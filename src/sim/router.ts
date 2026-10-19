import { CONFIG } from './config';
import { dist } from './geom';
import { Heap } from './terrain';
import type { Carries, Line, Stop, Vehicle, VehicleType } from './types';

/**
 * Routing between stops for groups of passengers or cargo.
 *
 * The graph has one node per stop. Riding a line from stop i to any later stop j
 * is one edge costing the expected wait (half the headway plus a transfer
 * penalty) and the travel time; walking joins stops closer than
 * CONFIG.walkRange. Passengers and cargo use separate graphs, because a line
 * only carries what its vehicles can carry. One backward Dijkstra per
 * destination, computed on demand and cached until the network changes, gives
 * the cost and the next hop from every stop.
 */

export interface RouterHost {
  stops: Stop[];
  lines: Line[];
  vehicles: Vehicle[];
}

export type Hop = { kind: 'ride'; line: number; to: number } | { kind: 'walk'; to: number };

interface Edge {
  from: number;
  cost: number;
  hop: Hop;
}

interface Table {
  cost: Float64Array;
  hop: (Hop | null)[];
}

const TRANSFER_PENALTY = 6;

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

/** True when a vehicle leaving stop index i in direction dir reaches index j before turning back. */
export function ahead(line: Line, i: number, dir: 1 | -1, j: number): boolean {
  if (j === i || j < 0) return false;
  if (line.loop) return true;
  return dir > 0 ? j > i : j < i;
}

/** Seconds per segment, with a little allowance for acceleration and the stop. */
export function segmentTimes(line: Line, type: VehicleType): number[] {
  return line.segs.map((s) => (s.length / type.speed) * 1.15 + type.minDwell + 1);
}

/** Seconds for one vehicle to come back to where it started. */
export function roundTrip(line: Line, type: VehicleType): number {
  const t = segmentTimes(line, type).reduce((a, b) => a + b, 0);
  return line.loop ? t : t * 2;
}

export class Router {
  /** Increments whenever the graph is rebuilt, so callers can cache what they derive from it. */
  version = 0;
  private dirty = true;
  private node = new Map<number, number>();
  private ids: number[] = [];
  private rev: Record<Carries, Edge[][]> = { pax: [], cargo: [] };
  private tables: Record<Carries, Map<number, Table>> = { pax: new Map(), cargo: new Map() };

  constructor(private host: RouterHost) {}

  invalidate(): void {
    this.dirty = true;
  }

  /** Expected seconds from stop `from` to stop `to`; Infinity when unreachable. */
  cost(k: Carries, from: number, to: number): number {
    if (from === to) return 0;
    const t = this.table(k, to);
    const i = this.node.get(from);
    return t && i !== undefined ? t.cost[i] : Infinity;
  }

  /** First step from `from` toward `to`, or null when there is no route. */
  hop(k: Carries, from: number, to: number): Hop | null {
    const t = this.table(k, to);
    const i = this.node.get(from);
    return t && i !== undefined ? t.hop[i] : null;
  }

  private table(k: Carries, dest: number): Table | undefined {
    this.ensure();
    const cached = this.tables[k].get(dest);
    if (cached) return cached;
    const d = this.node.get(dest);
    if (d === undefined) return undefined;
    const n = this.ids.length;
    const cost = new Float64Array(n).fill(Infinity);
    const hop: (Hop | null)[] = new Array(n).fill(null);
    const done = new Uint8Array(n);
    const heap = new Heap();
    cost[d] = 0;
    heap.push(d, 0);
    const rev = this.rev[k];
    while (heap.size) {
      const u = heap.pop();
      if (done[u]) continue;
      done[u] = 1;
      for (const e of rev[u]) {
        const c = cost[u] + e.cost;
        if (c < cost[e.from]) {
          cost[e.from] = c;
          hop[e.from] = e.hop;
          heap.push(e.from, c);
        }
      }
    }
    const t = { cost, hop };
    this.tables[k].set(dest, t);
    return t;
  }

  private ensure(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.version++;
    const { stops, lines, vehicles } = this.host;
    this.node = new Map(stops.map((s, i) => [s.id, i]));
    this.ids = stops.map((s) => s.id);
    this.tables = { pax: new Map(), cargo: new Map() };
    for (const k of ['pax', 'cargo'] as const) {
      const rev: Edge[][] = stops.map(() => []);
      for (const line of lines) {
        const fleet = vehicles.filter((v) => v.line === line.id && v.type.carries === k);
        if (fleet.length) this.addLine(rev, line, fleet[0].type, fleet.length);
      }
      this.rev[k] = rev;
    }
    // Walking links, shared by both graphs (cargo is carried across between neighbouring stops).
    for (let a = 0; a < stops.length; a++) {
      for (let b = 0; b < stops.length; b++) {
        if (a === b) continue;
        const d = dist(stops[a].pos, stops[b].pos);
        if (d > CONFIG.walkRange) continue;
        const e: Edge = { from: a, cost: d / CONFIG.walkSpeed + 2, hop: { kind: 'walk', to: stops[b].id } };
        this.rev.pax[b].push(e);
        this.rev.cargo[b].push(e);
      }
    }
  }

  private addLine(rev: Edge[][], line: Line, type: VehicleType, fleet: number): void {
    const n = line.stops.length;
    const idx = line.stops.map((id) => this.node.get(id));
    if (idx.some((i) => i === undefined) || line.segs.length === 0) return;
    const segTime = segmentTimes(line, type);
    const wait = roundTrip(line, type) / fleet / 2 + TRANSFER_PENALTY;
    const dirs: (1 | -1)[] = line.loop ? [1] : [1, -1];
    for (const dir of dirs) {
      for (let i = 0; i < n; i++) {
        let t = wait;
        let j = i;
        for (let step = 1; step < n; step++) {
          const next = nextIdx(line, j, dir);
          if (next < 0 || next >= n) break;
          t += segTime[segIndex(line, j, dir)];
          j = next;
          rev[idx[j]!].push({ from: idx[i]!, cost: t, hop: { kind: 'ride', line: line.id, to: line.stops[j] } });
        }
      }
    }
  }
}
