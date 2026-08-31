<template>
  <svg
    class="diagram-svg"
    :viewBox="viewBox"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#909399" />
      </marker>
    </defs>

    <!-- 内容直接渲染：viewBox 与布局坐标 1:1，无限漫游由外层 transform 层承担 -->
    <!-- 分组：纵向模块（实线框+标题栏+折叠按钮）/ 横向泳道（浅色带） -->
    <g v-for="g in layout.groups" :key="g.groupId" class="group">
      <rect
        :class="['group-rect', groupAxis(g.groupId) === 'vertical' ? 'is-module' : 'is-lane']"
        :x="g.x"
        :y="g.y"
        :width="g.width"
        :height="g.height"
        rx="6"
      />
      <text
        :x="g.x + 8"
        :y="g.y + 16"
        :class="['group-title', groupAxis(g.groupId) === 'vertical' ? 'is-module' : 'is-lane']"
      >{{ groupTitle(g.groupId) }}</text>
      <!-- 折叠模块：框内由聚合节点呈现（见节点区 aggregate 渲染） -->
      <g
        v-if="groupAxis(g.groupId) === 'vertical' && groupCollapsible(g.groupId)"
        :transform="`translate(${g.x + g.width - 20}, ${g.y + 6})`"
        class="collapse-btn"
        @pointerdown.stop.prevent
        @click.stop="onToggleModule(g.groupId)"
      >
        <circle r="9" fill="#fff" stroke="#409eff" stroke-width="1.5" />
        <text text-anchor="middle" dominant-baseline="central" font-size="13" fill="#409eff" font-weight="700">
          {{ isCollapsed(g.groupId) ? "+" : "−" }}
        </text>
      </g>
    </g>

    <!-- 连线（正交折线 + 箭头 + 标签）；跨折叠模块连线端点收敛到模块框边缘 -->
    <g
      v-for="e in renderEdges"
      :key="e.edgeId"
      :class="['edge', isEdgeHighlighted(e.edgeId) ? 'is-highlighted' : '']"
    >
      <polyline :points="pointsToStr(e.points)" fill="none" marker-end="url(#arrow)" />
      <text v-if="edgeLabel(e.edgeId)" class="edge-label" :x="edgeMid(e).x" :y="edgeMid(e).y" text-anchor="middle">
        {{ edgeLabel(e.edgeId) }}
      </text>
    </g>

    <!-- 节点（按语义类型区分样式；聚合节点特殊渲染；折叠模块内部节点隐藏） -->
    <g
      v-for="n in renderNodes"
      :key="n.nodeId"
      :class="['node', isAggregate(n.nodeId) ? 'is-aggregate' : '', isNodeHighlighted(n.nodeId) ? 'is-highlighted' : '']"
      :transform="`translate(${n.x}, ${n.y})`"
      @click="onNodeClick(n.nodeId)"
      @mouseenter="onNodeHover(n.nodeId, true)"
      @mouseleave="onNodeHover(n.nodeId, false)"
    >
      <!-- 聚合节点（折叠模块呈现为单个节点，点击展开） -->
      <template v-if="isAggregate(n.nodeId)">
        <rect :width="n.width" :height="n.height" rx="8" class="node-rect aggregate" />
        <text class="node-label aggregate-title" :x="n.width / 2" :y="n.height / 2" text-anchor="middle" dominant-baseline="central">
          {{ aggregateTitle(n.nodeId) }}
        </text>
        <text class="node-label aggregate-hint" :x="n.width / 2" :y="n.height / 2 + 18" text-anchor="middle">
          （已折叠 · 点击展开）
        </text>
      </template>

      <!-- 流程图决策节点：菱形 -->
      <template v-else-if="nodeShape(n.nodeId) === 'diamond'">
        <path :d="diamondPath(n)" :class="['node-rect', 'shape-diamond', nodeKindClass(n.nodeId)]" />
        <text class="node-label" :x="n.width / 2" :y="n.height / 2" text-anchor="middle" dominant-baseline="central">
          {{ nodeLabel(n.nodeId) }}
        </text>
      </template>

      <!-- 类节点：类名 + 属性/方法分栏 -->
      <template v-else-if="nodeShape(n.nodeId) === 'class'">
        <rect :width="n.width" :height="n.height" rx="6" :class="['node-rect', nodeKindClass(n.nodeId)]" />
        <rect :width="n.width" :height="24" rx="6" :class="['node-rect', 'class-header', nodeKindClass(n.nodeId)]" />
        <text class="node-label class-title" :x="6" :y="16">{{ nodeLabel(n.nodeId) }}</text>
        <line :x1="0" :y1="24" :x2="n.width" :y2="24" class="class-sep" />
        <text v-for="(line, i) in classBodyLines(n)" :key="i" class="node-label class-line" :x="6" :y="24 + 16 * (i + 1)">
          {{ line }}
        </text>
      </template>

      <!-- 常规节点 -->
      <template v-else>
        <rect :width="n.width" :height="n.height" rx="6" :class="['node-rect', nodeKindClass(n.nodeId)]" />
        <text class="node-label" :x="n.width / 2" :y="n.height / 2" text-anchor="middle" dominant-baseline="central">
          {{ nodeLabel(n.nodeId) }}
        </text>
      </template>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Diagram, LayoutDiagram } from "@fourstage/shared";

const props = defineProps<{
  layout: LayoutDiagram;
  /** 图语义模型（含节点类型字段，用于区分渲染样式） */
  diagram: Diagram;
  /** 已折叠模块 groupId 列表（会话态，本地折叠，不重排布局） */
  collapsedModules?: string[];
  /** 相机视口（Excalidraw 方式）：viewBox 字符串，由父级相机状态计算 */
  viewBox?: string;
}>();

const emit = defineEmits<{
  /** 折叠/展开：传入 groupId 切换该模块折叠状态 */
  (e: "toggle-collapse", groupId: string): void;
  /** 架构层节点点击：通知父级弹出关联图气泡（T39） */
  (e: "node-click", nodeId: string): void;
  /** 架构层节点悬停：enter 传 nodeId，leave 传 null（T40） */
  (e: "node-hover", nodeId: string | null): void;
}>();

/** 语义节点映射：nodeId → 节点对象 */
const nodeById = computed(() => {
  const m = new Map<string, Record<string, unknown>>();
  for (const n of props.diagram.nodes as unknown as Array<Record<string, unknown>>) {
    m.set(String(n.nodeId), n);
  }
  return m;
});

/** 分组语义信息（含 parentGroupId，供折叠祖先判定） */
const groupById = computed(() => {
  const m = new Map<string, { title: string; axis?: string; collapsible?: boolean; parentGroupId?: string }>();
  for (const g of props.diagram.groups) {
    m.set(g.groupId, g);
  }
  return m;
});

/** 连线标签映射 */
const edgeLabelMap = computed(() => {
  const m = new Map<string, string>();
  for (const e of props.diagram.edges) {
    m.set(e.edgeId, e.label ?? "");
  }
  return m;
});

/** 已折叠集合（快速查找） */
const collapsedSet = computed(() => new Set(props.collapsedModules ?? []));

/* ========== 折叠几何：判定节点/连线归属的可折叠模块框 ========== */

interface Box { x: number; y: number; w: number; h: number; }

/** 可折叠（纵向模块）的布局框 groupId → box */
const moduleBoxes = computed(() => {
  const m = new Map<string, Box>();
  for (const g of props.layout.groups) {
    if (groupAxis(g.groupId) !== "vertical") continue;
    if (!groupCollapsible(g.groupId)) continue;
    m.set(g.groupId, { x: g.x, y: g.y, w: g.width, h: g.height });
  }
  return m;
});

/**
 * 定位 (x,y) 命中的最深层可折叠模块。
 * 模块框整行堆叠（父子嵌套），因此命中多个时取高度最小者 = 最深。
 */
function findModule(x: number, y: number): string {
  let best: { id: string; h: number } | null = null;
  for (const [id, b] of moduleBoxes.value) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      if (!best || b.h < best.h) best = { id, h: b.h };
    }
  }
  return best ? best.id : "";
}

/** 判定某模块是否自身已折叠或其祖先已折叠（自身/子级节点均应隐藏） */
function isCollapsedOrAncestor(groupId: string): boolean {
  let cur = groupId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (collapsedSet.value.has(cur)) return true;
    seen.add(cur);
    cur = groupById.value.get(cur)?.parentGroupId ?? "";
  }
  return false;
}

/** 节点是否应隐藏（位于折叠模块内） */
function isNodeHidden(n: { x: number; y: number; width: number; height: number }): boolean {
  return isCollapsedOrAncestor(findModule(n.x + n.width / 2, n.y + n.height / 2));
}

/** 自身折叠（且祖先未折叠）：折叠模块渲染为单个聚合节点的前提 */
function isDirectlyCollapsed(groupId: string): boolean {
  if (!collapsedSet.value.has(groupId)) return false;
  let cur = groupById.value.get(groupId)?.parentGroupId ?? "";
  while (cur) {
    if (collapsedSet.value.has(cur)) return false;
    cur = groupById.value.get(cur)?.parentGroupId ?? "";
  }
  return true;
}

/**
 * 折叠模块的聚合节点：折叠后框内渲染为一个代表整模块的节点（如折叠「组件层」→ 渲染「组件层」节点）。
 * 位置居中于模块框，仅渲染层，不修改布局/语义数据。
 */
const aggregateNodes = computed(() => {
  const out: LayoutDiagram["nodes"] = [];
  for (const g of props.layout.groups) {
    if (groupAxis(g.groupId) !== "vertical") continue;
    if (!groupCollapsible(g.groupId)) continue;
    if (!isDirectlyCollapsed(g.groupId)) continue;
    const b = moduleBoxes.value.get(g.groupId);
    if (!b) continue;
    const title = groupTitle(g.groupId);
    const width = Math.max(120, title.length * 14 + 40);
    const height = 44;
    out.push({
      nodeId: `${g.groupId}::aggregate`,
      x: b.x + (b.w - width) / 2,
      y: b.y + (b.h - height) / 2,
      width,
      height
    });
  }
  return out;
});

/** 可见节点：真实节点过滤折叠模块内节点 + 追加折叠模块聚合节点 */
const renderNodes = computed(() => [
  ...props.layout.nodes.filter((n) => !isNodeHidden(n)),
  ...aggregateNodes.value
]);

/** 分组是否处于折叠态（用于「已折叠」提示） */
function isGroupCollapsed(groupId: string): boolean {
  return isCollapsedOrAncestor(groupId);
}

/* ========== 跨折叠模块连线的整合（折叠模块作为统一出入口） ========== */

function inBox(p: { x: number; y: number }, b: Box): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

/** 折叠模块统一出入口锚点 = 模块框中心（仅渲染，不影响数据） */
function moduleAnchor(groupId: string): { x: number; y: number } | null {
  const b = moduleBoxes.value.get(groupId);
  if (!b) return null;
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** 过滤掉框内点（折叠模块内部的连线段不再渲染） */
function outsideOf(points: Array<{ x: number; y: number }>, b: Box): Array<{ x: number; y: number }> {
  return points.filter((p) => !inBox(p, b));
}

/** 可见连线：折叠模块整体作为统一出入口，进出连线汇聚到模块框中心 */
const renderEdges = computed(() => {
  const out: LayoutDiagram["edges"] = [];
  for (const e of props.layout.edges) {
    const pts = e.points;
    if (pts.length < 2) {
      out.push(e);
      continue;
    }
    const p0 = pts[0];
    const pN = pts[pts.length - 1];
    const fromM = findModule(p0.x, p0.y);
    const toM = findModule(pN.x, pN.y);
    const fromHidden = isCollapsedOrAncestor(fromM);
    const toHidden = isCollapsedOrAncestor(toM);
    // 同一折叠模块内部连线：整体收敛丢弃
    if (fromHidden && toHidden && fromM === toM) continue;
    const fromAnchor = fromHidden ? moduleAnchor(fromM) : null;
    const toAnchor = toHidden ? moduleAnchor(toM) : null;
    let arr: Array<{ x: number; y: number }>;
    if (fromAnchor && toAnchor) {
      // 两端均为折叠模块：模块框中心直连（各自作为统一出入口）
      arr = [fromAnchor, toAnchor];
    } else if (fromAnchor) {
      // 起点为折叠模块：以中心为统一出口，连接框外路径
      const fb = moduleBoxes.value.get(fromM);
      arr = [fromAnchor, ...(fb ? outsideOf(pts, fb) : pts.slice(1))];
    } else if (toAnchor) {
      // 终点为折叠模块：框外路径汇聚到中心统一入口
      const tb = moduleBoxes.value.get(toM);
      arr = [...(tb ? outsideOf(pts, tb) : pts.slice(0, -1)), toAnchor];
    } else {
      arr = pts;
    }
    if (arr.length >= 2) out.push({ edgeId: e.edgeId, points: arr });
  }
  return out;
});

/* ========== 基础文本 ========== */

function pointsToStr(points: Array<{ x: number; y: number }>): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

function nodeLabel(nodeId: string): string {
  const n = nodeById.value.get(nodeId);
  return (n?.label as string) ?? nodeId;
}

function edgeLabel(edgeId: string): string {
  return edgeLabelMap.value.get(edgeId) ?? "";
}

function edgeMid(e: { points: Array<{ x: number; y: number }> }) {
  const pts = e.points;
  if (pts.length === 0) return { x: 0, y: 0 };
  const mid = pts[Math.floor(pts.length / 2)];
  return { x: mid.x, y: mid.y - 6 };
}

function groupTitle(groupId: string): string {
  const g = groupById.value.get(groupId);
  return g?.title ?? groupId;
}

function groupAxis(groupId: string): string {
  return groupById.value.get(groupId)?.axis ?? "vertical";
}

function groupCollapsible(groupId: string): boolean {
  return groupById.value.get(groupId)?.collapsible ?? false;
}

function isCollapsed(groupId: string): boolean {
  return collapsedSet.value.has(groupId);
}

/** 折叠按钮：仅切换当前模块折叠状态（不再触发服务端重布局/聚焦） */
function onToggleModule(groupId: string) {
  emit("toggle-collapse", groupId);
}

/** 点击聚合节点：展开对应折叠模块 */
function onAggregateClick(nodeId: string) {
  const groupId = nodeId.replace(/::aggregate$/, "");
  emit("toggle-collapse", groupId);
}

/* ========== 节点交互：架构层点击联动（T39）/ 类图点击高亮（T41） ========== */

/** 类图节点点击高亮（会话态，刷新重置）：当前高亮节点 id */
const highlightNodeId = ref("");

/** 与高亮节点相连的语义连线 edgeId 集合（layout.edges 依此判断高亮） */
const highlightedEdgeIds = computed(() => {
  const ids = new Set<string>();
  if (props.diagram.type !== "class" || !highlightNodeId.value) return ids;
  for (const e of props.diagram.edges) {
    if (e.from === highlightNodeId.value || e.to === highlightNodeId.value) {
      ids.add(e.edgeId);
    }
  }
  return ids;
});

/** 节点是否处于类图点击高亮态 */
function isNodeHighlighted(nodeId: string): boolean {
  return props.diagram.type === "class" && highlightNodeId.value === nodeId;
}

/** 连线是否与高亮节点相连（类图连线高亮） */
function isEdgeHighlighted(edgeId: string): boolean {
  return highlightedEdgeIds.value.has(edgeId);
}

/**
 * 节点点击分发：
 * - 聚合节点 → 展开折叠模块
 * - 架构图节点 → 触发父级关联图气泡（T39）
 * - 类图节点 → 本节点高亮 + 相连连线高亮，再点同节点取消（T41）
 * - 流程图节点 → 无操作
 */
function onNodeClick(nodeId: string) {
  if (isAggregate(nodeId)) {
    onAggregateClick(nodeId);
    return;
  }
  if (props.diagram.type === "architecture") {
    emit("node-click", nodeId);
  } else if (props.diagram.type === "class") {
    // 再点同一节点取消高亮；点其他节点切换高亮
    highlightNodeId.value = highlightNodeId.value === nodeId ? "" : nodeId;
  }
  // flow：无操作
}

/**
 * 节点悬停（T40）：仅架构图节点触发，enter 上抛 nodeId，leave 上抛 null。
 * 父级 DiagramView 依节点 description 显示/隐藏描述气泡。
 */
function onNodeHover(nodeId: string, enter: boolean) {
  if (props.diagram.type !== "architecture") return;
  if (isAggregate(nodeId)) return;
  emit("node-hover", enter ? nodeId : null);
}

/** 切换图时重置类图高亮态（避免残留到新图） */
watch(
  () => props.diagram,
  () => {
    highlightNodeId.value = "";
  }
);

/* ========== 聚合节点 ========== */

function isAggregate(nodeId: string): boolean {
  return nodeId.endsWith("::aggregate");
}

function aggregateTitle(nodeId: string): string {
  const groupId = nodeId.replace(/::aggregate$/, "");
  return groupTitle(groupId);
}

/* ========== 节点类型判定 ========== */

function nodeShape(nodeId: string): string {
  if (props.diagram.type === "flow") {
    const kind = nodeById.value.get(nodeId)?.nodeKind;
    return kind === "decision" ? "diamond" : "rect";
  }
  if (props.diagram.type === "class") {
    return "class";
  }
  return "rect";
}

function nodeKindClass(nodeId: string): string {
  const n = nodeById.value.get(nodeId);
  if (props.diagram.type === "architecture") {
    const kind = n?.nodeKind as string;
    return kind ? `arch-${kind}` : "arch-service";
  }
  if (props.diagram.type === "class") {
    const kind = (n?.kind as string) ?? "class";
    return `class-${kind}`;
  }
  const kind = (n?.nodeKind as string) ?? "process";
  return `flow-${kind}`;
}

function diamondPath(n: { width: number; height: number }): string {
  const w = n.width;
  const h = n.height;
  return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;
}

/** 类节点正文行（属性/方法），按节点高度裁剪 */
function classBodyLines(n: { nodeId: string; height: number }): string[] {
  const node = nodeById.value.get(n.nodeId);
  const lines: string[] = [];
  for (const a of (node?.attributes as Array<Record<string, unknown>>) ?? []) {
    lines.push(`${a.name}: ${a.type}`);
  }
  for (const mth of (node?.methods as Array<Record<string, unknown>>) ?? []) {
    lines.push(`${mth.name}(${((mth.params as Array<Record<string, unknown>>) ?? []).map((p) => p.type).join(", ")})`);
  }
  // 每行 16px，顶部标题栏 24px
  const max = Math.max(0, Math.floor((n.height - 28) / 16));
  return lines.slice(0, max);
}
</script>

<style scoped>
.diagram-svg {
  width: 100%;
  height: 100%;
  display: block;
  background: #ffffff;
  border-radius: 8px;
}
.group-rect {
  fill: #f5f7fa;
  stroke: #c0c4cc;
  stroke-dasharray: 5 5;
}
.group-rect.is-module {
  fill: rgba(64, 158, 255, 0.04);
  stroke: #a0cfff;
  stroke-dasharray: none;
}
.group-rect.is-lane {
  fill: rgba(144, 147, 153, 0.06);
  stroke: #dcdfe6;
}
.group-title {
  font-size: 12px;
  fill: #909399;
  font-weight: 600;
}
.group-title.is-module {
  fill: #409eff;
}
.group-title.is-lane {
  fill: #606266;
}
.collapsed-tag {
  font-size: 13px;
  fill: #b88230;
  font-weight: 600;
  paint-order: stroke;
  stroke: #ffffff;
  stroke-width: 3px;
}
.collapse-btn {
  cursor: pointer;
}
.collapse-btn text {
  pointer-events: none;
}
.edge polyline {
  stroke: #909399;
  stroke-width: 1.5;
  stroke-linejoin: round;
}
/* 类图点击高亮：相连连线高亮（T41） */
.edge.is-highlighted polyline {
  stroke: #409eff;
  stroke-width: 3;
  filter: drop-shadow(0 0 4px rgba(64, 158, 255, 0.7));
}
.edge-label {
  font-size: 11px;
  fill: #606266;
  paint-order: stroke;
  stroke: #fff;
  stroke-width: 3px;
}
.node {
  cursor: default;
}
/* 类图点击高亮：节点边框提亮 + 阴影（T41，会话态，不影响数据） */
.node.is-highlighted .node-rect:not(.class-header) {
  stroke-width: 3;
  stroke: #409eff;
  filter: drop-shadow(0 0 6px rgba(64, 158, 255, 0.75));
}
.node-rect {
  fill: #ecf5ff;
  stroke: #409eff;
  stroke-width: 1.5;
}
.node-rect.aggregate {
  fill: #fdf6ec;
  stroke: #e6a23c;
  stroke-dasharray: 6 4;
  cursor: pointer;
}
.node-label {
  font-size: 13px;
  fill: #303133;
}
.aggregate-title {
  font-size: 14px;
  font-weight: 700;
  fill: #b88230;
}
.aggregate-hint {
  font-size: 11px;
  fill: #c0a060;
}
.shape-diamond {
  fill: #fdf6ec;
  stroke: #e6a23c;
}
.class-header {
  stroke-width: 0;
}
.class-sep {
  stroke: #c0c4cc;
  stroke-width: 1;
}
.class-title {
  font-size: 13px;
  font-weight: 700;
}
.class-line {
  font-size: 11px;
  fill: #606266;
}

/* 架构图节点类型 */
.arch-service { fill: #ecf5ff; stroke: #409eff; }
.arch-database { fill: #fdf6ec; stroke: #e6a23c; }
.arch-mq { fill: #f5f0ff; stroke: #7c6ad8; }
.arch-cache { fill: #f0f9eb; stroke: #67c23a; }
.arch-external { fill: #f4f4f5; stroke: #909399; }
.arch-gateway { fill: #fef0f0; stroke: #f56c6c; }

/* 类图节点类型 */
.class-class { fill: #ecf5ff; stroke: #409eff; }
.class-interface { fill: #f0f9eb; stroke: #67c23a; }
.class-abstract { fill: #f5f0ff; stroke: #7c6ad8; }
.class-enum { fill: #fdf6ec; stroke: #e6a23c; }

/* 流程图节点类型 */
.flow-start { fill: #f0f9eb; stroke: #67c23a; }
.flow-end { fill: #fef0f0; stroke: #f56c6c; }
.flow-process { fill: #ecf5ff; stroke: #409eff; }
.flow-decision { fill: #fdf6ec; stroke: #e6a23c; }
.flow-inputOutput { fill: #e8f8f8; stroke: #36cfc9; }
.flow-subprocess { fill: #f5f0ff; stroke: #7c6ad8; }
</style>