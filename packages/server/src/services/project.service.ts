/**
 * 项目管理服务（T07 服务①）
 *
 * 对应开发文档 8.1 工具：create_project / list_projects / get_project_meta / switch_project_stage
 */
import crypto from "node:crypto";
import type { Stage, Project } from "@fourstage/shared";
import type { RepoWorkspace } from "../storage/workspace.js";
import { createRepositories } from "../storage/repositories/factory.js";

/** 创建项目（默认进入阶段1） */
export async function createProject(
  workspace: RepoWorkspace,
  projectName: string
): Promise<Project> {
  const repos = createRepositories(workspace);
  const now = Date.now();
  const project: Project = {
    projectId: workspace.entry.projectId,
    projectName,
    currentStage: "s1",
    createdAt: now,
    updatedAt: now,
    stage1: { docId: "", diagramIds: [] },
    stage2: { taskDocId: "", requirementIds: [], diagramIds: [] },
    stage3: { changeRecordIds: [] },
    stage4: { bugRecordIds: [] },
    indexId: `index-${workspace.entry.projectId}`
  };
  await repos.project.save(project);
  return project;
}

/** 获取项目列表（仅元信息） */
export async function listProjects(workspace: RepoWorkspace) {
  const repos = createRepositories(workspace);
  try {
    const p = await repos.project.get(workspace.entry.projectId);
    return [
      {
        projectId: p.projectId,
        projectName: p.projectName,
        currentStage: p.currentStage,
        updatedAt: p.updatedAt
      }
    ];
  } catch {
    return [];
  }
}

/** 获取单个项目元数据 */
export async function getProjectMeta(
  workspace: RepoWorkspace
): Promise<Project> {
  const repos = createRepositories(workspace);
  return repos.project.get(workspace.entry.projectId);
}

/** 切换项目当前阶段 */
export async function switchProjectStage(
  workspace: RepoWorkspace,
  stage: Stage
): Promise<Project> {
  const repos = createRepositories(workspace);
  const project = await repos.project.get(workspace.entry.projectId);
  project.currentStage = stage;
  project.updatedAt = Date.now();
  await repos.project.save(project);
  return project;
}

/** 生成通用 ID */
export function generateId(): string {
  return crypto.randomUUID();
}
