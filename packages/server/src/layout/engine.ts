/**
 * 布局引擎：业务语义 Diagram → 带坐标 LayoutDiagram
 *
 * 基于 elkjs（Eclipse Layout Kernel JS 实现）。
 * 输入为纯业务语义（无坐标），输出仅内部渲染用，不进入 MCP 通道。
 *
 * 本文件为基础版实现：三图类型通用平铺布局（节点+连线+分组外框）。
 * 双轴分区与模块折叠为后续增强项（T08 完整版）。
 */
import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs";
import type { Diagram, LayoutDiagram, Group } from "@fourstage/shared";

/** 三种图类型的默认节点尺寸 */
const NODE_WIDTH = 160;
const NODE_HEIGHT = 60;

/** 分组容器内边距 */
const GROUP_PADDING = 24;

/** 节点尺寸估算：按 label 长度粗略计算宽度（类图略宽以容纳属性/方法） */
function estimateNodeSize(node: {
  label: string;
  attributes?: unknown[];
  methods?: unknown[];
}) {
  let width = NODE_WIDTH;
  let height = NODE_HEIGHT;
  if (node.attributes?.length || node.methods?.length) {
    // 类图：按属性/方法数量估算高度，宽度加宽
    const items = (node.attributes?.length ?? 0) + (node.methods?.length ?? 0);
    width = 200;
    height = NODE_HEIGHT + items * 18;
  } else if (node.label.length > 12) {
    width = Math.max(NODE_WIDTH, node.label.length * 9);
  }
  return { width, height };
}

/** 将业务 Diagram 转换为 elk 输入结构 */
function toElkGraph(diagram: Diagram): ElkNode {
  const nodes: ElkNode[] = [];
  const edges: ElkExtendedEdge[] = [];

  for (const node of diagram.nodes as Array<{
    nodeId: string;
    label: string;
    attributes?: unknown[];
    methods?: unknown[];
  }>) {
    const { width, height } = estimateNodeSize(node);
    nodes.push({ id: node.nodeId, width, height, labels: [{ text: node.label }] });
  }

  for (const edge of diagram.edges) {
    edges.push({
      id: edge.edgeId,
      sources: [edge.from],
      targets: [edge.to],
      labels: edge.label ? [{ text: edge.label }] : []
    });
  }

  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "32",
      "elk.layered.spacing.nodeNodeBetweenLayers": "48",
      "elk.edgeRouting": "ORTHOGONAL"
    },
    children: nodes,
    edges
  };
}

/** 构建分组外框坐标（基于成员节点包围盒） */
function buildGroups(
  groups: Group[],
  nodePos: Map<string, { x: number; y: number; width: number; height: number }>
): LayoutDiagram["groups"] {
  return groups.map((group) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const nid of group.nodeIds) {
      const p = nodePos.get(nid);
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.width);
      maxY = Math.max(maxY, p.y + p.height);
    }
    if (!isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = 0;
      maxY = 0;
    }
    return {
      groupId: group.groupId,
      x: minX - GROUP_PADDING,
      y: Math.max(0, minY - GROUP_PADDING - 20), // 顶部留标题空间，且不为负
      width: maxX - minX + GROUP_PADDING * 2,
      height: maxY - minY + GROUP_PADDING * 2 + 20
    };
  });
}

/**
 * 计算图布局
 * @param diagram 业务语义图
 * @returns 带坐标的布局结果
 */
export async function computeLayout(diagram: Diagram): Promise<LayoutDiagram> {
  const elk = new ELK();
  const graph = toElkGraph(diagram);
  const laidOut = await elk.layout(graph);

  const nodePos = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const child of laidOut.children ?? []) {
    nodePos.set(child.id, {
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? NODE_WIDTH,
      height: child.height ?? NODE_HEIGHT
    });
  }

  // elk 坐标基于父节点相对，root 无需偏移
  const nodes = Array.from(nodePos.entries()).map(([nodeId, pos]) => ({
    nodeId,
    ...pos
  }));

  const edges: LayoutDiagram["edges"] = (laidOut.edges ?? []).map(
    (e: ElkExtendedEdge) => ({
      edgeId: e.id,
      points: (e.sections ?? []).flatMap((sec: { startPoint: { x: number; y: number }; bendPoints?: Array<{ x: number; y: number }>; endPoint: { x: number; y: number } }) =>
        sec.startPoint
          ? [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint]
          : []
      )
    })
  );

  // 计算整体宽高
  let width = 0;
  let height = 0;
  for (const n of nodes) {
    width = Math.max(width, n.x + n.width);
    height = Math.max(height, n.y + n.height);
  }
  for (const g of buildGroups(diagram.groups, nodePos)) {
    width = Math.max(width, g.x + g.width);
    height = Math.max(height, g.y + g.height);
  }

  return {
    diagramId: diagram.diagramId,
    width: Math.ceil(width),
    height: Math.ceil(height),
    nodes,
    edges,
    groups: buildGroups(diagram.groups, nodePos)
  };
}
