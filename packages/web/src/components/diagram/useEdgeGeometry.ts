/**
 * 端点几何约束工具（T73/T74/T75/T76/T80）
 *
 * 连线端点约束核心：
 * - 端点永远落在节点四边（含四角），不能进入节点内部或脱离节点；
 * - 端点可沿四边连续滑动并跨过角到相邻边（draw.io 式自由贴边）；
 * - 连线路径严格横平竖直：任意路径可正交化（补最小折点），冗余平行段可合并。
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

/**
 * 点到节点边框的最近距离（用于端点命中判定，支持跨边）。
 * 点在框内时距离为到最近边的距离；框外取到四边最近投影距离。
 */
export function distToBorder(point: Point, box: NodeBox): number {
  const snapped = snapToNodeBorder(point, box);
  return dist(point, snapped);
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
 * 返回的路径保证相邻点严格横平竖直。
 */
export function orthogonalizePath(pts: Point[]): Point[] {
  if (pts.length < 2) return pts;
  if (!pts.some((p, i) => i > 0 && isDiagonal(pts[i - 1], p))) return pts.map((p) => ({ ...p }));
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
