/**
 * 仓库路径解析工具
 *
 * 对应开发文档 7.2 目录结构：
 * {仓库根}/.fourstage/
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
export const FOURSTAGE_DIR = ".fourstage";

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

/** .fourstage 根路径 */
export function fourstageRoot(repoRoot: string): string {
  return path.join(repoRoot, FOURSTAGE_DIR);
}

/** 仓库入口元文件路径 */
export function repoEntryPath(repoRoot: string): string {
  return path.join(fourstageRoot(repoRoot), REPO_ENTRY_FILE);
}

/** store 根路径 */
export function storeRoot(repoRoot: string): string {
  return path.join(fourstageRoot(repoRoot), STORE_DIR);
}

/** store 子目录路径 */
export function storeSubdir(repoRoot: string, sub: string): string {
  return path.join(storeRoot(repoRoot), sub);
}

/** 写入锁路径 */
export function lockPath(repoRoot: string): string {
  return path.join(fourstageRoot(repoRoot), LOCK_FILE);
}

/** 各类实体文件路径 */
export const entityPath = {
  meta: (repoRoot: string) => path.join(storeRoot(repoRoot), "meta.json"),
  index: (repoRoot: string) => path.join(storeRoot(repoRoot), "index.json"),
  document: (repoRoot: string, docId: string) =>
    path.join(storeSubdir(repoRoot, "documents"), `${docId}.json`),
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
