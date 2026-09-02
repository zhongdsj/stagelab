/**
 * 图拓扑算法模块（T82）
 *
 * 基于 FourSeq 图自身（节点/边）做纯拓扑计算，产出影响范围索引 impactIndex：
 * - 传递闭包可达集/跳数（BFS）
 * - 扇入扇出（入度/出度）
 * - 环/强连通分量（Tarjan）
 * - 派生 structuralRisk（结构分客观基线）
 *
 * 不依赖任何代码扫描能力，与 CodeGraph/源码解耦，仅输入 Diagram 即可计算。
 */
import type {
  Diagram,
  ImpactIndexEntry,
  ImpactIndexMap,
  ImpactRiskLevel
} from "@fourstage/shared";

/** 结构分阈值：fanIn 达到该值视为"被多节点依赖"的高风险（绝对基线） */
const FANIN_HIGH = 4;
/** 结构分阈值：fanIn 达到该值视为中风险（跨层/近关键近似） */
const FANIN_MEDIUM = 2;

/** Tarjan 强连通分量结果 */
interface SccResult {
  sccOf: Map<string, number>;
  sccNodes: Map<number, string[]>;
}

/** Tarjan 求强连通分量（有向图） */
function tarjanSCC(
  nodeIds: string[],
  adj: Map<string, string[]>
): SccResult {
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Map<string, boolean>();
  const stack: string[] = [];
  const sccOf = new Map<string, number>();
  const sccNodes = new Map<number, string[]>();
  let sccCount = 0;

  const strongconnect = (v: string) => {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.set(v, true);

    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.get(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.set(w, false);
        comp.push(w);
      } while (w !== v);
      sccCount++;
      sccNodes.set(sccCount, comp);
      for (const id of comp) sccOf.set(id, sccCount);
    }
  };

  for (const id of nodeIds) {
    if (!indices.has(id)) strongconnect(id);
  }
  return { sccOf, sccNodes };
}

/** BFS 求从 start 沿出边可达的最远跳数（返回最大深度，0 表示无后继） */
function maxReachHops(start: string, graph: Map<string, string[]>): number {
  const visited = new Set<string>([start]);
  const queue: Array<{ id: string; depth: number }> = [{ id: start, depth: 0 }];
  let max = 0;
  while (queue.length) {
    const cur = queue.shift()!;
    max = Math.max(max, cur.depth);
    for (const next of graph.get(cur.id) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push({ id: next, depth: cur.depth + 1 });
      }
    }
  }
  return max;
}

/** 派生结构分：在环→high；fanIn 高→high；fanIn 中→medium；其余 low */
function deriveStructuralRisk(entry: ImpactIndexEntry): ImpactRiskLevel {
  if (entry.inCycle) return "high";
  if (entry.fanIn >= FANIN_HIGH) return "high";
  if (entry.fanIn >= FANIN_MEDIUM) return "medium";
  return "low";
}

/**
 * 计算整张图的 impactIndex（写图后同步维护，非读取时现算）
 * @param diagram 业务语义图（仅需 nodes/edges 的拓扑信息）
 * @returns nodeId → ImpactIndexEntry 映射
 */
export function computeImpactIndex(diagram: Diagram): ImpactIndexMap {
  const nodeIds = diagram.nodes.map((n) => n.nodeId);
  const nodeSet = new Set(nodeIds);

  // 仅保留端点均在节点集内的连线（悬空边忽略，避免污染拓扑）
  const validEdges = diagram.edges.filter(
    (e) => nodeSet.has(e.from) && nodeSet.has(e.to)
  );

  // 邻接表：adj = 出边（本节点 to），revAdj = 入边（指向本节点的 from）
  const adj = new Map<string, string[]>();
  const revAdj = new Map<string, string[]>();
  for (const n of nodeIds) {
    adj.set(n, []);
    revAdj.set(n, []);
  }
  for (const e of validEdges) {
    adj.get(e.from)!.push(e.to);
    revAdj.get(e.to)!.push(e.from);
  }

  // Tarjan 强连通分量（环检测）
  const { sccOf, sccNodes } = tarjanSCC(nodeIds, adj);

  const result: ImpactIndexMap = {};

  for (const nodeId of nodeIds) {
    const upstream = [...new Set(revAdj.get(nodeId) ?? [])];
    const downstream = [...new Set(adj.get(nodeId) ?? [])];
    const fanIn = upstream.length;
    const fanOut = downstream.length;

    // 环判定：所在 SCC 节点数 >1 算环；自身存在自环（from===to）也算环
    const sccIdx = sccOf.get(nodeId);
    const sccSet = sccIdx !== undefined ? sccNodes.get(sccIdx)! : [];
    const selfLoop = validEdges.some(
      (e) => e.from === nodeId && e.to === nodeId
    );
    const inCycle = sccSet.length > 1 || selfLoop;

    // 所属环节点集：SCC 集合 + 自环自身，去重合并
    const cycleIds =
      inCycle && sccSet.length > 1
        ? selfLoop
          ? [...new Set([...sccSet, nodeId])]
          : sccSet
        : selfLoop
          ? [nodeId]
          : [];

    const entry: ImpactIndexEntry = {
      upstream,
      downstream,
      upstreamHops: maxReachHops(nodeId, revAdj),
      downstreamHops: maxReachHops(nodeId, adj),
      fanIn,
      fanOut,
      inCycle,
      cycleIds,
      structuralRisk: "low"
    };
    entry.structuralRisk = deriveStructuralRisk(entry);
    result[nodeId] = entry;
  }

  return result;
}