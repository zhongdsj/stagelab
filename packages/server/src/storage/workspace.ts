/**
 * 仓库工作区管理：多仓库实例 + --repo 参数解析
 *
 * 对应开发文档 7.3 工作方式：
 * - Node 服务接收 --repo /path/to/your-git-repo
 * - 支持同时打开多个仓库实例，每个仓库一套独立项目
 */
import fs from "node:fs";
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
  pruneRegistryRepos
} from "./registry.js";
import { stagelabRoot } from "./paths.js";
import { errLog } from "../logger.js";

/** 错误 → 可读消息 */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 仓库工作区状态 */
export interface RepoWorkspace {
  repoRoot: string; // 仓库绝对路径
  entry: RepoEntryMeta; // 入口元数据（含 projectId）
}

/** 已加载的仓库工作区实例 */
const workspaces = new Map<string, RepoWorkspace>();

/** 当前工作仓库根路径（setCurrentRepo 显式切换后记录；getWorkspace 无参时优先返回它） */
let currentRoot: string | undefined;

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
  // 登记到注册表，便于服务重启后自动恢复（幂等）；
  // 写入失败不影响工作区加载，避免把启动/切换流程抛挂
  try {
    await registerRepo(root);
  } catch (err) {
    errLog("registry", `仓库登记失败（不影响本次加载）: ${root} - ${errMessage(err)}`);
  }
  return ws;
}

/**
 * 启动时从注册表恢复仓库工作区
 *
 * - 失效判定收紧：仅 `.stagelab` 目录确实不存在才剔除，暂时性失败一律保留记录
 * - openWorkspace 抛错（磁盘忙/权限/网络盘抖动）→ 保留记录并告警，下次启动重试
 * - 失效项走增量删除，不再用内存快照整体覆盖（避免抹掉并发窗口内新注册的记录）
 */
export async function loadRegisteredWorkspaces(): Promise<RepoWorkspace[]> {
  const roots = listRegisteredRepos();
  const loaded: RepoWorkspace[] = [];
  const invalid: string[] = [];
  for (const root of roots) {
    // 只有 .stagelab 目录确实不存在才视为永久失效
    if (!fs.existsSync(stagelabRoot(root))) {
      invalid.push(root);
      continue;
    }
    try {
      const ws = await openWorkspace(root);
      loaded.push(ws);
    } catch (err) {
      // 暂时性失败：保留注册记录，仅告警，留待下次启动重试
      errLog(
        "registry",
        `仓库加载失败，保留注册记录待下次重试: ${root} - ${errMessage(err)}`
      );
    }
  }
  // 增量删除确认失效项（无失效项时不写盘）
  try {
    await pruneRegistryRepos(invalid);
  } catch (err) {
    errLog("registry", `注册表清理失败（不影响启动）: ${errMessage(err)}`);
  }
  return loaded;
}

/**
 * 设置当前工作仓库（加载并切换指针）
 * 与 openWorkspace 的区别：显式把 currentRoot 指向该仓库，后续无参 getWorkspace 优先返回它
 */
export async function setCurrentRepo(repoRoot: string): Promise<RepoWorkspace> {
  const ws = await openWorkspace(repoRoot);
  currentRoot = ws.repoRoot;
  return ws;
}

/** 获取当前工作仓库（默认取显式切换的 currentRoot，未设置则回退最近加载的实例） */
export async function getWorkspace(repoRoot?: string): Promise<RepoWorkspace> {
  if (repoRoot) {
    return openWorkspace(repoRoot);
  }
  // 优先返回显式切换的当前仓库
  if (currentRoot) {
    const ws = workspaces.get(currentRoot);
    if (ws) return ws;
  }
  if (workspaces.size === 0) {
    throw new Error("未加载任何仓库，请先 init 或指定 --repo");
  }
  // 回退：返回最近加载的实例
  const last = Array.from(workspaces.values()).pop()!;
  return last;
}

/** 列出已加载的全部工作区 */
export function listWorkspaces(): RepoWorkspace[] {
  return Array.from(workspaces.values());
}

/** 移除已加载的工作区实例（项目删除后调用） */
export function removeWorkspace(repoRoot: string): void {
  const root = path.resolve(repoRoot);
  workspaces.delete(root);
  // 移除的恰是当前工作仓库时清空指针，避免悬空
  if (currentRoot === root) currentRoot = undefined;
}

/** 从进程参数解析 --repo 值 */
export function parseRepoArg(argv: string[]): string | undefined {
  const idx = argv.indexOf("--repo");
  if (idx !== -1 && argv[idx + 1]) {
    return argv[idx + 1];
  }
  return undefined;
}
