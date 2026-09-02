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

/** 需求生命周期状态（三态：开发/测试/完成，前端可修改；done 为终态） */
export type RequirementStatus = "dev" | "test" | "done";

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
    /** 图漂移校验锚点（P1）：仅存「最新一次」校验快照，完整轨迹见验证历史独立存储 */
    baseBranch?: string; // 图构造基于的分支
    baseCommit?: string; // 图构造基于的提交
    verifiedCommit?: string; // 最后一次被显式确认可信的提交（= 验证历史最新一条的 verifiedCommit 只读镜像）
    lastVerifiedAt?: number; // 确认时间
    verifiedBy?: VerificationActor; // 确认者：human | ai
    verifyNote?: string; // 校验备注：说明为何可信（如「仅参数变更，无结构变化」）
  };
  nodes: ArchitectureNode[] | ClassNode[] | FlowNode[];
  edges: Edge[];
  groups: Group[];
}

/** 6.3.0 自由画布几何（draw.io 改造）：节点坐标/尺寸，缺省时由布局引擎兜底 */
export interface NodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 源码锚点文件项（codeAnchor 成员）：记录节点对应的源文件与符号，供开发者参考、AI 定位/下钻 */
export interface CodeAnchorFile {
  path: string; // 源文件相对路径，如 packages/server/src/services/x.service.ts
  symbols?: string[]; // 该文件内的相关符号（类/函数/方法），如 ["XService", "doThing"]
}

/** 节点源码锚点：file/symbol 清单，优先用于源码定位，禁止按标签文本猜测文件 */
export interface CodeAnchor {
  files: CodeAnchorFile[];
}

/**
 * 节点关联图（跨图跳转）：占位节点/跨模块引用节点点击后跳转到目标图。
 * 架构图/流程图存于 payload.linkedDiagrams（复数数组），类图直接存节点字段 linkedDiagrams。
 */
export interface LinkedDiagram {
  diagramId: string; // 目标图 id，如 http-api-class / mcp-server-flow
  label?: string; // 按钮副标题（模块名），缺省用图标题
  type?: DiagramType; // 目标图类型 architecture | class | flow，用于按钮文案
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
  geometry?: NodeGeometry; // 自由画布坐标（无则引擎兜底）
  codeAnchor?: CodeAnchor; // 源码锚点（file/symbol 清单）
}

/** 6.3.2 类图节点（属性/方法结构化展开） */
export interface ClassNode {
  nodeId: string;
  label: string; // 类名
  kind?: "class" | "interface" | "abstract" | "enum";
  attributes?: ClassAttribute[];
  methods?: ClassMethod[];
  description?: string;
  geometry?: NodeGeometry; // 自由画布坐标（无则引擎兜底）
  codeAnchor?: CodeAnchor; // 源码锚点（file/symbol 清单）
  /** 关联图（跨模块引用）：占位/外部类节点点击可跳转到目标图（类图无 payload，直接用语义字段） */
  linkedDiagrams?: LinkedDiagram[];
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
  geometry?: NodeGeometry; // 自由画布坐标（无则引擎兜底）
  codeAnchor?: CodeAnchor; // 源码锚点（file/symbol 清单）
}

/** 6.3.4 连线与分组（三种图通用） */
export interface Edge {
  edgeId: string;
  from: string;
  to: string;
  label?: string;
  payload?: Record<string, unknown>;
  /** 自由画布折点坐标（draw.io 改造）：points[0]=from 锚点、points[last]=to 锚点；无则引擎兜底 */
  points?: Array<{ x: number; y: number }>;
  /** 类图方法映射（T66）：该连线调用的目标类方法名列表，供方法级点击高亮；无则退化为类级高亮 */
  methods?: string[];
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
    docType?: string; // 文档类型（自由文本，帮助 AI/人工快速理解文档性质）
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

/* ========== 6.8 VerificationRecord 图验证历史（独立存储，防图膨胀） ========== */

/** 校验动作参与者：人工或 AI */
export type VerificationActor = "human" | "ai";

/** 三类校验流程（按变更成本） */
export type VerificationChangeType = "no_change" | "incremental" | "rebuild";

/**
 * 图验证记录：每次显式 verify_diagram 追加一条，独立存储于
 * store/verifications/{diagramId}/{verificationId}.json，链式 prevVerifiedCommit 可回放追溯。
 * metadata 仅存最新一条的只读镜像，保持图轻量。
 */
export interface VerificationRecord {
  verificationId: string; // 如 "v-<hex>"
  diagramId: string;
  changeType: VerificationChangeType; // 本次校验流程类别
  baseCommit?: string; // 本次校验基线 commit
  verifiedCommit: string; // 本次确认可信的 commit
  prevVerifiedCommit?: string; // 上一条记录，形成链式追溯（首条为空）
  verifiedAt: number; // 校验时间戳
  verifiedBy: VerificationActor; // 确认者
  note?: string; // 校验备注：为何可信/变更了什么
}

/* ========== 6.7 ImpactIndex 影响范围索引（图拓扑预计算） ========== */

/** 结构风险等级（图算法客观基线）：低/中/高 */
export type ImpactRiskLevel = "low" | "medium" | "high";

/** 单节点影响范围索引条目：全部基于图自身拓扑（节点/边）推导，不含代码扫描 */
export interface ImpactIndexEntry {
  upstream: string[]; // 直接上游（指向本节点的 from 节点集）
  downstream: string[]; // 直接下游（本节点 to 的节点集）
  upstreamHops: number; // 最大上游跳数（可达最远上游所需跳数，0 表示无上游）
  downstreamHops: number; // 最大下游跳数（可达最远下游所需跳数，0 表示无下游）
  fanIn: number; // 入度（被多少节点直接依赖）
  fanOut: number; // 出度（直接依赖多少节点）
  inCycle: boolean; // 是否位于环/强连通分量
  cycleIds: string[]; // 所属环节点集（可能属于多个环，去重合并）
  structuralRisk: ImpactRiskLevel; // 结构分：fanIn 高→high、在环→high、跨层/近关键→medium、其余 low
}

/** 影响范围索引映射：nodeId → 条目 */
export type ImpactIndexMap = Record<string, ImpactIndexEntry>;

/* ========== 6.6.1 DocumentMeta 文档元信息（独立于分片，供索引与展示） ========== */

export interface DocumentMeta {
  docId: string;
  title: string; // 文档标题（与分片 title 解耦，索引与展示使用）
  docType?: string; // 文档类型（自由文本描述，帮助 AI/人工快速理解文档性质，不做枚举限定）
  summary?: string; // 摘要
  createdAt: number;
  updatedAt: number;
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
