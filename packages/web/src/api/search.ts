/**
 * 全项目搜索 API（对接 GET /api/projects/:id/search）
 *
 * 出参为 richer 结果：kind/snippet/ranges + 跳转定位字段（D3：不改动 MCP 搜索出参）。
 */
import { http } from "./client.js";

/** 搜索结果类型（与服务端 RichSearchKind 一致） */
export type SearchKind =
  | "document"
  | "fragment"
  | "diagram"
  | "requirement"
  | "task";

/** 命中区间（相对 snippet 的字符偏移，左闭右开） */
export interface SearchRange {
  start: number;
  end: number;
}

/** 单条搜索结果 */
export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle?: string;
  snippet?: string;
  ranges?: SearchRange[];
  score: number;
  docId?: string;
  docTitle?: string;
  fragmentId?: string;
  fragmentOrder?: number;
  diagramId?: string;
  diagramType?: string;
  requirementId?: string;
  taskId?: string;
}

/** 搜索选项 */
export interface SearchOptions {
  /** 限定类型；缺省为全部（含 fragment） */
  types?: SearchKind[];
  /** 返回条数上限（1..200，服务端默认 30） */
  limit?: number;
  /** 中止信号（前端 10s 超时兜底用） */
  signal?: AbortSignal;
}

/** 全项目搜索（仅当前项目，空关键词由调用方拦截） */
export function searchProject(
  projectId: string,
  q: string,
  options: SearchOptions = {}
): Promise<SearchHit[]> {
  const params = new URLSearchParams({ q });
  if (options.types?.length) params.set("types", options.types.join(","));
  if (options.limit) params.set("limit", String(options.limit));
  const init = options.signal ? { signal: options.signal } : undefined;
  return http.get<SearchHit[]>(
    `/api/projects/${encodeURIComponent(projectId)}/search?${params.toString()}`,
    init
  );
}
