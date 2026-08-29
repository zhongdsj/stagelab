/**
 * 图 API（对接 /api/projects/:id/diagrams 路由）
 */
import type { Diagram, LayoutDiagram } from "@fourstage/shared";
import { http } from "./client.js";

/** 读取图语义模型（含节点类型，供 SVG 渲染区分样式） */
export function getDiagram(
  projectId: string,
  diagramId: string
): Promise<Diagram> {
  return http.get<Diagram>(
    `/api/projects/${encodeURIComponent(projectId)}/diagrams/${encodeURIComponent(diagramId)}`
  );
}

/**
 * 实时计算图布局
 * @param focusModuleId 可选：聚焦模块，非聚焦模块折叠为聚合节点
 */
export function getLayout(
  projectId: string,
  diagramId: string,
  focusModuleId?: string
): Promise<LayoutDiagram> {
  const params = focusModuleId
    ? `?focusModuleId=${encodeURIComponent(focusModuleId)}`
    : "";
  return http.get<LayoutDiagram>(
    `/api/projects/${encodeURIComponent(projectId)}/diagrams/${encodeURIComponent(diagramId)}/layout${params}`
  );
}
