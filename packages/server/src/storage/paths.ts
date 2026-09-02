/**
 * 仓库路径解析工具
 *
 * 对应开发文档 7.2 目录结构：
 * {仓库根}/.stagelab/
 *   ├── project.meta.json      # 仓库入口元文件
 *   ├── store/
 *   │   ├── meta.json          # Project
 *   │   ├── index.json         # ProjectIndex
 *   │   ├── documents/
 *   │   ├── diagrams/
 *   │   ├── requirements/
 *   │   ├── tasks/
 *   │   └── records/
 *   └── .write.lock            # 写入互斥锁
 */
import path from "node:path";

/** 工具专属目录名 */
export const STAGELAB_DIR = ".stagelab";

/** 仓库入口元文件 */
export const REPO_ENTRY_FILE = "project.meta.json";

/** store 目录名 */
export const STORE_DIR = "store";

/** 写入锁文件名 */
export const LOCK_FILE = ".write.lock";

/** store 子目录 */
export const STORE_SUBDIRS = [
  "documents",
  "diagrams",
  "requirements",
  "tasks",
  "records"
] as const;

/** .stagelab 根路径 */
export function stagelabRoot(repoRoot: string): string {
  return path.join(repoRoot, STAGELAB_DIR);
}

/** 仓库入口元文件路径 */
export function repoEntryPath(repoRoot: string): string {
  return path.join(stagelabRoot(repoRoot), REPO_ENTRY_FILE);
}

/** store 根路径 */
export function storeRoot(repoRoot: string): string {
  return path.join(stagelabRoot(repoRoot), STORE_DIR);
}

/** store 子目录路径 */
export function storeSubdir(repoRoot: string, sub: string): string {
  return path.join(storeRoot(repoRoot), sub);
}

/** 写入锁路径 */
export function lockPath(repoRoot: string): string {
  return path.join(stagelabRoot(repoRoot), LOCK_FILE);
}

/** 各类实体文件路径 */
export const entityPath = {
  meta: (repoRoot: string) => path.join(storeRoot(repoRoot), "meta.json"),
  index: (repoRoot: string) => path.join(storeRoot(repoRoot), "index.json"),
  diagram: (repoRoot: string, diagramId: string) =>
    path.join(storeSubdir(repoRoot, "diagrams"), `${diagramId}.json`),
  requirement: (repoRoot: string, requirementId: string) =>
    path.join(storeSubdir(repoRoot, "requirements"), `${requirementId}.json`),
  task: (repoRoot: string, taskId: string) =>
    path.join(storeSubdir(repoRoot, "tasks"), `${taskId}.json`),
  changeRecord: (repoRoot: string, changeId: string) =>
    path.join(storeSubdir(repoRoot, "records"), `${changeId}.json`),
  bugRecord: (repoRoot: string, bugId: string) =>
    path.join(storeSubdir(repoRoot, "records"), `${bugId}.json`)
};

/** 文档目录：store/documents/{docId}/（内部分片文件 + meta.json，避免平铺散落） */
export function documentDir(repoRoot: string, docId: string): string {
  return path.join(storeSubdir(repoRoot, "documents"), docId);
}

/** 文档分片文件路径 */
export function documentFragmentPath(
  repoRoot: string,
  docId: string,
  fragmentId: string
): string {
  return path.join(documentDir(repoRoot, docId), `${fragmentId}.json`);
}

/** 文档元信息文件路径 */
export function documentMetaPath(repoRoot: string, docId: string): string {
  return path.join(documentDir(repoRoot, docId), "meta.json");
}

/** 影响范围索引（独立于 Diagram 存储，随图写后增量维护）：store/impact/{diagramId}.json */
export function impactPath(repoRoot: string, diagramId: string): string {
  return path.join(storeSubdir(repoRoot, "impact"), `${diagramId}.json`);
}

/** 验证历史目录：store/verifications/{diagramId}/（内部分条记录文件，避免平铺散落） */
export function verificationDir(
  repoRoot: string,
  diagramId: string
): string {
  return path.join(storeSubdir(repoRoot, "verifications"), diagramId);
}

/** 单条验证记录文件路径：store/verifications/{diagramId}/{verificationId}.json */
export function verificationPath(
  repoRoot: string,
  diagramId: string,
  verificationId: string
): string {
  return path.join(verificationDir(repoRoot, diagramId), `${verificationId}.json`);
}
