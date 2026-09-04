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
import {
  DiagramTypeSchema,
  EdgeSchema,
  GroupSchema,
  NodeGeometrySchema,
  CodeAnchorSchema,
  LinkedDiagramSchema,
  ClassAttributeSchema,
  ClassMethodSchema,
  VerificationActorSchema,
  VerificationChangeTypeSchema
} from "@stagelab/shared";
import { getWorkspace } from "../../storage/workspace.js";
import {
  createDiagram,
  getDiagramMeta,
  getDiagramPartial,
  updateDiagramElements,
  deleteDiagram,
  getDiagramGroup,
  getNodeGroups,
  getDiagramImpact,
  verifyDiagram,
  getVerificationHistory,
  toDiagramMeta,
  type DiagramElementPatch
} from "../../services/diagram.service.js";
import { safeCall } from "./_util.js";

/**
 * MCP 入口层 node 输入 schema：声明所有节点类型可能出现的字段。
 * - 不是 .strict()，保留灵活性（服务层 DiagramSchema.safeParse 做最终严格校验）
 * - 关键目的：让 MCP SDK 生成的 JSON schema 里 AI 能看到 required/可选字段列表/枚举值，
 *   避免 additionalProperties: {} 导致 AI 瞎猜 node 结构
 */
const NodeInputSchema = z.object({
  // 所有节点类型共享的必填字段
  nodeId: z.string().min(1),
  label: z.string().min(1),
  // 所有类型可选通用字段
  description: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  codeAnchor: CodeAnchorSchema.optional(),
  geometry: NodeGeometrySchema.optional(),
  linkedDiagrams: z.array(LinkedDiagramSchema).optional(),
  // Architecture 专属
  layer: z.string().optional(),
  nodeKind: z
    .enum([
      "service",
      "database",
      "mq",
      "cache",
      "external",
      "gateway",
      "start",
      "end",
      "process",
      "decision",
      "inputOutput",
      "subprocess"
    ])
    .optional(),
  // Class 专属
  kind: z.enum(["class", "interface", "abstract", "enum"]).optional(),
  attributes: z.array(ClassAttributeSchema).optional(),
  methods: z.array(ClassMethodSchema).optional()
});
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

/**
 * MCP 读侧语义视图：剔除布局坐标（节点 geometry / 连线 points）。
 * 业务/布局分离：坐标仅由前端 HTTP（LayoutDiagram）消费，MCP 只返回纯语义。
 * 仅 MCP 读接口调用，存储与 HTTP 层保持完整数据，不影响前端渲染。
 */
function stripVisual<T extends { nodes?: unknown[]; edges?: unknown[] }>(data: T): T {
  return {
    ...data,
    nodes: data.nodes?.map((n) => {
      const copy = { ...(n as Record<string, unknown>) };
      delete copy.geometry;
      return copy;
    }),
    edges: data.edges?.map((e) => {
      const copy = { ...(e as Record<string, unknown>) };
      delete copy.points;
      return copy;
    })
  } as T;
}

/** 注册图元操作类工具 */
export function registerDiagramTools(server: McpServer): void {
  server.registerTool(
    "create_diagram",
    {
      title: "创建结构化图",
      description:
        "创建新的结构化图（architecture/class/flow）。\n" +
        "type 决定后续 addNode 时需要的特征字段：\n" +
        "- architecture：node 应带 layer（如'接入层'/'服务层'）+ nodeKind（service/database/mq/cache/external/gateway）\n" +
        "- class：node 应带 kind（class/interface/abstract/enum），可选 attributes/methods\n" +
        "- flow：node 应带 nodeKind（start/end/process/decision/inputOutput/subprocess）",
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
        const d = await createDiagram(ws, args.diagramId, args.type, args.title, args.description);
        // T31：写操作只返回 meta 摘要，不返回节点/连线/分组内容
        return toDiagramMeta(d);
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
        const raw = await getDiagramPartial(ws, args.diagramId, {
          nodeIds: args.nodeIds,
          edgeIds: args.edgeIds,
          groupIds: args.groupIds
        });
        // 剔除坐标（geometry/points）：MCP 读侧只返回语义，坐标走 HTTP
        return stripVisual(raw);
      })
  );

  server.registerTool(
    "update_diagram_elements",
    {
      title: "局部更新图元",
      description:
        "局部新增/修改/删除图元节点、连线、分组（单节点/单连线 patch，不重传整图）。\n" +
        "patch action 类型：addNode / updateNode / removeNode / addEdge / updateEdge / removeEdge / addGroup / updateGroup / removeGroup\n" +
        "\n" +
        "⚠️ node 必填字段：nodeId, label（所有类型共享）\n" +
        "⚠️ node 特征字段（DiagramSchema 校验，缺失会报错）：\n" +
        "- architecture 图：node 应包含 layer 和/或 nodeKind（service/database/mq/cache/external/gateway）\n" +
        "- class 图：node 应包含 kind（class/interface/abstract/enum），可选 attributes/methods\n" +
        "- flow 图：node 应包含 nodeKind（start/end/process/decision/inputOutput/subprocess）\n" +
        "\n" +
        "edge 必填：edgeId, from, to\n" +
        "group 必填：groupId, title, nodeIds[]",
      inputSchema: {
        diagramId: z.string().min(1),
        patches: z.array(DiagramPatchSchema)
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        const patches = args.patches as DiagramElementPatch[];
        const d = await updateDiagramElements(ws, args.diagramId, patches);
        // T31：写操作只返回 meta 摘要 + 变更 id 列表，不返回节点/连线/分组内容
        const upsertedIds: string[] = [];
        const removedIds: string[] = [];
        for (const p of patches) {
          switch (p.action) {
            case "addNode":
            case "updateNode":
              upsertedIds.push(p.node.nodeId);
              break;
            case "removeNode":
              removedIds.push(p.nodeId);
              break;
            case "addEdge":
            case "updateEdge":
              upsertedIds.push(p.edge.edgeId);
              break;
            case "removeEdge":
              removedIds.push(p.edgeId);
              break;
            case "addGroup":
            case "updateGroup":
              upsertedIds.push(p.group.groupId);
              break;
            case "removeGroup":
              removedIds.push(p.groupId);
              break;
          }
        }
        return { ...toDiagramMeta(d), upsertedIds, removedIds };
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

  server.registerTool(
    "get_diagram_group",
    {
      title: "按分组聚合读取分区",
      description:
        "传入 diagramId + groupId，一次返回该分区（纵向模块/横向泳道）的节点详情、分区内连线与子分区摘要；不返回坐标、不拉取整图",
      inputSchema: {
        diagramId: z.string().min(1),
        groupId: z.string().min(1)
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        // 剔除坐标（geometry/points）：MCP 读侧只返回语义，坐标走 HTTP
        return stripVisual(await getDiagramGroup(ws, args.diagramId, args.groupId));
      })
  );

  server.registerTool(
    "get_node_groups",
    {
      title: "节点-分区反向查询",
      description:
        "查询指定节点属于哪些分区（纵向模块/横向泳道），返回 nodeId → 分区列表（groupId/title/axis）；支持多节点批量",
      inputSchema: {
        diagramId: z.string().min(1),
        nodeIds: z.array(z.string().min(1)).min(1)
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return getNodeGroups(ws, args.diagramId, args.nodeIds);
      })
  );

  server.registerTool(
    "get_diagram_impact",
    {
      title: "读取图影响范围索引",
      description:
        "读取预计算的影响范围索引 impactIndex（直接上游/下游、可达跳数、扇入扇出、是否在环、结构风险分）。" +
        "支持单节点/批量（nodeIds）或全量读取；默认返回全量。基于图拓扑预计算，AI 直接复用避免每次现算。",
      inputSchema: {
        diagramId: z.string().min(1),
        nodeIds: z.array(z.string().min(1)).optional()
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return getDiagramImpact(ws, args.diagramId, args.nodeIds);
      })
  );

  server.registerTool(
    "verify_diagram",
    {
      title: "显式校验图（漂移确认）",
      description:
        "显式声明某 commit 下图为可信（人工/AI 显式确认，绝不自动提升到 HEAD）。提升 metadata 最新可信快照并追加一条验证历史。" +
        "changeType：no_change（无结构变化）/ incremental（局部修订后）/ rebuild（重逆向重建）。",
      inputSchema: {
        diagramId: z.string().min(1),
        commit: z.string().min(1), // 本次显式确认可信的 commit
        note: z.string().optional(), // 校验备注：为何可信/变更了什么
        verifiedBy: VerificationActorSchema.optional(), // 确认者，默认 ai
        changeType: VerificationChangeTypeSchema.optional(), // 校验流程类别，默认 no_change
        baseCommit: z.string().optional() // 本次校验基线 commit（缺省沿用图当前 baseCommit）
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        const d = await verifyDiagram(ws, args.diagramId, {
          commit: args.commit,
          note: args.note,
          verifiedBy: args.verifiedBy,
          changeType: args.changeType,
          baseCommit: args.baseCommit
        });
        // 写操作只返回 meta + 最新可信快照锚点
        return {
          ...toDiagramMeta(d),
          verifiedCommit: d.metadata.verifiedCommit,
          lastVerifiedAt: d.metadata.lastVerifiedAt,
          verifiedBy: d.metadata.verifiedBy,
          verifyNote: d.metadata.verifyNote
        };
      })
  );

  server.registerTool(
    "get_verification_history",
    {
      title: "读取图验证历史",
      description:
        "读取某图的链式验证历史（verifiedAt 升序，含 baseCommit/verifiedCommit/prevVerifiedCommit/changeType/verifiedBy/note）。" +
        "支持 limit 限制条数；不含整图数据，轻量。",
      inputSchema: {
        diagramId: z.string().min(1),
        limit: z.number().int().positive().optional()
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return getVerificationHistory(ws, args.diagramId, args.limit);
      })
  );
}
