<template>
  <svg :width="layout.width" :height="layout.height" :viewBox="`0 0 ${layout.width} ${layout.height}`" xmlns="http://www.w3.org/2000/svg">
    <!-- 分组外框 -->
    <g v-for="g in layout.groups" :key="g.groupId">
      <rect :x="g.x" :y="g.y" :width="g.width" :height="g.height" class="group-rect" />
      <text :x="g.x + 8" :y="g.y + 18" class="group-title">{{ groupTitle(g.groupId) }}</text>
    </g>
    <!-- 连线 -->
    <g v-for="e in layout.edges" :key="e.edgeId" class="edge">
      <polyline :points="pointsToStr(e.points)" fill="none" />
    </g>
    <!-- 节点 -->
    <g v-for="n in layout.nodes" :key="n.nodeId" class="node">
      <rect :x="n.x" :y="n.y" :width="n.width" :height="n.height" rx="6" class="node-rect" />
      <text :x="n.x + n.width / 2" :y="n.y + n.height / 2" class="node-label" text-anchor="middle" dominant-baseline="central">
        {{ nodeLabel(n.nodeId) }}
      </text>
    </g>
  </svg>
</template>

<script setup lang="ts">
import type { LayoutDiagram } from "@fourstage/shared";

const props = defineProps<{
  layout: LayoutDiagram;
  /** 节点 ID → 显示文本 */
  nodeLabels?: Record<string, string>;
  /** 分组 ID → 标题 */
  groupTitles?: Record<string, string>;
}>();

function pointsToStr(points: Array<{ x: number; y: number }>): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

function nodeLabel(nodeId: string): string {
  return props.nodeLabels?.[nodeId] ?? nodeId;
}

function groupTitle(groupId: string): string {
  return props.groupTitles?.[groupId] ?? groupId;
}
</script>

<style scoped>
.group-rect {
  fill: #f5f7fa;
  stroke: #c0c4cc;
  stroke-dasharray: 4 4;
  rx: 8;
}
.group-title {
  font-size: 13px;
  fill: #606266;
  font-weight: 600;
}
.edge polyline {
  stroke: #909399;
  stroke-width: 1.5;
}
.node-rect {
  fill: #ecf5ff;
  stroke: #409eff;
  stroke-width: 1.5;
}
.node-label {
  font-size: 14px;
  fill: #303133;
}
</style>
