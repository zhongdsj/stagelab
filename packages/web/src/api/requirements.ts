/**
 * 需求与任务 API（对接 T12 新增 HTTP 路由）
 */
import type { Requirement, Task, RequirementStatus, TaskStatus } from "@fourstage/shared";
import { http } from "./client.js";

/** 需求列表项（轻量） */
export interface RequirementItem {
  requirementId: string;
  title: string;
  description?: string;
  status: RequirementStatus;
  branchName?: string;
  taskCount: number;
}

/** 任务摘要（需求下任务列表） */
export interface TaskSummary {
  taskId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  changeType: "新增" | "修改" | "删除";
}

/** 需求列表 */
export function listRequirements(projectId: string): Promise<RequirementItem[]> {
  return http.get<RequirementItem[]>(
    `/api/projects/${encodeURIComponent(projectId)}/requirements`
  );
}

/** 创建需求 */
export function createRequirement(
  projectId: string,
  title: string,
  options?: { description?: string; branchName?: string }
): Promise<Requirement> {
  return http.post<Requirement>(
    `/api/projects/${encodeURIComponent(projectId)}/requirements`,
    { title, ...options }
  );
}

/** 更新需求 */
export function updateRequirement(
  projectId: string,
  requirementId: string,
  patch: Partial<{
    title: string;
    description: string;
    branchName: string;
    status: RequirementStatus;
  }>
): Promise<Requirement> {
  return http.put<Requirement>(
    `/api/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(requirementId)}`,
    patch
  );
}

/** 删除需求（级联删除其下全部任务） */
export function deleteRequirement(
  projectId: string,
  requirementId: string
): Promise<void> {
  return http.del<void>(
    `/api/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(requirementId)}`
  );
}

/** 按需求列出任务 */
export function listTasks(
  projectId: string,
  requirementId: string
): Promise<TaskSummary[]> {
  return http.get<TaskSummary[]>(
    `/api/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(requirementId)}/tasks`
  );
}

/** 创建任务 */
export function createTask(
  projectId: string,
  requirementId: string,
  task: {
    title: string;
    description?: string;
    acceptanceCriteria?: string;
    files?: string[];
    changeType: "新增" | "修改" | "删除";
  }
): Promise<Task> {
  return http.post<Task>(
    `/api/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(requirementId)}/tasks`,
    task
  );
}

/** 更新任务状态 */
export function updateTaskStatus(
  projectId: string,
  taskId: string,
  status: TaskStatus
): Promise<Task> {
  return http.put<Task>(
    `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/status`,
    { status }
  );
}

/** 更新任务内容（标题/描述/验收标准/文件/变更类型；状态单独用 updateTaskStatus） */
export function updateTask(
  projectId: string,
  taskId: string,
  patch: Partial<{
    title: string;
    description: string;
    acceptanceCriteria: string;
    files: string[];
    changeType: "新增" | "修改" | "删除";
  }>
): Promise<Task> {
  return http.put<Task>(
    `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
    patch
  );
}

/** 删除任务 */
export function deleteTask(projectId: string, taskId: string): Promise<void> {
  return http.del<void>(
    `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`
  );
}
