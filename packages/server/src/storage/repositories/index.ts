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
  type EntityChangedHandler
} from "./base.js";
import {
  ProjectSchema,
  RequirementSchema,
  TaskSchema,
  ChangeRecordSchema,
  BugRecordSchema,
  DiagramSchema,
  DocumentFragmentSchema
} from "@fourstage/shared";
import { entityPath } from "../paths.js";
import type { RepoWorkspace } from "../workspace.js";
import type {
  Project,
  Requirement,
  Task,
  ChangeRecord,
  BugRecord,
  Diagram,
  DocumentFragment
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

/** DocumentFragment 文档分片仓储 */
export class DocumentFragmentRepository extends EntityRepository<DocumentFragment> {
  constructor(workspace: RepoWorkspace) {
    super(workspace, {
      filePath: (repoRoot, id) => entityPath.document(repoRoot, id),
      schema: DocumentFragmentSchema,
      idField: "fragmentId"
    });
  }

  /** 按文档列出全部分片 */
  async listByDoc(docId: string): Promise<DocumentFragment[]> {
    const all = await this.getAll("documents");
    return all
      .filter((f) => f.docId === docId)
      .sort((a, b) => a.order - b.order);
  }

  async list(): Promise<DocumentFragment[]> {
    return this.getAll("documents");
  }
}

export { setEntityChangedHandler };
export type { EntityChangedHandler };
