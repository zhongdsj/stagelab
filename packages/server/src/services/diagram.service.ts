/**
 * 图元 CRUD 服务（T07 服务③）
 *
 * 对应开发文档 8.3 工具：create_diagram / get_diagram_meta / get_diagram_partial / update_diagram_elements / delete_diagram
 *
 * 支持：
 * - 局部读取：按 nodeId/edgeId 读取部分图元
 * - 局部更新：单节点/单连线/分组 patch（不重传整图）
 * - MCP 层永不返回布局坐标（本层只返回业务语义）
 */
import type {
  Diagram,
  ArchitectureNode,
  ClassNode,
  FlowNode,
  Edge,
  Group,
  DiagramType
} from "@fourstage/shared";
import { DiagramSchema } from "@fourstage/shared";
import type { RepoWorkspace } from "../storage/workspace.js";
import { createRepositories } from "../storage/repositories/factory.js";

type NodeOfDiagram = ArchitectureNode | ClassNode | FlowNode;

/** 创建新结构化图 */
export async function createDiagram(
  workspace: RepoWorkspace,
  diagramId: string,
  type: DiagramType,
  title: string,
  description?: string
): Promise<Diagram> {
  const repos = createRepositories(workspace);
  const diagram: Diagram = {
    diagramId,
    type,
    metadata: { title, version: 1, description },
    nodes: [],
    edges: [],
    groups: []
  };
  await repos.diagram.save(diagram);
  return diagram;
}

/** 获取图元数据（标题/类型/节点数/连线数，不含详情） */
export async function getDiagramMeta(workspace: RepoWorkspace, diagramId: string) {
  const repos = createRepositories(workspace);
  const d = await repos.diagram.get(diagramId);
  return {
    diagramId: d.diagramId,
    title: d.metadata.title,
    type: d.type,
    version: d.metadata.version,
    nodeCount: d.nodes.length,
    edgeCount: d.edges.length,
    groupCount: d.groups.length
  };
}

/** 按节点ID/连线ID/分组ID读取部分图元 */
export async function getDiagramPartial(
  workspace: RepoWorkspace,
  diagramId: string,
  options: { nodeIds?: string[]; edgeIds?: string[]; groupIds?: string[] } = {}
) {
  const repos = createRepositories(workspace);
  const d = await repos.diagram.get(diagramId);

  const nodeMap = new Map(d.nodes.map((n) => [n.nodeId, n]));
  const edgeMap = new Map(d.edges.map((e) => [e.edgeId, e]));
  const groupMap = new Map(d.groups.map((g) => [g.groupId, g]));

  return {
    diagramId: d.diagramId,
    type: d.type,
    nodes: options.nodeIds
      ? options.nodeIds.map((id) => nodeMap.get(id)).filter(Boolean)
      : [],
    edges: options.edgeIds
      ? options.edgeIds.map((id) => edgeMap.get(id)).filter(Boolean)
      : [],
    groups: options.groupIds
      ? options.groupIds.map((id) => groupMap.get(id)).filter(Boolean)
      : []
  };
}

/** 图元局部更新操作 */
export type DiagramElementPatch =
  | {
      action: "addNode" | "updateNode";
      node: NodeOfDiagram;
    }
  | {
      action: "removeNode";
      nodeId: string;
    }
  | {
      action: "addEdge" | "updateEdge";
      edge: Edge;
    }
  | {
      action: "removeEdge";
      edgeId: string;
    }
  | {
      action: "addGroup" | "updateGroup";
      group: Group;
    }
  | {
      action: "removeGroup";
      groupId: string;
    };

/** 局部新增/修改/删除图元（单节点/单连线/分组 patch） */
export async function updateDiagramElements(
  workspace: RepoWorkspace,
  diagramId: string,
  patches: DiagramElementPatch[]
): Promise<Diagram> {
  const repos = createRepositories(workspace);
  const d = await repos.diagram.get(diagramId);

  // 深拷贝可变副本
  const nodes = d.nodes.map((n) => ({ ...n })) as NodeOfDiagram[];
  const edges = d.edges.map((e) => ({ ...e }));
  const groups = d.groups.map((g) => ({ ...g }));

  for (const patch of patches) {
    switch (patch.action) {
      case "addNode":
      case "updateNode": {
        const idx = nodes.findIndex((n) => n.nodeId === patch.node.nodeId);
        if (idx === -1) nodes.push(patch.node);
        else nodes[idx] = patch.node;
        break;
      }
      case "removeNode": {
        const idx = nodes.findIndex((n) => n.nodeId === patch.nodeId);
        if (idx !== -1) nodes.splice(idx, 1);
        break;
      }
      case "addEdge":
      case "updateEdge": {
        const idx = edges.findIndex((e) => e.edgeId === patch.edge.edgeId);
        if (idx === -1) edges.push(patch.edge);
        else edges[idx] = patch.edge;
        break;
      }
      case "removeEdge": {
        const idx = edges.findIndex((e) => e.edgeId === patch.edgeId);
        if (idx !== -1) edges.splice(idx, 1);
        break;
      }
      case "addGroup":
      case "updateGroup": {
        const idx = groups.findIndex((g) => g.groupId === patch.group.groupId);
        if (idx === -1) groups.push(patch.group);
        else groups[idx] = patch.group;
        break;
      }
      case "removeGroup": {
        const idx = groups.findIndex((g) => g.groupId === patch.groupId);
        if (idx !== -1) groups.splice(idx, 1);
        break;
      }
    }
  }

  const updated: Diagram = {
    ...d,
    nodes,
    edges,
    groups,
    metadata: { ...d.metadata, version: d.metadata.version + 1 }
  };

  // Zod 校验通过后落盘（防止跨类型节点混入）
  const parsed = DiagramSchema.safeParse(updated);
  if (!parsed.success) {
    throw new Error(
      `图元更新校验失败: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`
    );
  }

  await repos.diagram.save(updated);
  return updated;
}

/** 删除整张图 */
export async function deleteDiagram(
  workspace: RepoWorkspace,
  diagramId: string
): Promise<void> {
  const repos = createRepositories(workspace);
  await repos.diagram.delete(diagramId);
}
