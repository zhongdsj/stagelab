/**
 * 文档分片 API（对接 /api/projects/:id/documents/:docId/fragments 路由）
 */
import type { DocumentFragment } from "@fourstage/shared";
import { http } from "./client.js";

/** 分片列表元信息（轻量，不含全文 content） */
export interface FragmentMeta {
  fragmentId: string;
  docId: string;
  order: number;
  title: string;
}

/** 文档分片列表 */
export function listFragments(
  projectId: string,
  docId: string
): Promise<FragmentMeta[]> {
  return http.get<FragmentMeta[]>(
    `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docId)}/fragments`
  );
}

/** 读取指定分片全文 */
export function getFragment(
  projectId: string,
  docId: string,
  fragmentId: string
): Promise<DocumentFragment> {
  return http.get<DocumentFragment>(
    `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docId)}/fragments/${encodeURIComponent(fragmentId)}`
  );
}

/** 编辑指定分片（按 order 覆盖，超长自动再分片） */
export function updateFragment(
  projectId: string,
  docId: string,
  fragmentId: string,
  content: string
): Promise<DocumentFragment[]> {
  return http.put<DocumentFragment[]>(
    `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docId)}/fragments/${encodeURIComponent(fragmentId)}`,
    { content }
  );
}
