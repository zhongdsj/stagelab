/**
 * 影响范围索引服务（T83）
 *
 * 负责 impactIndex 的独立存储与获取：
 * - 写图后增量维护：refreshImpactIndex 由图写路径（createDiagram/updateDiagramElements/saveDiagramGeometry）调用，
 *   每次写图后重算该图拓扑并落盘到 store/impact/{diagramId}.json（「写时维护」而非「读取时现算」）。
 * - 删除图时清理：deleteDiagram 联动删除对应 impact 文件。
 * - 读取兜底：读取时若文件缺失/损坏，从现有 Diagram 现算一次补全，保证 MCP 读取始终可用。
 */
import type { Diagram, ImpactIndexMap } from "@fourstage/shared";
import { ImpactIndexMapSchema } from "@fourstage/shared";
import { readJsonFile, writeJsonFile } from "../storage/io.js";
import { impactPath } from "../storage/paths.js";
import type { RepoWorkspace } from "../storage/workspace.js";
import { computeImpactIndex } from "./graph-topology.js";

/** getImpactIndex 返回结构：图版本 + 影响范围索引映射 */
export interface ImpactIndexResult {
  version: number;
  impact: ImpactIndexMap;
}

/** 重算某图 impactIndex 并独立落盘（写图后调用） */
export async function refreshImpactIndex(
  workspace: RepoWorkspace,
  diagram: Diagram
): Promise<ImpactIndexMap> {
  const impact = computeImpactIndex(diagram);
  const parsed = ImpactIndexMapSchema.safeParse(impact);
  if (!parsed.success) {
    throw new Error(
      `影响范围索引校验失败: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`
    );
  }
  await writeJsonFile(impactPath(workspace.repoRoot, diagram.diagramId), impact);
  return impact;
}

/** 删除图时联动清理 impact 文件；文件不存在则忽略 */
export async function deleteImpactIndex(
  workspace: RepoWorkspace,
  diagramId: string
): Promise<void> {
  try {
    await readJsonFile(impactPath(workspace.repoRoot, diagramId));
  } catch {
    return; // 尚无 impact 文件，无需清理
  }
  await import("node:fs").then((fs) =>
    fs.promises.rm(impactPath(workspace.repoRoot, diagramId))
  );
}

/**
 * 读取某图 impactIndex。支持指定 nodeIds 局部读取；未指定返回全量。
 * 预计算文件缺失/损坏时，从当前图现算一次补全（无损兜底）。
 */
export async function getImpactIndex(
  workspace: RepoWorkspace,
  diagram: Diagram,
  nodeIds?: string[]
): Promise<ImpactIndexResult> {
  let impact: ImpactIndexMap;
  try {
    const raw = await readJsonFile<unknown>(
      impactPath(workspace.repoRoot, diagram.diagramId)
    );
    const parsed = ImpactIndexMapSchema.safeParse(raw);
    if (!parsed.success) throw new Error("impact 数据校验失败");
    impact = parsed.data;
  } catch {
    // 缺失/损坏 → 现算补全
    impact = await refreshImpactIndex(workspace, diagram);
  }

  if (nodeIds && nodeIds.length > 0) {
    const filtered: ImpactIndexMap = {};
    for (const id of nodeIds) {
      if (impact[id]) filtered[id] = impact[id];
    }
    return { version: diagram.metadata.version, impact: filtered };
  }
  return { version: diagram.metadata.version, impact };
}