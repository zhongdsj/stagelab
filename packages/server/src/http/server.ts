/**
 * HTTP API 服务（T10）
 *
 * 基于 Fastify 实现开发文档第九章全部路由，委托业务服务层与布局引擎。
 * - 路由：项目列表/创建/详情/切阶段/索引、图布局、文档分片列表/读取
 * - 跨域：onSend hook 注入 CORS 头，OPTIONS 预检 204（前端跨域可用）
 * - 错误：setErrorHandler 统一映射（文件不存在 404 / 格式损坏 422 / 冲突 409）
 *
 * 启动：
 * - 直接运行：npx tsx packages/server/src/http/server.ts --repo /path/to/repo
 * - 编译运行：node dist/http/server.js --repo /path/to/repo
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { pathToFileURL } from "node:url";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerDiagramRoutes } from "./routes/diagrams.js";
import { registerRequirementRoutes } from "./routes/requirements.js";
import { HttpError, errorStatus, messageOf } from "./routes/_util.js";
import { initFromArgs } from "../services/workspace.service.js";
import { log } from "../logger.js";

/** 请求开始时间记录（用于计算耗时） */
const requestTimers = new WeakMap<FastifyRequest, number>();

/** 创建 Fastify 实例（注册 CORS、错误处理与全部路由） */
export function createHttpServer(): FastifyInstance {
  const app = Fastify({ logger: false });

  // 请求日志：记录每个请求的方法/路径/状态码/耗时
  app.addHook("onRequest", async (request) => {
    requestTimers.set(request, Date.now());
  });
  app.addHook("onResponse", async (request, reply) => {
    const start = requestTimers.get(request) ?? Date.now();
    const ms = Date.now() - start;
    log("http", `${request.method} ${request.url} -> ${reply.statusCode} (${ms}ms)`);
  });

  // CORS：预检请求直接 204
  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "OPTIONS") {
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      reply.code(204).send();
      return reply;
    }
  });

  // CORS：所有响应注入允许跨域头
  app.addHook("onSend", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  });

  // 统一错误处理：分类错误 → 状态码 + 消息
  app.setErrorHandler((err, _request, reply) => {
    const status = err instanceof HttpError ? err.status : errorStatus(err);
    reply.code(status).send({ error: messageOf(err) });
  });

  registerProjectRoutes(app);
  registerDocumentRoutes(app);
  registerDiagramRoutes(app);
  registerRequirementRoutes(app);

  return app;
}

/** 启动 HTTP 服务（--repo 预加载默认仓库） */
export async function startHttpServer(options: { port?: number } = {}): Promise<FastifyInstance> {
  await initFromArgs(process.argv);
  const app = createHttpServer();
  // 停止日志需在 listen() 之前注册，Fastify 一旦开始监听便禁止新增 hook
  app.addHook("onClose", () => {
    log("http", "HTTP server 已停止");
  });
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  log("http", `HTTP server 已启动: http://localhost:${port}`);
  return app;
}

/** 被直接执行时自动启动 */
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  startHttpServer().catch((err) => {
    console.error("HTTP server 启动失败:", err);
    process.exit(1);
  });
}
