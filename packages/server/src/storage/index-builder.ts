/**
 * 索引重建（T05 验收标准 2：实体写入后 index.json 自动同步更新）
 *
 * 从各实体文件构建 ProjectIndex（两级：requirementIndex + taskIndex），
 * 写入 store/index.json。完整的分层访问/搜索增强在 T06 完善。
 *
 * 注意：本模块在实体仓储写后通过全局回调触发，需避免与仓储产生循环依赖。
 */
import { readJsonFile, writeJsonFile, invalidateCache } from "./io.js";
import { entityPath, storeSubdir } from "./paths.js";
import fs from "node:fs";
import type { RepoWorkspace } from "./workspace.js";
import type {
  Project,
  ProjectIndex,
  Requirement,
  Task,
  Diagram,
  DocumentFragment
} from "@fourstage/shared";

/** 读取目录下全部 JSON 文件（容忍单文件损坏） */
async function readAllInDir<T>(dir: string): Promise<T[]> {
  if (!fs.existsSync(dir)) return [];
  const files = await fs.promises.readdir(dir);
  const result: T[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const data = await readJsonFile<T>(`${dir}/${f}`);
      result.push(data);
    } catch {
      // 单实体损坏跳过（Git 冲突场景容忍），其余继续
    }
  }
  return result;
}

/**
 * 重建项目索引并写入 index.json
 * @returns 新索引
 */
export async function rebuildIndex(
  workspace: RepoWorkspace
): Promise<ProjectIndex> {
  const repoRoot = workspace.repoRoot;

  // 读取项目元数据（可能不存在则用占位）
  let projectId = workspace.entry.projectId;
  try {
    const meta = await readJsonFile<Project>(entityPath.meta(repoRoot));
    projectId = meta.projectId;
  } catch {
    // meta 不存在时使用仓库入口 projectId
  }

  // 读取各实体
  const requirements = await readAllInDir<Requirement>(
    storeSubdir(repoRoot, "requirements")
  );
  const tasks = await readAllInDir<Task>(storeSubdir(repoRoot, "tasks"));
  const diagrams = await readAllInDir<Diagram>(storeSubdir(repoRoot, "diagrams"));
  const fragments = await readAllInDir<DocumentFragment>(
    storeSubdir(repoRoot, "documents")
  );

  // 文档索引：按 docId 聚合分片
  const docMap = new Map<string, DocumentFragment[]>();
  for (const f of fragments) {
    const arr = docMap.get(f.docId) ?? [];
    arr.push(f);
    docMap.set(f.docId, arr);
  }
  const documentIndex = Array.from(docMap.entries()).map(([docId, frags]) => ({
    docId,
    title: frags[0]?.title ?? docId,
    summary: frags[0]?.content.slice(0, 50) ?? "",
    fragmentIds: frags
      .sort((a, b) => a.order - b.order)
      .map((f) => f.fragmentId)
  }));

  const diagramIndex = diagrams.map((d) => ({
    diagramId: d.diagramId,
    title: d.metadata.title,
    type: d.type,
    nodeCount: d.nodes.length,
    edgeCount: d.edges.length
  }));

  const requirementIndex = requirements.map((r) => ({
    requirementId: r.requirementId,
    title: r.title,
    status: r.status,
    branchName: r.branchName,
    taskCount: r.taskIds.length
  }));

  const taskIndex = tasks.map((t) => ({
    taskId: t.taskId,
    title: t.title,
    status: t.status,
    requirementId: t.requirementId
  }));

  const index: ProjectIndex = {
    projectId,
    version: (Date.now() / 1000) | 0,
    documentIndex,
    diagramIndex,
    requirementIndex,
    taskIndex
  };

  await writeJsonFile(entityPath.index(repoRoot), index);
  return index;
}

/** 读取当前项目索引（不存在返回 null） */
export async function readIndex(
  repoRoot: string
): Promise<ProjectIndex | null> {
  try {
    return await readJsonFile<ProjectIndex>(entityPath.index(repoRoot));
  } catch {
    return null;
  }
}

/** 使索引缓存失效（实体变更后调用） */
export function invalidateIndexCache(repoRoot: string): void {
  invalidateCache(entityPath.index(repoRoot));
}
