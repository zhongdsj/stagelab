/**
 * 图 API（对接 /api/projects/:id/diagrams 路由）
 */
import type { Diagram, LayoutDiagram } from "@fourstage/shared";
import { http } from "./client.js";

/** 自由画布坐标保存载荷（T59/T60）：节点几何 + 连线折点 */
export interface GeometrySave {
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

/** 读取图语义模型（含节点类型，供 SVG 渲染区分样式） */
export function getDiagram(
  projectId: string,
  diagramId: string
): Promise<Diagram> {
  return http.get<Diagram>(
    `/api/projects/${encodeURIComponent(projectId)}/diagrams/${encodeURIComponent(diagramId)}`
  );
}

/** 批量保存自由画布坐标（T59/T60）：首次固化 / 拖拽结束落库，返回更新后图数据 */
export function saveGeometry(
  projectId: string,
  diagramId: string,
  data: GeometrySave
): Promise<Diagram> {
  return http.post<Diagram>(
    `/api/projects/${encodeURIComponent(projectId)}/diagrams/${encodeURIComponent(diagramId)}/geometry`,
    data
  );
}

/** 前端可覆盖的布局参数（T47 扩展，缺省回退服务端预设） */
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

/** 布局响应：布局结果 + 当前生效参数（面板单一数据源） */
export type LayoutResponse = LayoutDiagram & {
  params: LayoutOverrides & {
    algorithm: string;
    direction: string;
    edgeRouting: string;
  };
};

/**
 * 实时计算图布局（可携带布局参数覆盖）
 * @param overrides 可选：布局参数覆盖，缺省用服务端当前图类型预设
 */
export function getLayout(
  projectId: string,
  diagramId: string,
  overrides?: LayoutOverrides
): Promise<LayoutResponse> {
  const q = new URLSearchParams();
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined && v > 0) q.set(k, String(v));
    }
  }
  const qs = q.toString();
  return http.get<LayoutResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/diagrams/${encodeURIComponent(diagramId)}/layout${qs ? `?${qs}` : ""}`
  );
}
