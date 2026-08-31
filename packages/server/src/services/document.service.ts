/**
 * 文档分片服务（T07 服务②）
 *
 * 对应开发文档 8.2 工具：create_document / get_document_index / read_document_fragment / write_document_fragment
 * 增强：readDocumentFull 全文拼接（供前端/人工阅读，观感友好）
 *
 * 存储形态：store/documents/{docId}/{fragmentId}.json + meta.json（文档标题独立于分片）
 * 分片约束：单分片内容不超过 2000 字（开发文档 7.5）
 */
import type { DocumentFragment, DocumentMeta } from "@fourstage/shared";
import type { RepoWorkspace } from "../storage/workspace.js";
import { createRepositories } from "../storage/repositories/factory.js";

/** 单分片最大字数 */
export const MAX_FRAGMENT_CHARS = 2000;

/** 确保文档元信息存在并更新标题/摘要（写分片后调用；docType 仅在显式传入时覆盖） */
async function upsertDocumentMeta(
  workspace: RepoWorkspace,
  docId: string,
  title: string,
  summary?: string,
  docType?: string
): Promise<void> {
  const repos = createRepositories(workspace);
  let meta: DocumentMeta;
  try {
    meta = await repos.documentMeta.get(docId);
    meta.title = title;
    if (docType !== undefined) meta.docType = docType;
    if (summary !== undefined) meta.summary = summary;
    meta.updatedAt = Date.now();
  } catch {
    meta = {
      docId,
      title,
      ...(docType ? { docType } : {}),
      summary: summary ?? "",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }
  await repos.documentMeta.save(meta);
}

/** 创建文档（meta + 首分片；docType 为自由文本，帮助 AI/人工快速理解文档性质） */
export async function createDocument(
  workspace: RepoWorkspace,
  docId: string,
  title: string,
  content: string,
  docType?: string
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
  await upsertDocumentMeta(workspace, docId, title, content.slice(0, 50), docType);
  return fragment;
}

/** 获取文档索引列表（轻量：标题摘要，来源为独立 meta，不再依赖分片 title） */
export async function getDocumentIndex(workspace: RepoWorkspace) {
  const repos = createRepositories(workspace);
  const metas = await repos.documentMeta.list();
  const frags = await repos.documentFragment.list();
  const countMap = new Map<string, number>();
  for (const f of frags) {
    countMap.set(f.docId, (countMap.get(f.docId) ?? 0) + 1);
  }
  return metas.map((m) => ({
    docId: m.docId,
    title: m.title,
    docType: m.docType,
    summary: m.summary ?? "",
    fragmentCount: countMap.get(m.docId) ?? 0
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

/** 读取文档全文（按 order 拼接，供人工/前端阅读） */
export async function readDocumentFull(
  workspace: RepoWorkspace,
  docId: string
): Promise<{
  docId: string;
  title: string;
  summary: string;
  content: string;
  fragmentCount: number;
}> {
  const repos = createRepositories(workspace);
  const frags = await repos.documentFragment.listByDoc(docId);
  let title = docId;
  let summary = "";
  try {
    const meta = await repos.documentMeta.get(docId);
    title = meta.title;
    summary = meta.summary ?? "";
  } catch {
    // 无 meta 时以 docId 兜底
  }
  return {
    docId,
    title,
    summary,
    content: frags.map((f) => f.content).join(""),
    fragmentCount: frags.length
  };
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
  const title = options.title ?? docId;
  for (let i = 0; i < chunks.length; i++) {
    const fragmentId = `${docId}-f${order + i}`; // 分片ID随order递增，避免多分片时覆盖
    const fragment: DocumentFragment = {
      fragmentId,
      docId,
      order: order + i,
      title, // 分片 title 保持纯标题（不带序号），文档标题由 meta 承载
      content: chunks[i]
    };
    await repos.documentFragment.save(fragment);
    fragments.push(fragment);
  }

  // 同步更新/创建文档 meta（标题独立 + 摘要取首分片内容）
  await upsertDocumentMeta(
    workspace,
    docId,
    title,
    fragments[0]?.content.slice(0, 50) ?? ""
  );

  // 清理孤儿分片：本次覆盖区间 [startOrder, startOrder+chunks.length) 之后的旧分片
  // （全量/片段编辑变短时，残留的后续分片需删除，避免索引混入脏数据）
  const startOrder = options.order ?? 0;
  const endOrder = startOrder + chunks.length;
  const existing = await repos.documentFragment.listByDoc(docId);
  for (const f of existing) {
    if (f.order >= endOrder) {
      await repos.documentFragment.delete(f.fragmentId);
    }
  }
  return fragments;
}

/** 重命名文档（标题/类型/摘要，仅更新 meta） */
export async function renameDocument(
  workspace: RepoWorkspace,
  docId: string,
  patch: { title?: string; docType?: string; summary?: string }
): Promise<DocumentMeta> {
  const repos = createRepositories(workspace);
  const meta = await repos.documentMeta.get(docId);
  if (patch.title !== undefined && patch.title.trim()) {
    meta.title = patch.title.trim();
  }
  if (patch.docType !== undefined) {
    meta.docType = patch.docType.trim() || undefined;
  }
  if (patch.summary !== undefined) {
    meta.summary = patch.summary.trim() || "";
  }
  meta.updatedAt = Date.now();
  await repos.documentMeta.save(meta);
  return meta;
}

/** 删除文档（meta + 全部分片，级联移除索引） */
export async function deleteDocument(
  workspace: RepoWorkspace,
  docId: string
): Promise<void> {
  const repos = createRepositories(workspace);
  const frags = await repos.documentFragment.listByDoc(docId);
  for (const f of frags) {
    await repos.documentFragment.delete(f.fragmentId);
  }
  await repos.documentMeta.delete(docId);
}
