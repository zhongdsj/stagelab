/**
 * MCP 工具：文档操作类（开发文档 8.2）
 *
 * get_document_index / read_document_fragment / write_document_fragment / create_document
 * + list_document_fragments / delete_document_fragment（AI 自控分片生命周期）
 * 约束：MCP 不提供全量读取（分层分片按需读取，避免全量拉取大对象，见开发文档 10.2）
 * 分片语义：单分片写入不自动切分；超长（>2000/4000）返回分级警告但不阻断落库，由 AI 自行决定是否拆分。
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getWorkspace } from "../../storage/workspace.js";
import {
  getDocumentIndex,
  readDocumentFragment,
  writeDocumentFragment,
  createDocument,
  listDocumentFragments,
  deleteDocumentFragment,
  renameDocument
} from "../../services/document.service.js";
import { safeCall } from "./_util.js";

/** 文档状态枚举（供 create_document / update_document_meta 复用） */
const documentStatusSchema = z
  .enum(["focused", "maintained", "archived"])
  .describe(
    "文档状态：focused 当前聚焦（默认，正在推进）| maintained 长期更新（最高可信度，需实时维护，变更时应同步更新）| archived 留档（历史/设计回顾，不再更新）"
  );

/** 注册文档操作类工具 */
export function registerDocumentTools(server: McpServer): void {
  server.registerTool(
    "get_document_index",
    {
      title: "获取文档索引",
      description: "获取文档索引列表（轻量：标题摘要，不含全文）"
    },
    async () =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return getDocumentIndex(ws);
      })
  );

  server.registerTool(
    "read_document_fragment",
    {
      title: "读取文档分片",
      description: "读取指定文档的指定分片内容",
      inputSchema: { fragmentId: z.string().min(1) }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return readDocumentFragment(ws, args.fragmentId);
      })
  );

  server.registerTool(
    "list_document_fragments",
    {
      title: "列出文档分片（轻量摘要）",
      description: "按 docId 列出文档全部分片的轻量摘要（fragmentId/order/title/summary，不含正文），供按摘要跳读后按需 read_document_fragment",
      inputSchema: { docId: z.string().min(1) }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return listDocumentFragments(ws, args.docId);
      })
  );

  server.registerTool(
    "delete_document_fragment",
    {
      title: "删除文档分片",
      description: "按 fragmentId 删除文档分片（AI 自主管理分片生命周期）",
      inputSchema: { fragmentId: z.string().min(1) }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        await deleteDocumentFragment(ws, args.fragmentId);
        return { ok: true, fragmentId: args.fragmentId };
      })
  );

  server.registerTool(
    "write_document_fragment",
    {
      title: "写入/更新文档分片",
      description:
        "写入/更新文档分片（AI 自控单分片语义）：\n" +
        "- 缺省 order：追加到该文档末尾；指定 order：替换该 order 的分片（不存在则新建）\n" +
        "- insertAfter：在该分片之后插入新分片（如分片2追加内容过大需拆出并插到2和3之间，用 insertAfter=<f2 id> 一次搞定），其后分片整体后移重编号；返回 shifted 给出旧→新 ID 映射，调用方须按新 ID 更新认知\n" +
        "- order 与 insertAfter 互斥，二选一\n" +
        "- 超长不报错不硬切，>2000 返回 warning、>4000 返回 strongWarning，内容均原样落库，由 AI 自行决定是否拆分\n" +
        "title/summary 为分片级元信息（仅供 list_document_fragments 跳读），不会改动文档级 meta；要改文档标题/类型/摘要请用 update_document_meta",
      inputSchema: {
        docId: z.string().min(1),
        content: z.string(),
        order: z.number().int().nonnegative().optional(),
        insertAfter: z.string().min(1).optional(),
        title: z.string().optional(),
        summary: z.string().optional()
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return writeDocumentFragment(ws, args.docId, args.content, {
          order: args.order,
          insertAfter: args.insertAfter,
          title: args.title,
          summary: args.summary
        });
      })
  );

  server.registerTool(
    "create_document",
    {
      title: "创建新文档",
      description: "创建新文档（单分片语义：超长不截断不报错，>2000 返回 warning、>4000 返回 strongWarning，由 AI 自行决定是否拆分）；可带 docType/summary/status",
      inputSchema: {
        docId: z.string().min(1),
        title: z.string().min(1),
        docType: z.string().optional().describe("文档类型（自由文本，帮助 AI 快速理解文档性质）"),
        summary: z.string().optional().describe("文档摘要（可选，帮助快速理解文档性质）"),
        status: documentStatusSchema.optional(),
        content: z.string()
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return createDocument(ws, args.docId, args.title, args.content, args.docType, args.summary, args.status);
      })
  );

  server.registerTool(
    "update_document_meta",
    {
      title: "更新文档元信息",
      description:
        "更新文档标题/类型/摘要/状态（仅改文档级 meta，不影响分片正文）。" +
        "title 传空串不覆盖；summary 传空串清空摘要；docType 传空串清除类型。" +
        "status 三态：focused 当前聚焦（默认）、maintained 长期更新（最高可信度，需实时维护，涉及变更时应同步更新提醒）、archived 留档（历史/设计回顾，不再更新）",
      inputSchema: {
        docId: z.string().min(1),
        title: z.string().optional(),
        docType: z.string().optional(),
        summary: z.string().optional(),
        status: documentStatusSchema.optional()
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return renameDocument(ws, args.docId, {
          title: args.title,
          docType: args.docType,
          summary: args.summary,
          status: args.status
        });
      })
  );
}
