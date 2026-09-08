/**
 * MCP 工具：需求与任务管理类（开发文档 8.3，共 7 个）
 *
 * create_requirement / list_requirements / get_requirement / update_requirement
 * create_task / update_task_status / list_tasks_by_requirement
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RequirementStatusSchema, TaskStatusSchema } from "@stagelab/shared";
import { getWorkspace } from "../../storage/workspace.js";
import {
  createRequirement,
  listRequirements,
  getRequirement,
  updateRequirement,
  createTask,
  updateTask,
  updateTaskStatus,
  listTasksByRequirement,
  syncRequirementIds
} from "../../services/requirement.service.js";
import { safeCall } from "./_util.js";

const ChangeTypeSchema = z.enum(["新增", "修改", "删除"]);

/** 注册需求与任务管理类工具 */
export function registerRequirementTools(server: McpServer): void {
  server.registerTool(
    "create_requirement",
    {
      title: "创建需求",
      description:
        "创建需求（可关联 Git 分支名），进入阶段2任务分组粒度。\n" +
        "- title：问题导向，一句话说清要解决什么（例：MCP 图元入口收紧 + 三图节点 schema 对齐）\n" +
        "- description：需求描述应含 ① 问题背景（为什么要做）② 目标（做成什么样）③ 验收口径（怎么算完成）。这是后续 create_task 拆解的依据。\n" +
        "- branchName：可选，关联 Git 分支（例 feature/diagram-schema-align）",
      inputSchema: {
        title: z.string().min(1),
        description: z.string().optional(),
        branchName: z.string().optional()
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return createRequirement(ws, args.title, {
          description: args.description,
          branchName: args.branchName
        });
      })
  );

  server.registerTool(
    "list_requirements",
    {
      title: "获取需求列表",
      description: "获取需求列表（轻量：标题/状态/分支/任务数）"
    },
    async () =>
      safeCall(async () => {
        const ws = await getWorkspace();
        // 确保项目 stage2.requirementIds 与磁盘需求保持一致（修复历史数据 + 兜底自动关联）
        await syncRequirementIds(ws);
        return listRequirements(ws);
      })
  );

  server.registerTool(
    "get_requirement",
    {
      title: "获取需求详情",
      description: "获取需求详情（含任务摘要列表）",
      inputSchema: { requirementId: z.string().min(1) }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return getRequirement(ws, args.requirementId);
      })
  );

  server.registerTool(
    "update_requirement",
    {
      title: "更新需求",
      description: "更新需求（状态切换 dev/test/done/abandoned、标题、描述、分支名、废弃原因等）",
      inputSchema: {
        requirementId: z.string().min(1),
        title: z.string().optional(),
        description: z.string().optional(),
        branchName: z.string().optional(),
        abandonReason: z.string().optional(),
        status: RequirementStatusSchema.optional()
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return updateRequirement(ws, args.requirementId, {
          title: args.title,
          description: args.description,
          branchName: args.branchName,
          abandonReason: args.abandonReason,
          status: args.status
        });
      })
  );

  server.registerTool(
    "create_task",
    {
      title: "创建任务",
      description:
        "在指定需求下创建任务。所有字段必填。\n" +
        "- title：动词开头，明确具体（例：补悬浮按钮 / 重构 mergePatch）\n" +
        "- description：问题背景 + 实现思路（1-3 句）\n" +
        "- acceptanceCriteria：可验证写法，拒绝含糊表述。\n" +
        "  ✅ 好：vue-tsc 类型检查通过；hover 态符合设计；单元测试覆盖核心分支\n" +
        "  ❌ 差：界面好看；性能提升\n" +
        "- files：改动文件相对路径清单（where），实现后可对照验收\n" +
        "- changeType：新增 / 修改 / 删除",
      inputSchema: {
        requirementId: z.string().min(1),
        title: z.string().min(1),
        description: z.string(),
        acceptanceCriteria: z.string(),
        files: z.array(z.string()),
        changeType: ChangeTypeSchema
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return createTask(ws, args.requirementId, {
          title: args.title,
          description: args.description,
          acceptanceCriteria: args.acceptanceCriteria,
          files: args.files,
          changeType: args.changeType
        });
      })
  );

  server.registerTool(
    "update_task_status",
    {
      title: "更新任务状态",
      description: "更新任务完成状态（pending/in_progress/done/abandoned；可带废弃原因 abandonReason，废弃状态用）",
      inputSchema: {
        taskId: z.string().min(1),
        status: TaskStatusSchema,
        abandonReason: z.string().optional()
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return updateTaskStatus(ws, args.taskId, args.status, args.abandonReason);
      })
  );

  server.registerTool(
    "update_task",
    {
      title: "更新任务内容",
      description:
        "更新任务内容（标题/描述/验收标准/涉及文件/变更类型；状态单独用 update_task_status）。\n" +
        "- acceptanceCriteria：可验证写法，拒绝含糊表述（与 create_task 一致）\n" +
        "- files：改动文件相对路径清单（where）\n" +
        "省略的字段保持原值，不会清空。",
      inputSchema: {
        taskId: z.string().min(1),
        title: z.string().optional(),
        description: z.string().optional(),
        acceptanceCriteria: z.string().optional(),
        files: z.array(z.string()).optional(),
        changeType: ChangeTypeSchema.optional()
      }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return updateTask(ws, args.taskId, {
          title: args.title,
          description: args.description,
          acceptanceCriteria: args.acceptanceCriteria,
          files: args.files,
          changeType: args.changeType
        });
      })
  );

  server.registerTool(
    "list_tasks_by_requirement",
    {
      title: "按需求列出任务",
      description: "获取指定需求下的任务列表（轻量摘要）",
      inputSchema: { requirementId: z.string().min(1) }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkspace();
        return listTasksByRequirement(ws, args.requirementId);
      })
  );
}
