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
  ArchitectureNodeSchema,
  ClassNodeSchema,
  FlowNodeSchema,
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
 * MCP 入口层 node/edge 输入 schema（T3 入口收紧）：
 * - node 按图类型拆三支 union（架构/类/流程），各自从共享节点 schema 派生（omit geometry）
 * - 保留 .strict()：跨类型字段直接报错（如把 kind 塞进架构图节点）；geometry 传 null/值均被拒绝
 * - edge 派生自 EdgeSchema 并 omit points：折点坐标仅前端 HTTP 职责，MCP 写侧入口不承载
 * - null 统一转 undefined：字段显式传 null 表示删除（RFC 7396 merge 语义），服务层据此合并
 */
function nullToUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(nullToUndefined);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = v === null ? undefined : nullToUndefined(v);
    }
    return out;
  }
  return value;
}

const ArchitectureNodeInput = ArchitectureNodeSchema.omit({ geometry: true });
const ClassNodeInput = ClassNodeSchema.omit({ geometry: true });
const FlowNodeInput = FlowNodeSchema.omit({ geometry: true });
const NodeInputSchema = z.preprocess(
  nullToUndefined,
  z.union([ArchitectureNodeInput, ClassNodeInput, FlowNodeInput])
);
/** edge 入口：移除 points 折点坐标，并收紧为 strict（未知字段报错） */
const EdgeInputSchema = z.preprocess(
  nullToUndefined,
  EdgeSchema.omit({ points: true }).strict()
);
const DiagramPatchSchema = z.union([
  z.object({ action: z.literal("addNode"), node: NodeInputSchema }),
  z.object({ action: z.literal("updateNode"), node: NodeInputSchema }),
  z.object({ action: z.literal("removeNode"), nodeId: z.string().min(1) }),
  z.object({ action: z.literal("addEdge"), edge: EdgeInputSchema }),
  z.object({ action: z.literal("updateEdge"), edge: EdgeInputSchema }),
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
        "- flow：node 应带 nodeKind（start/end/process/decision/inputOutput/subprocess）\n" +
        "description 参数：可选，写清这张图表达什么、覆盖哪些组件/模块（例：认证鉴权模块的过滤器链流程图），避免图建出来无主题。",
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
        "node 必填字段：nodeId, label；可选字段按图类型：\n" +
        "- architecture：layer（如'接入层'/'服务层'）、nodeKind（service/database/mq/cache/external/gateway）\n" +
        "- class：kind（class/interface/abstract/enum）、attributes[]、methods[]\n" +
        "- flow：nodeKind（start/end/process/decision/inputOutput/subprocess）\n" +
        "- 通用：description、payload（自由扩展 Record，如 aiRiskNote 风险注记）、codeAnchor（{files:[{path,symbols?}]}）、linkedDiagrams（[{diagramId,label?,type?}] 跨图跳转）\n" +
        "edge 必填：edgeId, from, to；可选：label、payload、methods[]（该连线承载的调用链方法清单）\n" +
        "group 必填：groupId, title, nodeIds[]；可选：axis（vertical/horizontal）、parentGroupId、collapsible\n" +
        "\n" +
        "⚠️ 更新语义（updateNode/updateEdge/updateGroup）：字段按 merge 合并——省略的字段保持原值；数组（attributes/methods/linkedDiagrams 等）整体替换；字段显式传 null 表示删除该字段（如 payload: null 清除扩展信息）。\n" +
        "⚠️ MCP 入口不承载坐标：geometry / points 仅由前端 HTTP 维护，node 传 geometry、edge 传 points 均会被拒绝。\n" +
        "\n" +
        "--- 排查导向引导（强烈建议填写）---\n" +
        "• 每个 node 尽量带 codeAnchor：对应文件路径 + 类/方法符号，便于跳转定位排查（where）\n" +
        "• flow 图 edge 尽量带 methods[]：这条线由哪个方法调用连接（例：[\"AuthFilter.filter → DefaultAuthStrategy.authenticate\"]），沿调用链排查用\n" +
        "• 关键节点的风险/边界：description 一句话说明 + payload.aiRiskNote 记录结构化风险（例：{timeout:3000, format:\"JWT\", risk:\"过期策略\"}）\n" +
        "• 跨图数据流：node.linkedDiagrams[] 关联其他模块图（diagramId + type + label），便于跨模块排查",
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
        "支持单节点/批量（nodeIds）或全量读取；默认返回全量。基于图拓扑预计算，AI 直接复用避免每次现算。" +
        "⚠️ 变更某节点前先查影响面，避免误改扇入/扇出大的节点（高依赖/核心节点）。",
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
