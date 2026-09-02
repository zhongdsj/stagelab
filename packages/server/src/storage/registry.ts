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
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 注册表目录名 */
const REGISTRY_DIR = "stagelab";
/** 注册表文件名 */
const REGISTRY_FILE = "registry.json";
/** 注册表 schema 版本 */
const REGISTRY_VERSION = 1;

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

/** 原子写入注册表（临时文件 + rename） */
function saveRegistry(data: RegistryData): void {
  const fp = registryFilePath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, fp);
}

/** 幂等登记仓库地址（已存在则更新时间戳） */
export function registerRepo(repoRoot: string): void {
  const data = loadRegistry();
  const normalized = path.resolve(repoRoot);
  const idx = data.repos.findIndex((r) => path.resolve(r.repoRoot) === normalized);
  if (idx >= 0) {
    data.repos[idx].openedAt = Date.now();
  } else {
    data.repos.push({ repoRoot: normalized, openedAt: Date.now() });
  }
  saveRegistry(data);
}

/** 移除仓库地址 */
export function removeRepo(repoRoot: string): void {
  const data = loadRegistry();
  const normalized = path.resolve(repoRoot);
  data.repos = data.repos.filter((r) => path.resolve(r.repoRoot) !== normalized);
  saveRegistry(data);
}

/** 列出全部登记仓库（规范化后的绝对路径） */
export function listRegisteredRepos(): string[] {
  return loadRegistry().repos.map((r) => path.resolve(r.repoRoot));
}

/** 用有效仓库列表整体覆盖注册表（启动清理失效项后调用） */
export function replaceRegistryRepos(repoRoots: string[]): void {
  const data: RegistryData = {
    version: REGISTRY_VERSION,
    repos: repoRoots.map((root) => ({
      repoRoot: path.resolve(root),
      openedAt: Date.now()
    }))
  };
  saveRegistry(data);
}
