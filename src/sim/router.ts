import { CONFIG } from './config';
import { dist } from './geom';
import type { Line, Stop, Vehicle } from './types';

/**
 * Passenger routing on a platform graph (ported from Small Subway).
 *
 * Nodes: P(s) = waiting at stop s; O(i, L, d) = aboard a vehicle of line L at
 * stop index i that will depart in index direction d. One backward Dijkstra
 * per destination district gives the cost-to-go from every node; passengers
 * then decide locally whether to board, stay aboard, alight or walk.
 *
 * Costs are seconds. Transfers use half the line headway plus a penalty; the
 * origin wait is projected from actual vehicle positions. Walking edges join
 * stops closer than CONFIG.walkRange, so rail and bus can feed each other.
 */

export interface RouterHost {
  stops: Stop[];
  lines: Line[];
  vehicles: Vehicle[];
  stopById(id: number): Stop | undefined;
  speedOf(line: Line): number;
  dwellOf(line: Line): number;
}

const TRANSFER_PENALTY = 6;
const REVERSAL_PENALTY = 3;
const EPOCH = 0.5;

export function nextIdx(line: Line, i: number, d: number): number {
  const n = line.stops.length;
  const j = i + d;
  return line.loop ? (j + n) % n : j;
}

export function departDir(line: Line, i: number, arrDir: 1 | -1): 1 | -1 {
  if (line.loop) return arrDir;
  const j = i + arrDir;
  return j < 0 || j >= line.stops.length ? (-arrDir as 1 | -1) : arrDir;
}

export function segIndex(line: Line, i: number, d: number): number {
  return d > 0 ? i : nextIdx(line, i, -1);
}

interface Edge {
  to: number;
  cost: number;
}

export type Choice = { kind: 'board'; line: number; dir: 1 | -1; cost: number } | { kind: 'walk'; to: number; cost: number };

export class Router {
  private dirty = true;
  private nextEpoch = 0;
  private nodeCount = 0;
  private platform = new Map<number, number>();
  private onboard = new Map<string, number>();
  private nodeStop: number[] = [];
  private rev: Edge[][] = [];
  private walks = new Map<number, { to: number; cost: number }[]>();
  private costs = new Map<number, Float64Array>();
  private waitCache = new Map<string, number>();
  private choiceCache = new Map<string, Choice | null>();

  constructor(private host: RouterHost) {}

  invalidate(): void {
    this.dirty = true;
  }

  /** Increments whenever the graph is rebuilt, so callers can cache reachability. */
  version = 0;

  update(time: number): void {
    if (this.dirty) this.build();
    if (time >= this.nextEpoch) {
      this.nextEpoch = time + EPOCH;
      this.waitCache.clear();
      this.choiceCache.clear();
    }
  }

  private lineById(id: number): Line | undefined {
    return this.host.lines.find((l) => l.id === id);
  }

  private vehiclesOn(lineId: number): Vehicle[] {
    return this.host.vehicles.filter((t) => t.line === lineId);
  }

  private headway(line: Line): number {
    const n = this.vehiclesOn(line.id).length;
    if (n === 0) return Infinity;
    let total = 0;
    for (const s of line.segs) total += s.length / this.host.speedOf(line) + this.host.dwellOf(line);
    return (line.loop ? total : 2 * total) / n;
  }

  private rideCost(line: Line, i: number, d: 1 | -1): number {
    return line.segs[segIndex(line, i, d)].length / this.host.speedOf(line) + this.host.dwellOf(line);
  }

  private build(): void {
    this.dirty = false;
    this.version++;
    this.platform.clear();
    this.onboard.clear();
    this.walks.clear();
    this.nodeStop = [];
    this.costs.clear();
    this.waitCache.clear();
    this.choiceCache.clear();
    const fwd: Edge[][] = [];
    const add = (stop: number): number => {
      this.nodeStop.push(stop);
      fwd.push([]);
      return this.nodeStop.length - 1;
    };
    for (const s of this.host.stops) this.platform.set(s.id, add(s.id));
    const lines = this.host.lines.filter((l) => l.stops.length >= 2 && isFinite(this.headway(l)));
    for (const line of lines) {
      line.stops.forEach((sid, i) => {
        for (const d of [1, -1] as const) {
          if (!line.loop && (i + d < 0 || i + d >= line.stops.length)) continue;
          this.onboard.set(`${line.id}:${i}:${d}`, add(sid));
        }
      });
    }
    for (const line of lines) {
      const hw = this.headway(line);
      line.stops.forEach((sid, i) => {
        for (const d of [1, -1] as const) {
          const o = this.onboard.get(`${line.id}:${i}:${d}`);
          if (o === undefined) continue;
          const p = this.platform.get(sid)!;
          fwd[o].push({ to: p, cost: 0 });
          fwd[p].push({ to: o, cost: hw / 2 + TRANSFER_PENALTY });
          const j = nextIdx(line, i, d);
          const d2 = departDir(line, j, d);
          const o2 = this.onboard.get(`${line.id}:${j}:${d2}`)!;
          fwd[o].push({ to: o2, cost: this.rideCost(line, i, d) + (d2 !== d ? REVERSAL_PENALTY : 0) });
        }
      });
    }
    // Walking between nearby stops (only stops that some line serves are worth walking to).
    const served = new Set(lines.flatMap((l) => l.stops));
    for (const a of this.host.stops) {
      for (const b of this.host.stops) {
        if (a.id === b.id || !served.has(b.id)) continue;
        const dd = dist(a.pos, b.pos);
        if (dd > CONFIG.walkRange) continue;
        const cost = dd / CONFIG.walkSpeed + TRANSFER_PENALTY;
        fwd[this.platform.get(a.id)!].push({ to: this.platform.get(b.id)!, cost });
        const list = this.walks.get(a.id) ?? [];
        list.push({ to: b.id, cost });
        this.walks.set(a.id, list);
      }
    }
    this.nodeCount = fwd.length;
    this.rev = Array.from({ length: this.nodeCount }, () => []);
    fwd.forEach((edges, from) => edges.forEach((e) => this.rev[e.to].push({ to: from, cost: e.cost })));
  }

  /** Cost-to-go table toward any stop covering district `dest`. */
  private costTo(dest: number): Float64Array {
    let c = this.costs.get(dest);
    if (c) return c;
    c = new Float64Array(this.nodeCount).fill(Infinity);
    const heap = new MinHeap();
    for (let n = 0; n < this.nodeCount; n++) {
      if (this.host.stopById(this.nodeStop[n])?.covers.has(dest)) {
        c[n] = 0;
        heap.push(n, 0);
      }
    }
    while (heap.size) {
      const [n, cost] = heap.pop();
      if (cost > c[n]) continue;
      for (const e of this.rev[n]) {
        const nc = cost + e.cost;
        if (nc < c[e.to]) {
          c[e.to] = nc;
          heap.push(e.to, nc);
        }
      }
    }
    this.costs.set(dest, c);
    return c;
  }

  /** Estimated seconds from waiting at `stop` to reaching `dest`, Infinity if unreachable. */
  costFrom(stop: number, dest: number): number {
    const p = this.platform.get(stop);
    return p === undefined ? Infinity : this.costTo(dest)[p];
  }

  private stayCost(line: Line, i: number, d: 1 | -1, c: Float64Array): number {
    if (this.onboard.get(`${line.id}:${i}:${d}`) === undefined) return Infinity;
    const j = nextIdx(line, i, d);
    const d2 = departDir(line, j, d);
    const o2 = this.onboard.get(`${line.id}:${j}:${d2}`);
    if (o2 === undefined) return Infinity;
    return this.rideCost(line, i, d) + (d2 !== d ? REVERSAL_PENALTY : 0) + c[o2];
  }

  /** Projected seconds until a vehicle of `line` is at stop i ready to depart in direction d. */
  originWait(line: Line, i: number, d: 1 | -1): number {
    const key = `${line.id}:${i}:${d}`;
    const hit = this.waitCache.get(key);
    if (hit !== undefined) return hit;
    const v = this.host.speedOf(line);
    const n = line.stops.length;
    let best = Infinity;
    for (const t of this.vehiclesOn(line.id)) {
      if (t.orphan) continue;
      let idx: number;
      let dirArr: 1 | -1;
      let time: number;
      if (t.state === 'dwelling') {
        if (t.fromIdx === i && t.dir === d) {
          best = 0;
          break;
        }
        time = this.rideCost(line, t.fromIdx, t.dir);
        idx = nextIdx(line, t.fromIdx, t.dir);
        dirArr = t.dir;
      } else {
        idx = t.toIdx;
        dirArr = t.dir;
        time = Math.max(0, t.pathLen - t.d) / v;
      }
      for (let k = 0; k < 2 * n + 2 && time < best; k++) {
        const dep = departDir(line, idx, dirArr);
        if (idx === i && dep === d) {
          best = Math.min(best, time);
          break;
        }
        time += this.rideCost(line, idx, dep);
        idx = nextIdx(line, idx, dep);
        dirArr = dep;
      }
    }
    this.waitCache.set(key, best);
    return best;
  }

  /** Best move from waiting at `stop`: board a line in a direction, walk, or nothing. A docked vehicle counts as zero wait. */
  decide(stop: Stop, dest: number, docked?: Vehicle, mayWalk = true): Choice | null {
    const key = `${stop.id}:${dest}:${mayWalk ? 1 : 0}`;
    if (!docked && this.choiceCache.has(key)) return this.choiceCache.get(key)!;
    const c = this.costTo(dest);
    let best: Choice | null = null;
    for (const line of this.host.lines) {
      const i = line.stops.indexOf(stop.id);
      if (i < 0) continue;
      for (const d of [1, -1] as const) {
        const stay = this.stayCost(line, i, d, c);
        if (!isFinite(stay)) continue;
        const isDocked = docked && docked.line === line.id && !docked.orphan && docked.fromIdx === i && docked.dir === d;
        const total = (isDocked ? 0 : this.originWait(line, i, d)) + stay;
        if (isFinite(total) && (!best || total < best.cost)) best = { kind: 'board', line: line.id, dir: d, cost: total };
      }
    }
    if (mayWalk) {
      for (const w of this.walks.get(stop.id) ?? []) {
        const p = this.platform.get(w.to);
        const total = p === undefined ? Infinity : w.cost + c[p];
        if (isFinite(total) && (!best || total < best.cost)) best = { kind: 'walk', to: w.to, cost: total };
      }
    }
    if (!docked) this.choiceCache.set(key, best);
    return best;
  }

  /** What a rider on `vehicle` does at its current stop (it departs in vehicle.dir). */
  decideAlight(vehicle: Vehicle, stop: Stop, dest: number): 'deliver' | 'alight' | 'stay' {
    if (stop.covers.has(dest)) return 'deliver';
    const line = this.lineById(vehicle.line);
    const c = this.costTo(dest);
    const p = this.platform.get(stop.id);
    const alight = p === undefined ? Infinity : c[p];
    if (!line || vehicle.orphan) return 'stay';
    const stay = this.stayCost(line, vehicle.fromIdx, vehicle.dir, c);
    if (!isFinite(alight)) return 'stay';
    return alight + 0.5 < stay ? 'alight' : 'stay';
  }

  /** Same decision, evaluated before the vehicle reaches stop i. */
  wouldAlight(line: Line, i: number, dep: 1 | -1, stop: Stop, dest: number): boolean {
    if (stop.covers.has(dest)) return true;
    const c = this.costTo(dest);
    const p = this.platform.get(stop.id);
    const alight = p === undefined ? Infinity : c[p];
    if (!isFinite(alight)) return false;
    return alight + 0.5 < this.stayCost(line, i, dep, c);
  }
}

class MinHeap {
  private items: [number, number][] = [];
  get size(): number {
    return this.items.length;
  }
  push(node: number, cost: number): void {
    const a = this.items;
    a.push([node, cost]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][1] <= a[i][1]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][1] < a[m][1]) m = l;
        if (r < a.length && a[r][1] < a[m][1]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
