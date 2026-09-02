/**
 * 项目 API（对接 GET/POST /api/projects 等路由）
 */
import type { Project, ProjectIndex, Stage } from "@stagelab/shared";
import { http } from "./client.js";

/** 索引查询结果（轻量分层访问，对应服务端 ProjectIndexResult） */
export interface ProjectIndexResult {
  projectId: string;
  version: number;
  documents: ProjectIndex["documentIndex"];
  diagrams: ProjectIndex["diagramIndex"];
  requirements: ProjectIndex["requirementIndex"];
  tasks: ProjectIndex["taskIndex"];
}

/** 项目列表（全部已加载工作区） */
export function listProjects(): Promise<Project[]> {
  return http.get<Project[]>("/api/projects");
}

/** 创建项目（可选显式指定仓库根目录，默认当前工作区） */
export function createProject(
  projectName: string,
  repoRoot?: string
): Promise<Project> {
  return http.post<Project>("/api/projects", { projectName, repoRoot });
}

/** 项目详情 */
export function getProject(projectId: string): Promise<Project> {
  return http.get<Project>(
    `/api/projects/${encodeURIComponent(projectId)}`
  );
}

/** 重命名项目（修改项目名称） */
export function renameProject(
  projectId: string,
  projectName: string
): Promise<Project> {
  return http.put<Project>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    { projectName }
  );
}

/** 删除项目（级联删除 .stagelab 目录） */
export function deleteProject(projectId: string): Promise<void> {
  return http.del<void>(
    `/api/projects/${encodeURIComponent(projectId)}`
  );
}

/** 切换项目阶段 */
export function switchStage(
  projectId: string,
  stage: Stage
): Promise<Project> {
  return http.put<Project>(
    `/api/projects/${encodeURIComponent(projectId)}/stage`,
    { stage }
  );
}

/** 项目索引 */
export function getProjectIndex(projectId: string): Promise<ProjectIndexResult> {
  return http.get<ProjectIndexResult>(
    `/api/projects/${encodeURIComponent(projectId)}/index`
  );
}
