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
import { layoutInWorker, type LayoutOverrides } from "../../layout/worker.js";
import { getDiagramGroup, getNodeGroups, saveDiagramGeometry } from "../../services/diagram.service.js";
import { getLayoutParams } from "../../layout/params.js";
import { requireWorkspaceByProjectId, HttpError } from "./_util.js";

/** 注册图路由 */
export function registerDiagramRoutes(app: FastifyInstance): void {
  // 读取图语义模型（含节点类型，供前端 SVG 渲染区分样式）
  app.get("/api/projects/:id/diagrams/:did", async (request) => {
    const { id, did } = request.params as { id: string; did: string };
    const ws = requireWorkspaceByProjectId(id);
    return readDiagram(ws, did);
  });

  // 实时布局（支持前端覆盖布局参数：nodeNodeSpacing/layerSpacing/baseNodeWidth/baseNodeHeight/colGap/rowGap/cellPadding）
  app.get("/api/projects/:id/diagrams/:did/layout", async (request) => {
    const { id, did } = request.params as { id: string; did: string };
    const ws = requireWorkspaceByProjectId(id);

    const diagram = await readDiagram(ws, did);

    // 客户端断开连接时取消布局（释放 Worker）
    const ac = new AbortController();
    request.raw.once("close", () => ac.abort());

    // 解析前端传入的布局参数覆盖（正数白名单，非法值忽略）
    const q = request.query as Record<string, string> | undefined;
    const num = (k: string): number | undefined => {
      const v = q?.[k];
      if (v === undefined || v === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const overrides: LayoutOverrides = {
      nodeNodeSpacing: num("nodeNodeSpacing"),
      layerSpacing: num("layerSpacing"),
      baseNodeWidth: num("baseNodeWidth"),
      baseNodeHeight: num("baseNodeHeight"),
      colGap: num("colGap"),
      rowGap: num("rowGap"),
      cellPadding: num("cellPadding"),
      edgeChannelSpread: num("edgeChannelSpread"),
      edgeChannelSlots: num("edgeChannelSlots"),
      edgeChannelStep: num("edgeChannelStep")
    };

    const layout = await layoutInWorker(diagram, { params: overrides }, ac.signal);

    // 回传当前生效参数（前端面板单一数据源）：默认预设 + 覆盖值
    // 注意：overrides 键存在但值为 undefined，直接 spread 会用 undefined 覆盖预设值，
    // 导致参数被 JSON 序列化省略，故只合并非 undefined 的覆盖项
    const effective = { ...getLayoutParams(diagram.type) };
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined) (effective as Record<string, unknown>)[k] = v;
    }
    return { ...layout, params: effective };
  });

  // T45：按分组聚合读取分区（节点详情 + 分区内连线 + 子分区摘要）
  app.get("/api/projects/:id/diagrams/:did/group/:groupId", async (request) => {
    const { id, did, groupId } = request.params as {
      id: string;
      did: string;
      groupId: string;
    };
    const ws = requireWorkspaceByProjectId(id);
    try {
      return await getDiagramGroup(ws, did, groupId);
    } catch (e) {
      // 分组不存在 → 404（而非通用 500）
      if (e instanceof Error && e.message.startsWith("分组不存在")) {
        throw new HttpError(404, e.message);
      }
      throw e;
    }
  });

  // T45：节点-分区反向查询（支持逗号分隔多节点批量）
  app.get("/api/projects/:id/diagrams/:did/nodes/:nodeIds/groups", async (request) => {
    const { id, did, nodeIds } = request.params as {
      id: string;
      did: string;
      nodeIds: string;
    };
    const ws = requireWorkspaceByProjectId(id);
    const ids = nodeIds.split(",").filter(Boolean);
    return getNodeGroups(ws, did, ids);
  });

  // T59：自由画布坐标批量保存（节点几何 + 连线折点），首次固化/拖拽结束落库
  app.post("/api/projects/:id/diagrams/:did/geometry", async (request) => {
    const { id, did } = request.params as { id: string; did: string };
    const ws = requireWorkspaceByProjectId(id);
    const body = (request.body ?? {}) as {
      nodes?: Array<{
        nodeId: string;
        x: number;
        y: number;
        width: number;
        height: number;
      }>;
      edges?: Array<{ edgeId: string; points: Array<{ x: number; y: number }> }>;
    };
    if (!Array.isArray(body.nodes) && !Array.isArray(body.edges)) {
      throw new HttpError(400, "请求体需包含 nodes 或 edges 数组");
    }
    return saveDiagramGeometry(ws, did, {
      nodes: body.nodes ?? [],
      edges: body.edges ?? []
    });
  });
}
