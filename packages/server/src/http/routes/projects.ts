/**
 * HTTP 路由：项目与索引（开发文档第九章）
 *
 * GET  /api/projects                        项目列表
 * POST /api/projects                        创建项目（默认进入阶段1）
 * GET  /api/projects/:id                    项目详情
 * PUT  /api/projects/:id                    重命名项目（修改）
 * DELETE /api/projects/:id                  删除项目（级联删除 .fourstage 目录）
 * PUT  /api/projects/:id/stage              切换阶段
 * GET  /api/projects/:id/index              获取项目索引
 *
 * 注：项目删除/重命名仅 HTTP 层提供，MCP 端不暴露删除操作（方案1）。
 */
import type { FastifyInstance } from "fastify";
import { StageSchema } from "@fourstage/shared";
import { listWorkspaces, openWorkspace } from "../../storage/workspace.js";
import {
  listProjects,
  createProject,
  getProjectMeta,
  switchProjectStage,
  updateProjectName,
  deleteProject
} from "../../services/project.service.js";
import { getProjectIndex } from "../../services/index.service.js";
import {
  HttpError,
  requireWorkspaceByProjectId,
  requireCurrentWorkspace
} from "./_util.js";

/** 注册项目类路由 */
export function registerProjectRoutes(app: FastifyInstance): void {
  // 项目列表（全部已加载工作区）
  app.get("/api/projects", async () => {
    const result = [];
    for (const ws of listWorkspaces()) {
      result.push(...(await listProjects(ws)));
    }
    return result;
  });

  // 创建项目
  app.post("/api/projects", async (request) => {
    const body = (request.body ?? {}) as { projectName?: string; repoRoot?: string };
    if (!body.projectName || !String(body.projectName).trim()) {
      throw new HttpError(400, "projectName 必填");
    }
    const ws = body.repoRoot
      ? await openWorkspace(body.repoRoot)
      : await requireCurrentWorkspace();
    return createProject(ws, body.projectName);
  });

  // 项目详情
  app.get("/api/projects/:id", async (request) => {
    const { id } = request.params as { id: string };
    const ws = requireWorkspaceByProjectId(id);
    return getProjectMeta(ws);
  });

  // 重命名项目（修改）
  app.put("/api/projects/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { projectName?: string };
    if (!body.projectName || !String(body.projectName).trim()) {
      throw new HttpError(400, "projectName 必填");
    }
    const ws = requireWorkspaceByProjectId(id);
    return updateProjectName(ws, String(body.projectName).trim());
  });

  // 删除项目（级联删除 .fourstage 目录，并从已加载工作区移除）
  app.delete("/api/projects/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const ws = requireWorkspaceByProjectId(id);
    await deleteProject(ws);
    reply.code(204).send();
  });

  // 切换阶段
  app.put("/api/projects/:id/stage", async (request) => {
    const { id } = request.params as { id: string };
    const ws = requireWorkspaceByProjectId(id);
    const stage = (request.body as { stage?: string })?.stage;
    const parsed = StageSchema.safeParse(stage);
    if (!parsed.success) {
      throw new HttpError(400, "stage 必须是 s1/s2/s3/s4");
    }
    return switchProjectStage(ws, parsed.data);
  });

  // 项目索引
  app.get("/api/projects/:id/index", async (request) => {
    const { id } = request.params as { id: string };
    const ws = requireWorkspaceByProjectId(id);
    return getProjectIndex(ws);
  });
}
