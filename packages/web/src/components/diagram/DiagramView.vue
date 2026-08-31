<template>
  <div class="diagram-view">
    <!-- 折叠状态提示 + 视图控制 -->
    <div class="diagram-toolbar">
      <span class="diagram-title">{{ title }}</span>
      <button class="btn-sm" type="button" @click="resetView">⟳ 重置视图</button>
    </div>

    <p v-if="loading" class="hint">布局计算中…</p>
    <p v-else-if="error" class="hint error">{{ error }}</p>

    <!-- 画布容器：固定尺寸（Excalidraw 相机方式），SVG 撑满容器，viewBox 由相机驱动 -->
    <div
      v-else-if="layout && diagram"
      ref="paneEl"
      class="canvas-pane"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
      @wheel.prevent="onWheel"
    >
      <DiagramSvg
        :layout="layout"
        :diagram="diagram"
        :view-box="viewBox"
        :collapsed-modules="collapsedModules"
        @toggle-collapse="toggleCollapse"
        @node-click="onNodeClick"
        @node-hover="onNodeHover"
      />

      <!-- 架构层节点点击：关联图气泡按钮（T39，屏幕坐标跟随相机） -->
      <div
        v-if="bubble"
        class="node-bubble"
        :style="{ left: bubble.pos.x + 'px', top: bubble.pos.y + 'px' }"
        @click.stop
      >
        <div class="bubble-title">{{ bubble.title }}</div>
        <template v-if="bubble.links.length">
          <button
            v-for="l in bubble.links"
            :key="l.diagramId"
            type="button"
            class="bubble-btn"
            @click.stop="gotoDiagram(l.diagramId)"
          >
            {{ l.type === "class" ? "转到类图" : "转到流程图" }}<span v-if="l.label" class="bubble-btn-sub"> · {{ l.label }}</span>
          </button>
        </template>
        <p v-else class="bubble-empty">无关联图</p>
      </div>

      <!-- 架构层节点悬停：描述气泡（T40，屏幕坐标跟随相机） -->
      <div
        v-if="tooltip"
        class="node-tooltip"
        :style="{ left: tooltip.pos.x + 'px', top: tooltip.pos.y + 'px' }"
      >
        {{ tooltip.text }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import DiagramSvg from "./DiagramSvg.vue";
import { getDiagram, getLayout, ApiError } from "../../api/index";
import type { Diagram, LayoutDiagram } from "@fourstage/shared";

const props = defineProps<{
  projectId: string;
  diagramId: string;
  title?: string;
}>();

const router = useRouter();

const loading = ref(false);
const error = ref("");
const diagram = ref<Diagram | null>(null);
const layout = ref<LayoutDiagram | null>(null);

/* ========== Excalidraw 相机（视口）坐标系：SVG 容器尺寸固定，靠相机变换模拟无限画布 ========== */
const paneEl = ref<HTMLElement | null>(null);
/** 相机缩放比例（0.2x ~ 3x） */
const scale = ref(1);
/** 相机平移偏移（px，相对容器左上角） */
const offset = ref({ x: 0, y: 0 });

const MIN_SCALE = 0.2;
const MAX_SCALE = 3;

/**
 * viewBox = 相机视口。内容坐标（layout）为世界坐标，viewBox 决定屏幕可见的世界区域：
 *   viewBox = `-offsetX/scale  -offsetY/scale  paneW/scale  paneH/scale`
 * 这样 SVG 内容坐标 1:1 映射，平移/缩放只改相机，不改 DOM 尺寸与内容坐标。
 */
const viewBox = computed(() => {
  const pane = paneEl.value;
  if (!pane || pane.clientWidth === 0) return undefined;
  const s = scale.value;
  const minX = -offset.value.x / s;
  const minY = -offset.value.y / s;
  const w = pane.clientWidth / s;
  const h = pane.clientHeight / s;
  return `${minX} ${minY} ${w} ${h}`;
});

/**
 * 适配视图（fit）：相机对准内容包围盒，使整图完整可见且居中。
 */
function fitView() {
  const pane = paneEl.value;
  const l = layout.value;
  if (!pane || !l || l.width <= 0 || l.height <= 0) return;
  const pw = pane.clientWidth;
  const ph = pane.clientHeight;
  // 整图完整可见优先：不设下限（大图可缩小到任意比例），上限 1（不放大）
  const s = clamp(Math.min(pw / l.width, ph / l.height, 1), 0.01, 1);
  scale.value = s;
  offset.value = {
    x: (pw - l.width * s) / 2,
    y: (ph - l.height * s) / 2
  };
}

/** 重置视图：恢复适配视图（整图完整居中显示） */
function resetView() {
  fitView();
}

let dragging = false;
let startX = 0;
let startY = 0;
let startOffset = { x: 0, y: 0 };

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  const target = e.target as Element | null;
  // 命中节点整体/折叠按钮/交互气泡：不启动拖拽，把点击权交给浏览器（节点文字可选中）
  if (
    target &&
    (target.closest?.(".node") ||
      target.closest?.(".collapse-btn") ||
      target.closest?.(".node-bubble") ||
      target.closest?.(".node-tooltip"))
  ) {
    return;
  }
  // 空白处拖拽平移时收起交互气泡
  bubble.value = null;
  tooltip.value = null;
  // 空白处：阻止浏览器原生文本选择后再拖拽平移（否则会选中画布上的文字）
  e.preventDefault();
  dragging = true;
  startX = e.clientX;
  startY = e.clientY;
  startOffset = { ...offset.value };
  paneEl.value?.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!dragging) return;
  offset.value = {
    x: startOffset.x + (e.clientX - startX),
    y: startOffset.y + (e.clientY - startY)
  };
}

function onPointerUp() {
  dragging = false;
}

function onPointerLeave() {
  dragging = false;
}

/** 滚轮以光标为中心缩放：保持光标下内容点不动 */
function onWheel(e: WheelEvent) {
  if (!paneEl.value) return;
  const rect = paneEl.value.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const newScale = clamp(scale.value * factor, MIN_SCALE, MAX_SCALE);
  const contentX = (px - offset.value.x) / scale.value;
  const contentY = (py - offset.value.y) / scale.value;
  scale.value = newScale;
  offset.value = {
    x: px - contentX * newScale,
    y: py - contentY * newScale
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/* ========== 单模块本地折叠（会话态，不触发重布局） ========== */
/** 已折叠模块 groupId 列表（会话态，刷新重置） */
const collapsedModules = ref<string[]>([]);

function toggleCollapse(groupId: string) {
  if (collapsedModules.value.includes(groupId)) {
    collapsedModules.value = collapsedModules.value.filter((id) => id !== groupId);
  } else {
    collapsedModules.value = [...collapsedModules.value, groupId];
  }
}

/* ========== 架构层节点交互：点击关联图气泡（T39）+ 悬停描述气泡（T40） ========== */

/** 关联图信息（payload.linkedDiagrams 元素） */
interface LinkedDiagram {
  diagramId: string;
  label?: string;
  type?: string;
}

const bubble = ref<{ title: string; links: LinkedDiagram[]; pos: { x: number; y: number } } | null>(null);
const tooltip = ref<{ text: string; pos: { x: number; y: number } } | null>(null);

/** 语义节点表：nodeId → 节点（供读取 payload/description/label） */
function semanticNode(nodeId: string): Record<string, unknown> | undefined {
  const nodes = (diagram.value?.nodes ?? []) as unknown as Array<Record<string, unknown>>;
  return nodes.find((n) => String(n.nodeId) === nodeId);
}

/**
 * 节点中心世界坐标 → 屏幕（画布容器内）坐标。
 * viewBox 左下原点的世界点 w 映射到屏幕像素：sx = w.x * scale + offset.x（相机换算）。
 */
function nodeScreenCenter(nodeId: string): { x: number; y: number } {
  const n = layout.value?.nodes.find((nd) => nd.nodeId === nodeId);
  if (!n) return { x: 0, y: 0 };
  return {
    x: (n.x + n.width / 2) * scale.value + offset.value.x,
    y: (n.y + n.height / 2) * scale.value + offset.value.y
  };
}

/** T39：架构节点点击 → 检测 payload.linkedDiagrams，弹出关联图气泡（无关联则提示） */
function onNodeClick(nodeId: string) {
  tooltip.value = null; // 点击时收起悬停气泡
  const node = semanticNode(nodeId);
  const payload = (node?.payload ?? {}) as Record<string, unknown>;
  const raw = payload.linkedDiagrams;
  const links = Array.isArray(raw) ? (raw as LinkedDiagram[]) : [];
  bubble.value = {
    title: String((node?.label as string) ?? nodeId),
    links,
    pos: nodeScreenCenter(nodeId)
  };
}

/** T40：架构节点悬停 → 有 description 显示描述气泡，无则隐藏 */
function onNodeHover(nodeId: string | null) {
  if (!nodeId) {
    tooltip.value = null;
    return;
  }
  const desc = (semanticNode(nodeId)?.description as string) ?? "";
  if (!desc) {
    tooltip.value = null;
    return;
  }
  tooltip.value = { text: desc, pos: nodeScreenCenter(nodeId) };
}

/** 气泡按钮点击 → 路由跳转到对应图页面 */
function gotoDiagram(diagramId: string) {
  bubble.value = null;
  router.push(`/projects/${props.projectId}/diagrams/${diagramId}`);
}

/* ========== 数据加载 ========== */
async function load() {
  loading.value = true;
  error.value = "";
  try {
    diagram.value = await getDiagram(props.projectId, props.diagramId);
    // 布局始终返回全量坐标；折叠改为本地会话态，不再传折叠参数
    layout.value = await getLayout(props.projectId, props.diagramId);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载图失败";
  } finally {
    loading.value = false;
    // 等画布容器渲染完成后适配视图（整图完整可见）
    await nextTick();
    fitView();
    // 首帧兜底：某些情况下 nextTick 时容器尚未有最终尺寸
    requestAnimationFrame(fitView);
  }
}

onMounted(() => {
  load();
  // 容器尺寸变化（窗口/侧栏折叠）后自动重适配
  window.addEventListener("resize", onWindowResize);
});
watch(() => props.diagramId, () => {
  collapsedModules.value = [];
  bubble.value = null;
  tooltip.value = null;
  resetView();
  load();
});
onBeforeUnmount(() => {
  dragging = false;
  window.removeEventListener("resize", onWindowResize);
});

/** 窗口尺寸变化：重新适配视图（仅当未进行自定义拖拽缩放时保持） */
function onWindowResize() {
  fitView();
}
</script>

<style scoped>
.diagram-view {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 16px;
}
.diagram-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.diagram-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #606266;
  cursor: pointer;
}
.btn-sm:hover {
  border-color: #409eff;
  color: #409eff;
}
/* 画布：固定高度 + 溢出隐藏 + 可拖拽 */
.canvas-pane {
  position: relative;
  height: calc(100vh - 200px);
  min-height: 400px;
  overflow: hidden;
  background: #fafafa;
  border: 1px dashed #e4e7ed;
  border-radius: 6px;
  cursor: grab;
  touch-action: none;
}
.canvas-pane.grabbing {
  cursor: grabbing;
}
/* 架构层节点交互气泡（T39）：屏幕坐标跟随相机，绝对定位于画布容器 */
.node-bubble {
  position: absolute;
  z-index: 20;
  transform: translate(-50%, calc(-100% - 10px));
  min-width: 150px;
  max-width: 260px;
  padding: 8px 10px;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.14);
  pointer-events: auto;
}
.bubble-title {
  font-size: 12px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 6px;
}
.bubble-btn {
  display: block;
  width: 100%;
  text-align: left;
  padding: 4px 8px;
  margin: 3px 0;
  border: none;
  background: #ecf5ff;
  color: #409eff;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bubble-btn:hover {
  background: #d9ecff;
}
.bubble-btn-sub {
  color: #a0a0a0;
}
.bubble-empty {
  margin: 0;
  font-size: 12px;
  color: #909399;
}
/* 架构层节点悬停描述气泡（T40）：纯展示，不拦截指针（避免影响节点悬停） */
.node-tooltip {
  position: absolute;
  z-index: 19;
  transform: translate(-50%, calc(-100% - 10px));
  max-width: 260px;
  padding: 6px 10px;
  background: #303133;
  color: #fff;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.5;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  pointer-events: none;
}
.hint {
  color: #909399;
  font-size: 13px;
  padding: 16px 0;
  text-align: center;
}
.hint.error {
  color: #f56c6c;
}
</style>