/**
 * 项目管理服务（T07 服务①）
 *
 * 对应开发文档 8.1 工具：create_project / list_projects / get_project_meta / switch_project_stage
 */
import crypto from "node:crypto";
import fs from "node:fs";
import type { Stage, Project } from "@stagelab/shared";
import type { RepoWorkspace } from "../storage/workspace.js";
import { createRepositories } from "../storage/repositories/factory.js";
import { stagelabRoot } from "../storage/paths.js";
import { clearCache } from "../storage/io.js";
import { removeWorkspace } from "../storage/workspace.js";
import { removeRepo } from "../storage/registry.js";

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

/** 重命名项目（修改项目名称） */
export async function updateProjectName(
  workspace: RepoWorkspace,
  projectName: string
): Promise<Project> {
  const repos = createRepositories(workspace);
  const project = await repos.project.get(workspace.entry.projectId);
  project.projectName = projectName;
  project.updatedAt = Date.now();
  await repos.project.save(project);
  return project;
}

/**
 * 删除项目（级联删除整仓库 .stagelab 目录）
 *
 * 一个仓库绑定一个 Project，删除项目即删除该仓库的 .stagelab 数据目录，
 * 并从已加载工作区实例中移除（MCP 端不暴露此操作，仅 HTTP/前端可调用）。
 */
export async function deleteProject(workspace: RepoWorkspace): Promise<void> {
  // 校验项目存在
  const repos = createRepositories(workspace);
  await repos.project.get(workspace.entry.projectId);
  // 删除整个 .stagelab 目录（含 meta/index/文档/图/需求/任务/记录）
  await fs.promises.rm(stagelabRoot(workspace.repoRoot), {
    recursive: true,
    force: true
  });
  // 从注册表移除该仓库地址（下次启动不再恢复）
  removeRepo(workspace.repoRoot);
  // 清空文件缓存，并从已加载工作区移除，避免后续读取残留旧数据
  clearCache();
  removeWorkspace(workspace.repoRoot);
}

/** 生成通用 ID */
export function generateId(): string {
  return crypto.randomUUID();
}
