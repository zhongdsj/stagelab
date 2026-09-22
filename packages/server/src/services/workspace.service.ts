/**
 * 仓库工作区服务（T07 服务⑤）
 *
 * 对应开发文档 8.1 工具：init_repo_project / set_working_repo / get_working_repo
 */
import {
  openWorkspace,
  setCurrentRepo,
  getWorkspace,
  listWorkspaces,
  loadRegisteredWorkspaces,
  parseRepoArg,
  type RepoWorkspace
} from "../storage/workspace.js";
import { initRepo } from "../storage/repo.js";
import { createRepositories, type Repositories } from "../storage/repositories/factory.js";

/** 初始化仓库项目（生成 .stagelab 与 store，并设为当前工作仓库） */
export async function initRepoProject(repoRoot: string): Promise<RepoWorkspace> {
  const ws = await setCurrentRepo(repoRoot);
  await initRepo(repoRoot);
  return ws;
}

/**
 * 切换当前工作仓库（显式设置 current 指针，后续读取基于新仓库）
 *
 * 入参 repoRoot / projectId 二选一（互斥）：
 * - repoRoot：按路径直接切换（未加载则加载）
 * - projectId：在已加载仓库中反查 repoRoot 后切换
 */
export async function setWorkingRepo(params: {
  repoRoot?: string;
  projectId?: string;
}): Promise<RepoWorkspace> {
  const { repoRoot, projectId } = params;
  if (repoRoot && projectId) {
    throw new Error("repoRoot 与 projectId 互斥，请只传其中一个");
  }
  if (repoRoot) {
    return setCurrentRepo(repoRoot);
  }
  if (projectId) {
    const hit = listWorkspaces().find((w) => w.entry.projectId === projectId);
    if (!hit) {
      throw new Error(
        `projectId 未匹配到已加载仓库: ${projectId}，请改用 repoRoot 指定路径`
      );
    }
    return setCurrentRepo(hit.repoRoot);
  }
  throw new Error("必须提供 repoRoot 或 projectId 之一");
}

/** 获取当前工作仓库信息 */
export async function getWorkingRepo(): Promise<RepoWorkspace | null> {
  try {
    return await getWorkspace();
  } catch {
    return null;
  }
}

/** 列出全部已加载仓库 */
export async function listWorkingRepos() {
  return listWorkspaces().map((w) => ({
    repoRoot: w.repoRoot,
    projectId: w.entry.projectId,
    schemaVersion: w.entry.schemaVersion
  }));
}

/**
 * 从进程参数初始化工作区
 *
 * 1. 先恢复注册表中的历史仓库（重启后项目列表自动恢复）
 * 2. --repo 显式指定的仓库优先加载（未在注册表则一并登记）
 */
export async function initFromArgs(argv: string[]): Promise<RepoWorkspace | null> {
  await loadRegisteredWorkspaces();
  const repoRoot = parseRepoArg(argv);
  if (!repoRoot) return null;
  // --repo 显式指定的仓库作为当前工作仓库
  return setCurrentRepo(repoRoot);
}

/** 获取当前仓库的仓储集合（不存在则抛错） */
export async function getRepositoriesForCurrent(): Promise<{
  workspace: RepoWorkspace;
  repos: Repositories;
}> {
  const workspace = await getWorkspace();
  return { workspace, repos: createRepositories(workspace) };
}
