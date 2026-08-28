/**
 * 四阶段MCP项目管理工具 - 共享数据模型类型定义
 *
 * 对应开发文档第六章全部数据模型：
 * - 6.1 Project 项目实体
 * - 6.2 Requirement 需求实体（阶段2任务分组粒度）
 * - 6.3 Diagram 业务图模型（架构/类/流程，纯语义不含视觉）
 * - 6.4 LayoutDiagram 布局结果模型（内部渲染用，不持久化、不走MCP）
 * - 6.5 ProjectIndex 项目索引（两级索引：需求 + 任务）
 * - 6.6 DocumentFragment 文档分片
 */

/* ========== 通用基础类型 ========== */

/** 项目当前阶段 */
export type Stage = "s1" | "s2" | "s3" | "s4";

/** 图类型 */
export type DiagramType = "architecture" | "class" | "flow";

/** 需求生命周期状态 */
export type RequirementStatus = "active" | "done" | "archived";

/** 任务状态 */
export type TaskStatus = "pending" | "in_progress" | "done";

/* ========== 6.1 Project 项目实体 ========== */

export interface Project {
  projectId: string;
  projectName: string;
  currentStage: Stage;
  createdAt: number;
  updatedAt: number;
  stage1: {
    docId: string;
    diagramIds: string[];
  };
  stage2: {
    taskDocId: string;
    requirementIds: string[]; // 需求列表（需求下挂任务）
    diagramIds: string[];
  };
  stage3: {
    changeRecordIds: string[];
  };
  stage4: {
    bugRecordIds: string[];
  };
  indexId: string;
}

/* ========== 6.2 Requirement 需求实体 ========== */

export interface Requirement {
  requirementId: string;
  title: string;
  description?: string;
  branchName?: string; // 关联 Git 分支名（可选）
  status: RequirementStatus;
  taskIds: string[];
  createdAt: number;
  updatedAt: number;
}

/* ========== 6.3 Diagram 业务图模型 ========== */

/** 图容器（三种图通用），nodes 类型随 type 而定 */
export interface Diagram {
  diagramId: string;
  type: DiagramType;
  metadata: {
    title: string;
    version: number;
    description?: string;
  };
  nodes: ArchitectureNode[] | ClassNode[] | FlowNode[];
  edges: Edge[];
  groups: Group[];
}

/** 6.3.1 架构图节点 */
export interface ArchitectureNode {
  nodeId: string;
  label: string;
  layer?: string; // 所属层级：接入层/服务层/数据层…
  nodeKind?:
    | "service"
    | "database"
    | "mq"
    | "cache"
    | "external"
    | "gateway"; // 组件类型
  description?: string;
  payload?: Record<string, unknown>;
}

/** 6.3.2 类图节点（属性/方法结构化展开） */
export interface ClassNode {
  nodeId: string;
  label: string; // 类名
  kind?: "class" | "interface" | "abstract" | "enum";
  attributes?: ClassAttribute[];
  methods?: ClassMethod[];
  description?: string;
}

export interface ClassAttribute {
  name: string;
  type: string;
  visibility?: "public" | "private" | "protected";
  static?: boolean;
  description?: string;
}

export interface ClassMethod {
  name: string;
  params?: Array<{ name: string; type: string }>;
  returnType?: string;
  visibility?: "public" | "private" | "protected";
  static?: boolean;
  abstract?: boolean;
  description?: string;
}

/** 6.3.3 流程图节点 */
export interface FlowNode {
  nodeId: string;
  label: string; // 步骤名称
  nodeKind?:
    | "start"
    | "end"
    | "process"
    | "decision"
    | "inputOutput"
    | "subprocess"; // 节点类型
  description?: string;
  payload?: Record<string, unknown>; // 扩展信息：判断条件、超时等
}

/** 6.3.4 连线与分组（三种图通用） */
export interface Edge {
  edgeId: string;
  from: string;
  to: string;
  label?: string;
  payload?: Record<string, unknown>;
}

export interface Group {
  groupId: string;
  title: string;
  axis?: "vertical" | "horizontal"; // 纵向=模块/层级；横向=阶段/泳道；默认 vertical
  nodeIds: string[];
  parentGroupId?: string; // 纵向分区支持嵌套
  collapsible?: boolean; // 是否可折叠，仅纵向分区（模块）有效
}

/* ========== 6.4 LayoutDiagram 布局结果模型（内部渲染用） ========== */

export interface LayoutDiagram {
  diagramId: string;
  width: number;
  height: number;
  nodes: Array<{
    nodeId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  edges: Array<{
    edgeId: string;
    points: Array<{ x: number; y: number }>;
  }>;
  groups: Array<{
    groupId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

/* ========== 6.5 ProjectIndex 项目索引（降Token核心） ========== */

export interface ProjectIndex {
  projectId: string;
  version: number;
  documentIndex: Array<{
    docId: string;
    title: string;
    summary: string;
    fragmentIds: string[];
  }>;
  diagramIndex: Array<{
    diagramId: string;
    title: string;
    type: string;
    nodeCount: number;
    edgeCount: number;
  }>;
  requirementIndex: Array<{
    requirementId: string;
    title: string;
    status: string;
    branchName?: string;
    taskCount: number;
  }>;
  taskIndex: Array<{
    taskId: string;
    title: string;
    status: string;
    requirementId: string;
  }>;
}

/* ========== 6.6 DocumentFragment 文档分片 ========== */

export interface DocumentFragment {
  fragmentId: string;
  docId: string;
  order: number;
  title: string;
  content: string;
}

/* ========== 阶段2任务 ========== */

export interface Task {
  taskId: string;
  requirementId: string; // 归属需求
  title: string;
  description: string;
  status: TaskStatus;
  acceptanceCriteria: string; // 验收标准
  files: string[]; // 涉及文件
  changeType: "新增" | "修改" | "删除";
  createdAt: number;
  updatedAt: number;
}

/* ========== 阶段3变更记录 ========== */

export interface ChangeRecord {
  changeId: string;
  taskId: string;
  description: string;
  filesChanged: string[];
  createdAt: number;
}

/* ========== 阶段4 Bug记录 ========== */

export interface BugRecord {
  bugId: string;
  title: string;
  description: string; // 问题现象/复现步骤
  rootCause: string; // 根因
  fixPlan: string; // 修复方案
  regressionChecks: string; // 回归校验要点
  status: "open" | "fixing" | "fixed" | "verified";
  createdAt: number;
  updatedAt: number;
}
