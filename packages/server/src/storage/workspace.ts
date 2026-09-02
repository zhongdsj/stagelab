/**
 * 仓库工作区管理：多仓库实例 + --repo 参数解析
 *
 * 对应开发文档 7.3 工作方式：
 * - Node 服务接收 --repo /path/to/your-git-repo
 * - 支持同时打开多个仓库实例，每个仓库一套独立项目
 */
import path from "node:path";
import {
  initRepo,
  loadRepoEntry,
  isRepoInitialized,
  type RepoEntryMeta
} from "./repo.js";
import {
  registerRepo,
  listRegisteredRepos,
  replaceRegistryRepos
} from "./registry.js";

/** 仓库工作区状态 */
export interface RepoWorkspace {
  repoRoot: string; // 仓库绝对路径
  entry: RepoEntryMeta; // 入口元数据（含 projectId）
}

/** 已加载的仓库工作区实例 */
const workspaces = new Map<string, RepoWorkspace>();

/** 校验并规范化仓库根路径 */
function normalizeRepoRoot(repoRoot: string): string {
  return path.resolve(repoRoot);
}

/**
 * 打开（或加载）一个仓库工作区
 * 若仓库未初始化则先初始化
 */
export async function openWorkspace(repoRoot: string): Promise<RepoWorkspace> {
  const root = normalizeRepoRoot(repoRoot);
  const cached = workspaces.get(root);
  if (cached) return cached;

  // 未初始化则初始化
  if (!isRepoInitialized(root)) {
    await initRepo(root);
  }
  const entry = await loadRepoEntry(root);
  if (!entry) {
    throw new Error(`仓库未正确初始化: ${root}`);
  }

  const ws: RepoWorkspace = { repoRoot: root, entry };
  workspaces.set(root, ws);
  // 登记到注册表，便于服务重启后自动恢复（幂等）
  registerRepo(root);
  return ws;
}

/**
 * 启动时从注册表恢复仓库工作区
 *
 * - 逐个校验仓库仍有效（.stagelab/project.meta.json 存在）
 * - 有效 → 加载进内存；无效 → 跳过（视为失效，不保留）
 * - 回写注册表，自动清理失效项
 */
export async function loadRegisteredWorkspaces(): Promise<RepoWorkspace[]> {
  const roots = listRegisteredRepos();
  const loaded: RepoWorkspace[] = [];
  const valid: string[] = [];
  for (const root of roots) {
    try {
      if (!isRepoInitialized(root)) continue; // 仓库已失效（.stagelab 被删）
      const ws = await openWorkspace(root);
      loaded.push(ws);
      valid.push(root);
    } catch {
      // 加载失败视为失效，跳过
    }
  }
  replaceRegistryRepos(valid);
  return loaded;
}

/** 获取当前工作仓库（默认取第一个，或显式指定） */
export async function getWorkspace(repoRoot?: string): Promise<RepoWorkspace> {
  if (repoRoot) {
    return openWorkspace(repoRoot);
  }
  if (workspaces.size === 0) {
    throw new Error("未加载任何仓库，请先 init 或指定 --repo");
  }
  // 返回最近加载的实例
  const last = Array.from(workspaces.values()).pop()!;
  return last;
}

/** 列出已加载的全部工作区 */
export function listWorkspaces(): RepoWorkspace[] {
  return Array.from(workspaces.values());
}

/** 移除已加载的工作区实例（项目删除后调用） */
export function removeWorkspace(repoRoot: string): void {
  workspaces.delete(path.resolve(repoRoot));
}

/** 从进程参数解析 --repo 值 */
export function parseRepoArg(argv: string[]): string | undefined {
  const idx = argv.indexOf("--repo");
  if (idx !== -1 && argv[idx + 1]) {
    return argv[idx + 1];
  }
  return undefined;
}
