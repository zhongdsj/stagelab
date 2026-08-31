/**
 * 需求与任务服务（T07 服务④）
 *
 * 对应开发文档 8.3 工具：
 * create_requirement / list_requirements / get_requirement / update_requirement
 * create_task / update_task_status / list_tasks_by_requirement
 *
 * 需求层级：Project → Requirement → Task（需求可关联 Git 分支）
 */
import type { Requirement, Task, RequirementStatus, TaskStatus } from "@fourstage/shared";
import type { RepoWorkspace } from "../storage/workspace.js";
import { createRepositories } from "../storage/repositories/factory.js";
import { generateId } from "./project.service.js";

/** 需求状态归一化：存量 active/archived 映射到三态（active→dev，archived→done） */
function normalizeRequirementStatus(status: string): RequirementStatus {
  if (status === "active") return "dev";
  if (status === "archived") return "done";
  return status as RequirementStatus;
}

/** 创建需求（可关联分支名） */
export async function createRequirement(
  workspace: RepoWorkspace,
  title: string,
  options: { description?: string; branchName?: string; requirementId?: string } = {}
): Promise<Requirement> {
  const repos = createRepositories(workspace);
  const now = Date.now();
  const requirement: Requirement = {
    requirementId: options.requirementId ?? generateId(),
    title,
    description: options.description,
    branchName: options.branchName,
    status: "dev",
    taskIds: [],
    createdAt: now,
    updatedAt: now
  };
  await repos.requirement.save(requirement);
  // 自动关联到项目 stage2.requirementIds（与 createTask 自动联动 taskIds 一致）
  await attachRequirementToProject(workspace, requirement.requirementId);
  return requirement;
}

/**
 * 将需求关联到项目 stage2.requirementIds（幂等去重）
 * 供 createRequirement 自动调用，也可用于存量数据同步
 */
export async function attachRequirementToProject(
  workspace: RepoWorkspace,
  requirementId: string
): Promise<void> {
  const repos = createRepositories(workspace);
  const project = await repos.project.get(workspace.entry.projectId);
  if (!project.stage2.requirementIds.includes(requirementId)) {
    project.stage2.requirementIds.push(requirementId);
    project.updatedAt = Date.now();
    await repos.project.save(project);
  }
}

/**
 * 同步存量需求到项目 stage2.requirementIds
 * 用于修复历史数据：将磁盘上全部需求与项目建立关联
 */
export async function syncRequirementIds(workspace: RepoWorkspace): Promise<number> {
  const repos = createRepositories(workspace);
  const reqs = await repos.requirement.list();
  const project = await repos.project.get(workspace.entry.projectId);
  let added = 0;
  for (const r of reqs) {
    if (!project.stage2.requirementIds.includes(r.requirementId)) {
      project.stage2.requirementIds.push(r.requirementId);
      added++;
    }
  }
  if (added > 0) {
    project.updatedAt = Date.now();
    await repos.project.save(project);
  }
  return added;
}

/** 获取需求列表（轻量：标题/状态/分支/任务数/更新时间） */
export async function listRequirements(workspace: RepoWorkspace) {
  const repos = createRepositories(workspace);
  const reqs = await repos.requirement.list();
  return reqs.map((r) => ({
    requirementId: r.requirementId,
    title: r.title,
    description: r.description,
    status: normalizeRequirementStatus(r.status),
    branchName: r.branchName,
    taskCount: r.taskIds.length,
    updatedAt: r.updatedAt
  }));
}

/**
 * 同步需求更新时间（T51）：需求内部任务变更时调用，保证「按活跃度排序」准确。
 * createTask/deleteTask 已由仓储 addTask/removeTask 联动 updatedAt，此处补齐
 * updateTaskStatus 与 updateTask 两个变更点。
 */
async function touchRequirement(
  workspace: RepoWorkspace,
  requirementId: string
): Promise<void> {
  const repos = createRepositories(workspace);
  const req = await repos.requirement.get(requirementId);
  req.updatedAt = Date.now();
  await repos.requirement.save(req);
}

/** 获取需求详情（含任务摘要列表） */
export async function getRequirement(
  workspace: RepoWorkspace,
  requirementId: string
) {
  const repos = createRepositories(workspace);
  const req = await repos.requirement.get(requirementId);
  const tasks: Task[] = [];
  for (const taskId of req.taskIds) {
    try {
      tasks.push(await repos.task.get(taskId));
    } catch {
      // 任务缺失跳过
    }
  }
  return {
    ...req,
    status: normalizeRequirementStatus(req.status),
    tasks: tasks.map((t) => ({
      taskId: t.taskId,
      title: t.title,
      status: t.status
    }))
  };
}

/** 更新需求（状态切换 dev/test/done、分支名等） */
export async function updateRequirement(
  workspace: RepoWorkspace,
  requirementId: string,
  patch: Partial<{
    title: string;
    description: string;
    branchName: string;
    status: RequirementStatus;
  }>
): Promise<Requirement> {
  const repos = createRepositories(workspace);
  const req = await repos.requirement.get(requirementId);
  // 过滤 undefined 字段，避免展开合并时覆盖实体原有有效值（如 status，问题3）
  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined)
  ) as Partial<Requirement>;
  const updated: Requirement = {
    ...req,
    ...cleanPatch,
    requirementId,
    updatedAt: Date.now()
  };
  await repos.requirement.save(updated);
  return updated;
}

/**
 * 删除需求（级联删除其下全部任务）
 *
 * 需求为独立实体，删除需求同时清理该需求下的所有任务文件。
 * MCP 端不暴露此操作，仅 HTTP/前端可调用。
 */
export async function deleteRequirement(
  workspace: RepoWorkspace,
  requirementId: string
): Promise<void> {
  const repos = createRepositories(workspace);
  const req = await repos.requirement.get(requirementId);
  // 级联删除需求下全部任务
  for (const taskId of req.taskIds) {
    await repos.task.delete(taskId);
  }
  await repos.requirement.delete(requirementId);
}

/** 在指定需求下创建任务 */
export async function createTask(
  workspace: RepoWorkspace,
  requirementId: string,
  taskInput: {
    taskId?: string;
    title: string;
    description: string;
    acceptanceCriteria: string;
    files: string[];
    changeType: "新增" | "修改" | "删除";
  }
): Promise<Task> {
  const repos = createRepositories(workspace);
  // 校验需求存在
  await repos.requirement.get(requirementId);

  const now = Date.now();
  const task: Task = {
    taskId: taskInput.taskId ?? generateId(),
    requirementId,
    title: taskInput.title,
    description: taskInput.description,
    status: "pending",
    acceptanceCriteria: taskInput.acceptanceCriteria,
    files: taskInput.files,
    changeType: taskInput.changeType,
    createdAt: now,
    updatedAt: now
  };
  await repos.task.save(task);
  await repos.requirement.addTask(requirementId, task.taskId);
  return task;
}

/** 更新任务完成状态 */
export async function updateTaskStatus(
  workspace: RepoWorkspace,
  taskId: string,
  status: TaskStatus
): Promise<Task> {
  const repos = createRepositories(workspace);
  const task = await repos.task.get(taskId);
  const updated: Task = { ...task, status, updatedAt: Date.now() };
  await repos.task.save(updated);
  // T51：任务状态变更即同步需求更新时间（无论是否触发自动流转）
  await touchRequirement(workspace, task.requirementId);
  // 自动流转：需求下所有任务均已完成且需求为开发 → 自动改为测试（done 为终态）
  await maybeAutoAdvanceRequirement(workspace, task.requirementId);
  return updated;
}

/**
 * 需求状态自动流转（T33）
 * 规则：需求下所有任务均「已完成(done)」且需求为「开发(dev)」时 → 自动改为「测试(test)」
 * done 为终态，不会被自动规则改回；空需求不触发
 */
async function maybeAutoAdvanceRequirement(
  workspace: RepoWorkspace,
  requirementId: string
): Promise<void> {
  const repos = createRepositories(workspace);
  const req = await repos.requirement.get(requirementId);
  // 仅开发态触发（存量 active 归一化为 dev 后同样生效）
  if (normalizeRequirementStatus(req.status) !== "dev") return;
  if (req.taskIds.length === 0) return; // 空需求不触发
  // 判断所有任务是否均已完成
  let allDone = true;
  for (const taskId of req.taskIds) {
    try {
      const t = await repos.task.get(taskId);
      if (t.status !== "done") {
        allDone = false;
        break;
      }
    } catch {
      // 任务缺失视为未完成
      allDone = false;
      break;
    }
  }
  if (allDone) {
    await updateRequirement(workspace, requirementId, { status: "test" });
  }
}

/**
 * 更新任务内容（标题/描述/验收标准/文件/变更类型；状态单独走 updateTaskStatus）
 * 与 updateRequirement 一致，合并前过滤 undefined 字段，防止覆盖有效值
 */
export async function updateTask(
  workspace: RepoWorkspace,
  taskId: string,
  patch: Partial<{
    title: string;
    description: string;
    acceptanceCriteria: string;
    files: string[];
    changeType: "新增" | "修改" | "删除";
  }>
): Promise<Task> {
  const repos = createRepositories(workspace);
  const task = await repos.task.get(taskId);
  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined)
  ) as Partial<Task>;
  const updated: Task = { ...task, ...cleanPatch, taskId, updatedAt: Date.now() };
  await repos.task.save(updated);
  // T51：任务内容变更同步需求更新时间
  await touchRequirement(workspace, task.requirementId);
  return updated;
}

/** 删除任务（同时从所属需求的 taskIds 中移除引用） */
export async function deleteTask(
  workspace: RepoWorkspace,
  taskId: string
): Promise<void> {
  const repos = createRepositories(workspace);
  const task = await repos.task.get(taskId);
  await repos.task.delete(taskId);
  await repos.requirement.removeTask(task.requirementId, taskId);
}

/** 获取指定需求下的任务列表（轻量摘要） */
export async function listTasksByRequirement(
  workspace: RepoWorkspace,
  requirementId: string
) {
  const repos = createRepositories(workspace);
  const req = await repos.requirement.get(requirementId);
  const tasks: Array<{
    taskId: string;
    title: string;
    description: string;
    status: TaskStatus;
    changeType: Task["changeType"];
  }> = [];
  for (const taskId of req.taskIds) {
    try {
      const t = await repos.task.get(taskId);
      tasks.push({
        taskId: t.taskId,
        title: t.title,
        description: t.description,
        status: t.status,
        changeType: t.changeType
      });
    } catch {
      // 跳过缺失任务
    }
  }
  return tasks;
}
