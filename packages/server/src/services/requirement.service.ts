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
    status: "active",
    taskIds: [],
    createdAt: now,
    updatedAt: now
  };
  await repos.requirement.save(requirement);
  return requirement;
}

/** 获取需求列表（轻量：标题/状态/分支/任务数） */
export async function listRequirements(workspace: RepoWorkspace) {
  const repos = createRepositories(workspace);
  const reqs = await repos.requirement.list();
  return reqs.map((r) => ({
    requirementId: r.requirementId,
    title: r.title,
    status: r.status,
    branchName: r.branchName,
    taskCount: r.taskIds.length
  }));
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
    tasks: tasks.map((t) => ({
      taskId: t.taskId,
      title: t.title,
      status: t.status
    }))
  };
}

/** 更新需求（状态切换 done/archived、分支名等） */
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
  const updated: Requirement = {
    ...req,
    ...patch,
    requirementId,
    updatedAt: Date.now()
  };
  await repos.requirement.save(updated);
  return updated;
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
  return updated;
}

/** 获取指定需求下的任务列表（轻量摘要） */
export async function listTasksByRequirement(
  workspace: RepoWorkspace,
  requirementId: string
) {
  const repos = createRepositories(workspace);
  const req = await repos.requirement.get(requirementId);
  const tasks: Array<{ taskId: string; title: string; status: TaskStatus }> = [];
  for (const taskId of req.taskIds) {
    try {
      const t = await repos.task.get(taskId);
      tasks.push({ taskId: t.taskId, title: t.title, status: t.status });
    } catch {
      // 跳过缺失任务
    }
  }
  return tasks;
}
