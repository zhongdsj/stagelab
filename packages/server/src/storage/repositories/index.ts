/**
 * 实体仓储统一出口
 *
 * 为各业务实体提供读写仓储，全部走 T04 文件 IO 安全引擎：
 * - meta（Project）、index、document 分片、diagram、requirement、task、changeRecord、bugRecord
 * - 写后触发索引联动更新（T05 验收标准 2）
 * - requirement 仓储支持 taskIds 增删联动（T05 验收标准 4）
 */
import {
  EntityRepository,
  setEntityChangedHandler,
  notifyChanged,
  type EntityChangedHandler
} from "./base.js";
import {
  ProjectSchema,
  RequirementSchema,
  TaskSchema,
  ChangeRecordSchema,
  BugRecordSchema,
  DiagramSchema,
  DocumentFragmentSchema,
  DocumentMetaSchema
} from "@fourstage/shared";
import fs from "node:fs";
import {
  entityPath,
  storeSubdir,
  documentDir,
  documentFragmentPath,
  documentMetaPath
} from "../paths.js";
import {
  readJsonFile,
  writeJsonFile,
  FileNotFoundError,
  invalidateCache
} from "../io.js";
import type { RepoWorkspace } from "../workspace.js";
import type {
  Project,
  Requirement,
  Task,
  ChangeRecord,
  BugRecord,
  Diagram,
  DocumentFragment,
  DocumentMeta
} from "@fourstage/shared";

/** Project 仓储（meta.json 单文件） */
export class ProjectRepository extends EntityRepository<Project> {
  constructor(workspace: RepoWorkspace) {
    super(workspace, {
      filePath: (repoRoot) => entityPath.meta(repoRoot),
      schema: ProjectSchema,
      idField: "projectId"
    });
  }
}

/** Diagram 图仓储 */
export class DiagramRepository extends EntityRepository<Diagram> {
  constructor(workspace: RepoWorkspace) {
    super(workspace, {
      filePath: (repoRoot, id) => entityPath.diagram(repoRoot, id),
      schema: DiagramSchema,
      idField: "diagramId"
    });
  }

  async list(): Promise<Diagram[]> {
    return this.getAll("diagrams");
  }
}

/** Requirement 需求仓储（支持 taskIds 联动） */
export class RequirementRepository extends EntityRepository<Requirement> {
  constructor(workspace: RepoWorkspace) {
    super(workspace, {
      filePath: (repoRoot, id) => entityPath.requirement(repoRoot, id),
      schema: RequirementSchema,
      idField: "requirementId"
    });
  }

  /** 需求下新增任务引用 */
  async addTask(requirementId: string, taskId: string): Promise<void> {
    const req = await this.get(requirementId);
    if (!req.taskIds.includes(taskId)) {
      req.taskIds.push(taskId);
      req.updatedAt = Date.now();
      await this.save(req);
    }
  }

  /** 需求下移除任务引用 */
  async removeTask(requirementId: string, taskId: string): Promise<void> {
    const req = await this.get(requirementId);
    const idx = req.taskIds.indexOf(taskId);
    if (idx !== -1) {
      req.taskIds.splice(idx, 1);
      req.updatedAt = Date.now();
      await this.save(req);
    }
  }

  async list(): Promise<Requirement[]> {
    return this.getAll("requirements");
  }
}

/** Task 任务仓储 */
export class TaskRepository extends EntityRepository<Task> {
  constructor(workspace: RepoWorkspace) {
    super(workspace, {
      filePath: (repoRoot, id) => entityPath.task(repoRoot, id),
      schema: TaskSchema,
      idField: "taskId"
    });
  }

  async list(): Promise<Task[]> {
    return this.getAll("tasks");
  }
}

/** ChangeRecord 变更记录仓储 */
export class ChangeRecordRepository extends EntityRepository<ChangeRecord> {
  constructor(workspace: RepoWorkspace) {
    super(workspace, {
      filePath: (repoRoot, id) => entityPath.changeRecord(repoRoot, id),
      schema: ChangeRecordSchema,
      idField: "changeId"
    });
  }
}

/** BugRecord Bug记录仓储 */
export class BugRecordRepository extends EntityRepository<BugRecord> {
  constructor(workspace: RepoWorkspace) {
    super(workspace, {
      filePath: (repoRoot, id) => entityPath.bugRecord(repoRoot, id),
      schema: BugRecordSchema,
      idField: "bugId"
    });
  }
}

/**
 * DocumentFragment 文档分片仓储
 *
 * 存储形态：store/documents/{docId}/{fragmentId}.json（按文档子目录组织，观感友好）
 * fragmentId 全局唯一，格式固定为 {docId}-f{order}，由正则贪婪解析所属 docId。
 */
export class DocumentFragmentRepository extends EntityRepository<DocumentFragment> {
  constructor(workspace: RepoWorkspace) {
    super(workspace, {
      // 占位路径（get/save 等已 override，按 docId 目录定位）
      filePath: (repoRoot, id) => documentFragmentPath(repoRoot, "unknown", id),
      schema: DocumentFragmentSchema,
      idField: "fragmentId"
    });
  }

  /** 从 fragmentId 解析所属 docId（贪婪匹配最长前缀，兼容 docId 内含 "-f数字"） */
  private docIdOf(fragmentId: string): string {
    const m = /^(.*)-f\d+$/.exec(fragmentId);
    if (!m) {
      throw new Error(`分片 ID 格式非法: ${fragmentId}（应为 {docId}-f{order}）`);
    }
    return m[1];
  }

  /** 确保文档目录存在 */
  private async ensureDir(docId: string): Promise<void> {
    await fs.promises.mkdir(documentDir(this.repoRoot, docId), {
      recursive: true
    });
  }

  override async get(fragmentId: string): Promise<DocumentFragment> {
    const docId = this.docIdOf(fragmentId);
    const fp = documentFragmentPath(this.repoRoot, docId, fragmentId);
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

  override async exists(fragmentId: string): Promise<boolean> {
    const docId = this.docIdOf(fragmentId);
    return fs.existsSync(documentFragmentPath(this.repoRoot, docId, fragmentId));
  }

  override async save(
    entity: DocumentFragment,
    baseMtime?: number
  ): Promise<void> {
    await this.ensureDir(entity.docId);
    const fp = documentFragmentPath(
      this.repoRoot,
      entity.docId,
      entity.fragmentId
    );
    await writeJsonFile(fp, entity, { baseMtime });
    await notifyChanged(this.repoRoot);
  }

  override async delete(fragmentId: string): Promise<void> {
    const docId = this.docIdOf(fragmentId);
    const fp = documentFragmentPath(this.repoRoot, docId, fragmentId);
    if (!fs.existsSync(fp)) {
      throw new FileNotFoundError(fp);
    }
    await fs.promises.unlink(fp);
    invalidateCache(fp);
    await notifyChanged(this.repoRoot);
  }

  /** 列出全部文档的 docId 集合 */
  async listDocIds(): Promise<string[]> {
    const dir = storeSubdir(this.repoRoot, "documents");
    if (!fs.existsSync(dir)) return [];
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  /** 按文档列出全部分片（排除 meta.json，按 order 排序） */
  async listByDoc(docId: string): Promise<DocumentFragment[]> {
    const dir = documentDir(this.repoRoot, docId);
    if (!fs.existsSync(dir)) return [];
    const files = await fs.promises.readdir(dir);
    const result: DocumentFragment[] = [];
    for (const f of files) {
      if (!f.endsWith(".json") || f === "meta.json") continue;
      try {
        result.push(await this.get(f.replace(/\.json$/, "")));
      } catch {
        // 单分片损坏跳过（索引重建容忍）
      }
    }
    return result.sort((a, b) => a.order - b.order);
  }

  /** 列出全部分片（跨全部文档） */
  async list(): Promise<DocumentFragment[]> {
    const ids = await this.listDocIds();
    const result: DocumentFragment[] = [];
    for (const docId of ids) {
      result.push(...(await this.listByDoc(docId)));
    }
    return result;
  }
}

/** DocumentMeta 文档元信息仓储（store/documents/{docId}/meta.json，标题独立于分片） */
export class DocumentMetaRepository extends EntityRepository<DocumentMeta> {
  constructor(workspace: RepoWorkspace) {
    super(workspace, {
      filePath: (repoRoot, docId) => documentMetaPath(repoRoot, docId),
      schema: DocumentMetaSchema,
      idField: "docId"
    });
  }

  /** 列出全部文档元信息 */
  async list(): Promise<DocumentMeta[]> {
    const docsDir = storeSubdir(this.repoRoot, "documents");
    if (!fs.existsSync(docsDir)) return [];
    const entries = await fs.promises.readdir(docsDir, { withFileTypes: true });
    const result: DocumentMeta[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const mp = documentMetaPath(this.repoRoot, e.name);
      if (!fs.existsSync(mp)) continue;
      try {
        result.push(await this.get(e.name));
      } catch {
        // 单 meta 损坏跳过
      }
    }
    return result;
  }
}

export { setEntityChangedHandler };
export type { EntityChangedHandler };
