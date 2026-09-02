<template>
  <svg
    ref="svgEl"
    class="diagram-svg"
    :viewBox="viewBox"
    xmlns="http://www.w3.org/2000/svg"
    @pointermove="onSvgPointerMove"
    @pointerup="onSvgPointerUp"
    @pointercancel="onSvgPointerUp"
  >
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
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

    <!-- 节点（普通节点，按语义类型区分样式；连线绘制在其上，端点/箭头完整可见便于拖拽） -->
    <g
      v-for="n in normalNodes"
      :key="n.nodeId"
      :class="[
        'node',
        isNodeHighlighted(n.nodeId) ? 'is-highlighted' : '',
        editMode ? 'is-editing' : '',
        hasNodeOverride(n.nodeId) ? 'has-override' : '',
        nodeRiskClass(n.nodeId)
      ]"
      :transform="`translate(${n.x}, ${n.y})`"
      @click="onNodeClickSuppressed(n.nodeId)"
      @pointerdown="onNodeDown(n.nodeId, $event)"
      @contextmenu.prevent="onNodeContextMenu(n.nodeId)"
      @mouseenter="onNodeHover(n.nodeId, true)"
      @mouseleave="onNodeHover(n.nodeId, false)"
    >
      <!-- 流程图决策节点：菱形 -->
      <template v-if="nodeShape(n.nodeId) === 'diamond'">
        <path :d="diamondPath(n)" :class="['node-rect', 'shape-diamond', nodeKindClass(n.nodeId)]" />
        <text class="node-label" :x="n.width / 2" :y="n.height / 2" text-anchor="middle" dominant-baseline="central">
          {{ nodeLabel(n.nodeId) }}
        </text>
      </template>

      <!-- 类节点：类名 + 属性/方法分栏；方法行可点击（T70 方法级高亮） -->
      <template v-else-if="nodeShape(n.nodeId) === 'class'">
        <rect :width="n.width" :height="n.height" rx="6" :class="['node-rect', nodeKindClass(n.nodeId)]" />
        <rect :width="n.width" :height="24" rx="6" :class="['node-rect', 'class-header', nodeKindClass(n.nodeId)]" />
        <text class="node-label class-title" :x="6" :y="16">{{ nodeLabel(n.nodeId) }}</text>
        <line :x1="0" :y1="24" :x2="n.width" :y2="24" class="class-sep" />
        <g
          v-for="row in classBodyRows(n)"
          :key="row.key"
          :class="[
            'class-body-row',
            row.type === 'method' ? 'is-method' : 'is-attr',
            row.type === 'method' && isMethodHighlighted(n.nodeId, row.methodName) ? 'is-method-highlighted' : ''
          ]"
          @pointerdown.stop.prevent
          @click.stop="row.type === 'method' ? onMethodClick(n.nodeId, row.methodName!) : undefined"
        >
          <rect v-if="row.type === 'method'" :x="0" :y="row.y - 13" :width="n.width" :height="16" class="method-hit" />
          <text class="node-label class-line" :x="6" :y="row.y">{{ row.text }}</text>
        </g>
      </template>

      <!-- 常规节点 -->
      <template v-else>
        <rect :width="n.width" :height="n.height" rx="6" :class="['node-rect', nodeKindClass(n.nodeId)]" />
        <text class="node-label" :x="n.width / 2" :y="n.height / 2" text-anchor="middle" dominant-baseline="central">
          {{ nodeLabel(n.nodeId) }}
        </text>
      </template>
    </g>

    <!-- 连线（正交折线 + 箭头 + 标签）；绘制在普通节点之上，端点/箭头不被节点遮挡（跨折叠模块连线端点收敛到模块框边缘） -->
    <g
      v-for="e in renderEdges"
      :key="e.edgeId"
      :class="[
        'edge',
        diagram.type === 'class' ? 'is-clickable' : '',
        isEdgeHighlighted(e.edgeId) ? 'is-highlighted' : '',
        hasEdgeOverride(e.edgeId) ? 'has-override' : ''
      ]"
      @click="onEdgeClickSuppressed(e.edgeId)"
      @contextmenu.prevent="onEdgeContextMenu(e.edgeId, $event)"
      @pointerdown="onEdgeDown(e.edgeId, $event)"
      @dblclick="onEdgeDblClick(e.edgeId, $event)"
    >
      <!-- T49 透明粗热区：扩大连线点击命中范围（仅命中用，不参与高亮样式） -->
      <polyline class="edge-hit" :points="pointsToStr(e.points)" fill="none" stroke="transparent" stroke-width="14" />
      <polyline :points="pointsToStr(e.points)" fill="none" marker-end="url(#arrow)" />
      <text v-if="edgeLabel(e.edgeId)" class="edge-label" :x="edgeMid(e).x" :y="edgeMid(e).y" text-anchor="middle">
        {{ edgeLabel(e.edgeId) }}
      </text>
      <!-- T53 手动编辑：折点/端点操作改为线段命中/双击/右键，不再以圆形手柄标出（T78） -->
    </g>

    <!-- 聚合节点（折叠模块）：置于最顶层，保证连线不遮挡其点击展开 -->
    <g
      v-for="n in renderAggregateNodes"
      :key="n.nodeId"
      class="node is-aggregate"
      :transform="`translate(${n.x}, ${n.y})`"
      @click="onNodeClickSuppressed(n.nodeId)"
      @pointerdown="onNodeDown(n.nodeId, $event)"
      @contextmenu.prevent="onNodeContextMenu(n.nodeId)"
      @mouseenter="onNodeHover(n.nodeId, true)"
      @mouseleave="onNodeHover(n.nodeId, false)"
    >
      <rect :width="n.width" :height="n.height" rx="8" class="node-rect aggregate" />
      <text class="node-label aggregate-title" :x="n.width / 2" :y="n.height / 2" text-anchor="middle" dominant-baseline="central">
        {{ aggregateTitle(n.nodeId) }}
      </text>
      <text class="node-label aggregate-hint" :x="n.width / 2" :y="n.height / 2 + 18" text-anchor="middle">
        （已折叠 · 点击展开）
      </text>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Diagram, LayoutDiagram } from "@fourstage/shared";
import type { ImpactRiskMap } from "../../api/index";
import type { ManualOverrides } from "./useManualEdit";
import { dist, snapToNodeBorder, orthogonalizePath, mergeCollinear, ensurePerpendicularEnds, moveEdgeEndpoint, type NodeBox } from "./useEdgeGeometry";

const props = defineProps<{
  layout: LayoutDiagram;
  /** 图语义模型（含节点类型字段，用于区分渲染样式） */
  diagram: Diagram;
  /** 已折叠模块 groupId 列表（会话态，本地折叠，不重排布局） */
  collapsedModules?: string[];
  /** 相机视口（Excalidraw 方式）：viewBox 字符串，由父级相机状态计算 */
  viewBox?: string;
  /** 编辑态（T52/T53）：节点可拖拽、连线显示手柄；仅影响交互与外观，不改数据 */
  editMode?: boolean;
  /** 手动覆盖（T51/T54）：节点位置/连线路径的用户增量，渲染层叠加于引擎结果 */
  overrides?: ManualOverrides;
  /** 节点风险分映射（feature/diagram-risk-color）：nodeId → structuralRisk，用于节点描边着色 */
  riskMap?: ImpactRiskMap;
}>();

const emit = defineEmits<{
  /** 折叠/展开：传入 groupId 切换该模块折叠状态 */
  (e: "toggle-collapse", groupId: string): void;
  /** 架构层节点点击：通知父级弹出关联图气泡（T39） */
  (e: "node-click", nodeId: string): void;
  /** 架构层节点悬停：enter 传 nodeId，leave 传 null（T40） */
  (e: "node-hover", nodeId: string | null): void;
  /** T52 节点拖拽：commit=false 拖动中实时更新，commit=true 拖动结束 */
  (e: "node-move", nodeId: string, x: number, y: number, commit: boolean): void;
  /** T53 连线手柄拖拽：points 为完整新路径，commit=false 拖动中，true 结束 */
  (e: "edge-move", edgeId: string, points: Array<{ x: number; y: number }>, commit: boolean): void;
  /** T56 右键清除节点覆盖 */
  (e: "clear-node", nodeId: string): void;
  /** T56 右键清除连线覆盖 */
  (e: "clear-edge", edgeId: string): void;
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

/* ========== 手动编辑：覆盖合并与渲染叠加（T54） ========== */

/** 节点位置覆盖：覆盖优先于引擎布局坐标，渲染层直接替换 */
const effectiveNodes = computed(() =>
  props.layout.nodes.map((n) => {
    const ov = props.overrides?.nodes?.[n.nodeId];
    return ov ? { ...n, x: ov.x, y: ov.y } : n;
  })
);

/** 语义连线端点表（edgeId → from/to 节点 id），供路径跟随节点移动 */
const edgeEndpointById = computed(() => {
  const m = new Map<string, { from: string; to: string }>();
  for (const e of props.diagram.edges) m.set(e.edgeId, { from: e.from, to: e.to });
  return m;
});

/** 连线端点节点盒子（T68 优化：端点沿节点边框滑动）；a=points[0] 端、b=points[last] 端 */
function endpointBoxes(edgeId: string): { a: { x: number; y: number; width: number; height: number }; b: { x: number; y: number; width: number; height: number } } | null {
  const ep = edgeEndpointById.value.get(edgeId);
  if (!ep) return null;
  const from = props.layout.nodes.find((n) => n.nodeId === ep.from);
  const to = props.layout.nodes.find((n) => n.nodeId === ep.to);
  if (!from || !to) return null;
  return { a: from, b: to };
}

/**
 * 连线路径合并（T54）：
 * - 有覆盖的连线：直接用覆盖路径（手动优先于引擎）
 * - 无覆盖的连线：若端点节点被手动移动，路径按弧长比例跟随端点位移
 *   （t=0 端点跟 from 节点位移，t=1 端点跟 to 节点位移，中间线性过渡，
 *   保证连线两端始终贴附在各自节点上）
 */
const effectiveEdges = computed(() =>
  props.layout.edges.map((e) => {
    const ov = props.overrides?.edges?.[e.edgeId];
    if (ov) return { edgeId: e.edgeId, points: ov.points };
    const ep = edgeEndpointById.value.get(e.edgeId);
    if (!ep) return e;
    const fromDelta = nodeDelta(ep.from);
    const toDelta = nodeDelta(ep.to);
    if (fromDelta.dx === 0 && fromDelta.dy === 0 && toDelta.dx === 0 && toDelta.dy === 0) return e;
    // 各折点按弧长占比 t（0=from 端，1=to 端）线性插值端点位移
    const t = arcFractions(e.points);
    return {
      edgeId: e.edgeId,
      points: e.points.map((p, i) => ({
        x: p.x + fromDelta.dx * (1 - t[i]) + toDelta.dx * t[i],
        y: p.y + fromDelta.dy * (1 - t[i]) + toDelta.dy * t[i]
      }))
    };
  })
);

/** 折点沿路径的弧长归一化占比（首点 0，末点 1；等长退化返回全 0） */
function arcFractions(points: Array<{ x: number; y: number }>): number[] {
  const n = points.length;
  if (n < 2) return points.map(() => 0);
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < n - 1; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    segs.push(len);
    total += len;
  }
  if (total <= 0) return points.map(() => 0);
  const t: number[] = [0];
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    acc += segs[i];
    t.push(acc / total);
  }
  return t;
}

/** 节点覆盖位移（覆盖位置 - 引擎布局位置），供连线跟随；兼容聚合占位节点 */
function nodeDelta(nodeId: string): { dx: number; dy: number } {
  const ov = props.overrides?.nodes?.[nodeId];
  if (!ov) return { dx: 0, dy: 0 };
  // 真实节点：以引擎布局坐标作基底
  const n = props.layout.nodes.find((nd) => nd.nodeId === nodeId);
  if (n) return { dx: ov.x - n.x, dy: ov.y - n.y };
  // 聚合占位节点（折叠模块）：以聚合节点当前渲染位置作基底
  const agg = aggregateNodes.value.find((a) => a.nodeId === nodeId);
  if (agg) return { dx: ov.x - agg.x, dy: ov.y - agg.y };
  return { dx: 0, dy: 0 };
}

/** 节点是否有手动覆盖（用于样式提示） */
function hasNodeOverride(nodeId: string): boolean {
  return !!props.overrides?.nodes?.[nodeId];
}

/** 连线是否有手动覆盖（用于样式提示） */
function hasEdgeOverride(edgeId: string): boolean {
  return !!props.overrides?.edges?.[edgeId];
}

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

/** 可见节点：真实节点过滤折叠模块内节点 + 追加折叠模块聚合节点；两者均叠加手动覆盖（T54） */
const renderNodes = computed(() => [
  ...effectiveNodes.value.filter((n) => !isNodeHidden(n)),
  ...aggregateNodes.value.map((n) => {
    const ov = props.overrides?.nodes?.[n.nodeId];
    return ov ? { ...n, x: ov.x, y: ov.y } : n;
  })
]);

/** 普通节点（不含聚合节点；连线绘制在其上层，端点/箭头不被遮挡） */
const normalNodes = computed(() => renderNodes.value.filter((n) => !isAggregate(n.nodeId)));

/** 聚合节点（折叠模块）：置于最顶层渲染，保证连线不遮挡其点击展开 */
const renderAggregateNodes = computed(() => renderNodes.value.filter((n) => isAggregate(n.nodeId)));

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

/** 可见连线：折叠模块整体作为统一出入口，进出连线汇聚到模块框中心（基于覆盖合并后的路径） */
const renderEdges = computed(() => {
  const out: LayoutDiagram["edges"] = [];
  for (const e of effectiveEdges.value) {
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
      // T80 渲染层正交化兜底：旧数据/异常路径存在斜线段时自动补最小折点（Z 形），
      // 保证渲染连线严格横平竖直；已正交路径原样返回（幂等），不影响正常渲染。
      // T77：按端点所在边生成垂直进入路径，箭头垂直所在边。
      const boxes = endpointBoxes(e.edgeId);
      arr = orthogonalizePath(pts, boxes?.a, boxes?.b);
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

/**
 * 连线标签定位（T48）：按弧长取中点。
 * 遍历折线 points 累计各段长度，取总长 50% 处坐标（线性插值到所在段），
 * 兼容正交/绕行/自环等任意点数；标签 y 仍做 -6 偏移避让连线。
 */
function edgeMid(e: { points: Array<{ x: number; y: number }> }) {
  const pts = e.points;
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y - 6 };
  // 累计各段长度
  let total = 0;
  const segs: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segs.push(len);
    total += len;
  }
  // total 为 0（所有点重合）时退化为首点
  if (total <= 0) return { x: pts[0].x, y: pts[0].y - 6 };
  const target = total / 2;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i] >= target) {
      const t = segs[i] > 0 ? (target - acc) / segs[i] : 0;
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t - 6
      };
    }
    acc += segs[i];
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y - 6 };
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

/** 类图节点点击高亮（T41，会话态，刷新重置）：当前高亮节点 id */
const highlightNodeId = ref("");

/** 类图连线点击高亮（T49，会话态）：当前高亮连线 id（与节点高亮互斥，共用高亮态） */
const highlightEdgeId = ref("");

/** T70 方法级高亮（会话态）：点击类节点方法后高亮该方法关联的连线与节点 */
const highlightMethod = ref<{ nodeId: string; method: string } | null>(null);

/** T70 方法关联连线集合：from=所属节点 且 (edge.methods 含该方法 或 无 methods 退化为该节点出发的全部连线) */
const methodEdgeIds = computed(() => {
  const ids = new Set<string>();
  const hm = highlightMethod.value;
  if (!hm) return ids;
  for (const e of props.diagram.edges) {
    if (e.from !== hm.nodeId) continue;
    if (e.methods && e.methods.length > 0) {
      if (e.methods.includes(hm.method)) ids.add(e.edgeId);
    } else {
      ids.add(e.edgeId); // 旧数据无 methods：退化为类级高亮
    }
  }
  return ids;
});

/** T70 方法高亮涉及的节点集合：所属节点 + 关联连线两端节点 */
const methodHighlightedNodeIds = computed(() => {
  const ids = new Set<string>();
  const hm = highlightMethod.value;
  if (!hm) return ids;
  ids.add(hm.nodeId);
  const eids = methodEdgeIds.value;
  for (const e of props.diagram.edges) {
    if (eids.has(e.edgeId)) {
      ids.add(e.from);
      ids.add(e.to);
    }
  }
  return ids;
});

/** T70 点击方法：切换方法级高亮；再点同方法取消；与节点/连线高亮互斥 */
function onMethodClick(nodeId: string, method: string) {
  if (props.diagram.type !== "class") return;
  if (highlightMethod.value && highlightMethod.value.nodeId === nodeId && highlightMethod.value.method === method) {
    highlightMethod.value = null;
    return;
  }
  highlightMethod.value = { nodeId, method };
  highlightNodeId.value = "";
  highlightEdgeId.value = "";
}

/** T70 方法行是否处于高亮态 */
function isMethodHighlighted(nodeId: string, method?: string): boolean {
  return (
    !!highlightMethod.value &&
    highlightMethod.value.nodeId === nodeId &&
    highlightMethod.value.method === method
  );
}

/** 类图点击高亮涉及的节点集合：节点点击→单节点；连线点击→两端节点 */
const highlightedNodeIds = computed(() => {
  const ids = new Set<string>();
  if (props.diagram.type !== "class") return ids;
  if (highlightNodeId.value) ids.add(highlightNodeId.value);
  if (highlightEdgeId.value) {
    const e = props.diagram.edges.find((ed) => ed.edgeId === highlightEdgeId.value);
    if (e) {
      ids.add(e.from);
      ids.add(e.to);
    }
  }
  return ids;
});

/** 与高亮相关的语义连线 edgeId 集合（layout.edges 依此判断高亮） */
const highlightedEdgeIds = computed(() => {
  const ids = new Set<string>();
  if (props.diagram.type !== "class") return ids;
  const nodes = highlightedNodeIds.value;
  if (nodes.size === 0) return ids;
  for (const e of props.diagram.edges) {
    if (nodes.has(e.from) || nodes.has(e.to)) ids.add(e.edgeId);
  }
  return ids;
});

/** 节点是否处于高亮态（类图：节点/连线点击高亮 + 方法级高亮，T70） */
function isNodeHighlighted(nodeId: string): boolean {
  if (props.diagram.type !== "class") return false;
  if (highlightedNodeIds.value.has(nodeId)) return true;
  return methodHighlightedNodeIds.value.has(nodeId);
}

/** 连线是否处于高亮态（与高亮节点/高亮连线两端节点相连 + 方法关联连线，T70） */
function isEdgeHighlighted(edgeId: string): boolean {
  if (props.diagram.type !== "class") return false;
  if (highlightedEdgeIds.value.has(edgeId)) return true;
  return methodEdgeIds.value.has(edgeId);
}

/**
 * 连线点击（T49）：仅类图响应。
 * 点击连线 → 高亮该连线两端节点 + 与两端节点相连的所有连线；
 * 再点同一连线取消，点其他连线切换；与节点点击高亮（T41）互斥。
 * 架构/流程图连线点击无操作。
 */
function onEdgeClick(edgeId: string) {
  if (props.diagram.type !== "class") return;
  highlightEdgeId.value = highlightEdgeId.value === edgeId ? "" : edgeId;
  highlightNodeId.value = "";
  highlightMethod.value = null; // T70 与方法高亮互斥
}

/**
 * 节点点击分发：
 * - 聚合节点 → 展开折叠模块
 * - 有关联图节点（类图/流程图/架构图占位或跨模块引用）→ 触发父级关联图跳转气泡（类图/流程图扩展，T2）
 * - 架构图节点 → 触发父级关联图气泡（T39）
 * - 类图节点 → 本节点高亮 + 相连连线高亮，再点同节点取消（T41）
 * - 流程图节点 → 无操作
 */
function onNodeClick(nodeId: string) {
  if (isAggregate(nodeId)) {
    onAggregateClick(nodeId);
    return;
  }
  // 跨图跳转优先：节点存在关联图（直接字段 linkedDiagrams 或 payload.linkedDiagrams）即上抛弹选择框，类图/流程图亦支持
  const node = nodeById.value.get(nodeId);
  const payload = (node?.payload ?? {}) as Record<string, unknown>;
  const hasLinks =
    (Array.isArray(node?.linkedDiagrams) && (node!.linkedDiagrams as unknown[]).length > 0) ||
    (Array.isArray(payload.linkedDiagrams) && (payload.linkedDiagrams as unknown[]).length > 0);
  if (hasLinks) {
    emit("node-click", nodeId);
    return;
  }
  if (props.diagram.type === "architecture") {
    // 架构图：无关联仍弹气泡提示「无关联图」（T39 原行为）
    emit("node-click", nodeId);
  } else if (props.diagram.type === "class") {
    // 再点同一节点取消高亮；点其他节点切换高亮（T41）；无关联时与连线点击高亮（T49）/方法高亮（T70）互斥
    highlightNodeId.value = highlightNodeId.value === nodeId ? "" : nodeId;
    highlightEdgeId.value = "";
    highlightMethod.value = null;
  }
  // flow：无关联时无操作
}

/**
 * 节点悬停（T69）：所有图类型节点（非聚合）有 description 时上抛 nodeId，leave 上抛 null。
 * 父级 DiagramView 依节点 description 显示/隐藏描述气泡。
 */
function onNodeHover(nodeId: string, enter: boolean) {
  if (isAggregate(nodeId)) return;
  emit("node-hover", enter ? nodeId : null);
}

/** 切换图时重置类图高亮态（节点+连线+方法，避免残留到新图） */
watch(
  () => props.diagram,
  () => {
    highlightNodeId.value = "";
    highlightEdgeId.value = "";
    highlightMethod.value = null;
  }
);

/* ========== 手动编辑：节点拖拽（T52）/ 连线手柄拖拽（T53）/ 右键清除（T56） ========== */

const svgEl = ref<SVGSVGElement | null>(null);

/** 拖动中的目标：node → 拖节点；edgePoint → 拖连线折点/端点；edgeSegment → 拖连线整段（T64 线段平移） */
interface DragTarget {
  kind: "node" | "edgePoint" | "edgeSegment";
  /** 节点或连线 id */
  targetId: string;
  /** 连线折点下标（仅 edgePoint） */
  index?: number;
  /** 线段下标（仅 edgeSegment）：该段起点在 points 中的下标 */
  segIndex?: number;
  /** 线段方向（仅 edgeSegment）：true=水平（平移改 y），false=垂直（平移改 x） */
  segHorizontal?: boolean;
  /** 触发拖动的指针 id（用于捕获/释放） */
  pointerId?: number;
  /** 拖动手柄的起始客户端坐标 */
  startClient: { x: number; y: number };
  /** 拖动对象的起始世界坐标（节点为当前位置；连线点为当前点） */
  startPos: { x: number; y: number };
  /** 连线起始完整点集（仅 edgePoint，拖动中实时更新） */
  points?: Array<{ x: number; y: number }>;
  /** 拖动过程中的最新目标（节点最新位置 / 连线最新点集，供结束时 commit 用） */
  last?: { x: number; y: number; points?: Array<{ x: number; y: number }> };
}

/** 当前拖动目标（null = 未在拖动） */
const dragTarget = ref<DragTarget | null>(null);
/** 是否发生了实际位移（用于抑制拖动结束后的 click 事件） */
let dragMoved = false;

/** 屏幕客户端坐标 → 世界坐标（viewBox 换算：viewBox 即世界坐标系 1:1 映射） */
function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
  const svg = svgEl.value;
  if (!svg) return { x: 0, y: 0 };
  const rect = svg.getBoundingClientRect();
  const vb = (props.viewBox ?? "").split(/\s+/).map(Number);
  if (vb.length !== 4 || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  const [minX, minY, w, h] = vb;
  return {
    x: minX + ((clientX - rect.left) / rect.width) * w,
    y: minY + ((clientY - rect.top) / rect.height) * h
  };
}

/** T52 节点拖拽开始（仅编辑态）：记录起始客户端坐标与节点当前世界坐标（保留抓取偏移） */
function onNodeDown(nodeId: string, e: PointerEvent) {
  if (!props.editMode) return;
  // 编辑态节点拖动：阻止冒泡（避免触发父级画布平移），但不 preventDefault（否则会吞掉 click，
  // 影响编辑态下的节点点击交互：气泡/类图高亮）。文本选择由 CSS user-select:none 禁止。
  e.stopPropagation();
  dragMoved = false;
  const node = renderNodes.value.find((n) => n.nodeId === nodeId);
  const world = clientToWorld(e.clientX, e.clientY);
  dragTarget.value = {
    kind: "node",
    targetId: nodeId,
    pointerId: e.pointerId,
    startClient: { x: e.clientX, y: e.clientY },
    // 以节点当前渲染位置为起点（含已有覆盖），拖动按指针位移增量移动，保留抓取偏移
    startPos: node ? { x: node.x, y: node.y } : world
  };
}

/* ========== T64 连线线段平移 + 折点新增/删除（draw.io 改造） ========== */

/** 点到线段的最近距离 */
function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

/** 命中折线最近线段下标（找不到或距离超阈值返回 -1） */
function hitSegment(edgeId: string, world: { x: number; y: number }, maxDist = 20): number {
  const edge = renderEdges.value.find((ed) => ed.edgeId === edgeId);
  const pts = edge?.points ?? [];
  if (pts.length < 2) return -1;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(world, pts[i], pts[i + 1]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return bestDist <= maxDist ? best : -1;
}

/** T64/T75 折点/端点拖动开始（仅编辑态）：按下连线时先命中折点（含端点）→ 拖动该折点；否则命中线段 → 拖动线段 */
function onEdgeDown(edgeId: string, e: PointerEvent) {
  if (!props.editMode) return;
  const world = clientToWorld(e.clientX, e.clientY);
  const edge = renderEdges.value.find((ed) => ed.edgeId === edgeId);
  const pts = edge?.points ?? [];
  if (pts.length < 2) return;
  // 优先命中已有折点/端点（半径阈值）：拖动该点（T75 端点跨边吸附在其拖动分支处理）
  // T77：端点命中半径扩大（端点需沿节点边滑动，范围太小难拖动；中间折点保持小半径）
  const hitIndex = pts.findIndex((p, i) => {
    const isEnd = i === 0 || i === pts.length - 1;
    return dist(world, p) <= (isEnd ? 14 : 10);
  });
  if (hitIndex !== -1) {
    e.stopPropagation();
    dragMoved = false;
    dragTarget.value = {
      kind: "edgePoint",
      targetId: edgeId,
      index: hitIndex,
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      startPos: { x: pts[hitIndex].x, y: pts[hitIndex].y },
      points: pts.map((p) => ({ ...p }))
    };
    return;
  }
  const seg = hitSegment(edgeId, world);
  if (seg === -1) return;
  const horizontal = Math.abs(pts[seg].y - pts[seg + 1].y) < 0.5;
  e.stopPropagation();
  dragMoved = false;
  dragTarget.value = {
    kind: "edgeSegment",
    targetId: edgeId,
    segIndex: seg,
    segHorizontal: horizontal,
    pointerId: e.pointerId,
    startClient: { x: e.clientX, y: e.clientY },
    startPos: { x: world.x, y: world.y },
    points: pts.map((p) => ({ ...p }))
  };
}


/** T64 双击连线空白段：插入折点；若命中已有折点则改为删除该折点（T64 修复：热区覆盖折点导致删除失效） */
function onEdgeDblClick(edgeId: string, e: MouseEvent) {
  if (!props.editMode) return;
  const world = clientToWorld(e.clientX, e.clientY);
  const edge = renderEdges.value.find((ed) => ed.edgeId === edgeId);
  const pts = edge?.points ?? [];
  if (pts.length < 2) return;
  // 先检测是否命中已有折点（含端点）：命中则删除该折点（端点锚点由 removeEdgePoint 保护）
  const hitIndex = pts.findIndex((p) => dist(world, p) <= 10);
  if (hitIndex !== -1) {
    removeEdgePoint(edgeId, hitIndex);
    return;
  }
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(world, pts[i], pts[i + 1]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  if (best === -1 || bestDist > 20) return;
  const a = pts[best];
  const b = pts[best + 1];
  const horizontal = Math.abs(a.y - b.y) < 0.5;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((world.x - a.x) * dx + (world.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  // 正交吸附：水平段 y 取段 y，垂直段 x 取段 x
  const px = horizontal ? a.x + dx * t : a.x;
  const py = horizontal ? a.y : a.y + dy * t;
  const np = pts.map((p) => ({ ...p }));
  np.splice(best + 1, 0, { x: px, y: py });
  emit("edge-move", edgeId, np, true);
}

/** T64 删除折点：右键/双击折点触发；端点锚点（首/末）禁止删除；删除后正交化（T68/T80） */
function removeEdgePoint(edgeId: string, index: number) {
  if (!props.editMode) return;
  const edge = renderEdges.value.find((ed) => ed.edgeId === edgeId);
  const pts = edge?.points ?? [];
  if (pts.length <= 2) return; // 至少保留两端锚点
  if (index === 0 || index === pts.length - 1) return; // 端点锚点禁止删除
  const np = pts.filter((_, i) => i !== index).map((p) => ({ ...p }));
  // T77 删除折点后保持端点段垂直进入（箭头垂直所在边）
  const boxes = endpointBoxes(edgeId);
  const out = ensurePerpendicularEnds(
    orthogonalizePath(np, boxes?.a, boxes?.b),
    boxes?.a,
    boxes?.b
  );
  emit("edge-move", edgeId, out, true);
}

/**
 * 拖动中：位移超过阈值才真正开始拖（捕获指针 + 实时上抛 commit=false）。
 * 阈值内视为点击，交由 click 事件处理（气泡/高亮等）。
 */
function onSvgPointerMove(e: PointerEvent) {
  const d = dragTarget.value;
  if (!d) return;
  const start = clientToWorld(d.startClient.x, d.startClient.y);
  const world = clientToWorld(e.clientX, e.clientY);
  const dx = world.x - start.x;
  const dy = world.y - start.y;
  const moved = Math.abs(dx) > 1 || Math.abs(dy) > 1;
  // 首次超过阈值：捕获指针，标记已拖动（此后 click 重定向到 svg，不会误触发节点/连线点击）
  if (moved && !dragMoved) {
    dragMoved = true;
    const pid = d.pointerId ?? e.pointerId;
    try {
      svgEl.value?.setPointerCapture(pid);
    } catch {
      /* 指针已不在/捕获失败：忽略，仍按位移继续 */
    }
  }
  if (!dragMoved) return;
  if (d.kind === "node") {
    const x = d.startPos.x + dx;
    const y = d.startPos.y + dy;
    d.last = { x, y };
    emit("node-move", d.targetId, x, y, false);
  } else if (d.kind === "edgePoint") {
    // T75 折点/端点拖动：端点（首/末）吸附到节点四边（跨边），中间折点保持自由
    const idx = d.index!;
    const pts = d.points!.map((p) => ({ ...p }));
    let nx = d.startPos.x + dx;
    let ny = d.startPos.y + dy;
    const boxes = endpointBoxes(d.targetId);
    let out: Array<{ x: number; y: number }>;
    if ((idx === 0 || idx === pts.length - 1) && boxes) {
      // T77 端点拖动：吸附到节点边后，仅重画端点段（垂直进出所在边，箭头垂直），
      // 保留中间手工折点，避免拖拽中整条路径跳变/箭头方向乱。
      if (idx === 0) {
        const s = snapToNodeBorder({ x: nx, y: ny }, boxes.a);
        nx = s.x;
        ny = s.y;
      } else {
        const s = snapToNodeBorder({ x: nx, y: ny }, boxes.b);
        nx = s.x;
        ny = s.y;
      }
      // 先合并中间冗余折点，再重画端点段（端点段最后生成，避免被共线合并吃掉垂直 stub）
      out = moveEdgeEndpoint(mergeCollinear(pts), idx, { x: nx, y: ny }, idx === 0 ? boxes.a : boxes.b);
    } else {
      // 中间折点拖动：保持自由，正交化 + 共线合并
      pts[idx] = { x: nx, y: ny };
      out = mergeCollinear(orthogonalizePath(pts));
    }
    d.last = { x: 0, y: 0, points: out };
    emit("edge-move", d.targetId, out, false);
  } else {
    // T74/T79/T80 线段平移：端点沿节点四边跨边滑动；相邻平行段重合时共线合并；保证正交
    const pts = d.points!.map((p) => ({ ...p }));
    const boxes = endpointBoxes(d.targetId);
    const segA = d.segIndex!;
    const segB = d.segIndex! + 1;
    const isAEnd = segA === 0;
    const isBEnd = segB === pts.length - 1;
    if (d.segHorizontal) {
      // 水平段平移改 y：中间折点跟随；端点经四边吸附（跨边），确保端点不脱离节点边框
      const ny = (pIdx: number, isEnd: boolean, box?: NodeBox): number => {
        const base = d.points![pIdx].y;
        if (isEnd && box) return snapToNodeBorder({ x: pts[pIdx].x, y: base + dy }, box).y;
        return base + dy;
      };
      pts[segA].y = ny(segA, isAEnd, isAEnd ? boxes?.a : undefined);
      pts[segB].y = ny(segB, isBEnd, isBEnd ? boxes?.b : undefined);
    } else {
      // 垂直段平移改 x：同上，端点沿左右/顶底四边吸附
      const nx = (pIdx: number, isEnd: boolean, box?: NodeBox): number => {
        const base = d.points![pIdx].x;
        if (isEnd && box) return snapToNodeBorder({ x: base + dx, y: pts[pIdx].y }, box).x;
        return base + dx;
      };
      pts[segA].x = nx(segA, isAEnd, isAEnd ? boxes?.a : undefined);
      pts[segB].x = nx(segB, isBEnd, isBEnd ? boxes?.b : undefined);
    }
    // T79：相邻平行段重合 → 共线合并去冗余折点；T80：非正交 → 自动补最小折点
    // T77：线段平移后端点沿边滑动，修正首/末段垂直进入（箭头垂直所在边）
    const out = ensurePerpendicularEnds(
      mergeCollinear(orthogonalizePath(pts, boxes?.a, boxes?.b)),
      boxes?.a,
      boxes?.b
    );
    d.last = { x: 0, y: 0, points: out };
    emit("edge-move", d.targetId, out, false);
  }
}

/** 拖动结束：若确有位移则上抛最终结果（commit=true），并释放指针与状态 */
function onSvgPointerUp() {
  const d = dragTarget.value;
  if (!d) return;
  if (dragMoved) {
    if (d.kind === "node") {
      emit("node-move", d.targetId, d.last?.x ?? d.startPos.x, d.last?.y ?? d.startPos.y, true);
    } else {
      emit("edge-move", d.targetId, d.last?.points ?? d.points!, true);
    }
    const pid = d.pointerId;
    if (pid !== undefined && svgEl.value?.hasPointerCapture(pid)) {
      try {
        svgEl.value.releasePointerCapture(pid);
      } catch {
        /* 捕获可能已失效，忽略 */
      }
    }
    // 延迟复位 dragMoved：click 事件在 pointerup 后同步派发，先让
    // onNodeClickSuppressed/onEdgeClickSuppressed 消费掉「拖动后的残余 click」，
    // 再复位标志，避免拖尾影响后续的正常点击。
    setTimeout(() => {
      dragMoved = false;
    }, 0);
  }
  dragTarget.value = null;
}

/** 节点点击：若刚拖动过则忽略本次点击（避免拖动结束后误触发气泡/高亮） */
function onNodeClickSuppressed(nodeId: string) {
  if (dragMoved) {
    dragMoved = false;
    return;
  }
  onNodeClick(nodeId);
}

/** 连线点击：若刚拖动过则忽略本次点击（避免误触发类图高亮） */
function onEdgeClickSuppressed(edgeId: string) {
  if (dragMoved) {
    dragMoved = false;
    return;
  }
  onEdgeClick(edgeId);
}

/** T56 右键清除节点覆盖（仅编辑态且有覆盖时） */
function onNodeContextMenu(nodeId: string) {
  if (!props.editMode || !hasNodeOverride(nodeId)) return;
  emit("clear-node", nodeId);
}

/** T56 右键清除连线覆盖；若命中折点（编辑态）则删除该折点（T78：手柄移除后右键折点删除入口） */
function onEdgeContextMenu(edgeId: string, e?: MouseEvent) {
  if (!props.editMode) {
    // 展示态：仅清除覆盖
    if (hasEdgeOverride(edgeId)) emit("clear-edge", edgeId);
    return;
  }
  // 编辑态：命中折点（含端点）→ 删除；否则清除覆盖
  const world = e ? clientToWorld(e.clientX, e.clientY) : null;
  if (world) {
    const edge = renderEdges.value.find((ed) => ed.edgeId === edgeId);
    const pts = edge?.points ?? [];
    const hitIndex = pts.findIndex((p) => dist(world, p) <= 10);
    if (hitIndex !== -1) {
      removeEdgePoint(edgeId, hitIndex);
      return;
    }
  }
  if (hasEdgeOverride(edgeId)) emit("clear-edge", edgeId);
}

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

/** 风险描边 class（feature/diagram-risk-color）：按 structuralRisk 分级，无数据节点返回空 */
function nodeRiskClass(nodeId: string): string {
  const risk = props.riskMap?.[nodeId];
  return risk ? `is-risk-${risk}` : "";
}

function diamondPath(n: { width: number; height: number }): string {
  const w = n.width;
  const h = n.height;
  return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;
}

/** 类节点正文行（属性/方法），按节点高度裁剪；方法行携带方法名供点击高亮（T70） */
interface ClassBodyRow {
  key: string;
  type: "attribute" | "method";
  text: string;
  y: number;
  methodName?: string;
}

function classBodyRows(n: { nodeId: string; height: number }): ClassBodyRow[] {
  const node = nodeById.value.get(n.nodeId);
  const rows: Array<Omit<ClassBodyRow, "y">> = [];
  for (const a of (node?.attributes as Array<Record<string, unknown>>) ?? []) {
    rows.push({ key: `a-${a.name}`, type: "attribute", text: `${a.name}: ${a.type}` });
  }
  for (const mth of (node?.methods as Array<Record<string, unknown>>) ?? []) {
    rows.push({
      key: `m-${mth.name}`,
      type: "method",
      text: `${mth.name}(${((mth.params as Array<Record<string, unknown>>) ?? []).map((p) => p.type).join(", ")})`,
      methodName: String(mth.name)
    });
  }
  // 每行 16px，顶部标题栏 24px
  const max = Math.max(0, Math.floor((n.height - 28) / 16));
  return rows.slice(0, max).map((r, i) => ({ ...r, y: 24 + 16 * (i + 1) }));
}
</script>

<style scoped>
.diagram-svg {
  width: 100%;
  height: 100%;
  display: block;
  background: #ffffff;
  border-radius: 8px;
  /* T67：SVG 内禁止选中文字，避免拖拽时误选中 */
  user-select: none;
  -webkit-user-select: none;
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
  /* T71：连线 hover 过渡 */
  transition: stroke 0.15s, stroke-width 0.15s;
}
/* 类图连线可点击（T49）：仅类图显示手型光标 */
.edge.is-clickable {
  cursor: pointer;
}
/* T71 可交互处标识：连线移入时描边提亮（所有图类型，展示态亦可交互反馈） */
.edge:hover polyline:not(.edge-hit) {
  stroke: #409eff;
  stroke-width: 2.5;
}
.edge {
  cursor: pointer;
}
/* 类图点击高亮：相连连线高亮（T41/T49，热区 polyline 除外避免被描边覆盖） */
.edge.is-highlighted polyline:not(.edge-hit) {
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
/* 手动覆盖的连线（T54）：高亮路径提示手动调整过 */
.edge.has-override polyline:not(.edge-hit) {
  stroke: #b88230;
  stroke-width: 2;
}
.node {
  cursor: default;
  /* T71：节点 hover 过渡 */
  transition: filter 0.15s;
}
/* T71 可交互处标识：节点移入时边框高亮（展示态亦可交互反馈）；有风险节点沿用风险色 */
.node:hover .node-rect:not(.class-header):not(.aggregate) {
  stroke: var(--risk-color, #409eff);
  stroke-width: 2.5;
  filter: drop-shadow(0 0 4px rgba(64, 158, 255, 0.35));
}
/* 编辑态节点可拖拽（T52） */
.node.is-editing {
  cursor: move;
}
/* 手动覆盖的节点（T54）：描边加深提示手动调整过 */
.node.has-override .node-rect:not(.class-header) {
  stroke: #b88230;
  stroke-width: 2;
}
/* 类图点击高亮：节点边框提亮 + 阴影（T41，会话态，不影响数据）；有风险节点沿用风险色 */
.node.is-highlighted .node-rect:not(.class-header) {
  stroke-width: 3;
  stroke: var(--risk-color, #409eff);
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
/* T70 方法行热区：透明背景撑满行高，承接点击/hover */
.method-hit {
  fill: transparent;
  stroke: none;
}
/* T71 可交互处标识：方法行移入背景高亮 + 手型光标 */
.class-body-row.is-method {
  cursor: pointer;
}
.class-body-row.is-method:hover .method-hit {
  fill: rgba(64, 158, 255, 0.12);
}
.class-body-row.is-method:hover .class-line {
  fill: #409eff;
}
/* T70 方法行高亮态（点击后）：背景加深 + 文字高亮 */
.class-body-row.is-method.is-method-highlighted .method-hit {
  fill: rgba(64, 158, 255, 0.2);
}
.class-body-row.is-method.is-method-highlighted .class-line {
  fill: #409eff;
  font-weight: 600;
}

/* 架构图节点类型 */
.arch-service { fill: #ecf5ff; stroke: #409eff; }
.arch-database { fill: #fdf6ec; stroke: #e6a23c; }
.arch-mq { fill: #f5f0ff; stroke: #7c6ad8; }
.arch-cache { fill: #f0f9eb; stroke: #67c23a; }
.arch-external { fill: #f4f4f5; stroke: #909399; }
.arch-gateway { fill: #fef0f0; stroke: #f56c6c; }

/* feature/diagram-risk-color：节点描边按预计算 structuralRisk 分级着色（数据驱动，覆盖类型描边色）
   --risk-color 供 hover/点击高亮复用：有风险节点高亮沿用其风险色，无风险节点回退蓝色 */
.node.is-risk-low { --risk-color: #67c23a; }
.node.is-risk-medium { --risk-color: #e6a23c; }
.node.is-risk-high { --risk-color: #f56c6c; }
.node.is-risk-low .node-rect,
.node.is-risk-medium .node-rect,
.node.is-risk-high .node-rect {
  stroke: var(--risk-color);
}
.node.is-risk-high .node-rect { stroke-width: 2.5; }

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