/**
 * HTTP 客户端封装（对接 T10 Fastify API）
 *
 * - fetch 统一封装：JSON 序列化/反序列化、204 处理
 * - 错误透传：后端 { error: string } 消息转为 ApiError（携带状态码）
 * - baseURL 走 vite 代理：/api → http://localhost:3000
 */

/** 后端错误响应体结构 */
export interface ApiErrorBody {
  error: string;
}

/** 请求失败异常（携带 HTTP 状态码与后端错误消息） */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** 基础请求：POST/PUT 携带 JSON body，非 2xx 抛 ApiError */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // 仅当请求携带 body 时设置 JSON 内容类型头；
  // GET/DELETE 等无 body 请求若带该头，Fastify 会因空 body 报错（问题1）
  const headers = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body != null && !("Content-Type" in headers)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...init, headers });

  // 204 无内容
  if (res.status === 204) {
    return undefined as T;
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* 非 JSON 响应体，忽略 */
  }

  if (!res.ok) {
    const message = (body as ApiErrorBody)?.error ?? `请求失败 (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return body as T;
}

/** 请求方法集合 */
export const http = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(data ?? {}) }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(data ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" })
};
