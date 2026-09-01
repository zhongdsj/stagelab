/**
 * 画布坐标状态（draw.io 改造，T61/T63）：节点/连线坐标全集 + 撤销/重做 + 保存载荷
 *
 * 分层约定：
 * - 坐标已固化为图数据（节点 geometry / 连线 points），本模块持有「当前画布坐标」全集，
 *   渲染层直接消费；拖拽/改形中实时更新，结束后由 DiagramView 调 saveGeometry 落库。
 * - 节点坐标：nodeId → { x, y, width, height }
 * - 连线坐标：edgeId → points
 * - 撤销/重做：提交式变更（拖动结束/清除）压入历史栈，对坐标全集做快照。
 *
 * 说明：保留 createManualEdit / ManualOverrides 命名以兼容既有调用方；
 * overrides 恒为空对象（坐标固化后不再有增量覆盖概念）。
 */
import { computed, reactive, ref } from "vue";
import type { Diagram } from "@fourstage/shared";

export interface CanvasNodeGeom {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasEdgeGeom {
  points: Array<{ x: number; y: number }>;
}

export interface CanvasGeometry {
  nodes: Record<string, CanvasNodeGeom>;
  edges: Record<string, CanvasEdgeGeom>;
}

/** 兼容旧类型：覆盖集合（恒空，坐标固化后无增量覆盖） */
export interface ManualOverrides {
  nodes: Record<string, { x: number; y: number }>;
  edges: Record<string, { points: Array<{ x: number; y: number }> }>;
}

/** 空覆盖常量（兼容 DiagramSvg overrides prop） */
const EMPTY_OVERRIDES: ManualOverrides = { nodes: {}, edges: {} };

/** 未布局节点兜底尺寸（首次固化前/异常时占位） */
export const DEFAULT_NODE_SIZE = { width: 120, height: 48 };

const HISTORY_LIMIT = 60;

/** 创建画布坐标状态（每张图页面一个实例） */
export function createManualEdit() {
  /** 编辑态/展示态切换：编辑态可拖动节点与连线，展示态只读 */
  const editMode = ref(false);

  /** 当前画布坐标全集（渲染层直接消费，reactive 保证 SVG 实时联动） */
  const nodes = reactive<Record<string, CanvasNodeGeom>>({});
  const edges = reactive<Record<string, CanvasEdgeGeom>>({});

  const undoStack = ref<CanvasGeometry[]>([]);
  const redoStack = ref<CanvasGeometry[]>([]);

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  /** 深拷贝当前坐标快照（历史栈用） */
  function snapshot(): CanvasGeometry {
    return {
      nodes: Object.fromEntries(
        Object.entries(nodes).map(([k, v]) => [k, { ...v }])
      ),
      edges: Object.fromEntries(
        Object.entries(edges).map(([k, v]) => [
          k,
          { points: v.points.map((p) => ({ ...p })) }
        ])
      )
    };
  }

  /** 用快照整体恢复坐标 */
  function restore(s: CanvasGeometry) {
    for (const k of Object.keys(nodes)) delete nodes[k];
    for (const k of Object.keys(s.nodes)) nodes[k] = { ...s.nodes[k] };
    for (const k of Object.keys(edges)) delete edges[k];
    for (const k of Object.keys(s.edges))
      edges[k] = { points: s.edges[k].points.map((p) => ({ ...p })) };
  }

  /** 提交式变更前压入历史（清空重做栈） */
  function pushHistory() {
    undoStack.value.push(snapshot());
    if (undoStack.value.length > HISTORY_LIMIT) undoStack.value.shift();
    redoStack.value = [];
  }

  /**
   * 从图数据加载坐标（geometry/points → 画布状态），重置编辑态与历史。
   * 无 geometry/points 的元素不填充，渲染层按缺省兜底（首次固化前）。
   */
  function load(diagram: Diagram) {
    editMode.value = false;
    for (const k of Object.keys(nodes)) delete nodes[k];
    for (const k of Object.keys(edges)) delete edges[k];
    undoStack.value = [];
    redoStack.value = [];
    for (const n of diagram.nodes as Array<{ nodeId: string; geometry?: CanvasNodeGeom }>) {
      if (n.geometry) nodes[n.nodeId] = { ...n.geometry };
    }
    for (const e of diagram.edges as Array<{ edgeId: string; points?: Array<{ x: number; y: number }> }>) {
      if (e.points && e.points.length >= 2) edges[e.edgeId] = { points: e.points.map((p) => ({ ...p })) };
    }
  }

  /** 节点拖拽：实时更新坐标；commit=true 压历史（保留原尺寸，未布局节点用兜底尺寸） */
  function setNode(nodeId: string, x: number, y: number, commit: boolean) {
    const cur = nodes[nodeId] ?? { x, y, ...DEFAULT_NODE_SIZE };
    nodes[nodeId] = { x, y, width: cur.width, height: cur.height };
    if (commit) pushHistory();
  }

  /** 连线改形：更新折点全集；commit=true 压历史 */
  function setEdge(edgeId: string, points: Array<{ x: number; y: number }>, commit: boolean) {
    edges[edgeId] = { points: points.map((p) => ({ ...p })) };
    if (commit) pushHistory();
  }

  /** 清除全部坐标（撤销可恢复） */
  function clearAll() {
    if (Object.keys(nodes).length === 0 && Object.keys(edges).length === 0) return;
    for (const k of Object.keys(nodes)) delete nodes[k];
    for (const k of Object.keys(edges)) delete edges[k];
    pushHistory();
  }

  /** 撤销（T56） */
  function undo() {
    const top = undoStack.value.pop();
    if (!top) return;
    redoStack.value.push(snapshot());
    restore(top);
  }

  /** 重做（T56） */
  function redo() {
    const top = redoStack.value.pop();
    if (!top) return;
    undoStack.value.push(snapshot());
    restore(top);
  }

  /** 退出编辑态（切图/重载时调用） */
  function resetEdit() {
    editMode.value = false;
  }

  /** 收集待保存的坐标载荷（拖拽结束/撤销重做/清除后由 DiagramView 落库） */
  function collectSavePayload(): {
    nodes: Array<CanvasNodeGeom & { nodeId: string }>;
    edges: Array<{ edgeId: string; points: Array<{ x: number; y: number }> }>;
  } {
    return {
      nodes: Object.entries(nodes).map(([nodeId, v]) => ({ nodeId, ...v })),
      edges: Object.entries(edges).map(([edgeId, v]) => ({ edgeId, points: v.points }))
    };
  }

  return {
    editMode,
    nodes,
    edges,
    /** 兼容覆盖（恒空，坐标固化后无增量覆盖） */
    overrides: EMPTY_OVERRIDES,
    canUndo,
    canRedo,
    load,
    setNode,
    setEdge,
    clearAll,
    undo,
    redo,
    resetEdit,
    collectSavePayload
  };
}

export type ManualEditStore = ReturnType<typeof createManualEdit>;
