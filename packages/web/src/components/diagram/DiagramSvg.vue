<template>
  <svg
    class="diagram-svg"
    :viewBox="`0 0 ${layout.width} ${layout.height}`"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#909399" />
      </marker>
    </defs>

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
      <!-- 模块折叠/展开按钮（仅纵向可折叠模块） -->
      <g
        v-if="groupAxis(g.groupId) === 'vertical' && groupCollapsible(g.groupId)"
        :transform="`translate(${g.x + g.width - 20}, ${g.y + 6})`"
        class="collapse-btn"
        @click="onToggleModule(g.groupId)"
      >
        <circle r="9" fill="#fff" stroke="#409eff" stroke-width="1.5" />
        <text text-anchor="middle" dominant-baseline="central" font-size="13" fill="#409eff" font-weight="700">
          {{ isModuleFocused(g.groupId) ? "+" : "−" }}
        </text>
      </g>
    </g>

    <!-- 连线（正交折线 + 箭头 + 标签） -->
    <g v-for="e in layout.edges" :key="e.edgeId" class="edge">
      <polyline :points="pointsToStr(e.points)" fill="none" marker-end="url(#arrow)" />
      <text v-if="edgeLabel(e.edgeId)" class="edge-label" :x="edgeMid(e).x" :y="edgeMid(e).y" text-anchor="middle">
        {{ edgeLabel(e.edgeId) }}
      </text>
    </g>

    <!-- 节点（按语义类型区分样式；聚合节点特殊渲染） -->
    <g
      v-for="n in layout.nodes"
      :key="n.nodeId"
      :class="['node', isAggregate(n.nodeId) ? 'is-aggregate' : '']"
      :transform="`translate(${n.x}, ${n.y})`"
    >
      <!-- 聚合节点（折叠后的模块占位） -->
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
import { computed } from "vue";
import type { Diagram, LayoutDiagram } from "@fourstage/shared";

const props = defineProps<{
  layout: LayoutDiagram;
  /** 图语义模型（含节点类型字段，用于区分渲染样式） */
  diagram: Diagram;
  /** 当前聚焦模块（折叠状态） */
  focusModuleId?: string;
}>();

const emit = defineEmits<{
  /** 折叠/展开：传入 groupId 折叠该模块，null 展开全部 */
  (e: "focus", moduleId: string | null): void;
}>();

/** 语义节点映射：nodeId → 节点对象 */
const nodeById = computed(() => {
  const m = new Map<string, Record<string, unknown>>();
  for (const n of props.diagram.nodes as unknown as Array<Record<string, unknown>>) {
    m.set(String(n.nodeId), n);
  }
  return m;
});

const groupById = computed(() => {
  const m = new Map<string, { title: string; axis?: string; collapsible?: boolean }>();
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

function isModuleFocused(groupId: string): boolean {
  return props.focusModuleId === groupId;
}

function onToggleModule(groupId: string) {
  // 当前已聚焦 → 展开全部；否则折叠聚焦该模块
  emit("focus", isModuleFocused(groupId) ? null : groupId);
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
  height: auto;
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
  pointer-events: none;
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
