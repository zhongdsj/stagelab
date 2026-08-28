/**
 * MCP 工具注册汇总
 *
 * 开发文档第八章全部工具：项目管理 7 + 文档操作 4 + 需求与任务 7 + 图元操作 5 + 索引查询 2 = 25
 * （另附便捷工具 list_working_repos 用于多仓库管理）
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProjectTools } from "./project.js";
import { registerDocumentTools } from "./document.js";
import { registerRequirementTools } from "./requirement.js";
import { registerDiagramTools } from "./diagram.js";
import { registerSearchTools } from "./search.js";

/** 注册全部 MCP 工具 */
export function registerAllTools(server: McpServer): void {
  registerProjectTools(server);
  registerDocumentTools(server);
  registerRequirementTools(server);
  registerDiagramTools(server);
  registerSearchTools(server);
}
