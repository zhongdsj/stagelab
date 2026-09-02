/**
 * 图 API（对接 /api/projects/:id/diagrams 路由）
 */
import type { Diagram, LayoutDiagram, ImpactRiskLevel, VerificationRecord, VerificationActor, VerificationChangeType } from "@fourstage/shared";
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

/** 节点风险分映射：nodeId → structuralRisk（前端风险着色，feature/diagram-risk-color） */
export type ImpactRiskMap = Record<string, ImpactRiskLevel>;

/** 读取预计算影响范围的节点风险分（仅 structuralRisk，轻量透传） */
export function getDiagramImpact(
  projectId: string,
  diagramId: string
): Promise<{ version: number; risk: ImpactRiskMap }> {
  return http.get(
    `/api/projects/${encodeURIComponent(projectId)}/diagrams/${encodeURIComponent(diagramId)}/impact`
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

/* ========== 图漂移校验（T91 前端能力扩展） ========== */

/** verify_diagram 入参（HTTP 透传，前端人工确认默认 verifiedBy=human） */
export interface VerifyDiagramPayload {
  commit: string;
  note?: string;
  verifiedBy?: VerificationActor;
  changeType?: VerificationChangeType;
  baseCommit?: string;
}

/** 显式确认图可信：返回最新可信快照锚点（前端徽标数据源） */
export function verifyDiagram(
  projectId: string,
  diagramId: string,
  payload: VerifyDiagramPayload
): Promise<{
  diagramId: string;
  version: number;
  verifiedCommit?: string;
  lastVerifiedAt?: number;
  verifiedBy?: VerificationActor;
  verifyNote?: string;
  baseCommit?: string;
}> {
  return http.post(
    `/api/projects/${encodeURIComponent(projectId)}/diagrams/${encodeURIComponent(diagramId)}/verify`,
    payload
  );
}

/** 读取图验证历史（链式，verifiedAt 升序；可选 limit 限制最新 N 条） */
export function getVerificationHistory(
  projectId: string,
  diagramId: string,
  limit?: number
): Promise<VerificationRecord[]> {
  const q = limit ? `?limit=${limit}` : "";
  return http.get<VerificationRecord[]>(
    `/api/projects/${encodeURIComponent(projectId)}/diagrams/${encodeURIComponent(diagramId)}/verifications${q}`
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
