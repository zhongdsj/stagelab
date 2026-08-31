/**
 * 实体仓储基类
 *
 * 所有实体仓储继承本类，统一走 T04 文件 IO 安全引擎：
 * - get/save/delete/list 均使用 readJsonFile / writeJsonFile（mtime 失效检测 + 原子写入）
 * - save 支持 baseMtime 冲突检测（读取后修改场景）
 * - 写后触发 onChanged 回调（用于索引联动更新）
 */
import fs from "node:fs";
import { z } from "zod";
import {
  readJsonFile,
  writeJsonFile,
  FileNotFoundError,
  invalidateCache
} from "../io.js";
import { storeSubdir } from "../paths.js";
import type { RepoWorkspace } from "../workspace.js";

/** 实体变更回调（写/删后触发，用于索引联动） */
export type EntityChangedHandler = (repo: string) => void | Promise<void>;

/** 全局变更回调注册（业务层注入，通常指向索引重建） */
let globalChangedHandler: EntityChangedHandler | null = null;

/** 设置全局实体变更回调 */
export function setEntityChangedHandler(handler: EntityChangedHandler | null): void {
  globalChangedHandler = handler;
}

/** 触发变更回调 */
export async function notifyChanged(repoRoot: string): Promise<void> {
  if (globalChangedHandler) {
    await globalChangedHandler(repoRoot);
  }
}

export interface EntityRepositoryOptions<T> {
  /** 实体文件路径（相对仓库）解析 */
  filePath: (repoRoot: string, id: string) => string;
  /** Zod schema 校验 */
  schema: z.ZodType<T>;
  /** 实体 ID 字段名 */
  idField: keyof T & string;
}

/**
 * 通用实体仓储基类
 */
export abstract class EntityRepository<T extends object> {
  protected repoRoot: string;
  private filePath: (repoRoot: string, id: string) => string;
  protected schema: z.ZodType<T>;
  private idField: keyof T & string;

  constructor(workspace: RepoWorkspace, options: EntityRepositoryOptions<T>) {
    this.repoRoot = workspace.repoRoot;
    this.filePath = options.filePath;
    this.schema = options.schema;
    this.idField = options.idField;
  }

  /** 读取单个实体（校验后返回） */
  async get(id: string): Promise<T> {
    const fp = this.filePath(this.repoRoot, id);
    const raw = await readJsonFile<unknown>(fp);
    const parsed = this.schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `实体数据校验失败(${fp}): ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`
      );
    }
    return parsed.data;
  }

  /** 是否存在 */
  async exists(id: string): Promise<boolean> {
    return fs.existsSync(this.filePath(this.repoRoot, id));
  }

  /**
   * 保存实体（写后触发索引联动）
   * @param entity 实体对象（含 ID 字段）
   * @param baseMtime 可选：冲突检测基线（读取后修改场景）
   */
  async save(entity: T, baseMtime?: number): Promise<void> {
    const id = String((entity as Record<string, unknown>)[this.idField]);
    if (!id) {
      throw new Error(`实体缺少 ${String(this.idField)} 字段`);
    }
    const fp = this.filePath(this.repoRoot, id);
    await writeJsonFile(fp, entity, { baseMtime });
    await notifyChanged(this.repoRoot);
  }

  /** 删除实体（写后触发索引联动） */
  async delete(id: string): Promise<void> {
    const fp = this.filePath(this.repoRoot, id);
    if (!fs.existsSync(fp)) {
      throw new FileNotFoundError(fp);
    }
    await fs.promises.unlink(fp);
    invalidateCache(fp); // 删除后清除缓存，避免读取残留旧数据
    await notifyChanged(this.repoRoot);
  }

  /** 列出某目录下全部实体 ID */
  async listIds(subdir: string): Promise<string[]> {
    const dir = storeSubdir(this.repoRoot, subdir);
    if (!fs.existsSync(dir)) return [];
    const files = await fs.promises.readdir(dir);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  }

  /** 批量读取（用于索引重建等） */
  async getAll(subdir: string): Promise<T[]> {
    const ids = await this.listIds(subdir);
    const result: T[] = [];
    for (const id of ids) {
      try {
        result.push(await this.get(id));
      } catch {
        // 单个实体损坏跳过（索引重建容忍）
      }
    }
    return result;
  }
}
