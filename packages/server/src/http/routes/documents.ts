/**
 * HTTP 路由：文档分片（开发文档第九章 + T12 编辑扩展）
 *
 * GET  /api/projects/:id/documents/:docId/fragments          文档分片列表（轻量，不含全文）
 * GET  /api/projects/:id/documents/:docId/fragments/:fid     读取指定分片
 * PUT  /api/projects/:id/documents/:docId/fragments/:fid     编辑指定分片（按 order 覆盖，超长自动再分片）
 */
import type { FastifyInstance } from "fastify";
import {
  createDocument,
  renameDocument,
  deleteDocument,
  listDocumentFragments,
  readDocumentFragment,
  readDocumentFull,
  writeDocumentFragment
} from "../../services/document.service.js";
import { generateId } from "../../services/project.service.js";
import { HttpError, requireWorkspaceByProjectId } from "./_util.js";

/** 注册文档路由 */
export function registerDocumentRoutes(app: FastifyInstance): void {
  // 新建文档（docId 缺省自动生成；docType 为自由文本帮助 AI/人工理解）
  app.post("/api/projects/:id/documents", async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      docId?: string;
      title?: string;
      docType?: string;
      content?: string;
    };
    const title = body.title?.trim();
    if (!title) throw new HttpError(400, "title 必填");
    const ws = requireWorkspaceByProjectId(id);
    const docId = body.docId?.trim() || generateId();
    return createDocument(ws, docId, title, body.content ?? "", body.docType?.trim() || undefined);
  });

  // 重命名文档（标题/类型/摘要）
  app.put("/api/projects/:id/documents/:docId", async (request) => {
    const { id, docId } = request.params as { id: string; docId: string };
    const body = (request.body ?? {}) as {
      title?: string;
      docType?: string;
      summary?: string;
    };
    const ws = requireWorkspaceByProjectId(id);
    return renameDocument(ws, docId, body);
  });

  // 删除文档（meta + 全部分片）
  app.delete("/api/projects/:id/documents/:docId", async (request) => {
    const { id, docId } = request.params as { id: string; docId: string };
    const ws = requireWorkspaceByProjectId(id);
    await deleteDocument(ws, docId);
    return { ok: true };
  });

  // 文档全文（按分片顺序拼接，供人工/前端阅读）
  app.get("/api/projects/:id/documents/:docId/full", async (request) => {
    const { id, docId } = request.params as { id: string; docId: string };
    const ws = requireWorkspaceByProjectId(id);
    return readDocumentFull(ws, docId);
  });

  // 全量编辑：从 order 0 覆盖全文（超长自动再分片 + 清理孤儿分片）
  app.put("/api/projects/:id/documents/:docId/full", async (request) => {
    const { id, docId } = request.params as { id: string; docId: string };
    const body = (request.body ?? {}) as { content?: string; title?: string };
    const content = body.content ?? "";
    if (!content.trim()) {
      throw new HttpError(400, "content 必填");
    }
    const ws = requireWorkspaceByProjectId(id);
    return writeDocumentFragment(ws, docId, content, {
      order: 0,
      title: body.title
    });
  });

  // 文档分片列表（按分片返回元信息，无全量大文本）
  app.get("/api/projects/:id/documents/:docId/fragments", async (request) => {
    const { id, docId } = request.params as { id: string; docId: string };
    const ws = requireWorkspaceByProjectId(id);
    return listDocumentFragments(ws, docId);
  });

  // 读取指定分片
  app.get(
    "/api/projects/:id/documents/:docId/fragments/:fid",
    async (request) => {
      const { id, docId, fid } = request.params as {
        id: string;
        docId: string;
        fid: string;
      };
      const ws = requireWorkspaceByProjectId(id);
      const frag = await readDocumentFragment(ws, fid);
      if (frag.docId !== docId) {
        throw new HttpError(404, "分片不存在或不属于该文档");
      }
      return frag;
    }
  );

  // 编辑指定分片：按 fid 解析 order 覆盖写入（超长内容自动再分片）
  app.put(
    "/api/projects/:id/documents/:docId/fragments/:fid",
    async (request) => {
      const { id, docId, fid } = request.params as {
        id: string;
        docId: string;
        fid: string;
      };
      const body = (request.body ?? {}) as { content?: string; title?: string };
      const content = body.content ?? "";
      if (!content.trim()) {
        throw new HttpError(400, "content 必填");
      }
      // 分片 ID 形如 {docId}-f{order}，解析 order 用于覆盖
      const match = /-f(\d+)$/.exec(fid);
      if (!match) {
        throw new HttpError(400, "分片 ID 格式非法");
      }
      const ws = requireWorkspaceByProjectId(id);
      const order = Number(match[1]);
      return writeDocumentFragment(ws, docId, content, {
        order,
        title: body.title
      });
    }
  );
}
