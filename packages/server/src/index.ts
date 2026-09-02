/**
 * @stagelab/server 包入口：导出可复用的 HTTP / MCP 启动能力，供外部库调用层面使用。
 * CLI 实际入口见 cli.ts（stagelab start/http/mcp），由 bin 指向编译后的 cli.js。
 */
export { createHttpServer, startHttpServer } from "./http/server.js";
export { createMcpServer, startMcpServer } from "./mcp/server.js";
export { main as cliMain } from "./cli.js";