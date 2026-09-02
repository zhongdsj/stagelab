#!/usr/bin/env node
/**
 * fourstage 统一 CLI 入口
 *
 * 子命令：
 * - start: 启动 HTTP 服务并托管 Web 界面（默认端口 6327），不启动 MCP
 * - http:  仅启动 HTTP API 服务（不托管 Web 界面）
 * - mcp:   启动 MCP stdio 服务（供 AI 客户端接入）
 *
 * 参数：
 * - --port <n>    HTTP 端口（默认 6327，也可用环境变量 PORT）
 * - --data <dir>  数据根目录（默认 %APPDATA%/fourstage；项目数据仍存各自 repo/.fourstage）
 * - --repo <path> 预加载指定仓库
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startHttpServer } from "./http/server.js";
import { startMcpServer } from "./mcp/server.js";

/** HTTP 默认端口 */
export const DEFAULT_PORT = 6327;

/** 读取 --name 选项值 */
function option(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

/** 安全转数字 */
function toNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isNaN(n) ? fallback : n;
}

/** 打印使用说明 */
function printUsage(): void {
  process.stdout.write(`fourstage - 四阶段 MCP 项目管理工具

用法:
  fourstage start [--port <n>] [--data <dir>] [--repo <path>]  启动 HTTP 服务并托管 Web 界面
  fourstage http  [--port <n>] [--data <dir>] [--repo <path>]  仅启动 HTTP API 服务
  fourstage mcp   [--data <dir>] [--repo <path>]               启动 MCP stdio 服务（供 AI 客户端接入）

选项:
  --port <n>    HTTP 端口（默认 ${DEFAULT_PORT}，也可用环境变量 PORT）
  --data <dir>  数据根目录（默认 %APPDATA%/fourstage；项目数据仍存各自 repo/.fourstage）
  --repo <path> 预加载指定仓库

示例:
  fourstage start
  fourstage mcp --repo /path/to/repo
`);
}

/** CLI 主入口 */
export function main(): void {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd) {
    printUsage();
    return;
  }
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    printUsage();
    return;
  }

  // --data 必须在任何注册表读取之前设置（registryFilePath 运行时读 env）
  const dataDir = option(args, "--data");
  if (dataDir) process.env.FOURSTAGE_DATA_DIR = path.resolve(dataDir);

  if (cmd === "start" || cmd === "http") {
    const port = toNumber(option(args, "--port"), DEFAULT_PORT);
    // start 托管 Web 界面（server+web）；http 仅暴露 API
    startHttpServer({ port, serveWeb: cmd === "start" }).catch((err) => {
      console.error(`fourstage ${cmd} 启动失败:`, err);
      process.exit(1);
    });
    return;
  }

  if (cmd === "mcp") {
    startMcpServer().catch((err) => {
      console.error("fourstage mcp 启动失败:", err);
      process.exit(1);
    });
    return;
  }

  console.error(`未知命令: ${cmd}`);
  printUsage();
  process.exit(1);
}

/** 被直接执行时自动启动 */
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main();
}