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

/**
 * 自由画布节点几何（draw.io 改造）：strict 节点 schema 需显式声明。
 * 仅供存储与 HTTP 通道读写；MCP 工具入口不接受坐标（传入即被拒绝），读侧也不返回。
 */
export const NodeGeometrySchema = z.object({
  x: z.number().finite().describe("节点左上角画布 X 坐标（px，相对图原点，可为负）"),
  y: z.number().finite().describe("节点左上角画布 Y 坐标（px，相对图原点，可为负）"),
  width: z.number().positive().finite().describe("节点宽度（px，必须为正数）"),
  height: z.number().positive().finite().describe("节点高度（px，必须为正数）")
});

/** 连线折点坐标：仅供存储与 HTTP 通道读写，MCP 入口不接受 */
export const PointSchema = z.object({
  x: z.number().finite().describe("折点画布 X 坐标（px）"),
  y: z.number().finite().describe("折点画布 Y 坐标（px）")
});

/** 源码锚点文件项（codeAnchor） */
export const CodeAnchorFileSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .describe(
        "源文件相对仓库根路径，如 packages/server/src/services/x.service.ts；必须来自真实文件，禁止按 label 猜测"
      ),
    symbols: z
      .array(z.string().min(1))
      .optional()
      .describe("该文件内的相关符号（类/函数/方法名）；省略表示整文件相关")
  })
  .strict();

/** 节点源码锚点：file/symbol 清单 */
export const CodeAnchorSchema = z
  .object({
    files: z
      .array(CodeAnchorFileSchema)
      .describe("源文件清单，至少一项；优先用于源码定位，禁止按标签文本猜文件")
  })
  .strict();

/** 节点关联图（跨图跳转）：占位/跨模块节点点击后跳转目标图 */
export const LinkedDiagramSchema = z
  .object({
    diagramId: z
      .string()
      .min(1)
      .describe("目标图 diagramId，必须是本项目内真实存在的图，禁止编造"),
    label: z
      .string()
      .optional()
      .describe("跳转按钮副标题（模块名），省略时用目标图标题"),
    type: DiagramTypeSchema.optional().describe(
      "目标图类型 architecture | class | flow，用于按钮文案；省略时按目标图实际类型"
    )
  })
  .strict();

/** 业务语义模型禁止出现坐标/尺寸/颜色等视觉字段——通过仅声明必要字段的 Schema 天然约束 */
export const ArchitectureNodeSchema = z
  .object({
    nodeId: z
      .string()
      .min(1)
      .describe("节点唯一 id（本图内唯一、跨更新稳定；连线 from/to 引用它）"),
    label: z.string().min(1).describe("节点显示名（组件名或业务名，中文优先）"),
    layer: z
      .string()
      .optional()
      .describe("所属层级，如 接入层/服务层/数据层；用于纵向分组的默认归置，省略则不归类"),
    nodeKind: z
      .enum(["service", "database", "mq", "cache", "external", "gateway"])
      .optional()
      .describe(
        "组件类型：service 服务 | database 数据库 | mq 消息队列 | cache 缓存 | external 外部系统 | gateway 网关；决定图标与配色"
      ),
    description: z.string().optional().describe("一句话说明该节点职责，供悬停提示与详情弹层展示"),
    payload: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "扩展字段自由对象（如 aiRiskNote 结构化风险：{timeout:3000, format:\"JWT\", risk:\"过期策略\"}）；不需要时省略"
      ),
    geometry: NodeGeometrySchema.optional().describe(
      "自由画布坐标与尺寸，供存储与 HTTP 通道持久化，省略则由布局引擎自动排布；MCP 工具入口不接受该字段（传入即报错），读侧也不返回"
    ),
    codeAnchor: CodeAnchorSchema.optional().describe(
      "源码锚点：该节点对应的文件与符号清单，用于代码定位（禁止按 label 猜测）"
    ),
    linkedDiagrams: z
      .array(LinkedDiagramSchema)
      .optional()
      .describe(
        "关联图（跨图跳转）：该节点代表另一个模块/图时填写，点击节点跳转目标图；架构图历史上也写在 payload.linkedDiagrams，新数据优先用本字段"
      )
  })
  .strict();

export const ClassAttributeSchema = z.object({
  name: z.string().min(1).describe("属性名"),
  type: z.string().min(1).describe("类型文本，原样展示（如 string[]、Map<string, Foo>）"),
  visibility: z
    .enum(["public", "private", "protected"])
    .optional()
    .describe("可见性，决定成员前的 +/#/- 符号；省略则不显示修饰符"),
  static: z.boolean().optional().describe("是否静态属性，true 时前端加下划线标识"),
  description: z.string().optional().describe("属性说明，悬停时展示")
});

export const ClassMethodSchema = z.object({
  name: z.string().min(1).describe("方法名（不含参数）"),
  params: z
    .array(
      z.object({
        name: z.string().min(1).describe("参数名"),
        type: z.string().min(1).describe("参数类型文本，原样展示")
      })
    )
    .optional()
    .describe("参数清单，按签名顺序；无参省略"),
  returnType: z.string().optional().describe("返回类型文本；无返回值可写 void 或省略"),
  visibility: z
    .enum(["public", "private", "protected"])
    .optional()
    .describe("可见性，决定方法前的 +/#/- 符号；省略则不显示修饰符"),
  static: z.boolean().optional().describe("是否静态方法，true 时前端加下划线标识"),
  abstract: z.boolean().optional().describe("是否抽象方法，true 时前端斜体标识"),
  description: z.string().optional().describe("方法说明，悬停时展示")
});

export const ClassNodeSchema = z
  .object({
    nodeId: z
      .string()
      .min(1)
      .describe("节点唯一 id（本图内唯一、跨更新稳定；连线 from/to 引用它）"),
    label: z.string().min(1).describe("类名（含泛型时保留尖括号，如 Result<T>）"),
    kind: z
      .enum(["class", "interface", "abstract", "enum"])
      .optional()
      .describe("类型种类：class 类 | interface 接口 | abstract 抽象类 | enum 枚举；决定节点角标"),
    attributes: z
      .array(ClassAttributeSchema)
      .optional()
      .describe("属性清单，按声明顺序渲染；无属性省略"),
    methods: z
      .array(ClassMethodSchema)
      .optional()
      .describe("方法清单，按声明顺序渲染；无方法省略"),
    description: z.string().optional().describe("一句话说明该类型职责，供悬停提示与详情弹层展示"),
    payload: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("扩展字段自由对象；类图优先用语义字段（attributes/methods），一般不需要 payload"),
    geometry: NodeGeometrySchema.optional().describe(
      "自由画布坐标与尺寸，供存储与 HTTP 通道持久化，省略则由布局引擎自动排布；MCP 工具入口不接受该字段（传入即报错），读侧也不返回"
    ),
    codeAnchor: CodeAnchorSchema.optional().describe(
      "源码锚点：该类型对应的文件与符号清单，用于代码定位（禁止按 label 猜测）"
    ),
    linkedDiagrams: z
      .array(LinkedDiagramSchema)
      .optional()
      .describe(
        "关联图（跨模块引用）：占位/外部类节点点击可跳转到目标图；类图无 payload，直接用本字段"
      )
  })
  .strict();

export const FlowNodeSchema = z
  .object({
    nodeId: z
      .string()
      .min(1)
      .describe("节点唯一 id（本图内唯一、跨更新稳定；连线 from/to 引用它）"),
    label: z.string().min(1).describe("步骤名称（动宾短语，如 校验参数、写入磁盘）"),
    nodeKind: z
      .enum([
        "start",
        "end",
        "process",
        "decision",
        "inputOutput",
        "subprocess"
      ])
      .optional()
      .describe(
        "流程节点类型：start 开始 | end 结束 | process 处理 | decision 判断（出边需带条件 label）| inputOutput 输入输出 | subprocess 子流程；决定形状"
      ),
    description: z.string().optional().describe("该步骤做什么；判断节点在此写判断条件"),
    payload: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("扩展信息（如判断条件、超时、异常分支）；值可为任意 JSON，不需要时省略"),
    geometry: NodeGeometrySchema.optional().describe(
      "自由画布坐标与尺寸，供存储与 HTTP 通道持久化，省略则由布局引擎自动排布；MCP 工具入口不接受该字段（传入即报错），读侧也不返回"
    ),
    codeAnchor: CodeAnchorSchema.optional().describe(
      "源码锚点：该步骤对应的文件与符号清单（方法优先），用于代码定位（禁止按 label 猜测）"
    ),
    linkedDiagrams: z
      .array(LinkedDiagramSchema)
      .optional()
      .describe(
        "关联图（跨模块跳转）：该步骤代表另一个模块/图时填写；流程图历史上也写在 payload.linkedDiagrams，新数据优先用本字段"
      )
  })
  .strict();

export const EdgeSchema = z.object({
  edgeId: z.string().min(1).describe("连线唯一 id（本图内唯一；更新/删除时按它定位）"),
  from: z.string().min(1).describe("起点节点 nodeId，必须存在于本图 nodes 中"),
  to: z.string().min(1).describe("终点节点 nodeId，必须存在；箭头指向该节点"),
  label: z.string().optional().describe("连线标签（如 调用/返回/是/否），省略则不显示"),
  payload: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("扩展字段自由对象（如超时、协议）；不需要时省略"),
  points: z
    .array(PointSchema)
    .optional()
    .describe(
      "折点坐标数组：points[0] 为 from 侧锚点、最后一项为 to 侧锚点，中间为正交折点；供存储与 HTTP 通道使用，MCP 入口不接受（传入即报错），读侧不返回；省略则由引擎自动布线"
    ),
  methods: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "类图方法映射：该连线承载的目标类方法名列表，用于方法级点击高亮；省略退化为类级高亮"
    )
});

export const GroupSchema = z.object({
  groupId: z.string().min(1).describe("分区唯一 id（本图内唯一）"),
  title: z.string().min(1).describe("分区标题（模块名/层级名/阶段名）"),
  axis: z
    .enum(["vertical", "horizontal"])
    .optional()
    .describe("分区方向：vertical 纵向模块/层级（默认）| horizontal 横向阶段/泳道"),
  nodeIds: z.array(z.string()).describe("分区包含的节点 id 列表，须存在于本图 nodes 中"),
  parentGroupId: z.string().optional().describe("父分区 groupId，用于纵向嵌套；省略为顶层分区"),
  collapsible: z.boolean().optional().describe("是否可折叠，仅纵向模块分区有效")
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

/** 文档状态枚举：focused 当前聚焦（默认）| maintained 长期更新（最高可信度）| archived 留档 */
export const DocumentStatusSchema = z.enum(["focused", "maintained", "archived"]);

export const ProjectIndexSchema = z.object({
  projectId: z.string().min(1),
  version: z.number().int().nonnegative(),
  documentIndex: z.array(
    z.object({
      docId: z.string().min(1),
      title: z.string().min(1),
      docType: z.string().optional(),
      status: DocumentStatusSchema.optional(),
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
  status: DocumentStatusSchema.optional(), // 文档状态（缺省 focused）
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
