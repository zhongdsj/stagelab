/**
 * MCP 工具：项目管理类（开发文档 8.1，共 7 个）
 *
 * init_repo_project / set_working_repo / get_working_repo
 * create_project / list_projects / get_project_meta / switch_project_stage
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StageSchema } from "@fourstage/shared";
import {
  initRepoProject,
  setWorkingRepo,
  getWorkingRepo,
  listWorkingRepos
} from "../../services/workspace.service.js";
import {
  createProject,
  listProjects,
  getProjectMeta,
  switchProjectStage
} from "../../services/project.service.js";
import { safeCall, workspaceInfo } from "./_util.js";

/** 注册项目管理类工具 */
export function registerProjectTools(server: McpServer): void {
  server.registerTool(
    "init_repo_project",
    {
      title: "初始化仓库项目",
      description:
        "在指定仓库根生成 .fourstage/project.meta.json 与 store 目录树，并加载为当前工作仓库",
      inputSchema: { repoRoot: z.string().min(1) }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await initRepoProject(args.repoRoot);
        return workspaceInfo(ws);
      })
  );

  server.registerTool(
    "set_working_repo",
    {
      title: "切换当前工作仓库",
      description: "切换当前工作仓库（多仓库实例间切换），后续操作基于新选中仓库",
      inputSchema: { repoRoot: z.string().min(1) }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await setWorkingRepo(args.repoRoot);
        return workspaceInfo(ws);
      })
  );

  server.registerTool(
    "get_working_repo",
    {
      title: "获取当前工作仓库",
      description: "获取当前工作仓库信息（未加载任何仓库时返回 null）"
    },
    async () =>
      safeCall(async () => {
        const ws = await getWorkingRepo();
        return ws ? workspaceInfo(ws) : null;
      })
  );

  server.registerTool(
    "create_project",
    {
      title: "创建项目",
      description: "在当前工作仓库创建新项目，默认进入阶段1（s1）",
      inputSchema: { projectName: z.string().min(1) }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkingRepo();
        if (!ws) throw new Error("未加载任何仓库，请先 init_repo_project 或 set_working_repo");
        return createProject(ws, args.projectName);
      })
  );

  server.registerTool(
    "list_projects",
    {
      title: "获取项目列表",
      description: "获取项目列表（仅返回元信息，不包含详情）"
    },
    async () =>
      safeCall(async () => {
        const ws = await getWorkingRepo();
        if (!ws) return [];
        return listProjects(ws);
      })
  );

  server.registerTool(
    "get_project_meta",
    {
      title: "获取项目元数据",
      description: "获取当前工作仓库项目元数据"
    },
    async () =>
      safeCall(async () => {
        const ws = await getWorkingRepo();
        if (!ws) throw new Error("未加载任何仓库，请先 init_repo_project 或 set_working_repo");
        return getProjectMeta(ws);
      })
  );

  server.registerTool(
    "switch_project_stage",
    {
      title: "切换项目当前阶段",
      description: "切换项目当前阶段（s1/s2/s3/s4）",
      inputSchema: { stage: StageSchema }
    },
    async (args) =>
      safeCall(async () => {
        const ws = await getWorkingRepo();
        if (!ws) throw new Error("未加载任何仓库，请先 init_repo_project 或 set_working_repo");
        return switchProjectStage(ws, args.stage);
      })
  );

  // 便捷工具：列出全部已加载仓库（辅助多仓库管理）
  server.registerTool(
    "list_working_repos",
    {
      title: "列出已加载仓库",
      description: "列出当前进程已加载的全部仓库实例"
    },
    async () =>
      safeCall(async () => {
        return listWorkingRepos();
      })
  );
}
