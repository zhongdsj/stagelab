/**
 * 仓库工作区服务（T07 服务⑤）
 *
 * 对应开发文档 8.1 工具：init_repo_project / set_working_repo / get_working_repo
 */
import {
  openWorkspace,
  getWorkspace,
  listWorkspaces,
  parseRepoArg,
  type RepoWorkspace
} from "../storage/workspace.js";
import { initRepo } from "../storage/repo.js";
import { createRepositories, type Repositories } from "../storage/repositories/factory.js";

/** 初始化仓库项目（生成 .fourstage 与 store，返回工作区） */
export async function initRepoProject(repoRoot: string): Promise<RepoWorkspace> {
  const ws = await openWorkspace(repoRoot);
  await initRepo(repoRoot);
  return ws;
}

/** 切换当前工作仓库 */
export async function setWorkingRepo(repoRoot: string): Promise<RepoWorkspace> {
  return openWorkspace(repoRoot);
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

/** 从进程参数初始化默认仓库（--repo 解析） */
export async function initFromArgs(argv: string[]): Promise<RepoWorkspace | null> {
  const repoRoot = parseRepoArg(argv);
  if (!repoRoot) return null;
  return openWorkspace(repoRoot);
}

/** 获取当前仓库的仓储集合（不存在则抛错） */
export async function getRepositoriesForCurrent(): Promise<{
  workspace: RepoWorkspace;
  repos: Repositories;
}> {
  const workspace = await getWorkspace();
  return { workspace, repos: createRepositories(workspace) };
}
