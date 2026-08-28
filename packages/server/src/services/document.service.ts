/**
 * 文档分片服务（T07 服务②）
 *
 * 对应开发文档 8.2 工具：create_document / get_document_index / read_document_fragment / write_document_fragment
 *
 * 分片约束：单分片内容不超过 2000 字（开发文档 7.5）
 */
import type { DocumentFragment } from "@fourstage/shared";
import type { RepoWorkspace } from "../storage/workspace.js";
import { createRepositories } from "../storage/repositories/factory.js";
import { generateId } from "./project.service.js";

/** 单分片最大字数 */
export const MAX_FRAGMENT_CHARS = 2000;

/** 创建文档（首分片） */
export async function createDocument(
  workspace: RepoWorkspace,
  docId: string,
  title: string,
  content: string
): Promise<DocumentFragment> {
  const repos = createRepositories(workspace);
  const fragment: DocumentFragment = {
    fragmentId: `${docId}-f0`,
    docId,
    order: 0,
    title,
    content: content.slice(0, MAX_FRAGMENT_CHARS)
  };
  await repos.documentFragment.save(fragment);
  return fragment;
}

/** 获取文档索引列表（轻量：标题摘要） */
export async function getDocumentIndex(workspace: RepoWorkspace) {
  const repos = createRepositories(workspace);
  const frags = await repos.documentFragment.list();
  // 按 docId 聚合并取首分片为摘要
  const map = new Map<string, DocumentFragment[]>();
  for (const f of frags) {
    const arr = map.get(f.docId) ?? [];
    arr.push(f);
    map.set(f.docId, arr);
  }
  return Array.from(map.entries()).map(([docId, list]) => ({
    docId,
    title: list[0]?.title ?? docId,
    summary: list[0]?.content.slice(0, 50) ?? "",
    fragmentCount: list.length
  }));
}

/** 读取指定文档指定分片 */
export async function readDocumentFragment(
  workspace: RepoWorkspace,
  fragmentId: string
): Promise<DocumentFragment> {
  const repos = createRepositories(workspace);
  return repos.documentFragment.get(fragmentId);
}

/** 列出指定文档的全部分片（轻量：不含内容，避免返回大文本） */
export async function listDocumentFragments(
  workspace: RepoWorkspace,
  docId: string
) {
  const repos = createRepositories(workspace);
  const frags = await repos.documentFragment.listByDoc(docId);
  return frags.map((f) => ({
    fragmentId: f.fragmentId,
    docId: f.docId,
    order: f.order,
    title: f.title
  }));
}

/** 写入/更新文档分片（含自动分片：超出 2000 字时拆分） */
export async function writeDocumentFragment(
  workspace: RepoWorkspace,
  docId: string,
  content: string,
  options: { order?: number; title?: string } = {}
): Promise<DocumentFragment[]> {
  const repos = createRepositories(workspace);

  // 若内容超长，按 MAX 自动拆分
  const chunks: string[] = [];
  if (content.length <= MAX_FRAGMENT_CHARS) {
    chunks.push(content);
  } else {
    for (let i = 0; i < content.length; i += MAX_FRAGMENT_CHARS) {
      chunks.push(content.slice(i, i + MAX_FRAGMENT_CHARS));
    }
  }

  const fragments: DocumentFragment[] = [];
  let order = options.order ?? 0;
  for (let i = 0; i < chunks.length; i++) {
    const fragmentId = `${docId}-f${order}`;
    const fragment: DocumentFragment = {
      fragmentId,
      docId,
      order: order + i,
      title: chunks.length > 1 ? `${options.title ?? docId}(${i + 1}/${chunks.length})` : (options.title ?? docId),
      content: chunks[i]
    };
    await repos.documentFragment.save(fragment);
    fragments.push(fragment);
  }
  return fragments;
}
