/**
 * HTTP 路由：全项目搜索（T5）
 *
 * GET /api/projects/:id/search?q=&types=&limit=
 * - 只搜索本项目（D2），不跨仓库
 * - q 为空/纯空白 → 返回 []（不报错，前端空串不发请求亦兼容）
 * - q 超过 100 字截断（防止超长输入拖慢全文扫描）
 * - types 逗号分隔，非法值忽略；全部非法时等于不过滤
 * - limit 默认 30，范围 1..200
 * - 出参为 richer 结果（含 kind/snippet/ranges/定位字段），不改动 MCP 搜索出参（D3）
 */
import type { FastifyInstance } from "fastify";
import {
  searchProjectContentRich,
  type RichSearchKind
} from "../../services/index.service.js";
import { requireWorkspaceByProjectId } from "./_util.js";

/** 允许的搜索类型（与 RichSearchKind 保持一致） */
const VALID_KINDS: readonly RichSearchKind[] = [
  "document",
  "fragment",
  "diagram",
  "requirement",
  "task"
];

/** 关键词最大长度（超长截断） */
const MAX_KEYWORD_LENGTH = 100;
/** 默认/上限返回条数 */
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;

/** 解析 types 查询参数：支持 "task,fragment" 或重复参数，忽略非法值 */
function parseTypes(raw: unknown): RichSearchKind[] | undefined {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const kinds = parts
    .map((p) => String(p).trim())
    .filter((p): p is RichSearchKind => (VALID_KINDS as readonly string[]).includes(p));
  if (kinds.length === 0) return undefined;
  return [...new Set(kinds)];
}

/** 解析 limit：非法/缺省回退默认值，越界收敛到 1..200 */
function parseLimit(raw: unknown): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

/** 注册搜索路由 */
export function registerSearchRoutes(app: FastifyInstance): void {
  app.get("/api/projects/:id/search", async (request) => {
    const { id } = request.params as { id: string };
    const query = (request.query ?? {}) as Record<string, unknown>;
    const keyword = String(query.q ?? "").trim().slice(0, MAX_KEYWORD_LENGTH);
    if (!keyword) return [];
    const ws = requireWorkspaceByProjectId(id);
    return searchProjectContentRich(ws, keyword, {
      types: parseTypes(query.types),
      limit: parseLimit(query.limit)
    });
  });
}
