/**
 * MCP 工具：文档操作类（开发文档 8.2，共 4 个）
 *
 * get_document_index / read_document_fragment / write_document_fragment / create_document
 * 约束：MCP 不提供全量读取（分层分片按需读取，避免全量拉取大对象，见开发文档 10.2）
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getWorkspace } from "../../storage/workspace.js";
import {
  getDocumentIndex,
  readDocumentFragment,
  writeDocumentFragment,
  createDocument
} from "../../services/document.service.js";
import { safeCall } from "./_util.js";

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
    "write_document_fragment",
    {
      title: "写入/更新文档分片",
      description: "写入/更新文档分片；超长内容自动拆分（单分片不超过 2000 字）",
      inputSchema: {
        docId: z.string().min(1),
        content: z.string(),
        order: z.number().int().nonnegative().optional(),
        title: z.string().optional()
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return writeDocumentFragment(ws, args.docId, args.content, {
          order: args.order,
          title: args.title
        });
      })
  );

  server.registerTool(
    "create_document",
    {
      title: "创建新文档",
      description: "创建新文档（首分片；内容超过 2000 字将截断，请用 write_document_fragment 写入全文）",
      inputSchema: {
        docId: z.string().min(1),
        title: z.string().min(1),
        docType: z.string().optional().describe("文档类型（自由文本，帮助 AI 快速理解文档性质）"),
        content: z.string()
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return createDocument(ws, args.docId, args.title, args.content, args.docType);
      })
  );
}
