/**
 * 文件锁（T04 规范第 5、6 条）
 *
 * - 使用 .write.lock 文件，仅在写入期间短暂持有，写入完成立即释放
 * - 锁只做互斥，绝对不长期持有
 * - 用 fs.open 'wx' 原子创建实现互斥（多进程安全）
 * - 带超时与 stale 锁检测（进程崩溃后遗留锁文件自动回收）
 */
import fs from "node:fs";
import path from "node:path";

export interface LockOptions {
  /** 获取锁的超时 ms，默认 5000 */
  acquireTimeoutMs?: number;
  /** stale 锁判定阈值 ms，默认 10000（超过视为遗留锁可回收） */
  staleMs?: number;
  /** 轮询间隔 ms，默认 50 */
  pollIntervalMs?: number;
}

const DEFAULT_ACQUIRE_TIMEOUT = 5000;
const DEFAULT_STALE_MS = 10000;
const DEFAULT_POLL_INTERVAL = 50;

/** 锁内容：记录持有时间，用于 stale 判定 */
interface LockMeta {
  pid: number;
  acquiredAt: number;
}

/** 获取锁（阻塞等待），返回释放函数 */
export async function acquireLock(
  lockPath: string,
  options: LockOptions = {}
): Promise<() => Promise<void>> {
  const acquireTimeout = options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const pollInterval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;

  const start = Date.now();

  // 确保锁文件所在目录存在
  await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      // 'wx'：文件不存在才创建 → 原子互斥
      const meta: LockMeta = {
        pid: process.pid,
        acquiredAt: Date.now()
      };
      await fs.promises.writeFile(lockPath, JSON.stringify(meta), {
        flag: "wx"
      });
      // 拿到锁
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          await fs.promises.unlink(lockPath);
        } catch {
          // 已被回收或不存在，忽略
        }
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        // 锁被占用：检查是否 stale
        const stale = await isStale(lockPath, staleMs);
        if (stale) {
          // 回收遗留锁
          try {
            await fs.promises.unlink(lockPath);
          } catch {
            // 竞争：其他进程已回收，继续轮询
          }
        }
        if (Date.now() - start > acquireTimeout) {
          throw new Error(`获取文件锁超时: ${lockPath}`);
        }
        await sleep(pollInterval);
        continue;
      }
      throw err;
    }
  }
}

/** 判断锁文件是否为遗留 stale 锁 */
async function isStale(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const raw = await fs.promises.readFile(lockPath, "utf-8");
    const meta = JSON.parse(raw) as Partial<LockMeta>;
    if (typeof meta.acquiredAt === "number") {
      return Date.now() - meta.acquiredAt > staleMs;
    }
    // 无 meta 信息：用文件 mtime 兜底
    const stat = await fs.promises.stat(lockPath);
    return Date.now() - stat.mtimeMs > staleMs;
  } catch {
    return false; // 文件已被删，无需 stale 判定
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 便捷：执行写操作并在完成后自动释放锁 */
export async function withLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options?: LockOptions
): Promise<T> {
  const release = await acquireLock(lockPath, options);
  try {
    return await fn();
  } finally {
    await release();
  }
}
