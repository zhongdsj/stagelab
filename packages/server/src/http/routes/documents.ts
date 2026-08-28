/**
 * HTTP 路由：文档分片（开发文档第九章）
 *
 * GET /api/projects/:id/documents/:docId/fragments          文档分片列表（轻量，不含全文）
 * GET /api/projects/:id/documents/:docId/fragments/:fid     读取指定分片
 */
import type { FastifyInstance } from "fastify";
import {
  listDocumentFragments,
  readDocumentFragment
} from "../../services/document.service.js";
import { HttpError, requireWorkspaceByProjectId } from "./_util.js";

/** 注册文档分片路由 */
export function registerDocumentRoutes(app: FastifyInstance): void {
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
}
