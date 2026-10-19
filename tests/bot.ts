import { CONFIG } from '../src/sim/config';
import { dist, v, type Vec2 } from '../src/sim/geom';
import type { Carries, Industry, Mode, Stop, Town } from '../src/sim/types';
import type { World } from '../src/sim/world';

export const DT = 1 / 60;

export function runMonths(w: World, months: number, each?: (w: World) => void): void {
  const steps = (months * CONFIG.monthSeconds) / DT;
  for (let i = 0; i < steps && !w.over; i++) {
    w.step(DT);
    if (i % (CONFIG.monthSeconds * 30) === 0) each?.(w); // twice a month
  }
}

const must = <T>(r: T | string): T => {
  if (typeof r === 'string') throw new Error(r);
  return r;
};

function stationIn(w: World, t: Town): Stop | undefined {
  return w.stops.find((s) => s.mode === 'rail' && dist(s.pos, t.center) < 200);
}

/** A stop of this mode near p, reusing one already there. */
function stopNear(w: World, mode: Mode, p: Vec2): Stop | undefined {
  const have = w.stops.find((s) => s.mode === mode && dist(s.pos, p) < 120);
  if (have) return have;
  for (const off of [v(0, 0), v(80, 0), v(-80, 0), v(0, 80), v(0, -80), v(120, 120)]) {
    const s = w.placeStop(mode, v(p.x + off.x, p.y + off.y));
    if (typeof s !== 'string') return s;
  }
  return undefined;
}

/** Bus feeder: four stops around the station, the first within walking range of it. */
function feedTown(w: World, t: Town, station: Stop): void {
  const r = w.townRadius(t) * 0.6;
  const spots = [v(station.pos.x + 110, station.pos.y), v(t.center.x, t.center.y - r), v(t.center.x - r, t.center.y), v(t.center.x, t.center.y + r)];
  const ids: number[] = [];
  for (const p of spots) {
    const s = w.placeStop('road', p);
    if (typeof s !== 'string') ids.push(s.id);
  }
  if (ids.length >= 3) {
    const line = w.commitLine(null, 'road', ids, true);
    if (typeof line !== 'string') w.addVehicle(line.id);
  }
}

/** A two-stop line between two places with `n` vehicles of a kind. */
function link(w: World, mode: Mode, a: Vec2, b: Vec2, carries: Carries, n: number): boolean {
  const sa = stopNear(w, mode, a);
  const sb = stopNear(w, mode, b);
  if (!sa || !sb) return false;
  const existing = w.lines.find((l) => l.stops.length === 2 && l.stops.includes(sa.id) && l.stops.includes(sb.id));
  const line = existing ?? w.commitLine(null, mode, [sa.id, sb.id], false);
  if (typeof line === 'string') return false;
  for (let k = 0; k < n; k++) w.addVehicle(line.id, carries);
  return true;
}

const industry = (w: World, kind: Industry['kind']) => w.industries.filter((i) => i.kind === kind);

/**
 * A sensible player: rail between the two biggest towns, bus feeders, a food
 * chain by truck, then one new town per year while cash allows; buys vehicles
 * for busy lines that pay, sells idle ones.
 */
export function sensible(w: World): void {
  const e = w.econ;
  const bySize = [...w.towns].sort((a, b) => b.pop - a.pop);
  if (w.lines.length === 0) {
    const [a, b] = bySize;
    const sa = must(w.placeStop('rail', a.center));
    const sb = must(w.placeStop('rail', b.center));
    const line = must(w.commitLine(null, 'rail', [sa.id, sb.id], false));
    must(w.addVehicle(line.id));
    return;
  }
  // Food chain: farm to food plant, food plant to the nearest big town.
  const freightLines = w.vehicles.filter((x) => x.type.carries === 'cargo').length;
  if (freightLines === 0 && e.cash > 400_000) {
    const farm = industry(w, 'farm')[0];
    const plant = industry(w, 'foodplant')[0];
    const town = [...w.towns].sort((a, b) => dist(a.center, plant.pos) - dist(b.center, plant.pos))[0];
    link(w, 'road', farm.pos, plant.pos, 'cargo', 3);
    link(w, 'road', plant.pos, town.center, 'cargo', 2);
  }
  // Feeders for served towns, once there is spare cash.
  for (const t of bySize) {
    const st = stationIn(w, t);
    if (st && e.cash > 400_000 && !w.stops.some((s) => s.mode === 'road' && dist(s.pos, st.pos) < 200)) feedTown(w, t, st);
  }
  // Expand by one town when rich.
  if (e.cash > 900_000) {
    const served = bySize.filter((t) => stationIn(w, t));
    const next = bySize.find((t) => !stationIn(w, t));
    if (next) {
      const from = served.sort((a, b) => dist(a.center, next.center) - dist(b.center, next.center))[0];
      const sNew = w.placeStop('rail', next.center);
      const sFrom = stationIn(w, from);
      if (typeof sNew !== 'string' && sFrom) {
        const line = w.commitLine(null, 'rail', [sFrom.id, sNew.id], false);
        if (typeof line !== 'string') w.addVehicle(line.id);
      }
    }
  }
  // Capacity management, per kind of vehicle on each line.
  for (const l of w.lines) {
    for (const carries of ['pax', 'cargo'] as const) {
      const vs = w.vehiclesOn(l.id, carries);
      if (!vs.length) continue;
      const waiting = l.stops.reduce((n, id) => {
        const s = w.stopById(id)!;
        const by = w.waitingBy(s);
        return n + (carries === 'pax' ? (by.pax ?? 0) : w.waitingTotal(s) - (by.pax ?? 0));
      }, 0);
      const cap = vs.reduce((n, x) => n + x.type.capacity, 0);
      // Only grow lines that already pay their way.
      if (waiting > cap * 1.5 && l.profitLast > 0 && e.cash > 500_000) w.addVehicle(l.id, carries);
      else if (vs.length > 1 && waiting < cap * 0.1 && l.profitLast < 0) w.sellVehicle(l.id, carries);
    }
  }
  if (e.cash < 50_000) e.borrow();
  else if (e.cash > 2_000_000 && e.loan > 0) e.repay();
}

/** A reckless player: borrows to the limit and builds the longest lines first, four trains each, until the money runs out. */
export function reckless(w: World): void {
  if (w.lines.length) return;
  while (w.econ.borrow());
  const st = w.towns.map((t) => w.placeStop('rail', t.center));
  const pairs: [Stop, Stop][] = [];
  for (let i = 0; i < st.length; i++) {
    for (let j = i + 1; j < st.length; j++) {
      const a = st[i];
      const b = st[j];
      if (typeof a !== 'string' && typeof b !== 'string') pairs.push([a, b]);
    }
  }
  pairs.sort((p, q) => dist(q[0].pos, q[1].pos) - dist(p[0].pos, p[1].pos));
  for (const [a, b] of pairs) {
    const line = w.commitLine(null, 'rail', [a.id, b.id], false);
    if (typeof line === 'string') continue;
    for (let k = 0; k < 4; k++) w.addVehicle(line.id);
  }
}
