/**
 * 仓库入口层：Git 仓库与工具项目绑定
 *
 * 对应开发文档 7.1/7.3：
 * - 每个 Git 仓库最多对应一个工具 Project 项目
 * - 仓库根生成 .stagelab/project.meta.json 作为入口元文件
 * - 支持多仓库实例管理
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  stagelabRoot,
  storeRoot,
  storeSubdir,
  repoEntryPath,
  REPO_ENTRY_FILE,
  STORE_DIR,
  STORE_SUBDIRS
} from "./paths.js";

/** 仓库入口元数据结构（对应 7.3 RepoEntryMeta） */
export interface RepoEntryMeta {
  schemaVersion: string;
  projectId: string;
  storeDir: string;
  createdAt: number;
}

/** 当前 schema 版本 */
export const SCHEMA_VERSION = "1.0.0";

/** 生成项目 ID */
export function generateProjectId(): string {
  return crypto.randomUUID();
}

/**
 * 初始化仓库：在仓库根生成 .stagelab/project.meta.json 与 store 完整目录树
 * @param repoRoot 业务 Git 仓库根路径
 * @returns 生成的入口元数据
 */
export async function initRepo(repoRoot: string): Promise<RepoEntryMeta> {
  const fsRoot = stagelabRoot(repoRoot);

  // 已存在则不重复初始化（保留原 projectId）
  const existing = await loadRepoEntry(repoRoot);
  if (existing) {
    // 补全缺失的 store 子目录（幂等）
    await ensureStoreDirs(repoRoot);
    return existing;
  }

  const entry: RepoEntryMeta = {
    schemaVersion: SCHEMA_VERSION,
    projectId: generateProjectId(),
    storeDir: `./${STORE_DIR}`,
    createdAt: Date.now()
  };

  await fs.promises.mkdir(fsRoot, { recursive: true });
  await fs.promises.mkdir(storeRoot(repoRoot), { recursive: true });
  await ensureStoreDirs(repoRoot);

  // 写入口文件
  await fs.promises.writeFile(
    repoEntryPath(repoRoot),
    JSON.stringify(entry, null, 2),
    "utf-8"
  );

  return entry;
}

/** 确保 store 全部子目录存在（幂等） */
async function ensureStoreDirs(repoRoot: string): Promise<void> {
  for (const sub of STORE_SUBDIRS) {
    await fs.promises.mkdir(storeSubdir(repoRoot, sub), { recursive: true });
  }
}

/**
 * 加载仓库入口元数据
 * @returns 入口元数据；若 .stagelab 不存在或未初始化返回 null
 */
export async function loadRepoEntry(
  repoRoot: string
): Promise<RepoEntryMeta | null> {
  const entryPath = repoEntryPath(repoRoot);
  try {
    const raw = await fs.promises.readFile(entryPath, "utf-8");
    const parsed = JSON.parse(raw) as RepoEntryMeta;
    // 基础合法性校验
    if (!parsed.schemaVersion || !parsed.projectId || !parsed.storeDir) {
      return null;
    }
    return parsed;
  } catch {
    // 文件不存在或损坏均视为未初始化
    return null;
  }
}

/** 判断仓库是否已初始化（.stagelab/project.meta.json 存在） */
export function isRepoInitialized(repoRoot: string): boolean {
  return fs.existsSync(repoEntryPath(repoRoot));
}

/** 仓库是否是一个 Git 仓库（存在 .git 目录） */
export function isGitRepo(repoRoot: string): boolean {
  return fs.existsSync(path.join(repoRoot, ".git"));
}
