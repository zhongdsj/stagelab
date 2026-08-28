/**
 * 仓储工厂：聚合全部实体仓储，并绑定实体变更 → 索引重建联动
 *
 * 用法：
 *   const repos = createRepositories(workspace);
 *   await repos.requirement.save(req); // 自动触发索引重建
 */
import { setEntityChangedHandler } from "./base.js";
import {
  ProjectRepository,
  DiagramRepository,
  RequirementRepository,
  TaskRepository,
  ChangeRecordRepository,
  BugRecordRepository,
  DocumentFragmentRepository
} from "./index.js";
import { rebuildIndex, invalidateIndexCache } from "../index-builder.js";
import type { RepoWorkspace } from "../workspace.js";

export interface Repositories {
  project: ProjectRepository;
  diagram: DiagramRepository;
  requirement: RequirementRepository;
  task: TaskRepository;
  changeRecord: ChangeRecordRepository;
  bugRecord: BugRecordRepository;
  documentFragment: DocumentFragmentRepository;
  /** 手动触发一次索引重建 */
  rebuildIndex: (repoRoot: string) => Promise<void>;
}

/**
 * 创建某仓库的仓储集合，并绑定全局变更回调（索引联动）
 * 多个仓库时，回调按 repoRoot 路由到对应仓库重建索引
 */
export function createRepositories(
  workspace: RepoWorkspace
): Repositories {
  const project = new ProjectRepository(workspace);
  const diagram = new DiagramRepository(workspace);
  const requirement = new RequirementRepository(workspace);
  const task = new TaskRepository(workspace);
  const changeRecord = new ChangeRecordRepository(workspace);
  const bugRecord = new BugRecordRepository(workspace);
  const documentFragment = new DocumentFragmentRepository(workspace);

  // 全局回调：按 repoRoot 重建对应仓库索引
  setEntityChangedHandler(async (repoRoot) => {
    if (repoRoot !== workspace.repoRoot) return;
    invalidateIndexCache(repoRoot);
    await rebuildIndex(workspace);
  });

  return {
    project,
    diagram,
    requirement,
    task,
    changeRecord,
    bugRecord,
    documentFragment,
    rebuildIndex: async (repoRoot) => {
      if (repoRoot !== workspace.repoRoot) return;
      invalidateIndexCache(repoRoot);
      await rebuildIndex(workspace);
    }
  };
}
