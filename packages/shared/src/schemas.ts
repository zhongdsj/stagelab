/**
 * 四阶段MCP项目管理工具 - Zod 校验 Schema
 *
 * 与 types.ts 一一对应，作为数据统一校验层。
 * 关键设计：
 * - 图节点采用 discriminated union 按 type 校验，防止跨类型字段混用
 * - 业务层模型（Diagram 等）不含坐标/尺寸/颜色等视觉字段
 * - 布局结果 LayoutDiagram 为独立内部模型，不走 MCP
 */
import { z } from "zod";

/* ========== 通用基础 ========== */

export const StageSchema = z.enum(["s1", "s2", "s3", "s4"]);
export const DiagramTypeSchema = z.enum(["architecture", "class", "flow"]);
export const RequirementStatusSchema = z.enum(["dev", "test", "done", "abandoned"]);
export const TaskStatusSchema = z.enum(["pending", "in_progress", "done", "abandoned"]);

/* ========== 6.1 Project 项目实体 ========== */

export const ProjectSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  currentStage: StageSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  stage1: z.object({
    docId: z.string(), // 初始创建时可为空串（尚未分配文档）
    diagramIds: z.array(z.string())
  }),
  stage2: z.object({
    taskDocId: z.string(), // 初始创建时可为空串
    requirementIds: z.array(z.string()),
    diagramIds: z.array(z.string())
  }),
  stage3: z.object({
    changeRecordIds: z.array(z.string())
  }),
  stage4: z.object({
    bugRecordIds: z.array(z.string())
  }),
  indexId: z.string().min(1)
});

/* ========== 6.2 Requirement 需求实体 ========== */

export const RequirementSchema = z.object({
  requirementId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  branchName: z.string().optional(),
  status: RequirementStatusSchema,
  abandonReason: z.string().optional(),
  taskIds: z.array(z.string()),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
});

/* ========== 6.3 Diagram 业务图模型 ========== */

/** 自由画布节点几何（draw.io 改造）：strict 节点 schema 需显式声明 */
export const NodeGeometrySchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().finite(),
  height: z.number().positive().finite()
});

/** 连线折点坐标 */
export const PointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
});

/** 源码锚点文件项（codeAnchor） */
export const CodeAnchorFileSchema = z
  .object({
    path: z.string().min(1),
    symbols: z.array(z.string().min(1)).optional()
  })
  .strict();

/** 节点源码锚点：file/symbol 清单 */
export const CodeAnchorSchema = z
  .object({
    files: z.array(CodeAnchorFileSchema)
  })
  .strict();

/** 节点关联图（跨图跳转）：占位/跨模块节点点击后跳转目标图 */
export const LinkedDiagramSchema = z
  .object({
    diagramId: z.string().min(1),
    label: z.string().optional(),
    type: DiagramTypeSchema.optional()
  })
  .strict();

/** 业务语义模型禁止出现坐标/尺寸/颜色等视觉字段——通过仅声明必要字段的 Schema 天然约束 */
export const ArchitectureNodeSchema = z
  .object({
    nodeId: z.string().min(1),
    label: z.string().min(1),
    layer: z.string().optional(),
    nodeKind: z
      .enum(["service", "database", "mq", "cache", "external", "gateway"])
      .optional(),
    description: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    geometry: NodeGeometrySchema.optional(),
    codeAnchor: CodeAnchorSchema.optional()
  })
  .strict();

export const ClassAttributeSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  visibility: z.enum(["public", "private", "protected"]).optional(),
  static: z.boolean().optional(),
  description: z.string().optional()
});

export const ClassMethodSchema = z.object({
  name: z.string().min(1),
  params: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.string().min(1)
      })
    )
    .optional(),
  returnType: z.string().optional(),
  visibility: z.enum(["public", "private", "protected"]).optional(),
  static: z.boolean().optional(),
  abstract: z.boolean().optional(),
  description: z.string().optional()
});

export const ClassNodeSchema = z
  .object({
    nodeId: z.string().min(1),
    label: z.string().min(1),
    kind: z.enum(["class", "interface", "abstract", "enum"]).optional(),
    attributes: z.array(ClassAttributeSchema).optional(),
    methods: z.array(ClassMethodSchema).optional(),
    description: z.string().optional(),
    geometry: NodeGeometrySchema.optional(),
    codeAnchor: CodeAnchorSchema.optional(),
    linkedDiagrams: z.array(LinkedDiagramSchema).optional()
  })
  .strict();

export const FlowNodeSchema = z
  .object({
    nodeId: z.string().min(1),
    label: z.string().min(1),
    nodeKind: z
      .enum([
        "start",
        "end",
        "process",
        "decision",
        "inputOutput",
        "subprocess"
      ])
      .optional(),
    description: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    geometry: NodeGeometrySchema.optional(),
    codeAnchor: CodeAnchorSchema.optional(),
    linkedDiagrams: z.array(LinkedDiagramSchema).optional()
  })
  .strict();

export const EdgeSchema = z.object({
  edgeId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  points: z.array(PointSchema).optional(),
  methods: z.array(z.string().min(1)).optional()
});

export const GroupSchema = z.object({
  groupId: z.string().min(1),
  title: z.string().min(1),
  axis: z.enum(["vertical", "horizontal"]).optional(),
  nodeIds: z.array(z.string()),
  parentGroupId: z.string().optional(),
  collapsible: z.boolean().optional()
});

/* ========== 6.8 VerificationRecord 图验证历史 ========== */

export const VerificationActorSchema = z.enum(["human", "ai"]);

export const VerificationChangeTypeSchema = z.enum([
  "no_change",
  "incremental",
  "rebuild"
]);

export const VerificationRecordSchema = z
  .object({
    verificationId: z.string().min(1),
    diagramId: z.string().min(1),
    changeType: VerificationChangeTypeSchema,
    baseCommit: z.string().optional(),
    verifiedCommit: z.string().min(1),
    prevVerifiedCommit: z.string().optional(),
    verifiedAt: z.number().int().nonnegative(),
    verifiedBy: VerificationActorSchema,
    note: z.string().optional()
  })
  .strict();

/**
 * Diagram 图容器：nodes 按 type 用 discriminated union 区分校验
 * 防止跨类型字段混用（如把 class 节点塞进 architecture 图）
 */
export const DiagramSchema = z
  .object({
    diagramId: z.string().min(1),
    type: DiagramTypeSchema,
    metadata: z.object({
      title: z.string().min(1),
      version: z.number().int().nonnegative(),
      description: z.string().optional(),
      // 图漂移校验锚点（P1）：均 optional，存量图零迁移兼容
      baseBranch: z.string().optional(),
      baseCommit: z.string().optional(),
      verifiedCommit: z.string().optional(),
      lastVerifiedAt: z.number().int().nonnegative().optional(),
      verifiedBy: VerificationActorSchema.optional(),
      verifyNote: z.string().optional()
    }),
    nodes: z.union([
      z.array(ArchitectureNodeSchema),
      z.array(ClassNodeSchema),
      z.array(FlowNodeSchema)
    ]),
    edges: z.array(EdgeSchema),
    groups: z.array(GroupSchema)
  })
  .superRefine((diagram, ctx) => {
    // 按图类型校验节点：确保 nodes 元素与 type 一致，防止跨类型字段混用
    const typeToNodeKeys: Record<string, string[]> = {
      architecture: ["layer", "nodeKind"],
      class: ["kind", "attributes", "methods"],
      flow: ["nodeKind"]
    };
    const nodeKeys = typeToNodeKeys[diagram.type];

    const mismatch = diagram.nodes.find(
      (node) => !nodeKeys.some((key) => key in node)
    );
    if (mismatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `节点 ${mismatch.nodeId} 缺少 ${diagram.type} 图类型特征字段，存在跨类型节点`
      });
    }
  });

/* ========== 6.4 LayoutDiagram 布局结果模型（内部渲染用） ========== */

export const LayoutDiagramSchema = z.object({
  diagramId: z.string().min(1),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  nodes: z.array(
    z.object({
      nodeId: z.string().min(1),
      x: z.number(),
      y: z.number(),
      width: z.number().nonnegative(),
      height: z.number().nonnegative()
    })
  ),
  edges: z.array(
    z.object({
      edgeId: z.string().min(1),
      points: z.array(
        z.object({
          x: z.number(),
          y: z.number()
        })
      )
    })
  ),
  groups: z.array(
    z.object({
      groupId: z.string().min(1),
      x: z.number(),
      y: z.number(),
      width: z.number().nonnegative(),
      height: z.number().nonnegative()
    })
  )
});

/* ========== 6.5 ProjectIndex 项目索引 ========== */

export const ProjectIndexSchema = z.object({
  projectId: z.string().min(1),
  version: z.number().int().nonnegative(),
  documentIndex: z.array(
    z.object({
      docId: z.string().min(1),
      title: z.string().min(1),
      docType: z.string().optional(),
      summary: z.string(),
      fragmentIds: z.array(z.string())
    })
  ),
  diagramIndex: z.array(
    z.object({
      diagramId: z.string().min(1),
      title: z.string().min(1),
      type: z.string().min(1),
      nodeCount: z.number().int().nonnegative(),
      edgeCount: z.number().int().nonnegative()
    })
  ),
  requirementIndex: z.array(
    z.object({
      requirementId: z.string().min(1),
      title: z.string().min(1),
      status: z.string().min(1),
      branchName: z.string().optional(),
      taskCount: z.number().int().nonnegative()
    })
  ),
  taskIndex: z.array(
    z.object({
      taskId: z.string().min(1),
      title: z.string().min(1),
      status: z.string().min(1),
      requirementId: z.string().min(1)
    })
  )
});

/* ========== 6.6 DocumentFragment 文档分片 ========== */

export const DocumentFragmentSchema = z.object({
  fragmentId: z.string().min(1),
  docId: z.string().min(1),
  order: z.number().int().nonnegative(),
  title: z.string(),
  content: z.string(),
  summary: z.string().optional()
});

/* ========== 6.7 ImpactIndex 影响范围索引（图拓扑预计算） ========== */

export const ImpactRiskLevelSchema = z.enum(["low", "medium", "high"]);

export const ImpactIndexEntrySchema = z
  .object({
    upstream: z.array(z.string()),
    downstream: z.array(z.string()),
    upstreamHops: z.number().int().nonnegative(),
    downstreamHops: z.number().int().nonnegative(),
    fanIn: z.number().int().nonnegative(),
    fanOut: z.number().int().nonnegative(),
    inCycle: z.boolean(),
    cycleIds: z.array(z.string()),
    structuralRisk: ImpactRiskLevelSchema
  })
  .strict();

export const ImpactIndexMapSchema = z.record(z.string(), ImpactIndexEntrySchema);

/* ========== 6.6.1 DocumentMeta 文档元信息 ========== */

export const DocumentMetaSchema = z.object({
  docId: z.string().min(1),
  title: z.string().min(1),
  docType: z.string().optional(), // 文档类型（自由文本，非枚举）
  summary: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
});

/* ========== 阶段2任务 ========== */

export const TaskSchema = z.object({
  taskId: z.string().min(1),
  requirementId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  status: TaskStatusSchema,
  abandonReason: z.string().optional(),
  acceptanceCriteria: z.string(),
  files: z.array(z.string()),
  changeType: z.enum(["新增", "修改", "删除"]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
});

/* ========== 阶段3变更记录 ========== */

export const ChangeRecordSchema = z.object({
  changeId: z.string().min(1),
  taskId: z.string().min(1),
  description: z.string(),
  filesChanged: z.array(z.string()),
  createdAt: z.number().int().nonnegative()
});

/* ========== 阶段4 Bug记录 ========== */

export const BugRecordSchema = z.object({
  bugId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  rootCause: z.string(),
  fixPlan: z.string(),
  regressionChecks: z.string(),
  status: z.enum(["open", "fixing", "fixed", "verified"]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
});

/* ========== 类型推导（供外部使用 Schema 推断类型） ========== */

export type ProjectType = z.infer<typeof ProjectSchema>;
export type RequirementType = z.infer<typeof RequirementSchema>;
export type DiagramTypeModel = z.infer<typeof DiagramSchema>;
export type LayoutDiagramType = z.infer<typeof LayoutDiagramSchema>;
export type ProjectIndexType = z.infer<typeof ProjectIndexSchema>;
export type DocumentFragmentType = z.infer<typeof DocumentFragmentSchema>;
export type TaskType = z.infer<typeof TaskSchema>;
export type ChangeRecordType = z.infer<typeof ChangeRecordSchema>;
export type BugRecordType = z.infer<typeof BugRecordSchema>;
