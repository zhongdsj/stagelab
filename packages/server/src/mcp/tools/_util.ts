/**
 * MCP 工具公共工具：错误分类 + 统一调用包装
 *
 * 错误语义分类（开发文档 7.8 / T09 验收标准）：
 * - FileNotFoundError  → 文件不存在
 * - CorruptJsonError  → 数据文件格式损坏（大概率 Git 冲突）
 * - ConflictError     → 写入冲突（磁盘已被外部修改）
 * - 其他              → 通用错误透传 message
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  FileNotFoundError,
  CorruptJsonError,
  ConflictError
} from "../../storage/io.js";
import type { RepoWorkspace } from "../../storage/workspace.js";

/** 错误 → 用户可读中文消息 */
export function classifyError(err: unknown): string {
  if (err instanceof FileNotFoundError) return err.message;
  if (err instanceof CorruptJsonError) return err.message;
  if (err instanceof ConflictError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

/**
 * 统一调用包装：成功 → JSON 文本；失败 → 分类错误消息 + isError
 */
export async function safeCall(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await fn();
    return {
      content: [
        { type: "text", text: data === undefined ? "{}" : JSON.stringify(data, null, 2) }
      ]
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: classifyError(err) }],
      isError: true
    };
  }
}

/** 工作区摘要信息（对外暴露，不含内部结构） */
export function workspaceInfo(ws: RepoWorkspace) {
  return {
    repoRoot: ws.repoRoot,
    projectId: ws.entry.projectId,
    schemaVersion: ws.entry.schemaVersion
  };
}
