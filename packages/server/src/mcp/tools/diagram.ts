/**
 * MCP 工具：图元操作类（开发文档 8.4，共 5 个）
 *
 * create_diagram / get_diagram_meta / get_diagram_partial
 * update_diagram_elements / delete_diagram
 *
 * 约束：MCP 层永不返回布局坐标数据（业务层与布局层分离）。
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DiagramTypeSchema, EdgeSchema, GroupSchema } from "@fourstage/shared";
import { getWorkspace } from "../../storage/workspace.js";
import {
  createDiagram,
  getDiagramMeta,
  getDiagramPartial,
  updateDiagramElements,
  deleteDiagram,
  type DiagramElementPatch
} from "../../services/diagram.service.js";
import { safeCall } from "./_util.js";

/**
 * 图元局部更新操作 schema
 * node 用宽松结构接收（节点类型随图 type 而定），
 * 服务层 updateDiagramElements 内部用 DiagramSchema 严格校验（防跨类型）。
 */
const NodeInputSchema = z.record(z.string(), z.unknown());
const DiagramPatchSchema = z.union([
  z.object({ action: z.literal("addNode"), node: NodeInputSchema }),
  z.object({ action: z.literal("updateNode"), node: NodeInputSchema }),
  z.object({ action: z.literal("removeNode"), nodeId: z.string().min(1) }),
  z.object({ action: z.literal("addEdge"), edge: EdgeSchema }),
  z.object({ action: z.literal("updateEdge"), edge: EdgeSchema }),
  z.object({ action: z.literal("removeEdge"), edgeId: z.string().min(1) }),
  z.object({ action: z.literal("addGroup"), group: GroupSchema }),
  z.object({ action: z.literal("updateGroup"), group: GroupSchema }),
  z.object({ action: z.literal("removeGroup"), groupId: z.string().min(1) })
]);

/** 注册图元操作类工具 */
export function registerDiagramTools(server: McpServer): void {
  server.registerTool(
    "create_diagram",
    {
      title: "创建结构化图",
      description: "创建新的结构化图（architecture/class/flow，业务语义无坐标）",
      inputSchema: {
        diagramId: z.string().min(1),
        type: DiagramTypeSchema,
        title: z.string().min(1),
        description: z.string().optional()
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return createDiagram(ws, args.diagramId, args.type, args.title, args.description);
      })
  );

  server.registerTool(
    "get_diagram_meta",
    {
      title: "获取图元数据",
      description: "获取图元数据（标题、类型、节点数、连线数，不含详情）",
      inputSchema: { diagramId: z.string().min(1) }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return getDiagramMeta(ws, args.diagramId);
      })
  );

  server.registerTool(
    "get_diagram_partial",
    {
      title: "读取部分图元",
      description: "按节点ID/连线ID/分组ID读取部分图元，不拉取整图",
      inputSchema: {
        diagramId: z.string().min(1),
        nodeIds: z.array(z.string()).optional(),
        edgeIds: z.array(z.string()).optional(),
        groupIds: z.array(z.string()).optional()
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return getDiagramPartial(ws, args.diagramId, {
          nodeIds: args.nodeIds,
          edgeIds: args.edgeIds,
          groupIds: args.groupIds
        });
      })
  );

  server.registerTool(
    "update_diagram_elements",
    {
      title: "局部更新图元",
      description:
        "局部新增/修改/删除图元节点、连线、分组（单节点/单连线 patch，不重传整图）",
      inputSchema: {
        diagramId: z.string().min(1),
        patches: z.array(DiagramPatchSchema)
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return updateDiagramElements(
          ws,
          args.diagramId,
          args.patches as DiagramElementPatch[]
        );
      })
  );

  server.registerTool(
    "delete_diagram",
    {
      title: "删除整张图",
      description: "删除指定 diagramId 的整张图",
      inputSchema: { diagramId: z.string().min(1) }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        await deleteDiagram(ws, args.diagramId);
        return { diagramId: args.diagramId, deleted: true };
      })
  );
}
