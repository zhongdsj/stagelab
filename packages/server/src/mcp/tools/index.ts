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
import { errLog } from "../../logger.js";

/** 注册全部 MCP 工具 */
export function registerAllTools(server: McpServer): void {
  registerAllToolsWithLog(server, "");
}

/**
 * 注册全部工具并注入调用日志（MCP stdio 协议日志写 stderr，避免污染 stdout 协议通道）
 * @param server      MCP 服务实例
 * @param scopePrefix 日志范围前缀，如 mcp/project
 * @param hooks       可选日志钩子（start/end/error），用于统一记录工具调用
 */
export function registerAllToolsWithLog(
  server: McpServer,
  scopePrefix: string,
  hooks?: {
    onCall?: (tool: string, args: unknown) => void;
    onDone?: (tool: string) => void;
    onError?: (tool: string, err: unknown) => void;
  }
): void {
  // 在 server 上包装 registerTool，统一加日志
  const wrapped = new Proxy(server, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver);
      if (prop === "registerTool" && typeof val === "function") {
        return (name: string, ...rest: unknown[]) => {
          const opts = (rest[0] as { description?: string }) ?? {};
          const execute = (rest[rest.length - 1] as (args: unknown) => Promise<unknown>) as (
            args: unknown
          ) => unknown;
          const logged = (async (args: unknown) => {
            const scope = scopePrefix ? `${scopePrefix}/${name}` : `mcp/${name}`;
            if (hooks?.onCall) hooks.onCall(name, args);
            else errLog(scope, `调用 -> ${JSON.stringify(args ?? {})}`);
            try {
              const result = await execute(args);
              if (hooks?.onDone) hooks.onDone(name);
              else errLog(scope, "完成");
              return result;
            } catch (e) {
              if (hooks?.onError) hooks.onError(name, e);
              else errLog(scope, `失败: ${e instanceof Error ? e.message : String(e)}`);
              throw e;
            }
          }) as typeof execute;
          return val.call(target, name, opts, logged);
        };
      }
      return val;
    }
  }) as McpServer;

  registerProjectTools(wrapped);
  registerDocumentTools(wrapped);
  registerRequirementTools(wrapped);
  registerDiagramTools(wrapped);
  registerSearchTools(wrapped);
}
