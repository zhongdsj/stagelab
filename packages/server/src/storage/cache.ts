/**
 * 短时内存缓存（T04 规范第 2、3 条）
 *
 * - 内存不做永久缓存，使用短 TTL（默认 3s）降低重复 IO
 * - 缓存项记录磁盘 mtime；外部（Git 分支切换等）修改后 mtime 变化，
 *   读取方对比磁盘 mtime 决定是否丢弃缓存
 */
export interface CacheEntry<T> {
  value: T;
  /** 缓存生成时的磁盘 mtime（ms 时间戳） */
  mtime: number;
  /** 缓存写入时间 */
  cachedAt: number;
}

export interface CacheOptions {
  /** TTL 毫秒，默认 3000 */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 3000;

export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private ttlMs: number;

  constructor(options: CacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * 读取缓存：命中且未过期返回缓存；否则返回 null
   * @param key 文件绝对路径
   * @param diskMtime 当前磁盘 mtime（可选，用于检测外部变更）
   */
  get(key: string, diskMtime?: number): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    const expired = Date.now() - entry.cachedAt > this.ttlMs;
    // 磁盘 mtime 较新 → 外部已修改，缓存失效
    const stale =
      diskMtime !== undefined && diskMtime !== null && diskMtime > entry.mtime;

    if (expired || stale) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  /** 写入缓存（记录当前磁盘 mtime） */
  set(key: string, value: T, diskMtime: number): void {
    this.store.set(key, {
      value,
      mtime: diskMtime,
      cachedAt: Date.now()
    });
  }

  /** 主动失效某个 key */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** 清空全部缓存 */
  clear(): void {
    this.store.clear();
  }
}
