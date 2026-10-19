import { CONFIG } from '../src/sim/config';
import { dist, v } from '../src/sim/geom';
import type { Stop, Town } from '../src/sim/types';
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

/** Bus feeder: four stops around the station, the first within walking range of it. */
function feedTown(w: World, t: Town, station: Stop): void {
  const r = w.townRadius(t) * 0.6;
  const spots = [v(station.pos.x + 110, station.pos.y), v(t.center.x, t.center.y - r), v(t.center.x - r, t.center.y), v(t.center.x, t.center.y + r)];
  const ids: number[] = [];
  for (const p of spots) {
    const s = w.placeStop('bus', p);
    if (typeof s !== 'string') ids.push(s.id);
  }
  if (ids.length >= 3) {
    const line = w.commitLine(null, 'bus', ids, true);
    if (typeof line !== 'string') w.addVehicle(line.id);
  }
}

/**
 * A sensible player: rail between the two biggest towns, bus feeders, then one
 * new town per year while cash allows; buys vehicles for full lines, sells idle ones.
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
  // Feeders for served towns, once there is spare cash.
  for (const t of bySize) {
    const st = stationIn(w, t);
    if (st && e.cash > 400_000 && !w.stops.some((s) => s.mode === 'bus' && dist(s.pos, st.pos) < 200)) feedTown(w, t, st);
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
  // Capacity management.
  for (const l of w.lines) {
    const vs = w.vehiclesOn(l.id);
    const waiting = l.stops.reduce((n, id) => n + (w.stopById(id)?.waiting.length ?? 0), 0);
    const cap = vs.reduce((n, x) => n + x.type.capacity, 0);
    // Only grow lines that already pay their way.
    if (vs.length === 0 || (waiting > cap && l.profitLast > 0 && e.cash > 500_000)) w.addVehicle(l.id);
    else if (vs.length > 1 && waiting < cap * 0.1 && l.profitLast < 0) w.sellVehicle(l.id);
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
