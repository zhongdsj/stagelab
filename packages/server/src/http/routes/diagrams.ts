/**
 * HTTP 路由：图（开发文档第九章 + T12 语义数据扩展）
 *
 * GET /api/projects/:id/diagrams/:did/layout   实时调用布局引擎返回带坐标结果
 * GET /api/projects/:id/diagrams/:did          读取图语义模型（含节点类型，供 SVG 渲染）
 *
 * 布局始终返回全量坐标（无折叠参数）：折叠改为前端本地会话态，不再触发服务端重布局。
 * 布局在 Worker Thread 执行，客户端断开时自动取消。
 */
import type { FastifyInstance } from "fastify";
import { readDiagram } from "../../services/index.service.js";
import { layoutInWorker } from "../../layout/worker.js";
import { requireWorkspaceByProjectId } from "./_util.js";

/** 注册图路由 */
export function registerDiagramRoutes(app: FastifyInstance): void {
  // 读取图语义模型（含节点类型，供前端 SVG 渲染区分样式）
  app.get("/api/projects/:id/diagrams/:did", async (request) => {
    const { id, did } = request.params as { id: string; did: string };
    const ws = requireWorkspaceByProjectId(id);
    return readDiagram(ws, did);
  });

  // 实时布局
  app.get("/api/projects/:id/diagrams/:did/layout", async (request) => {
    const { id, did } = request.params as { id: string; did: string };
    const ws = requireWorkspaceByProjectId(id);

    const diagram = await readDiagram(ws, did);

    // 客户端断开连接时取消布局（释放 Worker）
    const ac = new AbortController();
    request.raw.once("close", () => ac.abort());

    // 折叠为前端本地会话态，这里始终返回全量布局（引擎折叠能力保留为内部兼容）
    return layoutInWorker(diagram, {}, ac.signal);
  });
}
