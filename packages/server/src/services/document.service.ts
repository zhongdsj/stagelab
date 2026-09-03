/**
 * 文档分片服务（T07 服务②）
 *
 * 对应开发文档 8.2 工具：create_document / get_document_index / read_document_fragment / write_document_fragment
 * 增强：readDocumentFull 全文拼接（供前端/人工阅读，观感友好）
 *
 * 存储形态：store/documents/{docId}/{fragmentId}.json + meta.json（文档标题独立于分片）
 * 分片约束（AI 自控）：不自动切分、不超限报错，单分片语义 + 分级警告（2000/4000）。
 * - 缺省 order=追加到末尾，指定 order=替换该分片；删除走 deleteDocumentFragment
 * - 超长不报错不硬切：≤2000 无警告，2001~4000 warning，>4000 strongWarning，内容均原样落库
 */
import type { DocumentFragment, DocumentMeta } from "@stagelab/shared";
import type { RepoWorkspace } from "../storage/workspace.js";
import { createRepositories } from "../storage/repositories/factory.js";

/** 单分片建议字数上限（超过给警告，不阻断落库） */
export const MAX_FRAGMENT_CHARS = 2000;

/** 分级警告类型：warning（建议拆分） / strongWarning（强烈建议拆分） */
export type FragmentWarning = "warning" | "strongWarning";

/** 文档写入结果（含分级警告，供 MCP/HTTP 透传给调用方自行决策） */
export interface WriteFragmentResult {
  fragment: DocumentFragment;
  warning?: FragmentWarning;
}

/** 按内容长度计算分级警告：≤2000 无警告；2001~4000 warning；>4000 strongWarning */
function warningOfLength(len: number): FragmentWarning | undefined {
  if (len <= MAX_FRAGMENT_CHARS) return undefined;
  if (len <= MAX_FRAGMENT_CHARS * 2) return "warning";
  return "strongWarning";
}

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

/**
 * 创建文档（meta + 首分片；单分片语义，超长不截断，返回分级警告；docType 为自由文本）
 */
export async function createDocument(
  workspace: RepoWorkspace,
  docId: string,
  title: string,
  content: string,
  docType?: string,
  summary?: string
): Promise<WriteFragmentResult> {
  const repos = createRepositories(workspace);
  const fragment: DocumentFragment = {
    fragmentId: `${docId}-f0`,
    docId,
    order: 0,
    title,
    content,
    summary: summary ?? content.slice(0, 50) // 未显式提供摘要时取内容前 50 字兜底
  };
  await repos.documentFragment.save(fragment);
  await upsertDocumentMeta(workspace, docId, title, fragment.summary, docType);
  return { fragment, warning: warningOfLength(content.length) };
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

/** 列出指定文档的全部分片（轻量：含分片摘要，不含正文，供 AI 按摘要跳读） */
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
    title: f.title,
    summary: f.summary ?? ""
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

/**
 * 写入/更新文档分片（AI 自控单分片语义）
 *
 * - 缺省 order：追加到该文档末尾（当前最大 order + 1，无分片则 0）
 * - 指定 order：替换该 order 的分片（不存在则新建）
 * - 超长不报错不硬切，按 2000/4000 分级返回 warning，内容原样落库
 * - summary：显式提供则存，否则取内容前 50 字兜底
 */
export async function writeDocumentFragment(
  workspace: RepoWorkspace,
  docId: string,
  content: string,
  options: { order?: number; title?: string; summary?: string } = {}
): Promise<WriteFragmentResult> {
  const repos = createRepositories(workspace);

  // 缺省 order：追加到末尾
  let order = options.order;
  if (order === undefined) {
    const existing = await repos.documentFragment.listByDoc(docId);
    order = existing.length > 0 ? existing[existing.length - 1].order + 1 : 0;
  }

  const title = options.title ?? docId;
  const fragment: DocumentFragment = {
    fragmentId: `${docId}-f${order}`,
    docId,
    order,
    title,
    content,
    summary: options.summary ?? content.slice(0, 50)
  };
  await repos.documentFragment.save(fragment);

  // 同步更新/创建文档 meta（标题独立 + 摘要取当前分片摘要）
  await upsertDocumentMeta(workspace, docId, title, fragment.summary);

  return { fragment, warning: warningOfLength(content.length) };
}

/** 删除指定文档分片（AI 自主管理分片生命周期） */
export async function deleteDocumentFragment(
  workspace: RepoWorkspace,
  fragmentId: string
): Promise<void> {
  const repos = createRepositories(workspace);
  await repos.documentFragment.delete(fragmentId);
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
