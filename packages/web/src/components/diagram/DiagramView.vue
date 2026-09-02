<template>
  <div class="diagram-view">
    <!-- 折叠状态提示 + 视图控制 -->
    <div class="diagram-toolbar">
      <span class="diagram-title">{{ title }}</span>
      <div class="toolbar-actions">
        <button
          class="btn-sm"
          :class="{ primary: manual.editMode.value }"
          type="button"
          @click="toggleEditMode"
        >
          ✏ 手动调整{{ manual.editMode.value ? "（编辑中）" : "" }}
        </button>
        <!-- 编辑态：撤销/重做 -->
        <template v-if="manual.editMode.value">
          <button class="btn-sm" type="button" :disabled="!manual.canUndo.value" @click="onUndo">↩ 撤销</button>
          <button class="btn-sm" type="button" :disabled="!manual.canRedo.value" @click="onRedo">↪ 重做</button>
        </template>
        <button class="btn-sm" type="button" @click="resetView">⟳ 重置视图</button>
      </div>
    </div>

    <!-- 编辑态使用提示（draw.io 交互） -->
    <p v-if="manual.editMode.value" class="edit-hint">
      拖拽节点或连线调整位置；双击连线空白处新增折点，右键/双击折点删除折点。
    </p>

    <p v-if="loading" class="hint">加载中…</p>
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
        :edit-mode="manual.editMode.value"
        :overrides="manual.overrides"
        @toggle-collapse="toggleCollapse"
        @node-click="onNodeClick"
        @node-hover="onNodeHover"
        @node-move="onNodeMove"
        @edge-move="onEdgeMove"
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
import { createManualEdit, DEFAULT_NODE_SIZE } from "./useManualEdit";
import {
  getDiagram,
  getLayout,
  saveGeometry,
  ApiError,
  type GeometrySave,
  type LayoutResponse
} from "../../api/index";
import type { Diagram, NodeGeometry } from "@fourstage/shared";
import { snapToNodeBorder, perpendicularEntryPath, type NodeBox } from "./useEdgeGeometry";

const props = defineProps<{
  projectId: string;
  diagramId: string;
  title?: string;
}>();

const router = useRouter();

const loading = ref(false);
const error = ref("");
const diagram = ref<Diagram | null>(null);

/* ========== 画布坐标状态（draw.io 改造，T61/T63） ========== */
const manual = createManualEdit();

/** 编辑态/展示态切换 */
function toggleEditMode() {
  manual.editMode.value = !manual.editMode.value;
  // 切换编辑态时收起交互气泡，避免遮挡手柄
  bubble.value = null;
  tooltip.value = null;
}

/** 保存当前画布坐标到服务端（拖拽结束/撤销重做后调用；失败静默，会话内坐标仍生效） */
async function persist() {
  try {
    await saveGeometry(props.projectId, props.diagramId, manual.collectSavePayload());
  } catch {
    /* 保存失败静默：本次会话坐标仍生效，下次拖拽/刷新会重新同步 */
  }
}

/** 节点拖动后：关联连线整体重布线（T76，端点严格贴节点四边，用 T73 工具生成正交折线） */
function recomputeEdgeAnchors(nodeId: string) {
  const g = manual.nodes[nodeId];
  const d = diagram.value;
  if (!g || !d) return;
  for (const e of d.edges) {
    if (e.from !== nodeId && e.to !== nodeId) continue;
    const otherId = e.from === nodeId ? e.to : e.from;
    const og = manual.nodes[otherId];
    if (!og) continue;
    const a = (e.from === nodeId ? g : og) as NodeBox;
    const b = (e.from === nodeId ? og : g) as NodeBox;
    // 端点吸附到各自节点边框上朝对方的一边（跨边吸附由手动调整控制）
    const aC = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const bC = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    const fromPt = snapToNodeBorder(aC, a);
    const toPt = snapToNodeBorder(bC, b);
    // T77 节点拖动重布线：按端点所在边生成垂直进入路径（末段垂直进入端点边，箭头垂直）
    manual.edges[e.edgeId] = { points: perpendicularEntryPath(fromPt, a, toPt, b) };
  }
}

/** 节点拖拽：拖动中实时更新坐标并重算关联连线端点，结束后保存 */
function onNodeMove(nodeId: string, x: number, y: number, commit: boolean) {
  manual.setNode(nodeId, x, y, commit);
  recomputeEdgeAnchors(nodeId);
  if (commit) persist();
}

/** 连线改形（手柄/线段平移/折点增删）：同上 */
function onEdgeMove(edgeId: string, points: Array<{ x: number; y: number }>, commit: boolean) {
  manual.setEdge(edgeId, points, commit);
  if (commit) persist();
}

/** 撤销：变更后保存 */
function onUndo() {
  manual.undo();
  persist();
}

/** 重做：变更后保存 */
function onRedo() {
  manual.redo();
  persist();
}

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
  if (
    target &&
    (target.closest?.(".node") ||
      target.closest?.(".edge") ||
      target.closest?.(".collapse-btn") ||
      target.closest?.(".node-bubble") ||
      target.closest?.(".node-tooltip"))
  ) {
    return;
  }
  bubble.value = null;
  tooltip.value = null;
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
const collapsedModules = ref<string[]>([]);

function toggleCollapse(groupId: string) {
  if (collapsedModules.value.includes(groupId)) {
    collapsedModules.value = collapsedModules.value.filter((id) => id !== groupId);
  } else {
    collapsedModules.value = [...collapsedModules.value, groupId];
  }
}

/* ========== 架构层节点交互：点击关联图气泡（T39）+ 悬停描述气泡（T40） ========== */

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
  tooltip.value = null;
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

/* ========== 画布布局：从坐标数据实时构建（draw.io 改造，T62） ========== */
/**
 * 统一取数：节点坐标/尺寸来自 manual.nodes（geometry 固化 + 拖拽实时更新），
 * 连线折点来自 manual.edges；无坐标的节点/连线用兜底值，保证渲染不报错。
 */
const layout = computed<LayoutResponse | null>(() => {
  const d = diagram.value;
  if (!d) return null;

  const nodePos = d.nodes.map((n) => {
    const g = manual.nodes[n.nodeId];
    return g
      ? { nodeId: n.nodeId, x: g.x, y: g.y, width: g.width, height: g.height }
      : { nodeId: n.nodeId, x: 0, y: 0, width: DEFAULT_NODE_SIZE.width, height: DEFAULT_NODE_SIZE.height };
  });

  const edgePos = d.edges.map((e) => {
    const pts = manual.edges[e.edgeId]?.points ?? e.points;
    if (pts && pts.length >= 2) return { edgeId: e.edgeId, points: pts };
    // 兜底：两端节点中心直连
    const from = nodePos.find((nd) => nd.nodeId === e.from);
    const to = nodePos.find((nd) => nd.nodeId === e.to);
    const p0 = from ? { x: from.x + from.width / 2, y: from.y + from.height / 2 } : { x: 0, y: 0 };
    const p1 = to ? { x: to.x + to.width / 2, y: to.y + to.height / 2 } : { x: 100, y: 100 };
    return { edgeId: e.edgeId, points: [p0, p1] };
  });

  // 分组（模块/泳道）包围盒：由成员节点几何动态计算
  const groupPos = d.groups.map((g) => {
    const boxes = g.nodeIds
      .map((id) => nodePos.find((nd) => nd.nodeId === id))
      .filter(
        (b): b is { nodeId: string; x: number; y: number; width: number; height: number } =>
          !!b && b.width > 0 && b.height > 0
      );
    if (boxes.length === 0) return { groupId: g.groupId, x: 0, y: 0, width: 0, height: 0 };
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.width));
    const maxY = Math.max(...boxes.map((b) => b.y + b.height));
    const pad = 10;
    // 纵向模块（垂直模块框）：顶部预留标题空间（标题渲染在 y+16，文字上缘约 y+7），
    // 避免标题被第一个节点遮住；横向泳道框顶部即画布顶，无需额外预留。
    const padTop = g.axis !== "horizontal" ? 22 : pad;
    return {
      groupId: g.groupId,
      x: minX - pad,
      y: minY - padTop,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad + padTop
    };
  });

  // 整体内容包围盒（fitView 用）
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  if (nodePos.length > 0) {
    minX = Math.min(...nodePos.map((b) => b.x));
    minY = Math.min(...nodePos.map((b) => b.y));
    maxX = Math.max(...nodePos.map((b) => b.x + b.width));
    maxY = Math.max(...nodePos.map((b) => b.y + b.height));
  }

  return {
    diagramId: d.diagramId,
    width: Math.max(maxX - minX, 200) + 40,
    height: Math.max(maxY - minY, 200) + 40,
    nodes: nodePos,
    edges: edgePos,
    groups: groupPos,
    params: { algorithm: "freeform", direction: "down", edgeRouting: "orthogonal" }
  };
});

/* ========== 数据加载（draw.io 改造：首次补默认值 + 固化，T61） ========== */

/** 检测图是否缺坐标：任一节点无 geometry 或任一连线无 points */
function hasMissingGeometry(d: Diagram): boolean {
  return (
    d.nodes.some((n) => !(n as { geometry?: unknown }).geometry) ||
    d.edges.some((e) => !e.points || e.points.length < 2)
  );
}

/** 用布局结果补齐图坐标（节点 geometry + 连线 points），返回新图对象（不落库） */
function enrichWithLayout(d: Diagram, l: LayoutResponse): Diagram {
  const layoutNodes = new Map(l.nodes.map((n) => [n.nodeId, n]));
  const layoutEdges = new Map(l.edges.map((e) => [e.edgeId, e.points]));
  return {
    ...d,
    nodes: d.nodes.map((n) => {
      const ln = layoutNodes.get(n.nodeId);
      return ln
        ? { ...n, geometry: { x: ln.x, y: ln.y, width: ln.width, height: ln.height } }
        : n;
    }),
    edges: d.edges.map((e) => {
      const pts = layoutEdges.get(e.edgeId);
      return pts ? { ...e, points: pts } : e;
    })
  };
}

/** 从图数据收集坐标载荷（用于首次固化落库） */
function toGeometryPayload(d: Diagram): GeometrySave {
  return {
    nodes: (d.nodes as Array<{ nodeId: string; geometry?: NodeGeometry }>)
      .filter((n) => n.geometry)
      .map((n) => ({ nodeId: n.nodeId, ...(n.geometry as NodeGeometry) })),
    edges: d.edges
      .filter((e) => e.points && e.points.length >= 2)
      .map((e) => ({ edgeId: e.edgeId, points: e.points as Array<{ x: number; y: number }> }))
  };
}

/**
 * 加载图数据：旧图（无坐标）首次打开自动补齐缺省默认坐标并固化，
 * 固化后与新图行为完全一致（统一走 geometry/points 渲染）。
 */
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const d = await getDiagram(props.projectId, props.diagramId);
    if (hasMissingGeometry(d)) {
      // 缺坐标 → 引擎生成默认坐标 → 固化到服务端
      const l = await getLayout(props.projectId, props.diagramId);
      const enriched = enrichWithLayout(d, l);
      diagram.value = enriched;
      try {
        await saveGeometry(props.projectId, props.diagramId, toGeometryPayload(enriched));
      } catch {
        /* 固化失败不阻塞展示：下次打开再补写 */
      }
    } else {
      diagram.value = d;
    }
    manual.load(diagram.value);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载图失败";
  } finally {
    loading.value = false;
    await nextTick();
    fitView();
    requestAnimationFrame(fitView);
  }
}

onMounted(() => {
  load();
  window.addEventListener("resize", onWindowResize);
});
watch(() => props.diagramId, () => {
  collapsedModules.value = [];
  bubble.value = null;
  tooltip.value = null;
  manual.resetEdit();
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
.toolbar-actions {
  display: flex;
  gap: 8px;
}
/* 编辑态使用提示 */
.edit-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: #b88230;
  background: #fdf6ec;
  border: 1px solid #f5dab1;
  border-radius: 4px;
  padding: 6px 10px;
}
.btn-sm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-sm.primary {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}
.btn-sm.primary:hover {
  background: #66b1ff;
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
  /* T67：画布内禁止选中文字，避免拖拽连线/节点时误选中 */
  user-select: none;
  -webkit-user-select: none;
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
