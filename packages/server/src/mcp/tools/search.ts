/**
 * MCP 工具：索引查询类（开发文档 8.5，共 2 个）
 *
 * get_project_index / search_project_content
 *
 * 遵循索引优先约束：批量查询先走索引，不加载全量对象。
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getWorkspace } from "../../storage/workspace.js";
import {
  getProjectIndex,
  searchProjectContent
} from "../../services/index.service.js";
import { safeCall } from "./_util.js";

const EntityTypeSchema = z.enum(["document", "diagram", "requirement", "task"]);

/** 注册索引查询类工具 */
export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    "get_project_index",
    {
      title: "获取项目索引",
      description:
        "获取项目完整索引（轻量摘要，含需求/任务两级索引），用于分层访问第一层"
    },
    async () =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return getProjectIndex(ws);
      })
  );

  server.registerTool(
    "search_project_content",
    {
      title: "关键词搜索项目内容",
      description:
        "按关键词搜索项目内文档、图元、需求、任务，返回匹配 ID 列表；可限定搜索范围",
      inputSchema: {
        keyword: z.string().min(1),
        entityTypes: z.array(EntityTypeSchema).optional()
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return searchProjectContent(ws, args.keyword, args.entityTypes);
      })
  );
}
