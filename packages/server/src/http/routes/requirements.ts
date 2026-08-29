/**
 * HTTP 路由：需求与任务（T12 前端编辑扩展）
 *
 * GET  /api/projects/:id/requirements                  需求列表（轻量）
 * POST /api/projects/:id/requirements                  创建需求
 * PUT  /api/projects/:id/requirements/:rid             更新需求（状态/标题/描述/分支）
 * DELETE /api/projects/:id/requirements/:rid           删除需求（级联删除其下任务）
 * GET  /api/projects/:id/requirements/:rid/tasks       按需求列出任务
 * POST /api/projects/:id/requirements/:rid/tasks       在需求下创建任务
 * PUT  /api/projects/:id/tasks/:tid/status             更新任务状态
 *
 * 注：需求删除仅 HTTP 层提供，MCP 端不暴露删除操作（方案1）。
 */
import type { FastifyInstance } from "fastify";
import {
  createRequirement,
  listRequirements,
  updateRequirement,
  deleteRequirement,
  createTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  listTasksByRequirement
} from "../../services/requirement.service.js";
import { HttpError, requireWorkspaceByProjectId } from "./_util.js";

/** 需求状态白名单（与 shared RequirementStatusSchema 一致） */
const REQUIREMENT_STATUS = ["active", "done", "archived"] as const;
/** 任务状态白名单（与 shared TaskStatusSchema 一致） */
const TASK_STATUS = ["pending", "in_progress", "done"] as const;
/** 变更类型白名单 */
const CHANGE_TYPES = ["新增", "修改", "删除"] as const;

/** 注册需求与任务路由 */
export function registerRequirementRoutes(app: FastifyInstance): void {
  // 需求列表（轻量：标题/状态/分支/任务数）
  app.get("/api/projects/:id/requirements", async (request) => {
    const { id } = request.params as { id: string };
    const ws = requireWorkspaceByProjectId(id);
    return listRequirements(ws);
  });

  // 创建需求
  app.post("/api/projects/:id/requirements", async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      title?: string;
      description?: string;
      branchName?: string;
    };
    if (!body.title || !String(body.title).trim()) {
      throw new HttpError(400, "title 必填");
    }
    const ws = requireWorkspaceByProjectId(id);
    return createRequirement(ws, body.title, {
      description: body.description,
      branchName: body.branchName
    });
  });

  // 更新需求
  app.put("/api/projects/:id/requirements/:rid", async (request) => {
    const { id, rid } = request.params as { id: string; rid: string };
    const body = (request.body ?? {}) as {
      title?: string;
      description?: string;
      branchName?: string;
      status?: string;
    };
    if (body.status !== undefined && !(REQUIREMENT_STATUS as readonly string[]).includes(body.status)) {
      throw new HttpError(400, "status 必须是 active/done/archived");
    }
    const ws = requireWorkspaceByProjectId(id);
    return updateRequirement(ws, rid, {
      title: body.title,
      description: body.description,
      branchName: body.branchName,
      status: body.status as typeof REQUIREMENT_STATUS[number] | undefined
    });
  });

  // 删除需求（级联删除其下全部任务）
  app.delete("/api/projects/:id/requirements/:rid", async (request, reply) => {
    const { id, rid } = request.params as { id: string; rid: string };
    const ws = requireWorkspaceByProjectId(id);
    await deleteRequirement(ws, rid);
    reply.code(204).send();
  });

  // 按需求列出任务
  app.get("/api/projects/:id/requirements/:rid/tasks", async (request) => {
    const { id, rid } = request.params as { id: string; rid: string };
    const ws = requireWorkspaceByProjectId(id);
    return listTasksByRequirement(ws, rid);
  });

  // 创建任务
  app.post("/api/projects/:id/requirements/:rid/tasks", async (request) => {
    const { id, rid } = request.params as { id: string; rid: string };
    const body = (request.body ?? {}) as {
      title?: string;
      description?: string;
      acceptanceCriteria?: string;
      files?: string[];
      changeType?: string;
    };
    if (!body.title || !String(body.title).trim()) {
      throw new HttpError(400, "title 必填");
    }
    if (!(CHANGE_TYPES as readonly string[]).includes(body.changeType ?? "")) {
      throw new HttpError(400, "changeType 必须是 新增/修改/删除");
    }
    const ws = requireWorkspaceByProjectId(id);
    return createTask(ws, rid, {
      title: body.title,
      description: body.description ?? "",
      acceptanceCriteria: body.acceptanceCriteria ?? "",
      files: body.files ?? [],
      changeType: body.changeType as typeof CHANGE_TYPES[number]
    });
  });

  // 更新任务状态
  app.put("/api/projects/:id/tasks/:tid/status", async (request) => {
    const { id, tid } = request.params as { id: string; tid: string };
    const body = (request.body ?? {}) as { status?: string };
    if (!(TASK_STATUS as readonly string[]).includes(body.status ?? "")) {
      throw new HttpError(400, "status 必须是 pending/in_progress/done");
    }
    const ws = requireWorkspaceByProjectId(id);
    return updateTaskStatus(ws, tid, body.status as typeof TASK_STATUS[number]);
  });

  // 更新任务内容（标题/描述/验收标准/文件/变更类型；状态走上方独立接口）
  app.put("/api/projects/:id/tasks/:tid", async (request) => {
    const { id, tid } = request.params as { id: string; tid: string };
    const body = (request.body ?? {}) as {
      title?: string;
      description?: string;
      acceptanceCriteria?: string;
      files?: string[];
      changeType?: string;
    };
    if (
      body.changeType !== undefined &&
      !(CHANGE_TYPES as readonly string[]).includes(body.changeType)
    ) {
      throw new HttpError(400, "changeType 必须是 新增/修改/删除");
    }
    const ws = requireWorkspaceByProjectId(id);
    return updateTask(ws, tid, {
      title: body.title,
      description: body.description,
      acceptanceCriteria: body.acceptanceCriteria,
      files: body.files,
      changeType: body.changeType as typeof CHANGE_TYPES[number] | undefined
    });
  });

  // 删除任务（从所属需求 taskIds 移除引用）
  app.delete("/api/projects/:id/tasks/:tid", async (request, reply) => {
    const { id, tid } = request.params as { id: string; tid: string };
    const ws = requireWorkspaceByProjectId(id);
    await deleteTask(ws, tid);
    reply.code(204).send();
  });
}
