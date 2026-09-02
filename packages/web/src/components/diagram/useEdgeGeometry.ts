/**
 * 端点几何约束工具（T73/T74/T75/T76/T80/T77）
 *
 * 连线端点约束核心：
 * - 端点永远落在节点四边（含四角），不能进入节点内部或脱离节点；
 * - 端点可沿四边连续滑动并跨过角到相邻边（draw.io 式自由贴边）；
 * - 连线路径严格横平竖直：任意路径可正交化（补最小折点），冗余平行段可合并；
 * - T77 箭头垂直：无论端点落在节点哪条边，末段始终垂直进入该边，箭头垂直于边。
 */

/** 节点盒子（位置 + 尺寸） */
export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

const EPS = 0.5;

/** 点到点距离 */
export function dist(p: Point, q: Point): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/**
 * 把任意点吸附到节点四边的最近投影（跨边支持）。
 * 取到四条边距离最小的一条，投影到该边上；四角自然落在两条边交点。
 * 端点永远落在边框上（含四角），不会进入节点内部。
 */
export function snapToNodeBorder(point: Point, box: NodeBox): Point {
  const cx = Math.min(Math.max(point.x, box.x), box.x + box.width);
  const cy = Math.min(Math.max(point.y, box.y), box.y + box.height);
  const dLeft = Math.abs(cx - box.x);
  const dRight = Math.abs(box.x + box.width - cx);
  const dTop = Math.abs(cy - box.y);
  const dBottom = Math.abs(box.y + box.height - cy);
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  if (min === dTop) return { x: cx, y: box.y };
  if (min === dBottom) return { x: cx, y: box.y + box.height };
  if (min === dLeft) return { x: box.x, y: cy };
  return { x: box.x + box.width, y: cy };
}

/** 点到节点边框的最近距离（用于端点命中判定，支持跨边）。
 * 点在框内时距离为到最近边的距离；框外取到四边最近投影距离。
 */
export function distToBorder(point: Point, box: NodeBox): number {
  const snapped = snapToNodeBorder(point, box);
  return dist(point, snapped);
}

/* ========== T77 箭头垂直修正：按端点所在边生成垂直进入路径 ========== */

/** 端点所在边类型 */
export type EdgeSide = "top" | "bottom" | "left" | "right";

/** 垂直进入路径的出/入 stub 长度（端点外侧垂直出/入的一小段，保证箭头垂直） */
const ENTRY_STUB = 24;

/** 边类型 → 外向法线（垂直单位向量，背离节点） */
export function edgeNormal(side: EdgeSide): Point {
  switch (side) {
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
  }
}

/**
 * 判定吸附在节点边框上的端点所在边（T77）。
 * 端点须已吸附（snapToNodeBorder 输出）；四角同时落在两条边时，
 * 按 toward（另一端点/来向）与边外向法线的夹角取最接近的一边，保证箭头方向稳定。
 */
export function edgeSideOf(point: Point, box: NodeBox, toward?: Point): EdgeSide {
  const left = Math.abs(point.x - box.x) < EPS;
  const right = Math.abs(point.x - (box.x + box.width)) < EPS;
  const top = Math.abs(point.y - box.y) < EPS;
  const bottom = Math.abs(point.y - (box.y + box.height)) < EPS;
  const candidates: EdgeSide[] = [];
  if (top) candidates.push("top");
  if (bottom) candidates.push("bottom");
  if (left) candidates.push("left");
  if (right) candidates.push("right");
  if (candidates.length === 0) {
    // 端点未严格落在边框（容差外）：先吸附再判定
    return edgeSideOf(snapToNodeBorder(point, box), box, toward);
  }
  if (candidates.length === 1) return candidates[0];
  // 四角：外向法线与「朝 toward 方向」最接近的一边
  const v = toward ? { x: toward.x - point.x, y: toward.y - point.y } : { x: 0, y: -1 };
  const len = Math.hypot(v.x, v.y) || 1;
  let best = candidates[0];
  let bestDot = -Infinity;
  for (const c of candidates) {
    const n = edgeNormal(c);
    const dot = (v.x * n.x + v.y * n.y) / len;
    if (dot > bestDot) {
      bestDot = dot;
      best = c;
    }
  }
  return best;
}

/** 移除连续重复点（stub 与折点重合时去重） */
function dedupePoints(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
    out.push({ ...p });
  }
  return out;
}

/**
 * 按端点所在边生成垂直进入路径（T77 重布线/正交化兜底用）。
 * a 已吸附在 boxA 边框、b 已吸附在 boxB 边框；生成正交路径：
 * 首段沿 a 所在边外向法线垂直出线，末段沿 b 所在边内向法线垂直进入（箭头垂直于 b 边）。
 * 两端点各保留一段出/入 stub；stub 段不可合并（合并会破坏垂直进入）。
 */
export function perpendicularEntryPath(
  a: Point,
  boxA: NodeBox,
  b: Point,
  boxB: NodeBox,
  stub = ENTRY_STUB
): Point[] {
  const na = edgeNormal(edgeSideOf(a, boxA, b));
  const nb = edgeNormal(edgeSideOf(b, boxB, a));
  const a1 = { x: a.x + na.x * stub, y: a.y + na.y * stub };
  const b1 = { x: b.x + nb.x * stub, y: b.y + nb.y * stub };
  // 首段垂直时：a1 水平接 b1.x → 垂直进 b1；首段水平时：a1 垂直接 b1.y → 水平进 b1
  const mid = na.x === 0 ? { x: b1.x, y: a1.y } : { x: a1.x, y: b1.y };
  return dedupePoints([a, a1, mid, b1, b]);
}

/** 修正末段：端点在 box 边框上，末段须垂直且朝内（stair 插入 stub，保留手工路由） */
function fixEnd(pts: Point[], box: NodeBox, stub: number): Point[] {
  const n = pts.length;
  if (n < 2) return pts;
  const b = pts[n - 1];
  const p = pts[n - 2];
  const nb = edgeNormal(edgeSideOf(b, box, p));
  const dx = b.x - p.x;
  const dy = b.y - p.y;
  // 已垂直且朝内（指向节点内部）：无需改动
  const aligned = nb.x !== 0 ? Math.abs(dy) < EPS : Math.abs(dx) < EPS;
  const inward = dx * -nb.x + dy * -nb.y > 0;
  if (aligned && inward) return pts;
  const entry = { x: b.x + nb.x * stub, y: b.y + nb.y * stub };
  const corner = nb.x === 0 ? { x: p.x, y: entry.y } : { x: entry.x, y: p.y };
  const out = pts.slice(0, -1);
  out.push(corner, entry, b);
  return dedupePoints(out);
}

/** 修正首段：与 fixEnd 对称（反转 → fixEnd → 反转），首段垂直出线 */
function fixStart(pts: Point[], box: NodeBox, stub: number): Point[] {
  return fixEnd([...pts].reverse(), box, stub).reverse();
}

/**
 * 保持手工路由，仅修正端点段的垂直进入/出线（T77 手动拖端点/线段）。
 * aBox/bBox 为端点所在节点盒子，缺省的一侧不处理。
 */
export function ensurePerpendicularEnds(
  pts: Point[],
  aBox: NodeBox | null | undefined,
  bBox: NodeBox | null | undefined,
  stub = ENTRY_STUB
): Point[] {
  let out = pts.map((p) => ({ ...p }));
  if (aBox) out = fixStart(out, aBox, stub);
  if (bBox) out = fixEnd(out, bBox, stub);
  return out;
}

/**
 * 端点沿边拖动的端点段重画（T77 拖端点专用）。
 * 端点吸附在 box 边框后，仅重画端点段——沿端点所在边法线垂直出/入（箭头垂直所在边），
 * 保留其余手工折点不变，避免拖拽中整条路径跳变。idx=0 为首端（垂直出线），idx=末为末端（垂直进入）。
 */
export function moveEdgeEndpoint(
  pts: Point[],
  idx: number,
  e: Point,
  box: NodeBox,
  stub = ENTRY_STUB
): Point[] {
  const n = pts.length;
  if (n < 2 || (idx !== 0 && idx !== n - 1)) return pts;
  const out = pts.map((p) => ({ ...p }));
  out[idx] = { ...e };
  const adjIdx = idx === 0 ? 1 : n - 2;
  const p = out[adjIdx];
  const nb = edgeNormal(edgeSideOf(e, box, p));
  const entry = { x: e.x + nb.x * stub, y: e.y + nb.y * stub };
  // p → entry 的正交连接（[p, corner, entry] 或 [p, entry]）
  const leg = orthogonalPath(p, entry);
  if (idx === 0) {
    // 首段垂直出线：e → entry（沿外向法线）→ 反转接入 p 及后续点
    const rev = leg.slice().reverse(); // [entry, corner?, p]
    return dedupePoints([e, ...rev, ...out.slice(2)]);
  }
  // 末段垂直进入：前点保持，p → corner → entry → e
  return dedupePoints([...out.slice(0, n - 2), ...leg, e]);
}

/** 线段是否水平（允许小误差） */
export function isHorizontal(a: Point, b: Point): boolean {
  return Math.abs(a.y - b.y) < EPS;
}

/** 线段是否垂直（允许小误差） */
export function isVertical(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPS;
}

/** 相邻两点是否构成斜线段（既非水平也非垂直） */
export function isDiagonal(a: Point, b: Point): boolean {
  return !isHorizontal(a, b) && !isVertical(a, b);
}

/**
 * 正交化路径：若路径存在斜线段，以首末点为基准重新生成正交阶梯折线（Z 形）。
 * 同轴（水平/垂直）直接两点；否则先垂直出线、水平中段、垂直进线。
 * T77：传入两端节点盒子时，按端点所在边生成垂直进入路径（箭头垂直所在边）。
 * 返回的路径保证相邻点严格横平竖直。
 */
export function orthogonalizePath(
  pts: Point[],
  aBox?: NodeBox | null,
  bBox?: NodeBox | null
): Point[] {
  if (pts.length < 2) return pts;
  if (!pts.some((p, i) => i > 0 && isDiagonal(pts[i - 1], p))) return pts.map((p) => ({ ...p }));
  if (aBox && bBox) return perpendicularEntryPath(pts[0], aBox, pts[pts.length - 1], bBox);
  return orthogonalPath(pts[0], pts[pts.length - 1]);
}

/**
 * 以两端点为起止生成正交阶梯折线（T76 重布线用；端点已吸附在节点边框）。
 * 一般情形：A 垂直出线 → 水平中段 → 垂直进 B；
 * 同轴水平/垂直直接两点。
 */
export function orthogonalPath(a: Point, b: Point): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dy) < EPS) return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
  if (Math.abs(dx) < EPS) return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
  const midY = a.y + dy / 2;
  return [
    { x: a.x, y: a.y },
    { x: a.x, y: midY },
    { x: b.x, y: midY },
    { x: b.x, y: b.y }
  ];
}

/**
 * 共线合并（T79）：折线路径中，若相邻三段的中间段消失后两侧平行段共线（同一水平线/竖直线），
 * 则移除中间折点、删除中间段，将两条平行段合并为一段。
 * 仅合并中间折点（不触碰首末端点锚点）。返回合并后的路径；无可合并返回原路径。
 *
 * 判定：p[i-1] 与 p[i+1] 共线（x 或 y 相等）即认为中间折点 p[i] 冗余，可移除。
 * 反复扫描直到无冗余折点。
 */
export function mergeCollinear(pts: Point[]): Point[] {
  if (pts.length < 3) return pts;
  let out = pts.map((p) => ({ ...p }));
  let changed = true;
  while (changed) {
    changed = false;
    if (out.length < 3) break;
    for (let i = out.length - 2; i >= 1; i--) {
      const prev = out[i - 1];
      const cur = out[i];
      const next = out[i + 1];
      // 两侧段与中间段方向一致且共线：x 相同（竖）或 y 相同（横）
      if (Math.abs(prev.x - cur.x) < EPS && Math.abs(cur.x - next.x) < EPS) {
        out.splice(i, 1);
        changed = true;
      } else if (Math.abs(prev.y - cur.y) < EPS && Math.abs(cur.y - next.y) < EPS) {
        out.splice(i, 1);
        changed = true;
      }
    }
  }
  return out;
}
