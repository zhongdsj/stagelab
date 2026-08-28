/**
 * MCP Server：stdio 模式
 *
 * 基于 @modelcontextprotocol/sdk 注册开发文档第八章全部工具。
 * - 直接运行：npx tsx packages/server/src/mcp/server.ts --repo /path/to/repo
 * - 编译运行：node dist/mcp/server.js --repo /path/to/repo
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { registerAllTools } from "./tools/index.js";
import { initFromArgs } from "../services/workspace.service.js";

/** 创建 MCP Server（注册全部工具） */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "fourstage-mcp", version: "0.1.0" });
  registerAllTools(server);
  return server;
}

/** 启动 MCP Server（stdio 模式，支持 --repo 预加载默认仓库） */
export async function startMcpServer(): Promise<void> {
  await initFromArgs(process.argv);
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/** 被直接执行时自动启动 */
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  startMcpServer().catch((err) => {
    console.error("MCP server 启动失败:", err);
    process.exit(1);
  });
}
