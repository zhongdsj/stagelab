/**
 * 文件 IO 安全引擎（T04 核心）
 *
 * 整合开发文档 7.4 全部强制规范：
 * 1. 禁止长期持有文件句柄：读→open→read→立即close；写→open→write→立即close
 * 2. 内存不做永久缓存：短 TTL 缓存（默认 3s）降低重复 IO
 * 3. 外部变更检测：读取前比较磁盘 mtime 与缓存 mtime，磁盘较新则重载
 * 4. 安全写入：临时文件 + fsync + 原子 rename，禁止原地覆写
 * 5. 短持有文件锁：.write.lock 仅写入期间持有
 * 6. 冲突拒绝：拿到锁后磁盘 mtime 大于内存版本 → 拒绝写入返回冲突
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { TtlCache } from "./cache.js";
import { withLock } from "./lock.js";

/** 写入冲突错误 */
export class ConflictError extends Error {
  constructor(filePath: string) {
    super(
      `文件已被外部修改（磁盘 mtime 新于内存版本），已拒绝覆盖: ${filePath}`
    );
    this.name = "ConflictError";
  }
}

/** 文件不存在错误 */
export class FileNotFoundError extends Error {
  constructor(filePath: string) {
    super(`文件不存在: ${filePath}`);
    this.name = "FileNotFoundError";
  }
}

/** 文件格式损坏错误（大概率 Git 冲突标记） */
export class CorruptJsonError extends Error {
  constructor(filePath: string, cause?: unknown) {
    super(
      `数据文件格式损坏，请手动解决 git 冲突后继续: ${filePath}` +
        (cause ? ` (${String(cause)})` : "")
    );
    this.name = "CorruptJsonError";
  }
}

/** 读取缓存（全局，按文件路径） */
const readCache = new TtlCache<unknown>();

/** 文件锁路径提供函数（由存储层注入，默认取同目录 .write.lock） */
let lockPathProvider: ((filePath: string) => string) | null = null;

/**
 * 设置锁路径提供函数
 * @param provider 根据目标文件路径返回锁文件路径
 */
export function setLockPathProvider(
  provider: (filePath: string) => string
): void {
  lockPathProvider = provider;
}

function resolveLockPath(filePath: string): string {
  if (lockPathProvider) return lockPathProvider(filePath);
  return path.join(path.dirname(filePath), ".write.lock");
}

/** 获取文件 mtime（ms）。不存在返回 0 */
async function getMtimeMs(filePath: string): Promise<number> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * 读取 JSON 文件（带缓存 + mtime 失效检测）
 * - 读 → open → read → 立即 close，不常驻 fd
 * - 命中短 TTL 缓存且磁盘 mtime 未变 → 直接返回缓存
 * - 磁盘 mtime 变化（Git 切换分支等）→ 丢弃缓存重新加载
 */
export async function readJsonFile<T>(filePath: string): Promise<T> {
  const diskMtime = await getMtimeMs(filePath);

  // 缓存命中（未过期且磁盘未变）
  const cached = readCache.get(filePath, diskMtime);
  if (cached !== null && cached !== undefined) {
    return cached as T;
  }

  if (diskMtime === 0) {
    throw new FileNotFoundError(filePath);
  }

  // 读 → 立即 close
  const raw = await fs.promises.readFile(filePath, "utf-8");

  let parsed: T;
  try {
    parsed = JSON.parse(raw) as T;
  } catch (e) {
    throw new CorruptJsonError(filePath, e);
  }

  readCache.set(filePath, parsed, diskMtime);
  return parsed;
}

/** 清除单个文件缓存（写入后调用，保证后续读取拿到新数据） */
export function invalidateCache(filePath: string): void {
  readCache.invalidate(filePath);
}

/** 清除全部缓存 */
export function clearCache(): void {
  readCache.clear();
}

/**
 * 安全写入 JSON 文件（T04 规范 4、5、6）
 *
 * 流程：加短锁 → 冲突检测 → 写临时文件 → fsync → 原子 rename → 释放锁
 *
 * @param filePath 目标文件
 * @param data 要写入的数据
 * @param options
 *   - baseMtime: 调用方持有的"基线 mtime"，用于冲突检测；
 *     若磁盘当前 mtime 新于 baseMtime，说明外部已修改，拒绝写入
 *   - lockPath: 自定义锁路径（默认由 provider 解析）
 */
export async function writeJsonFile(
  filePath: string,
  data: unknown,
  options: { baseMtime?: number; lockPath?: string } = {}
): Promise<void> {
  const lockPath = options.lockPath ?? resolveLockPath(filePath);
  const serialized = JSON.stringify(data, null, 2);

  await withLock(lockPath, async () => {
    // 冲突检测：磁盘 mtime 新于基线 → 拒绝覆盖
    if (options.baseMtime !== undefined) {
      const diskMtime = await getMtimeMs(filePath);
      if (diskMtime > options.baseMtime) {
        throw new ConflictError(filePath);
      }
    }

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    // 写临时文件 + fsync + 原子 rename
    const tmpPath = path.join(
      path.dirname(filePath),
      `${path.basename(filePath)}.tmp-${crypto.randomBytes(6).toString("hex")}`
    );

    // 打开临时文件（仅写期间持有 fd，写完立即 close）
    const fh = await fs.promises.open(tmpPath, "w");
    try {
      await fh.writeFile(serialized, "utf-8");
      await fh.sync(); // fsync 确保落盘完整
    } finally {
      await fh.close(); // 立即 close，不长期持有 fd
    }

    // 原子 rename 覆盖正式文件
    await fs.promises.rename(tmpPath, filePath);

    // 清理缓存，确保后续读取拿到新数据
    invalidateCache(filePath);
  });
}

/** 判断文件是否存在 */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}
