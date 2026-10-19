import { CONFIG } from './config';
import { dist, distToSegment, pointAt, pointInPolygon, polylineLength, v, type Vec2 } from './geom';
import type { MapDef, Mode } from './types';

/** Extra cost per unit on every route so free roads still prefer the shorter way. */
const LENGTH_BIAS: Record<Mode, number> = { rail: 6, road: 2 };

/**
 * Terrain lookups and route finding for new track and road. Routes are found on a
 * coarse grid (A*), straightened where the terrain allows, then smoothed into curves.
 */
export class Terrain {
  readonly cell = CONFIG.grid;
  readonly cols: number;
  readonly rows: number;
  private water: Uint8Array;
  private hill: Uint8Array;
  private road: Uint8Array;
  /** Industry yards, which routes avoid. */
  private site: Uint8Array;
  private street = CONFIG.lot * CONFIG.streetEvery;

  constructor(readonly map: MapDef) {
    this.cols = Math.ceil((map.halfW * 2) / this.cell);
    this.rows = Math.ceil((map.halfH * 2) / this.cell);
    const n = this.cols * this.rows;
    this.water = new Uint8Array(n);
    this.hill = new Uint8Array(n);
    this.road = new Uint8Array(n);
    this.site = new Uint8Array(n);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const p = this.center(c, r);
        const i = r * this.cols + c;
        this.water[i] = map.water.some((w) => pointInPolygon(p, w)) ? 1 : 0;
        this.hill[i] = map.hills.some((h) => pointInPolygon(p, h)) ? 1 : 0;
        this.road[i] = map.roads.some((rd) => nearPolyline(p, rd, this.cell * 0.6)) ? 1 : 0;
        this.site[i] = map.industries.some((ind) => dist(ind.pos, p) < 150) ? 1 : 0;
      }
    }
  }

  private center(c: number, r: number): Vec2 {
    return v(-this.map.halfW + (c + 0.5) * this.cell, -this.map.halfH + (r + 0.5) * this.cell);
  }

  private cellOf(p: Vec2): number {
    const c = Math.max(0, Math.min(this.cols - 1, Math.floor((p.x + this.map.halfW) / this.cell)));
    const r = Math.max(0, Math.min(this.rows - 1, Math.floor((p.y + this.map.halfH) / this.cell)));
    return r * this.cols + c;
  }

  /** Build cost per world unit at p. Country roads and, inside towns, the street grid are free for road vehicles. */
  unitCost(mode: Mode, p: Vec2, inTown: (p: Vec2) => boolean): number {
    const i = this.cellOf(p);
    const c = CONFIG.way[mode];
    if (mode === 'road' && this.road[i]) return 0;
    const town = inTown(p);
    if (mode === 'road' && town && this.onStreet(p)) return 0;
    if (this.water[i]) return c.bridge;
    // Through a town or an industry yard means demolition and detours: dearer.
    const extra = town || this.site[i] ? 1.6 : 1;
    return c.build * (this.hill[i] ? c.hill : 1) * extra;
  }

  /** True on the town street grid (within half a cell of a street line). */
  onStreet(p: Vec2): boolean {
    const near = (x: number) => Math.abs(x - Math.round(x / this.street) * this.street) < this.cell / 2;
    return near(p.x) || near(p.y);
  }

  /** Move a point next to a country road onto the road itself. */
  private snapToRoad(p: Vec2): Vec2 {
    let best = p;
    let bd = Infinity;
    for (const road of this.map.roads) {
      for (let i = 1; i < road.length; i++) {
        const q = closestOnSegment(p, road[i - 1], road[i]);
        const d = dist(p, q);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
    }
    return best;
  }

  /** Move a point that lies in a street corridor onto the street line itself. */
  private snapToStreet(p: Vec2): Vec2 {
    const s = this.street;
    const half = this.cell / 2;
    const sx = Math.round(p.x / s) * s;
    const sy = Math.round(p.y / s) * s;
    return v(Math.abs(p.x - sx) < half ? sx : p.x, Math.abs(p.y - sy) < half ? sy : p.y);
  }

  isRoad(p: Vec2): boolean {
    return this.road[this.cellOf(p)] === 1;
  }

  /** Construction cost of a path, sampled every 10 units. */
  pathCost(mode: Mode, path: Vec2[], inTown: (p: Vec2) => boolean): number {
    const len = polylineLength(path);
    const n = Math.max(1, Math.ceil(len / 10));
    const step = len / n;
    let cost = 0;
    for (let i = 0; i < n; i++) cost += this.unitCost(mode, pointAt(path, (i + 0.5) * step).p, inTown) * step;
    return cost;
  }

  /** Cheapest route from a to b for this mode, as a smooth polyline. */
  route(mode: Mode, a: Vec2, b: Vec2, inTown: (p: Vec2) => boolean): Vec2[] {
    if (dist(a, b) < this.cell * 1.5) return [a, b];
    const n = this.cols * this.rows;
    const unit = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / this.cols);
      unit[i] = this.unitCost(mode, this.center(i - r * this.cols, r), inTown) + LENGTH_BIAS[mode];
    }
    const start = this.cellOf(a);
    const goal = this.cellOf(b);
    const g = new Float64Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new Heap();
    const minUnit = LENGTH_BIAS[mode];
    const gx = goal % this.cols;
    const gy = Math.floor(goal / this.cols);
    const h = (i: number) => Math.hypot((i % this.cols) - gx, Math.floor(i / this.cols) - gy) * this.cell * minUnit;
    g[start] = 0;
    heap.push(start, h(start));
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % this.cols;
      const cy = Math.floor(cur / this.cols);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
          const nb = ny * this.cols + nx;
          if (closed[nb]) continue;
          const step = (dx && dy ? Math.SQRT2 : 1) * this.cell;
          const cost = g[cur] + ((unit[cur] + unit[nb]) / 2) * step;
          if (cost < g[nb]) {
            g[nb] = cost;
            from[nb] = cur;
            heap.push(nb, cost + h(nb));
          }
        }
      }
    }
    const cells: number[] = [];
    for (let i = goal; i >= 0; i = from[i]) {
      cells.push(i);
      if (i === start) break;
    }
    cells.reverse();
    const mid = cells.slice(1, -1).map((i) => {
      const p = this.center(i % this.cols, Math.floor(i / this.cols));
      if (mode !== 'road') return p;
      if (this.road[i]) return this.snapToRoad(p);
      return inTown(p) ? this.snapToStreet(p) : p;
    });
    return smooth(this.straighten(mode, [a, ...mid, b], inTown), mode === 'rail' ? 140 : 24);
  }

  /** Drop grid points wherever a straight cut costs no more than the stair-stepped route. */
  private straighten(mode: Mode, pts: Vec2[], inTown: (p: Vec2) => boolean): Vec2[] {
    const bias = LENGTH_BIAS[mode];
    const legCost = (a: Vec2, b: Vec2) => {
      const len = dist(a, b);
      const n = Math.max(1, Math.ceil(len / (this.cell / 2)));
      let c = 0;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        c += this.unitCost(mode, v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), inTown);
      }
      return (c / n + bias) * len;
    };
    // Cumulative cost along the grid route, so any stretch of it is priced in O(1).
    const acc = [0];
    for (let k = 1; k < pts.length; k++) acc.push(acc[k - 1] + legCost(pts[k - 1], pts[k]));
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      while (j + 1 < pts.length && legCost(pts[i], pts[j + 1]) <= (acc[j + 1] - acc[i]) * 1.001) j++;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}

/** Two rounds of Chaikin corner cutting, each cut at most `maxCut` long; endpoints stay put. */
function smooth(pts: Vec2[], maxCut: number): Vec2[] {
  let p = pts;
  for (let k = 0; k < 2 && p.length > 2; k++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      const f = Math.min(0.25, maxCut / Math.max(1, dist(a, b)));
      if (i > 0) out.push(v(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f));
      if (i < p.length - 2) out.push(v(b.x + (a.x - b.x) * f, b.y + (a.y - b.y) * f));
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return v(a.x + dx * t, a.y + dy * t);
}

function nearPolyline(p: Vec2, path: Vec2[], r: number): boolean {
  for (let i = 1; i < path.length; i++) if (distToSegment(p, path[i - 1], path[i]) < r) return true;
  return false;
}

/** Minimal binary min-heap of (id, priority). */
export class Heap {
  private ids: number[] = [];
  private pri: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, p: number): void {
    const ids = this.ids;
    const pri = this.pri;
    let i = ids.length;
    ids.push(id);
    pri.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (pri[up] <= p) break;
      ids[i] = ids[up];
      pri[i] = pri[up];
      i = up;
    }
    ids[i] = id;
    pri[i] = p;
  }

  pop(): number {
    const ids = this.ids;
    const pri = this.pri;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastP = pri.pop()!;
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= lastP) break;
        ids[i] = ids[c];
        pri[i] = pri[c];
        i = c;
      }
      ids[i] = lastId;
      pri[i] = lastP;
    }
    return top;
  }
}
