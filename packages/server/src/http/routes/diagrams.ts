/**
 * HTTP 路由：图（开发文档第九章 + T12 语义数据扩展）
 *
 * GET /api/projects/:id/diagrams/:did/layout   实时调用布局引擎返回带坐标结果
 * GET /api/projects/:id/diagrams/:did          读取图语义模型（含节点类型，供 SVG 渲染）
 *
 * 布局查询参数：focusModuleId（可选）——聚焦模块，非聚焦模块折叠为聚合节点。
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

    const focusModuleId = (request.query as { focusModuleId?: string })
      ?.focusModuleId;

    // 客户端断开连接时取消布局（释放 Worker）
    const ac = new AbortController();
    request.raw.once("close", () => ac.abort());

    return layoutInWorker(diagram, { focusModuleId }, ac.signal);
  });
}
