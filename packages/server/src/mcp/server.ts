/**
 * MCP Server：stdio 模式
 *
 * 基于 @modelcontextprotocol/sdk 注册开发文档第八章全部工具。
 * - 直接运行：npx tsx packages/server/src/mcp/server.ts --repo /path/to/repo
 * - 编译运行：node dist/mcp/server.js --repo /path/to/repo
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/index.js";
import { initFromArgs } from "../services/workspace.service.js";
import { errLog } from "../logger.js";

/** 创建 MCP Server（注册全部工具） */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "fourstage-mcp", version: "0.1.0" });
  registerAllTools(server);
  return server;
}

/** 启动 MCP Server（stdio 模式，支持 --repo 预加载默认仓库） */
export async function startMcpServer(): Promise<void> {
  // stderr 日志：stdio 协议中 stdout 是协议通道，日志必须走 stderr 才不会污染协议流
  errLog("mcp", "MCP server 正在启动…");
  await initFromArgs(process.argv);
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  errLog("mcp", "MCP server 已连接（stdio 模式），等待客户端调用…");
}
