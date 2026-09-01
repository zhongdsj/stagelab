/**
 * 布局引擎完整版：业务语义 Diagram → 带坐标 LayoutDiagram
 *
 * 能力：
 * 1. 三种图类型布局参数预设（params.ts）
 * 2. 双轴分区布局：纵向模块层叠（axis:vertical 行）+ 横向泳道拓扑序（axis:horizontal 列）
 * 3. 模块折叠：focusModuleId，非聚焦模块输出聚合占位节点（模块名+子节点数），跨模块连线收敛
 *
 * 说明：
 * - 本文件为纯计算核心（可同步/直接调用）；大图请经 worker.ts 在 Worker Thread 中执行。
 * - 输出仅内部渲染用，不进入 MCP 通道（数据分层约束）。
 */
import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs";
import type { Diagram, LayoutDiagram, Group, Edge } from "@fourstage/shared";
import { getLayoutParams, type LayoutParams } from "./params.ts";

export interface LayoutOptions {
  /** 聚焦模块 groupId；非聚焦模块折叠为聚合占位节点 */
  focusModuleId?: string;
  /** 布局参数覆盖（前端可调，T47 扩展）：缺省用当前图类型预设 */
  params?: LayoutOverrides;
}

/** 前端可覆盖的布局参数（数字字段全可选，缺省回退到预设/常量默认值） */
export interface LayoutOverrides {
  nodeNodeSpacing?: number;
  layerSpacing?: number;
  baseNodeWidth?: number;
  baseNodeHeight?: number;
  colGap?: number;
  rowGap?: number;
  cellPadding?: number;
  edgeChannelSpread?: number;
  edgeChannelSlots?: number;
  edgeChannelStep?: number;
}

interface NodeMeta {
  nodeId: string;
  label: string;
  attributes?: unknown[];
  methods?: unknown[];
}

interface NodeBox {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

/** 纵向模块（行） */
interface VModule {
  groupId: string;
  title: string;
  collapsible: boolean;
  nodeIds: Set<string>;
  directNodeIds: string[]; // 直接归属本模块（不含子模块内节点）
  children: VModule[];
  parentGroupId?: string;
}

/** 横向泳道（列） */
interface HLane {
  groupId: string;
  title: string;
  nodeIds: Set<string>;
}

/** 折叠计划 */
interface CollapsePlan {
  collapsed: Set<string>; // 被折叠模块 groupId
  aggregates: Map<string, NodeMeta>; // 模块 groupId → 聚合节点
  nodeToAggregate: Map<string, string>; // 原节点 id → 聚合节点 id
}

interface CellLayout {
  nodes: NodeBox[];
  width: number;
  height: number;
  cellEdges: Array<{ edgeId: string; points: Point[] }>;
}

const MODULE_HEADER_H = 26; // 行（模块）标题高度
const LANE_HEADER_H = 26; // 列（泳道）标题高度
const CELL_PADDING = 20; // 单元格内边距（T47 二次加大，给跨单元连线留空间）
const COL_GAP = 88; // 列间距（T47 二次加大）
const ROW_GAP = 40; // 行间距（T47 二次加大）

const DEFAULT_MODULE = "__default_module__";
const DEFAULT_LANE = "__default_lane__";

/* ================= 节点尺寸 ================= */

function estimateNodeSize(node: NodeMeta, p: LayoutParams): { width: number; height: number } {
  const items = (node.attributes?.length ?? 0) + (node.methods?.length ?? 0);
  if (items > 0) {
    // 类图：按属性/方法数量估算高度，宽度略宽
    return {
      width: p.baseNodeWidth + 40,
      height: Math.max(p.baseNodeHeight, 44 + items * 20)
    };
  }
  if (node.label.length > 10) {
    return {
      width: Math.max(p.baseNodeWidth, Math.ceil(node.label.length * 8.5)),
      height: p.baseNodeHeight
    };
  }
  return { width: p.baseNodeWidth, height: p.baseNodeHeight };
}

/* ================= 分区解析：纵向模块 + 横向泳道 ================= */

function buildModules(groups: Group[], allNodeIds: string[]): {
  roots: VModule[];
  moduleById: Map<string, VModule>;
  nodeToModule: Map<string, string>;
} {
  const vGroups = groups.filter((g) => g.axis !== "horizontal");
  const moduleById = new Map<string, VModule>();
  for (const g of vGroups) {
    moduleById.set(g.groupId, {
      groupId: g.groupId,
      title: g.title,
      collapsible: g.collapsible !== false,
      nodeIds: new Set(g.nodeIds),
      directNodeIds: [],
      children: [],
      parentGroupId: g.parentGroupId
    });
  }
  const roots: VModule[] = [];
  for (const m of moduleById.values()) {
    if (m.parentGroupId && moduleById.has(m.parentGroupId)) {
      moduleById.get(m.parentGroupId)!.children.push(m);
    } else {
      roots.push(m);
    }
  }

  // 节点 → 最深归属模块
  const nodeToModule = new Map<string, string>();
  const assign = (nid: string, m: VModule): string => {
    for (const child of m.children) {
      if (child.nodeIds.has(nid)) return assign(nid, child);
    }
    return m.groupId;
  };
  const walk = (m: VModule) => {
    for (const nid of m.nodeIds) {
      if (!nodeToModule.has(nid)) nodeToModule.set(nid, assign(nid, m));
    }
    for (const c of m.children) walk(c);
  };
  for (const r of roots) walk(r);

  // 直接归属（不含子模块内节点）
  for (const m of moduleById.values()) {
    m.directNodeIds = [...m.nodeIds].filter((nid) => nodeToModule.get(nid) === m.groupId);
  }

  // 未归属任何模块的节点 → 默认模块
  const defModule: VModule = {
    groupId: DEFAULT_MODULE,
    title: "",
    collapsible: false,
    nodeIds: new Set(),
    directNodeIds: [],
    children: [],
    parentGroupId: undefined
  };
  const assigned = new Set(allNodeIds.filter((nid) => nodeToModule.has(nid)));
  for (const nid of allNodeIds) {
    if (!assigned.has(nid)) defModule.directNodeIds.push(nid);
  }
  if (defModule.directNodeIds.length > 0) {
    defModule.nodeIds = new Set(defModule.directNodeIds);
    roots.push(defModule);
  }

  return { roots, moduleById, nodeToModule };
}

function buildLanes(groups: Group[], allNodeIds: string[]): {
  lanes: HLane[];
  nodeToLane: Map<string, string>;
} {
  const hGroups = groups.filter((g) => g.axis === "horizontal");
  const lanes: HLane[] = hGroups.map((g) => ({
    groupId: g.groupId,
    title: g.title,
    nodeIds: new Set(g.nodeIds)
  }));
  const nodeToLane = new Map<string, string>();
  for (const lane of lanes) {
    for (const nid of lane.nodeIds) nodeToLane.set(nid, lane.groupId);
  }
  const assigned = new Set(allNodeIds.filter((nid) => nodeToLane.has(nid)));
  const defLane: HLane = { groupId: DEFAULT_LANE, title: "", nodeIds: new Set() };
  for (const nid of allNodeIds) {
    if (!assigned.has(nid)) {
      defLane.nodeIds.add(nid);
      nodeToLane.set(nid, DEFAULT_LANE);
    }
  }
  if (defLane.nodeIds.size > 0) lanes.push(defLane);
  return { lanes, nodeToLane };
}

/* ================= 泳道拓扑排序 ================= */

function orderLanes(lanes: HLane[], edges: Edge[]): HLane[] {
  if (lanes.length <= 1) return lanes;
  const index = new Map<string, number>();
  lanes.forEach((l, i) => index.set(l.groupId, i));
  const adj: Set<number>[] = lanes.map(() => new Set<number>());
  const indeg = new Array(lanes.length).fill(0);
  for (const e of edges) {
    const fi = index.get(e.from);
    const ti = index.get(e.to);
    if (fi === undefined || ti === undefined || fi === ti) continue;
    if (!adj[fi].has(ti)) {
      adj[fi].add(ti);
      indeg[ti]++;
    }
  }
  const order: number[] = [];
  const ready: number[] = [];
  for (let i = 0; i < lanes.length; i++) if (indeg[i] === 0) ready.push(i);
  while (ready.length > 0) {
    // 稳定序：同层按原始顺序
    ready.sort((a, b) => a - b);
    const u = ready.shift()!;
    order.push(u);
    for (const v of adj[u]) {
      if (--indeg[v] === 0) ready.push(v);
    }
  }
  for (let i = 0; i < lanes.length; i++) if (!order.includes(i)) order.push(i); // 环残留按原始序
  return order.map((i) => lanes[i]);
}

/* ================= 模块折叠 ================= */

function buildCollapsePlan(roots: VModule[], focusId?: string): CollapsePlan {
  const plan: CollapsePlan = {
    collapsed: new Set(),
    aggregates: new Map(),
    nodeToAggregate: new Map()
  };
  if (!focusId) return plan;

  const onPath = new Set<string>();
  const findPath = (m: VModule): boolean => {
    const hit = m.groupId === focusId || m.children.some(findPath);
    if (hit) onPath.add(m.groupId);
    return hit;
  };
  if (!roots.some(findPath)) return plan; // 聚焦模块不存在，不折叠

  const countSub = (m: VModule): number => {
    let n = m.directNodeIds.length;
    for (const c of m.children) n += countSub(c);
    return n;
  };
  const mapSub = (m: VModule, aggId: string) => {
    for (const nid of m.directNodeIds) plan.nodeToAggregate.set(nid, aggId);
    for (const c of m.children) mapSub(c, aggId);
  };
  const decide = (m: VModule) => {
    if (!onPath.has(m.groupId)) {
      plan.collapsed.add(m.groupId);
      const count = countSub(m);
      const aggId = `${m.groupId}::aggregate`;
      plan.aggregates.set(m.groupId, {
        nodeId: aggId,
        label: `${m.title} (${count})`
      });
      mapSub(m, aggId);
      return;
    }
    for (const c of m.children) decide(c);
  };
  for (const r of roots) decide(r);
  return plan;
}

/* ================= 单元格内 ELK 布局 ================= */

async function layoutCell(
  nodeIds: string[],
  metaById: Map<string, NodeMeta>,
  edges: Edge[],
  p: LayoutParams,
  cellPadding: number
): Promise<CellLayout> {
  const elk = new ELK();
  const idSet = new Set(nodeIds);
  const children: ElkNode[] = nodeIds.map((id) => {
    const meta = metaById.get(id)!;
    const { width, height } = estimateNodeSize(meta, p);
    return { id, width, height, labels: [{ text: meta.label }] };
  });
  const cellEdges: ElkExtendedEdge[] = edges
    .filter((e) => idSet.has(e.from) && idSet.has(e.to))
    .map((e) => ({
      id: e.edgeId,
      sources: [e.from],
      targets: [e.to],
      labels: e.label ? [{ text: e.label }] : []
    }));
  const graph: ElkNode = {
    id: "cell",
    layoutOptions: {
      "elk.algorithm": p.algorithm,
      "elk.direction": p.direction,
      "elk.spacing.nodeNode": String(p.nodeNodeSpacing),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(p.layerSpacing),
      "elk.edgeRouting": p.edgeRouting
    },
    children,
    edges: cellEdges
  };
  const laidOut = await elk.layout(graph);

  const boxes = new Map<string, NodeBox>();
  let maxR = 0;
  let maxB = 0;
  for (const ch of laidOut.children ?? []) {
    const width = ch.width ?? p.baseNodeWidth;
    const height = ch.height ?? p.baseNodeHeight;
    const x = ch.x ?? 0;
    const y = ch.y ?? 0;
    boxes.set(ch.id, { nodeId: ch.id, x, y, width, height });
    maxR = Math.max(maxR, x + width);
    maxB = Math.max(maxB, y + height);
  }
  const routed = (laidOut.edges ?? []).map((e) => ({
    edgeId: e.id,
    points: (e.sections ?? []).flatMap((sec: {
      startPoint?: Point;
      bendPoints?: Point[];
      endPoint: Point;
    }) =>
      sec.startPoint
        ? [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint]
        : []
    )
  }));
  return {
    nodes: nodeIds.map((id) => boxes.get(id)!),
    width: maxR + cellPadding,
    height: maxB + cellPadding,
    cellEdges: routed
  };
}

/* ================= 连线路径（跨单元/聚合连线） ================= */

let channelCounter = 0;

function routeEdge(from: NodeBox, to: NodeBox, p: LayoutParams): Point[] {
  // 每条跨格连线分配唯一序号，用于把各边横/纵通道互相错开（减少竖直挤一根、水平重叠，T47 收尾）
  const seq = channelCounter++;
  const sx = from.x + from.width;
  const sy = from.y + from.height / 2;
  const ex = to.x;
  const ey = to.y + to.height / 2;

  if (from.nodeId === to.nodeId) {
    // 自环：右侧小回环
    return [
      { x: sx, y: sy },
      { x: sx + 18, y: sy },
      { x: sx + 18, y: sy + 18 },
      { x: sx, y: sy + 18 },
      { x: sx, y: sy }
    ];
  }
  if (sx <= ex + 1) {
    // 起点在终点左侧：Z 形正交路径。令竖直通道在节点水平间隙内按序号错开，
    // 避免多条边共用同一根 midX 竖线导致"竖直挤一根"。spread/slots 可经面板调整（T47 收尾）。
    const gap = ex - sx;
    const slots = Math.max(1, Math.round(p.edgeChannelSlots)); // 参与错开的通道槽位数
    const spread = Math.min(gap * 0.4, Math.max(0, p.edgeChannelSpread)); // 允许错开总宽度（受间隙约束）
    const off = ((seq % slots) - (slots >> 1)) * (spread / slots);
    const midX = (sx + ex) / 2 + off;
    return [
      { x: sx, y: sy },
      { x: midX, y: sy },
      { x: midX, y: ey },
      { x: ex, y: ey }
    ];
  }
  // 起点在终点右侧：向上绕行（通道随边序号错开避免重叠，step 可经面板调整，T47 收尾）
  const channel = Math.min(from.y, to.y) - p.layerSpacing - 24 - (seq % 8) * Math.max(0, p.edgeChannelStep);
  return [
    { x: sx, y: sy },
    { x: sx + 10, y: sy },
    { x: sx + 10, y: channel },
    { x: ex - 10, y: channel },
    { x: ex - 10, y: ey },
    { x: ex, y: ey }
  ];
}

/* ================= 行生成 ================= */

type RowUnit =
  | { kind: "cells"; module: VModule }
  | { kind: "aggregate"; module: VModule };

function genRows(module: VModule, collapsed: Set<string>, out: RowUnit[]) {
  if (collapsed.has(module.groupId)) {
    out.push({ kind: "aggregate", module });
    return;
  }
  if (module.directNodeIds.length > 0) {
    out.push({ kind: "cells", module });
  }
  for (const c of module.children) genRows(c, collapsed, out);
}

/* ================= 主入口 ================= */

/**
 * 计算图布局
 * @param diagram 业务语义图
 * @param options 布局选项（focusModuleId 模块折叠）
 * @returns 带坐标的布局结果
 */
export async function computeLayout(
  diagram: Diagram,
  options: LayoutOptions = {}
): Promise<LayoutDiagram> {
  channelCounter = 0;
  const ov = options.params ?? {};
  const base = getLayoutParams(diagram.type);
  // 覆盖优先：前端可调参数（T47）
  const p: LayoutParams = {
    ...base,
    nodeNodeSpacing: ov.nodeNodeSpacing ?? base.nodeNodeSpacing,
    layerSpacing: ov.layerSpacing ?? base.layerSpacing,
    baseNodeWidth: ov.baseNodeWidth ?? base.baseNodeWidth,
    baseNodeHeight: ov.baseNodeHeight ?? base.baseNodeHeight,
    edgeChannelSpread: ov.edgeChannelSpread ?? base.edgeChannelSpread,
    edgeChannelSlots: ov.edgeChannelSlots ?? base.edgeChannelSlots,
    edgeChannelStep: ov.edgeChannelStep ?? base.edgeChannelStep
  };
  const cellPadding = ov.cellPadding ?? CELL_PADDING;
  const colGap = ov.colGap ?? COL_GAP;
  const rowGap = ov.rowGap ?? ROW_GAP;
  const rawNodes = diagram.nodes as NodeMeta[];
  const allNodeIds = rawNodes.map((n) => n.nodeId);
  const metaById = new Map<string, NodeMeta>(rawNodes.map((n) => [n.nodeId, n]));

  const { roots } = buildModules(diagram.groups, allNodeIds);
  const { lanes, nodeToLane } = buildLanes(diagram.groups, allNodeIds);
  const plan = buildCollapsePlan(roots, options.focusModuleId);

  // 折叠后连线收敛
  const activeEdges: Edge[] = [];
  for (const e of diagram.edges) {
    const fromAgg = plan.nodeToAggregate.get(e.from);
    const toAgg = plan.nodeToAggregate.get(e.to);
    if (fromAgg && toAgg && fromAgg === toAgg) continue; // 折叠模块内部连线收敛丢弃
    activeEdges.push({
      edgeId: e.edgeId,
      from: fromAgg ?? e.from,
      to: toAgg ?? e.to,
      label: e.label
    });
  }

  const rows: RowUnit[] = [];
  for (const r of roots) genRows(r, plan.collapsed, rows);

  // 泳道拓扑序（仅保留有节点的列）
  const laneOrder = orderLanes(lanes, activeEdges).filter((l) =>
    rows.some((row) =>
      row.kind === "cells"
        ? row.module.directNodeIds.some((nid) => nodeToLane.get(nid) === l.groupId)
        : false
    )
  );
  const colIds = laneOrder.map((l) => l.groupId);

  // 逐行计算单元格
  const rowLayouts: Array<{
    unit: RowUnit;
    cells: Map<string, CellLayout>;
    rowH: number;
    aggregate?: NodeBox;
  }> = [];

  for (const unit of rows) {
    if (unit.kind === "aggregate") {
      const aggMeta = plan.aggregates.get(unit.module.groupId)!;
      const { width, height } = estimateNodeSize(aggMeta, p);
      rowLayouts.push({
        unit,
        cells: new Map(),
        rowH: MODULE_HEADER_H + height,
        aggregate: { nodeId: aggMeta.nodeId, x: 0, y: 0, width, height }
      });
      continue;
    }
    const cells = new Map<string, CellLayout>();
    let maxH = 0;
    for (const colId of colIds) {
      const cellNodes = unit.module.directNodeIds.filter(
        (nid) => nodeToLane.get(nid) === colId
      );
      if (cellNodes.length === 0) continue;
      const cell = await layoutCell(cellNodes, metaById, activeEdges, p, cellPadding);
      cells.set(colId, cell);
      maxH = Math.max(maxH, cell.height);
    }
    rowLayouts.push({
      unit,
      cells,
      rowH: MODULE_HEADER_H + maxH,
      aggregate: undefined
    });
  }

  // 列宽 = 各列跨行最大单元格宽度
  const colW = new Map<string, number>();
  for (const colId of colIds) {
    let w = 0;
    for (const rl of rowLayouts) {
      const cell = rl.cells.get(colId);
      if (cell) w = Math.max(w, cell.width);
    }
    colW.set(colId, Math.max(w, p.baseNodeWidth + cellPadding));
  }

  // 网格坐标
  const colX = new Map<string, number>();
  let cx = 0;
  for (const colId of colIds) {
    colX.set(colId, cx);
    cx += colW.get(colId)! + colGap;
  }
  const totalW = cx > 0 ? cx - colGap : 0;

  let contentH = 0;
  for (const rl of rowLayouts) contentH += rl.rowH;
  contentH += rowGap * Math.max(0, rowLayouts.length - 1);
  const totalH = LANE_HEADER_H + contentH;

  // 节点绝对坐标
  const nodePos = new Map<string, NodeBox>();
  let rowY = LANE_HEADER_H;
  const rowRect = new Map<string, { x: number; y: number; width: number; height: number }>();

  for (const rl of rowLayouts) {
    rowRect.set(rl.unit.module.groupId, { x: 0, y: rowY, width: totalW, height: rl.rowH });
    if (rl.unit.kind === "aggregate") {
      const agg = rl.aggregate!;
      const ax = Math.max(0, (totalW - agg.width) / 2);
      const ay = rowY + MODULE_HEADER_H;
      agg.x = ax;
      agg.y = ay;
      nodePos.set(agg.nodeId, { ...agg });
    } else {
      const cells = rl.cells;
      for (const [colId, cell] of cells) {
        const ox = colX.get(colId)!;
        const oy = rowY + MODULE_HEADER_H;
        for (const nb of cell.nodes) {
          const abs = { ...nb, x: ox + nb.x, y: oy + nb.y };
          nodePos.set(nb.nodeId, abs);
        }
      }
    }
    rowY += rl.rowH + rowGap;
  }

  // 连线：单元格内沿用 elk 路径（换算为绝对坐标），跨单元/聚合走正交路由
  const laidEdges = new Map<string, Point[]>();

  rowY = LANE_HEADER_H;
  for (const rl of rowLayouts) {
    if (rl.unit.kind === "cells") {
      const oy = rowY + MODULE_HEADER_H;
      for (const [colId, cell] of rl.cells) {
        const ox = colX.get(colId)!;
        for (const ce of cell.cellEdges) {
          laidEdges.set(
            ce.edgeId,
            ce.points.map((pt) => ({ x: pt.x + ox, y: pt.y + oy }))
          );
        }
      }
    }
    rowY += rl.rowH + rowGap;
  }
  for (const e of activeEdges) {
    if (laidEdges.has(e.edgeId)) continue;
    const from = nodePos.get(e.from);
    const to = nodePos.get(e.to);
    if (!from || !to) continue;
    laidEdges.set(e.edgeId, routeEdge(from, to, p));
  }

  const edges: LayoutDiagram["edges"] = activeEdges
    .filter((e) => laidEdges.has(e.edgeId))
    .map((e) => ({ edgeId: e.edgeId, points: laidEdges.get(e.edgeId)! }));

  const nodes: LayoutDiagram["nodes"] = Array.from(nodePos.values()).map((nb) => ({
    nodeId: nb.nodeId,
    x: Math.round(nb.x),
    y: Math.round(nb.y),
    width: Math.round(nb.width),
    height: Math.round(nb.height)
  }));

  // 模块分组框（递归：父模块包围其子模块行）
  const groupBoxes: LayoutDiagram["groups"] = [];
  const moduleBox = (m: VModule): LayoutDiagram["groups"][number] | null => {
    if (plan.collapsed.has(m.groupId)) return null;
    const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
    const own = rowRect.get(m.groupId);
    if (own) rects.push(own);
    for (const c of m.children) {
      const r = moduleBox(c);
      if (r) rects.push(r);
    }
    if (rects.length === 0) return null;
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    const right = Math.max(...rects.map((r) => r.x + r.width));
    const bottom = Math.max(...rects.map((r) => r.y + r.height));
    return { groupId: m.groupId, x, y, width: right - x, height: bottom - y };
  };
  const emitModule = (m: VModule) => {
    if (m.groupId === DEFAULT_MODULE) {
      for (const c of m.children) emitModule(c);
      return;
    }
    const box = moduleBox(m);
    if (box) groupBoxes.push(box);
    for (const c of m.children) emitModule(c);
  };
  for (const r of roots) emitModule(r);

  // 横向泳道分组框（整列）
  for (const lane of laneOrder) {
    if (lane.groupId === DEFAULT_LANE) continue;
    const x = colX.get(lane.groupId)!;
    groupBoxes.push({
      groupId: lane.groupId,
      x,
      y: 0,
      width: colW.get(lane.groupId)!,
      height: totalH
    });
  }

  // 画布尺寸：取全部元素（节点/连线路径/分组框）的实际包围盒并集，
  // 避免绕行连线/自环等超出网格尺寸导致边缘渲染不完整。
  const EDGE_MARGIN = 16; // 四周留白，防止边框/箭头贴边被裁
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const span = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const n of nodes) {
    span(n.x, n.y);
    span(n.x + n.width, n.y + n.height);
  }
  for (const e of edges) {
    for (const p of e.points) span(p.x, p.y);
  }
  for (const g of groupBoxes) {
    span(g.x, g.y);
    span(g.x + g.width, g.y + g.height);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = totalW;
    maxY = totalH;
  }
  // 整体平移到非负起点（绕行通道等可能存在负坐标），保证 SVG viewBox 从 0 开始完整覆盖
  const dx = minX;
  const dy = minY;
  for (const n of nodes) {
    n.x -= dx;
    n.y -= dy;
  }
  for (const e of edges) {
    for (const p of e.points) {
      p.x -= dx;
      p.y -= dy;
    }
  }
  for (const g of groupBoxes) {
    g.x -= dx;
    g.y -= dy;
  }
  const canvasWidth = Math.ceil(maxX - minX + EDGE_MARGIN * 2);
  const canvasHeight = Math.ceil(maxY - minY + EDGE_MARGIN * 2);

  return {
    diagramId: diagram.diagramId,
    width: Math.max(1, canvasWidth),
    height: Math.max(1, canvasHeight),
    nodes,
    edges,
    groups: groupBoxes
  };
}
