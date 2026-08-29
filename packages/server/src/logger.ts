/**
 * 轻量日志工具
 *
 * 统一时间戳 + 范围前缀，供 HTTP / MCP 等模块输出运行日志。
 * 关键约定：
 * - 普通进程（HTTP server）日志写 stdout（log）
 * - MCP 进程走 stdio 协议，stdout 是协议消息通道，日志必须写 stderr（errLog），
 *   否则会污染协议流导致客户端解析失败
 */
function fmt(): string {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

/** 控制台日志（写 stdout，HTTP / 普通进程使用） */
export function log(scope: string, message: string): void {
  console.log(`[${fmt()}] [${scope}] ${message}`);
}

/** stderr 日志（MCP 进程使用，避免污染 stdio 协议通道） */
export function errLog(scope: string, message: string): void {
  console.error(`[${fmt()}] [${scope}] ${message}`);
}
