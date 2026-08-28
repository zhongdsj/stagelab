/**
 * HTTP 路由公共工具：错误分类 + 工作区解析
 *
 * 错误 → HTTP 状态码：
 * - FileNotFoundError → 404
 * - CorruptJsonError（Git 冲突/损坏）→ 422
 * - ConflictError → 409
 * - HttpError → 自定义状态码
 * - 其他 → 500
 */
import {
  FileNotFoundError,
  CorruptJsonError,
  ConflictError
} from "../../storage/io.js";
import {
  listWorkspaces,
  getWorkspace,
  type RepoWorkspace
} from "../../storage/workspace.js";

/** HTTP 层错误（携带状态码） */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** 存储层错误 → HTTP 状态码 */
export function errorStatus(err: unknown): number {
  if (err instanceof FileNotFoundError) return 404;
  if (err instanceof CorruptJsonError) return 422;
  if (err instanceof ConflictError) return 409;
  return 500;
}

/** 错误 → 用户可读消息 */
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 按 projectId 查找已加载工作区（找不到 → 404） */
export function requireWorkspaceByProjectId(projectId: string): RepoWorkspace {
  const ws = listWorkspaces().find((w) => w.entry.projectId === projectId);
  if (!ws) throw new HttpError(404, `项目不存在或未加载: ${projectId}`);
  return ws;
}

/** 获取当前工作仓库（未加载 → 400，提示用 repoRoot 指定） */
export async function requireCurrentWorkspace(): Promise<RepoWorkspace> {
  try {
    return await getWorkspace();
  } catch {
    throw new HttpError(400, "未加载任何仓库，请通过 repoRoot 指定或先加载仓库");
  }
}
