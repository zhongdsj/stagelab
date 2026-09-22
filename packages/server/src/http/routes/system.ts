/**
 * HTTP 路由：系统级运维（registry 临时文件手动清理，G1）
 *
 * GET    /api/system/registry-tmp           列出 registry 临时文件
 * DELETE /api/system/registry-tmp?name=xxx  删除单个临时文件
 * DELETE /api/system/registry-tmp/all       清空全部临时文件
 *
 * 安全约束（红线）：
 * - 仅接受白名单文件名（与 saveRegistry 命名一致：registry.json.tmp-<时间戳>-<随机串>）
 * - 拼接后的绝对路径必须仍位于注册表目录下，拒绝 `..` / 绝对路径 / 子目录
 * - 不做任何自动清理：仅在收到显式请求时删除
 */
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { registryFilePath } from "../../storage/registry.js";
import { HttpError } from "./_util.js";

/** 临时文件白名单：与 saveRegistry 的 tmp 命名保持一致 */
const TMP_NAME_RE = /^registry\.json\.tmp-\d+-[a-z0-9]+$/;

/** registry 临时文件所在目录（复用 registryFilePath 定位，含 STAGELAB_DATA_DIR 覆盖） */
function registryDir(): string {
  return path.resolve(path.dirname(registryFilePath()));
}

/**
 * 校验文件名并解析为绝对路径（非法则抛 400）
 * 双重校验：正则白名单 + path.resolve 后的父目录前缀比对
 */
function resolveTmpFile(name: string): string {
  if (!TMP_NAME_RE.test(name)) {
    throw new HttpError(400, `非法文件名: ${name}`);
  }
  const dir = registryDir();
  const full = path.resolve(dir, name);
  // 前缀校验：解析后必须仍直接落在注册表目录内（防路径穿越）
  if (path.dirname(full) !== dir) {
    throw new HttpError(400, `非法文件路径: ${name}`);
  }
  return full;
}

/** 列出 registry 临时文件（时间优先取文件名内时间戳，回退文件 mtime） */
function listRegistryTmp() {
  const dir = registryDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => TMP_NAME_RE.test(n))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      const ts = Number(name.split("-")[1]);
      return {
        name,
        size: stat.size,
        createdAt: Number.isFinite(ts) ? ts : stat.mtimeMs
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** 注册系统级路由 */
export function registerSystemRoutes(app: FastifyInstance): void {
  // 列表
  app.get("/api/system/registry-tmp", async () => listRegistryTmp());

  // 清空全部（静态路径，与单删路由互不冲突）
  app.delete("/api/system/registry-tmp/all", async () => {
    const files = listRegistryTmp();
    let deleted = 0;
    for (const f of files) {
      try {
        fs.unlinkSync(path.join(registryDir(), f.name));
        deleted += 1;
      } catch {
        // 单个文件删除失败（被占用等）不阻塞其余清理
      }
    }
    return { deleted, total: files.length };
  });

  // 删除单个（按 name 白名单）
  app.delete("/api/system/registry-tmp", async (request) => {
    const name = (request.query as { name?: string } | undefined)?.name;
    if (!name) {
      throw new HttpError(400, "name 必填");
    }
    const full = resolveTmpFile(name);
    if (!fs.existsSync(full)) {
      throw new HttpError(404, `临时文件不存在: ${name}`);
    }
    fs.unlinkSync(full);
    return { name, deleted: true };
  });
}
