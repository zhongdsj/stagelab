/**
 * 索引服务（T06）
 *
 * 提供：
 * 1. 分层访问入口：getProjectIndex 返回轻量索引（两级 requirementIndex + taskIndex）
 * 2. 关键词搜索：searchProjectContent 搜索文档/图元/需求/任务，返回匹配 ID 列表
 *
 * 遵循约束：
 * - 索引优先：批量查询先走索引，不加载全量对象
 * - search 需要逐实体匹配内容时，按需读取实体文件（索引层仅存摘要/ID）
 */
import type { RepoWorkspace } from "../storage/workspace.js";
import {
  readIndex,
  rebuildIndex
} from "../storage/index-builder.js";
import {
  readJsonFile,
  FileNotFoundError
} from "../storage/io.js";
import { entityPath, storeSubdir } from "../storage/paths.js";
import fs from "node:fs";
import type {
  ProjectIndex,
  Diagram,
  DocumentFragment,
  Requirement,
  Task
} from "@fourstage/shared";

/** 索引查询结果（轻量分层访问） */
export interface ProjectIndexResult {
  projectId: string;
  version: number;
  documents: ProjectIndex["documentIndex"];
  diagrams: ProjectIndex["diagramIndex"];
  requirements: ProjectIndex["requirementIndex"];
  tasks: ProjectIndex["taskIndex"];
}

/** 搜索命中项 */
export interface SearchHit {
  entityType: "document" | "diagram" | "requirement" | "task";
  id: string;
  title: string;
}

/**
 * 获取项目索引（分层访问第一层）
 * 优先读缓存索引文件；不存在时触发重建
 */
export async function getProjectIndex(
  workspace: RepoWorkspace
): Promise<ProjectIndexResult> {
  const index = await readIndex(workspace.repoRoot);
  const effective =
    index ??
    (await rebuildIndex(workspace));

  return {
    projectId: effective.projectId,
    version: effective.version,
    documents: effective.documentIndex,
    diagrams: effective.diagramIndex,
    requirements: effective.requirementIndex,
    tasks: effective.taskIndex
  };
}

/** 读取某目录下全部 JSON（按需，用于搜索） */
async function readAllInDir<T>(dir: string): Promise<T[]> {
  if (!fs.existsSync(dir)) return [];
  const files = await fs.promises.readdir(dir);
  const result: T[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      result.push(await readJsonFile<T>(`${dir}/${f}`));
    } catch {
      // 单实体损坏跳过
    }
  }
  return result;
}

/** 小写化并去除空白（搜索归一化） */
function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/** 判断是否命中关键词 */
function matchKeyword(text: string, keyword: string): boolean {
  return normalize(text).includes(normalize(keyword));
}

/** 图节点/连线文本提取 */
function diagramSearchText(d: Diagram): string {
  const parts: string[] = [d.metadata.title, d.metadata.description ?? ""];
  for (const n of d.nodes as Array<{ label: string; description?: string; layer?: string }>) {
    parts.push(n.label, n.description ?? "", n.layer ?? "");
  }
  for (const e of d.edges) {
    parts.push(e.label ?? "", e.from, e.to);
  }
  for (const g of d.groups) {
    parts.push(g.title);
  }
  return parts.join(" ");
}

/**
 * 关键词搜索项目内容
 * @param workspace 仓库工作区
 * @param keyword 关键词
 * @param entityTypes 限定搜索范围（默认全部）
 */
export async function searchProjectContent(
  workspace: RepoWorkspace,
  keyword: string,
  entityTypes?: Array<"document" | "diagram" | "requirement" | "task">
): Promise<SearchHit[]> {
  if (!keyword.trim()) return [];
  const types = entityTypes ?? [
    "document",
    "diagram",
    "requirement",
    "task"
  ];
  const hits: SearchHit[] = [];
  const repoRoot = workspace.repoRoot;

  // 文档：搜索分片标题与内容
  if (types.includes("document")) {
    const frags = await readAllInDir<DocumentFragment>(
      storeSubdir(repoRoot, "documents")
    );
    const seen = new Set<string>();
    for (const f of frags) {
      if (
        matchKeyword(f.title, keyword) ||
        matchKeyword(f.content, keyword)
      ) {
        if (!seen.has(f.docId)) {
          seen.add(f.docId);
          hits.push({
            entityType: "document",
            id: f.docId,
            title: f.title
          });
        }
      }
    }
  }

  // 图元：搜索标题/节点/连线/分组
  if (types.includes("diagram")) {
    const diagrams = await readAllInDir<Diagram>(
      storeSubdir(repoRoot, "diagrams")
    );
    for (const d of diagrams) {
      if (matchKeyword(diagramSearchText(d), keyword)) {
        hits.push({
          entityType: "diagram",
          id: d.diagramId,
          title: d.metadata.title
        });
      }
    }
  }

  // 需求：搜索标题/描述
  if (types.includes("requirement")) {
    const reqs = await readAllInDir<Requirement>(
      storeSubdir(repoRoot, "requirements")
    );
    for (const r of reqs) {
      if (
        matchKeyword(r.title, keyword) ||
        (r.description && matchKeyword(r.description, keyword))
      ) {
        hits.push({
          entityType: "requirement",
          id: r.requirementId,
          title: r.title
        });
      }
    }
  }

  // 任务：搜索标题/描述
  if (types.includes("task")) {
    const tasks = await readAllInDir<Task>(storeSubdir(repoRoot, "tasks"));
    for (const t of tasks) {
      if (
        matchKeyword(t.title, keyword) ||
        matchKeyword(t.description, keyword)
      ) {
        hits.push({
          entityType: "task",
          id: t.taskId,
          title: t.title
        });
      }
    }
  }

  return hits;
}

/** 按需读取指定文档分片（分层访问第二层） */
export async function readFragment(
  workspace: RepoWorkspace,
  docId: string,
  fragmentId: string
): Promise<DocumentFragment> {
  return readJsonFile<DocumentFragment>(
    entityPath.document(workspace.repoRoot, fragmentId)
  );
}

/** 按需读取指定图元（分层访问第二层） */
export async function readDiagram(
  workspace: RepoWorkspace,
  diagramId: string
): Promise<Diagram> {
  return readJsonFile<Diagram>(
    entityPath.diagram(workspace.repoRoot, diagramId)
  );
}

export { FileNotFoundError };
