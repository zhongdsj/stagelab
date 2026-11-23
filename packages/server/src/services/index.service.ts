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
import { entityPath, storeSubdir, documentFragmentPath } from "../storage/paths.js";
import fs from "node:fs";
import type {
  ProjectIndex,
  Diagram,
  DocumentFragment,
  DocumentMeta,
  Requirement,
  Task
} from "@stagelab/shared";

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

/** 读取 documents/{docId}/ 嵌套目录下全部分片（搜索用，排除 meta.json） */
async function readAllDocumentFragments(
  repoRoot: string
): Promise<DocumentFragment[]> {
  const docsDir = storeSubdir(repoRoot, "documents");
  if (!fs.existsSync(docsDir)) return [];
  const entries = await fs.promises.readdir(docsDir, { withFileTypes: true });
  const result: DocumentFragment[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = `${docsDir}/${e.name}`;
    const files = await fs.promises.readdir(sub);
    for (const f of files) {
      if (!f.endsWith(".json") || f === "meta.json") continue;
      try {
        result.push(await readJsonFile<DocumentFragment>(`${sub}/${f}`));
      } catch {
        // 单分片损坏跳过
      }
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
    const frags = await readAllDocumentFragments(repoRoot);
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


/* ========== 富搜索（HTTP/前端专用；MCP 出参保持 SearchHit 不变） ========== */

/** 富搜索结果实体类型：文档（meta）/ 文档分片 / 图元 / 需求 / 任务 */
export type RichSearchKind =
  | "document"
  | "fragment"
  | "diagram"
  | "requirement"
  | "task";

/** 命中区间（相对 snippet 的 UTF-16 下标，供前端精确高亮） */
export interface SearchRange {
  start: number;
  end: number;
}

/**
 * 富搜索命中项：在 SearchHit 基础上补定位与摘要字段，供 HTTP /search 与前端搜索框使用。
 * - document：文档 meta 命中（docId）
 * - fragment：分片命中（docId/docTitle/fragmentId/fragmentOrder，可直接跳转锚点）
 * - diagram / requirement / task：对应实体 id 与类型/状态副标题
 */
export interface RichSearchHit {
  kind: RichSearchKind;
  id: string;
  title: string;
  /** 副标题：类型/状态/所属文档等，一行说明 */
  subtitle?: string;
  /** 命中摘要（折叠空白后的上下文片段） */
  snippet?: string;
  /** snippet 内命中区间（前端高亮用） */
  ranges?: SearchRange[];
  /** 相关度打分（越大越相关，仅用于排序） */
  score: number;
  // —— 文档侧 ——
  docId?: string;
  docTitle?: string;
  fragmentId?: string;
  fragmentOrder?: number;
  // —— 图侧 ——
  diagramId?: string;
  diagramType?: string;
  // —— 需求/任务侧 ——
  requirementId?: string;
  taskId?: string;
}

/** 读取 documents/{docId}/meta.json 全部文档元信息（搜索用，含标题/摘要/类型） */
async function readAllDocumentMetas(repoRoot: string): Promise<DocumentMeta[]> {
  const docsDir = storeSubdir(repoRoot, "documents");
  if (!fs.existsSync(docsDir)) return [];
  const entries = await fs.promises.readdir(docsDir, { withFileTypes: true });
  const result: DocumentMeta[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      result.push(
        await readJsonFile<DocumentMeta>(`${docsDir}/${e.name}/meta.json`)
      );
    } catch {
      // meta.json 缺失/损坏跳过（分片仍可被搜索到）
    }
  }
  return result;
}

/** 统计关键词出现次数（已归一化文本） */
function countOccurrences(text: string, keyword: string): number {
  const kw = normalize(keyword);
  if (!kw) return 0;
  let count = 0;
  let p = text.indexOf(kw);
  while (p >= 0 && count < 50) {
    count += 1;
    p = text.indexOf(kw, p + kw.length);
  }
  return count;
}

/**
 * 基于「标题 + 正文」计算相关度：
 * 标题完全相等 > 标题前缀 > 标题包含 > 正文出现次数（封顶 6 次）。
 */
function scoreMatch(keyword: string, title: string, body?: string): number {
  const kw = normalize(keyword);
  const t = normalize(title);
  let score = 0;
  if (t === kw) score += 100;
  else if (t.startsWith(kw)) score += 70;
  else if (t.includes(kw)) score += 50;
  if (body) {
    const count = countOccurrences(normalize(body), kw);
    if (count > 0) score += Math.min(count, 6) * 5;
  }
  return score;
}

/**
 * 生成命中摘要：折叠空白后取首个命中位置前后 window 字符，
 * 并给出 snippet 内全部命中区间（前端据此包 <mark> 高亮）。
 */
function buildSnippet(
  text: string,
  keyword: string,
  window = 60
): { snippet: string; ranges: SearchRange[] } | undefined {
  const flat = text.replace(/\s+/g, " ").trim();
  const kw = normalize(keyword);
  if (!flat || !kw) return undefined;
  const idx = normalize(flat).indexOf(kw);
  if (idx < 0) return undefined;
  const start = Math.max(0, idx - window);
  const end = Math.min(flat.length, idx + kw.length + window);
  const snippet =
    (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
  return { snippet, ranges: findRanges(snippet, keyword) };
}

/** 依次尝试用候选文本生成摘要（正文无命中时回退标题等），取第一个命中的 */
function pickSnippet(
  keyword: string,
  ...texts: Array<string | undefined>
): { snippet: string; ranges: SearchRange[] } | undefined {
  for (const t of texts) {
    if (!t) continue;
    const s = buildSnippet(t, keyword);
    if (s) return s;
  }
  return undefined;
}

/** 找出 snippet 内全部命中区间（大小写不敏感） */
function findRanges(text: string, keyword: string): SearchRange[] {
  const kw = normalize(keyword);
  const hay = normalize(text);
  const ranges: SearchRange[] = [];
  if (!kw) return ranges;
  let p = hay.indexOf(kw);
  while (p >= 0 && ranges.length < 20) {
    ranges.push({ start: p, end: p + kw.length });
    p = hay.indexOf(kw, p + kw.length);
  }
  return ranges;
}

/** 图类型中文标签（副标题用） */
function diagramTypeLabel(type: string): string {
  const map: Record<string, string> = {
    architecture: "架构图",
    class: "类图",
    flow: "流程图"
  };
  return map[type] ?? type;
}

/** 需求/任务状态中文标签（副标题用） */
function statusLabel(status: string): string {
  const map: Record<string, string> = {
    dev: "开发中",
    test: "测试中",
    done: "已完成",
    abandoned: "已废弃",
    pending: "待处理",
    in_progress: "进行中"
  };
  return map[status] ?? status;
}

/**
 * 富搜索：在现有 searchProjectContent 基础上补文档 meta、分片定位与命中摘要。
 *
 * 与 MCP 的 searchProjectContent 解耦：后者出参保持 { entityType, id, title }，
 * 本函数专供 HTTP /search 与前端搜索框使用。
 *
 * @param keyword 关键词（调用方保证非空；这里再做一次 trim 兜底）
 * @param options.types 限定实体类型（缺省全部，含 fragment）
 * @param options.limit 结果条数上限（默认 30，最大 200）
 */
export async function searchProjectContentRich(
  workspace: RepoWorkspace,
  keyword: string,
  options: { types?: RichSearchKind[]; limit?: number } = {}
): Promise<RichSearchHit[]> {
  if (!keyword.trim()) return [];
  const types: RichSearchKind[] =
    options.types && options.types.length
      ? options.types
      : ["document", "fragment", "diagram", "requirement", "task"];
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 200);
  const repoRoot = workspace.repoRoot;
  const hits: RichSearchHit[] = [];

  // 文档 meta 与分片：一次读出文档标题表，供分片标题兜底
  const docMetas = types.includes("document") || types.includes("fragment")
    ? await readAllDocumentMetas(repoRoot)
    : [];
  const docTitleById = new Map(docMetas.map((m) => [m.docId, m.title]));

  // 文档（meta）：标题 / 摘要 / 类型
  if (types.includes("document")) {
    for (const m of docMetas) {
      const body = [m.summary ?? "", m.docType ?? ""].join(" ");
      const score = scoreMatch(keyword, m.title, body);
      if (score === 0) continue;
      const snip = pickSnippet(keyword, body, m.title);
      hits.push({
        kind: "document",
        id: m.docId,
        title: m.title,
        subtitle: [m.docType, m.status ? statusLabel(m.status) : ""]
          .filter(Boolean)
          .join(" · "),
        snippet: snip?.snippet,
        ranges: snip?.ranges,
        score,
        docId: m.docId,
        docTitle: m.title
      });
    }
  }

  // 文档分片：标题 / 内容，标题缺失时兜底「文档标题 › #order」
  if (types.includes("fragment")) {
    const frags = await readAllDocumentFragments(repoRoot);
    for (const f of frags) {
      const docTitle = docTitleById.get(f.docId) ?? f.docId;
      const title = f.title
        ? f.title
        : `${docTitle} › #${f.order}`;
      const score = scoreMatch(keyword, title, f.content + " " + (f.summary ?? ""));
      if (score === 0) continue;
      const snip = pickSnippet(keyword, f.content, f.summary, title);
      hits.push({
        kind: "fragment",
        id: `${f.docId}#${f.fragmentId}`,
        title,
        subtitle: `文档分片 · ${docTitle}`,
        snippet: snip?.snippet,
        ranges: snip?.ranges,
        score,
        docId: f.docId,
        docTitle,
        fragmentId: f.fragmentId,
        fragmentOrder: f.order
      });
    }
  }

  // 图元：标题 / 描述 / 节点 / 连线 / 分组
  if (types.includes("diagram")) {
    const diagrams = await readAllInDir<Diagram>(
      storeSubdir(repoRoot, "diagrams")
    );
    for (const d of diagrams) {
      const body = diagramSearchText(d);
      const score = scoreMatch(keyword, d.metadata.title, body);
      if (score === 0) continue;
      const snip = pickSnippet(keyword, body, d.metadata.title);
      hits.push({
        kind: "diagram",
        id: d.diagramId,
        title: d.metadata.title,
        subtitle: `${diagramTypeLabel(d.type)} · ${d.nodes.length} 节点 / ${d.edges.length} 连线`,
        snippet: snip?.snippet,
        ranges: snip?.ranges,
        score,
        diagramId: d.diagramId,
        diagramType: d.type
      });
    }
  }

  // 需求：标题 / 描述
  if (types.includes("requirement")) {
    const reqs = await readAllInDir<Requirement>(
      storeSubdir(repoRoot, "requirements")
    );
    for (const r of reqs) {
      const body = r.description ?? "";
      const score = scoreMatch(keyword, r.title, body);
      if (score === 0) continue;
      const snip = pickSnippet(keyword, body, r.title);
      hits.push({
        kind: "requirement",
        id: r.requirementId,
        title: r.title,
        subtitle: `需求 · ${statusLabel(r.status)}`,
        snippet: snip?.snippet,
        ranges: snip?.ranges,
        score,
        requirementId: r.requirementId
      });
    }
  }

  // 任务：标题 / 描述 / 验收标准
  if (types.includes("task")) {
    const tasks = await readAllInDir<Task>(storeSubdir(repoRoot, "tasks"));
    for (const t of tasks) {
      const body = [t.description, t.acceptanceCriteria].filter(Boolean).join(" ");
      const score = scoreMatch(keyword, t.title, body);
      if (score === 0) continue;
      const snip = pickSnippet(keyword, body, t.title);
      hits.push({
        kind: "task",
        id: t.taskId,
        title: t.title,
        subtitle: `任务 · ${statusLabel(t.status)}`,
        snippet: snip?.snippet,
        ranges: snip?.ranges,
        score,
        requirementId: t.requirementId,
        taskId: t.taskId
      });
    }
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.kind.localeCompare(b.kind) ||
      a.title.localeCompare(b.title)
  );
  return hits.slice(0, limit);
}

/** 按需读取指定文档分片（分层访问第二层） */
export async function readFragment(
  workspace: RepoWorkspace,
  docId: string,
  fragmentId: string
): Promise<DocumentFragment> {
  return readJsonFile<DocumentFragment>(
    documentFragmentPath(workspace.repoRoot, docId, fragmentId)
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
