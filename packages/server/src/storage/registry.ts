/**
 * 仓库注册表（Registry）
 *
 * 持久化记录"已打开过的仓库地址"，解决服务重启后内存工作区丢失、
 * 项目列表无法自动恢复的问题：
 * - 存储于用户级目录（优先 %APPDATA%/stagelab/registry.json，回退用户主目录）
 * - openWorkspace 成功时登记仓库地址
 * - 启动时读取注册表，逐个校验仓库有效性并加载，自动清理失效项
 *
 * 设计约束：只登记用户显式操作过的仓库，不做全盘递归扫描，安全可控。
 *
 * 写入完整性约定（feature/registry-write-integrity）：
 * - 所有写操作先取跨进程文件锁，锁内重读 → 修改 → 落盘，消除多进程读-改-写竞态
 * - 清理失效项只做「增量删除」，不再用内存快照整体覆盖（那是项目记录丢失的根因）
 * - 原子写（tmp + rename）失败有限重试，并回收本次调用自己创建的 tmp
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withLock } from "./lock.js";

/** 注册表目录名 */
const REGISTRY_DIR = "stagelab";
/** 注册表文件名 */
const REGISTRY_FILE = "registry.json";
/** 注册表 schema 版本 */
const REGISTRY_VERSION = 1;
/** rename 失败重试次数（Windows 上目标被句柄占用会抛 EPERM/EBUSY） */
const RENAME_RETRY_ATTEMPTS = 5;
/** rename 重试基础退避 ms（按次数线性递增） */
const RENAME_RETRY_BACKOFF_MS = 20;

/** 注册表结构 */
export interface RegistryData {
  version: number;
  repos: RegistryRepo[];
}

/** 单条仓库记录 */
export interface RegistryRepo {
  repoRoot: string;
  openedAt: number;
}

/** 注册表文件路径（优先 --data/STAGELAB_DATA_DIR，其次 %APPDATA%，回退用户主目录） */
export function registryFilePath(): string {
  const dataDir = process.env.STAGELAB_DATA_DIR;
  if (dataDir && dataDir.length > 0) {
    return path.join(dataDir, REGISTRY_FILE);
  }
  const base =
    process.env.APPDATA && process.env.APPDATA.length > 0
      ? path.join(process.env.APPDATA, REGISTRY_DIR)
      : path.join(os.homedir(), `.${REGISTRY_DIR}`);
  return path.join(base, REGISTRY_FILE);
}

/** 读取注册表（文件不存在或损坏时返回空注册表） */
export function loadRegistry(): RegistryData {
  try {
    const fp = registryFilePath();
    if (!fs.existsSync(fp)) {
      return { version: REGISTRY_VERSION, repos: [] };
    }
    const raw = JSON.parse(fs.readFileSync(fp, "utf-8")) as Partial<RegistryData>;
    return {
      version: raw.version ?? REGISTRY_VERSION,
      repos: Array.isArray(raw.repos) ? raw.repos : []
    };
  } catch {
    // 注册表损坏视为空，避免阻塞启动
    return { version: REGISTRY_VERSION, repos: [] };
  }
}

/** 注册表写锁路径（与 registry.json 同目录，跨进程互斥） */
function registryLockPath(): string {
  return `${registryFilePath()}.write.lock`;
}

/** 同步睡眠（仅用于 rename 重试退避，Node 主线程允许 Atomics.wait） */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** rename 覆盖写：仅对「文件被占用」类错误退避重试，其余错误直接抛出 */
function renameWithRetry(tmp: string, target: string): void {
  let lastErr: unknown;
  for (let i = 0; i < RENAME_RETRY_ATTEMPTS; i += 1) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw err;
      sleepSync(RENAME_RETRY_BACKOFF_MS * (i + 1));
    }
  }
  throw lastErr;
}

/**
 * 原子写入注册表（临时文件 + rename）
 *
 * - rename 失败有限重试，缓解 Windows 句柄占用导致的 EPERM/EBUSY
 * - try/finally 保证本次调用失败时回收「本次自己创建」的 tmp（不涉历史孤儿）
 */
function saveRegistry(data: RegistryData): void {
  const fp = registryFilePath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  try {
    renameWithRetry(tmp, fp);
  } finally {
    // rename 成功后 tmp 已不存在；失败则回收本次创建的残留，避免堆积
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // 回收失败不影响主流程（历史孤儿由手动清理入口处理）
    }
  }
}

/** 幂等登记仓库地址（已存在则更新时间戳）；锁内重读，避免多进程并发丢记录 */
export async function registerRepo(repoRoot: string): Promise<void> {
  const normalized = path.resolve(repoRoot);
  await withLock(registryLockPath(), async () => {
    const data = loadRegistry();
    const idx = data.repos.findIndex(
      (r) => path.resolve(r.repoRoot) === normalized
    );
    if (idx >= 0) {
      data.repos[idx].openedAt = Date.now();
    } else {
      data.repos.push({ repoRoot: normalized, openedAt: Date.now() });
    }
    saveRegistry(data);
  });
}

/** 移除仓库地址（无命中则不写盘） */
export async function removeRepo(repoRoot: string): Promise<void> {
  const normalized = path.resolve(repoRoot);
  await withLock(registryLockPath(), async () => {
    const data = loadRegistry();
    const before = data.repos.length;
    data.repos = data.repos.filter(
      (r) => path.resolve(r.repoRoot) !== normalized
    );
    if (data.repos.length === before) return;
    saveRegistry(data);
  });
}

/** 列出全部登记仓库（规范化后的绝对路径） */
export function listRegisteredRepos(): string[] {
  return loadRegistry().repos.map((r) => path.resolve(r.repoRoot));
}

/**
 * 增量删除失效仓库（只删除传入的失效路径）
 *
 * 替代原「用内存快照整体覆盖」的写法：整体覆盖会在读快照→写盘窗口内
 * 抹掉其他进程新注册的记录（路径 B 丢记录），故只做定向删除。
 * 传入空数组或未命中任何记录时不写盘，避免无谓写与竞态窗口。
 */
export async function pruneRegistryRepos(
  invalidRepoRoots: string[]
): Promise<void> {
  if (invalidRepoRoots.length === 0) return;
  const drop = new Set(invalidRepoRoots.map((r) => path.resolve(r)));
  await withLock(registryLockPath(), async () => {
    const data = loadRegistry();
    const before = data.repos.length;
    data.repos = data.repos.filter((r) => !drop.has(path.resolve(r.repoRoot)));
    if (data.repos.length === before) return;
    saveRegistry(data);
  });
}
