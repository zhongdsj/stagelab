/**
 * 文档分片 API（对接 /api/projects/:id/documents/:docId/fragments 路由）
 */
import type { DocumentFragment } from "@stagelab/shared";
import { http } from "./client.js";

/** 分片列表元信息（轻量：含摘要，不含全文 content） */
export interface FragmentMeta {
  fragmentId: string;
  docId: string;
  order: number;
  title: string;
  summary: string;
}

/** 文档写入结果（单分片语义，含分级警告） */
export interface WriteFragmentResult {
  fragment: DocumentFragment;
  warning?: "warning" | "strongWarning";
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

/** 编辑指定分片（单分片替换，不自动切分；返回分级警告） */
export function updateFragment(
  projectId: string,
  docId: string,
  fragmentId: string,
  content: string
): Promise<WriteFragmentResult> {
  return http.put<WriteFragmentResult>(
    `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docId)}/fragments/${encodeURIComponent(fragmentId)}`,
    { content }
  );
}

/** 文档全文（分片顺序拼接，供全量展示） */
export interface FullDocument {
  docId: string;
  title: string;
  summary: string;
  content: string;
  fragmentCount: number;
}

/** 读取文档全文 */
export function getFullDocument(
  projectId: string,
  docId: string
): Promise<FullDocument> {
  return http.get<FullDocument>(
    `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docId)}/full`
  );
}

/** 全量编辑文档（清空其他分片 + order0 单分片全量覆盖，不自动切分；返回分级警告） */
export function updateFullDocument(
  projectId: string,
  docId: string,
  content: string,
  title?: string
): Promise<WriteFragmentResult> {
  return http.put<WriteFragmentResult>(
    `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docId)}/full`,
    { content, title }
  );
}

/** 文档列表项（来自项目索引，含 docType 便于 AI/人工识别文档性质） */
export interface DocumentItem {
  docId: string;
  title: string;
  docType?: string;
  summary?: string;
  fragmentIds: string[];
}

/** 新建文档（docId 后端自动生成；docType 为自由文本） */
export function createDocument(
  projectId: string,
  payload: { title: string; docType?: string; content?: string }
): Promise<DocumentFragment> {
  return http.post<DocumentFragment>(
    `/api/projects/${encodeURIComponent(projectId)}/documents`,
    payload
  );
}

/** 重命名文档（标题/类型/摘要） */
export function renameDocument(
  projectId: string,
  docId: string,
  patch: { title?: string; docType?: string; summary?: string }
): Promise<unknown> {
  return http.put(
    `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docId)}`,
    patch
  );
}

/** 删除文档（meta + 全部分片） */
export function deleteDocument(projectId: string, docId: string): Promise<void> {
  return http.del<void>(
    `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docId)}`
  );
}
