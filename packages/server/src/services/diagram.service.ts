/**
 * 图元 CRUD 服务（T07 服务③）
 *
 * 对应开发文档 8.3 工具：create_diagram / get_diagram_meta / get_diagram_partial / update_diagram_elements / delete_diagram
 *
 * 支持：
 * - 局部读取：按 nodeId/edgeId 读取部分图元
 * - 局部更新：单节点/单连线/分组 patch（不重传整图）
 * - MCP 层永不返回布局坐标（本层只返回业务语义）
 */
import type {
  Diagram,
  ArchitectureNode,
  ClassNode,
  FlowNode,
  Edge,
  Group,
  DiagramType,
  VerificationRecord,
  VerificationActor,
  VerificationChangeType
} from "@stagelab/shared";
import { DiagramSchema, VerificationRecordSchema } from "@stagelab/shared";
import crypto from "node:crypto";
import type { RepoWorkspace } from "../storage/workspace.js";
import { createRepositories } from "../storage/repositories/factory.js";
import {
  refreshImpactIndex,
  deleteImpactIndex,
  getImpactIndex,
  type ImpactIndexResult
} from "./impact.service.js";

type NodeOfDiagram = ArchitectureNode | ClassNode | FlowNode;

/** 创建新结构化图 */
export async function createDiagram(
  workspace: RepoWorkspace,
  diagramId: string,
  type: DiagramType,
  title: string,
  description?: string
): Promise<Diagram> {
  const repos = createRepositories(workspace);
  const diagram: Diagram = {
    diagramId,
    type,
    metadata: { title, version: 1, description },
    nodes: [],
    edges: [],
    groups: []
  };
  await repos.diagram.save(diagram);
  // 写图后增量维护影响范围索引（空图 → 空映射，独立存储）
  await refreshImpactIndex(workspace, diagram);
  return diagram;
}

/** 从 Diagram 提取 meta 摘要（不含节点/连线/分组详情，供 MCP 写操作返回，T31） */
export function toDiagramMeta(d: Diagram) {
  return {
    diagramId: d.diagramId,
    title: d.metadata.title,
    type: d.type,
    version: d.metadata.version,
    nodeCount: d.nodes.length,
    edgeCount: d.edges.length,
    groupCount: d.groups.length
  };
}

/** 获取图元数据（标题/类型/节点数/连线数，不含详情） */
export async function getDiagramMeta(workspace: RepoWorkspace, diagramId: string) {
  const repos = createRepositories(workspace);
  const d = await repos.diagram.get(diagramId);
  return toDiagramMeta(d);
}

/** 按节点ID/连线ID/分组ID读取部分图元 */
export async function getDiagramPartial(
  workspace: RepoWorkspace,
  diagramId: string,
  options: { nodeIds?: string[]; edgeIds?: string[]; groupIds?: string[] } = {}
) {
  const repos = createRepositories(workspace);
  const d = await repos.diagram.get(diagramId);

  const nodeMap = new Map(d.nodes.map((n) => [n.nodeId, n]));
  const edgeMap = new Map(d.edges.map((e) => [e.edgeId, e]));
  const groupMap = new Map(d.groups.map((g) => [g.groupId, g]));

  return {
    diagramId: d.diagramId,
    type: d.type,
    nodes: options.nodeIds
      ? options.nodeIds.map((id) => nodeMap.get(id)).filter(Boolean)
      : [],
    edges: options.edgeIds
      ? options.edgeIds.map((id) => edgeMap.get(id)).filter(Boolean)
      : [],
    groups: options.groupIds
      ? options.groupIds.map((id) => groupMap.get(id)).filter(Boolean)
      : []
  };
}

/** 分组内连线（from/to 均落在 nodeIds 集合内） */
function edgesWithinGroup(
  edges: Edge[],
  nodeIds: Set<string>
): Edge[] {
  return edges.filter(
    (e) => nodeIds.has(e.from) && nodeIds.has(e.to)
  );
}

/**
 * 按分组聚合读取（T43）：一次返回该分区的节点详情 + 分区内连线 + 子分区摘要。
 * - 不返回坐标、不加载整图之外的实体（仅按需组装目标分区）
 */
export async function getDiagramGroup(
  workspace: RepoWorkspace,
  diagramId: string,
  groupId: string
) {
  const repos = createRepositories(workspace);
  const d = await repos.diagram.get(diagramId);

  const group = d.groups.find((g) => g.groupId === groupId);
  if (!group) {
    throw new Error(`分组不存在: ${groupId}`);
  }

  const nodeIds = new Set(group.nodeIds);
  const nodes = d.nodes.filter((n) => nodeIds.has(n.nodeId));
  const edges = edgesWithinGroup(d.edges, nodeIds);
  // 子分区：parentGroupId 指向当前分区的 groups 的轻量信息
  const childGroups = d.groups
    .filter((g) => g.parentGroupId === groupId)
    .map((g) => ({
      groupId: g.groupId,
      title: g.title,
      axis: g.axis,
      nodeCount: g.nodeIds.length
    }));

  return {
    diagramId: d.diagramId,
    type: d.type,
    group: {
      groupId: group.groupId,
      title: group.title,
      axis: group.axis,
      parentGroupId: group.parentGroupId,
      collapsible: group.collapsible
    },
    nodes,
    edges,
    childGroups
  };
}

/**
 * 节点-分区反向查询（T44）：返回指定节点所属的全部分区（纵向模块/横向泳道）。
 * 支持单节点或多节点批量，返回 nodeId → 分区列表。
 */
export async function getNodeGroups(
  workspace: RepoWorkspace,
  diagramId: string,
  nodeIds: string[]
) {
  const repos = createRepositories(workspace);
  const d = await repos.diagram.get(diagramId);

  const result: Record<
    string,
    Array<{ groupId: string; title: string; axis?: string }>
  > = {};
  for (const nodeId of nodeIds) {
    result[nodeId] = d.groups
      .filter((g) => g.nodeIds.includes(nodeId))
      .map((g) => ({
        groupId: g.groupId,
        title: g.title,
        axis: g.axis
      }));
  }
  return { diagramId: d.diagramId, type: d.type, nodes: result };
}

/** 图元局部更新操作 */
export type DiagramElementPatch =
  | {
      action: "addNode" | "updateNode";
      node: NodeOfDiagram;
    }
  | {
      action: "removeNode";
      nodeId: string;
    }
  | {
      action: "addEdge" | "updateEdge";
      edge: Edge;
    }
  | {
      action: "removeEdge";
      edgeId: string;
    }
  | {
      action: "addGroup" | "updateGroup";
      group: Group;
    }
  | {
      action: "removeGroup";
      groupId: string;
    };

/** 局部新增/修改/删除图元（单节点/单连线/分组 patch） */
export async function updateDiagramElements(
  workspace: RepoWorkspace,
  diagramId: string,
  patches: DiagramElementPatch[]
): Promise<Diagram> {
  const repos = createRepositories(workspace);
  const d = await repos.diagram.get(diagramId);

  // 深拷贝可变副本
  const nodes = d.nodes.map((n) => ({ ...n })) as NodeOfDiagram[];
  const edges = d.edges.map((e) => ({ ...e }));
  const groups = d.groups.map((g) => ({ ...g }));

  for (const patch of patches) {
    switch (patch.action) {
      case "addNode":
      case "updateNode": {
        const idx = nodes.findIndex((n) => n.nodeId === patch.node.nodeId);
        if (idx === -1) nodes.push(patch.node);
        // 字段合并（与 updateEdge 一致）：仅覆盖传入字段，保留存储中其余字段（如 geometry 坐标），
        // 避免 MCP updateNode 只改 label/payload 时把 geometry 整体替换丢失。
        else nodes[idx] = { ...nodes[idx], ...patch.node };
        break;
      }
      case "removeNode": {
        const idx = nodes.findIndex((n) => n.nodeId === patch.nodeId);
        if (idx !== -1) nodes.splice(idx, 1);
        break;
      }
      case "addEdge":
      case "updateEdge": {
        const idx = edges.findIndex((e) => e.edgeId === patch.edge.edgeId);
        if (idx === -1) edges.push(patch.edge);
        // 字段合并（方案A）：仅覆盖传入字段，保留存储中其余字段（如 points 坐标），
        // 避免 MCP updateEdge 只改 methods/label 时把坐标整体替换丢失。
        else edges[idx] = { ...edges[idx], ...patch.edge };
        break;
      }
      case "removeEdge": {
        const idx = edges.findIndex((e) => e.edgeId === patch.edgeId);
        if (idx !== -1) edges.splice(idx, 1);
        break;
      }
      case "addGroup":
      case "updateGroup": {
        const idx = groups.findIndex((g) => g.groupId === patch.group.groupId);
        if (idx === -1) groups.push(patch.group);
        else groups[idx] = patch.group;
        break;
      }
      case "removeGroup": {
        const idx = groups.findIndex((g) => g.groupId === patch.groupId);
        if (idx !== -1) groups.splice(idx, 1);
        break;
      }
    }
  }

  const updated: Diagram = {
    ...d,
    nodes,
    edges,
    groups,
    metadata: { ...d.metadata, version: d.metadata.version + 1 }
  };

  // Zod 校验通过后落盘（防止跨类型节点混入）
  const parsed = DiagramSchema.safeParse(updated);
  if (!parsed.success) {
    throw new Error(
      `图元更新校验失败: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`
    );
  }

  await repos.diagram.save(updated);
  // 写图后增量维护影响范围索引（拓扑可能变化，重算该图）
  await refreshImpactIndex(workspace, updated);
  return updated;
}

/** 删除整张图 */
export async function deleteDiagram(
  workspace: RepoWorkspace,
  diagramId: string
): Promise<void> {
  const repos = createRepositories(workspace);
  await repos.diagram.delete(diagramId);
  // 删除图时联动清理独立存储的影响范围索引
  await deleteImpactIndex(workspace, diagramId);
  // 级联清理验证历史（独立存储，随图删除一并移除）
  await repos.verification.deleteByDiagram(diagramId);
}

/* ========== 图漂移校验与验证历史（P1，T91） ========== */

/** verify_diagram 入参 */
export interface VerifyDiagramInput {
  commit: string; // 本次显式确认可信的 commit
  note?: string; // 校验备注：为何可信/变更了什么
  verifiedBy?: VerificationActor; // 确认者，默认 ai
  changeType?: VerificationChangeType; // 校验流程类别，默认 no_change
  baseCommit?: string; // 本次校验基线 commit（可选，缺省沿用图当前 baseCommit）
}

/**
 * 显式校验图（T91）：提升 metadata 最新可信快照 + 追加一条验证历史（链式 prevVerifiedCommit）。
 * - 仅「人工/AI 显式声明此 commit 图结构没变」时调用，绝不自动提升到 HEAD；
 * - metadata 仅存最新快照（图保持轻量），完整轨迹独立存储于 store/verifications/。
 */
export async function verifyDiagram(
  workspace: RepoWorkspace,
  diagramId: string,
  input: VerifyDiagramInput
): Promise<Diagram> {
  const repos = createRepositories(workspace);
  const d = await repos.diagram.get(diagramId);

  // 读取既有历史，取最新一条作为链式追溯的前驱
  const history = await repos.verification.listByDiagram(diagramId);
  const last = history[history.length - 1];
  const prevVerifiedCommit = last?.verifiedCommit;

  const now = Date.now();
  const actor: VerificationActor = input.verifiedBy ?? "ai";
  const changeType: VerificationChangeType = input.changeType ?? "no_change";
  const baseCommit =
    input.baseCommit ?? d.metadata.baseCommit ?? input.commit;

  const verificationId = `v-${crypto.randomBytes(3).toString("hex")}`;
  const record: VerificationRecord = {
    verificationId,
    diagramId,
    changeType,
    baseCommit,
    verifiedCommit: input.commit,
    prevVerifiedCommit,
    verifiedAt: now,
    verifiedBy: actor,
    note: input.note
  };

  // 校验验证记录
  const recParsed = VerificationRecordSchema.safeParse(record);
  if (!recParsed.success) {
    throw new Error(
      `验证记录校验失败: ${recParsed.error.issues
        .map((i) => i.message)
        .join("; ")}`
    );
  }

  // 提升 metadata 最新快照（不递增 version：校验不改图结构语义）
  // 但为了让前端能感知到快照刷新，仅更新校验锚点字段
  const updated: Diagram = {
    ...d,
    metadata: {
      ...d.metadata,
      baseCommit: baseCommit ?? d.metadata.baseCommit,
      verifiedCommit: input.commit,
      lastVerifiedAt: now,
      verifiedBy: actor,
      verifyNote: input.note
    }
  };

  const parsed = DiagramSchema.safeParse(updated);
  if (!parsed.success) {
    throw new Error(
      `图校验更新失败: ${parsed.error.issues.map((i) => i.message).join("; ")}`
    );
  }

  await repos.verification.save(record);
  await repos.diagram.save(updated);
  return updated;
}

/** get_verification_history：按图读取链式验证历史（verifiedAt 升序，不含整图） */
export async function getVerificationHistory(
  workspace: RepoWorkspace,
  diagramId: string,
  limit?: number
): Promise<VerificationRecord[]> {
  const repos = createRepositories(workspace);
  const history = await repos.verification.listByDiagram(diagramId);
  // 返回最新的 limit 条（从尾部截取），仍按时间升序
  if (limit && limit > 0 && history.length > limit) {
    return history.slice(history.length - limit);
  }
  return history;
}

/** 读取某图的影响范围索引（T84）：支持指定 nodeIds 局部读取，未指定返回全量 */
export async function getDiagramImpact(
  workspace: RepoWorkspace,
  diagramId: string,
  nodeIds?: string[]
): Promise<ImpactIndexResult> {
  const repos = createRepositories(workspace);
  const d = await repos.diagram.get(diagramId);
  return getImpactIndex(workspace, d, nodeIds);
}

/* ========== 自由画布坐标（draw.io 改造，T59） ========== */

/** 坐标批量保存载荷：按 nodeId/edgeId 合并节点几何与连线折点 */
export interface GeometryPatch {
  nodes?: Array<{
    nodeId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  edges?: Array<{
    edgeId: string;
    points: Array<{ x: number; y: number }>;
  }>;
}

/** 坐标合法性校验：有限数值，尺寸必须为正 */
function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * 批量保存自由画布坐标（T59）：将节点 geometry / 连线 points 合并进图数据落库。
 * - 逐元素合并，保留其余字段（不覆盖语义数据）；
 * - 不存在的 nodeId/edgeId 静默忽略；
 * - 坐标非法（NaN/Infinity/非正尺寸）直接拒绝，避免脏数据。
 */
export async function saveDiagramGeometry(
  workspace: RepoWorkspace,
  diagramId: string,
  patch: GeometryPatch
): Promise<Diagram> {
  const repos = createRepositories(workspace);
  const d = await repos.diagram.get(diagramId);

  // 深拷贝可变副本（保留语义字段）
  const nodes = d.nodes.map((n) => ({ ...n })) as NodeOfDiagram[];
  const edges = d.edges.map((e) => ({ ...e }));

  for (const g of patch.nodes ?? []) {
    if (
      !isFiniteNum(g.x) ||
      !isFiniteNum(g.y) ||
      !isFiniteNum(g.width) ||
      !isFiniteNum(g.height) ||
      g.width <= 0 ||
      g.height <= 0
    ) {
      throw new Error(`节点 ${g.nodeId} 坐标非法`);
    }
    const idx = nodes.findIndex((n) => n.nodeId === g.nodeId);
    if (idx === -1) continue; // 忽略不存在的节点
    nodes[idx] = {
      ...nodes[idx],
      geometry: { x: g.x, y: g.y, width: g.width, height: g.height }
    };
  }

  for (const g of patch.edges ?? []) {
    const pts = g.points ?? [];
    if (!pts.every((p) => isFiniteNum(p.x) && isFiniteNum(p.y))) {
      throw new Error(`连线 ${g.edgeId} 折点坐标非法`);
    }
    const idx = edges.findIndex((e) => e.edgeId === g.edgeId);
    if (idx === -1) continue; // 忽略不存在的连线
    edges[idx] = { ...edges[idx], points: pts.map((p) => ({ x: p.x, y: p.y })) };
  }

  const updated: Diagram = {
    ...d,
    nodes,
    edges,
    metadata: { ...d.metadata, version: d.metadata.version + 1 }
  };

  const parsed = DiagramSchema.safeParse(updated);
  if (!parsed.success) {
    throw new Error(
      `坐标保存校验失败: ${parsed.error.issues.map((i) => i.message).join("; ")}`
    );
  }

  await repos.diagram.save(updated);
  // 坐标保存不改拓扑，但按 T83 统一维护影响范围索引（幂等，成本低）
  await refreshImpactIndex(workspace, updated);
  return updated;
}
