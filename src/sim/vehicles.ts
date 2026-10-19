import { CONFIG } from './config';
import { dist, pointAt, type Vec2 } from './geom';
import { departDir, nextIdx, segIndex, type Choice } from './router';
import type { Line, Stop, Vehicle } from './types';
import type { World } from './world';

/* Vehicle movement, ported from Small Subway's trains and parameterised by VehicleType. */

export function segPath(line: Line, i: number, d: 1 | -1): { path: Vec2[]; len: number } {
  const seg = line.segs[segIndex(line, i, d)];
  return { path: d > 0 ? seg.path : seg.path.slice().reverse(), len: seg.length };
}

export function vehiclePose(t: Vehicle, back = 0): { p: Vec2; t: Vec2 } {
  return pointAt(t.path, t.d - back);
}

export function updateVehicle(w: World, t: Vehicle, dt: number): void {
  if (t.state === 'dwelling') return updateDwell(w, t, dt);
  const cfg = t.type;
  const remaining = t.pathLen - t.d;
  const brake = (t.speed * t.speed) / (2 * cfg.decel);
  if (!t.stopDecided && remaining <= brake + t.speed * dt + 4) {
    t.stopping = shouldStop(w, t);
    t.stopDecided = true;
  }
  if (t.stopping) {
    const cap = Math.sqrt(2 * cfg.decel * Math.max(0, remaining));
    t.speed = Math.min(t.speed + cfg.accel * dt, cfg.speed, Math.max(cap, 10));
  } else t.speed = Math.min(t.speed + cfg.accel * dt, cfg.speed);
  t.d += t.speed * dt;
  t.odo += t.speed * dt;
  if (t.d >= t.pathLen) arrive(w, t, t.d - t.pathLen);
}

function shouldStop(w: World, t: Vehicle): boolean {
  const line = w.lineById(t.line);
  if (t.orphan || !line) return true;
  const st = w.stopById(t.toStation)!;
  const dep = departDir(line, t.toIdx, t.dir);
  let leaving = 0;
  for (const r of t.riders) if (w.router.wouldAlight(line, t.toIdx, dep, st, r.dest)) leaving++;
  if (leaving > 0) return true;
  if (t.riders.length >= t.type.capacity) return false;
  const seen = new Set<string>();
  for (const p of st.waiting) {
    const k = `${p.dest}:${p.walked}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const c = w.router.decide(st, p.dest, undefined, !p.walked);
    if (c?.kind === 'board' && c.line === line.id && c.dir === dep) return true;
  }
  return false;
}

function nearestOnLine(w: World, line: Line, from: Vec2): Stop {
  let best = w.stopById(line.stops[0])!;
  for (const id of line.stops) {
    const s = w.stopById(id)!;
    if (dist(s.pos, from) < dist(best.pos, from)) best = s;
  }
  return best;
}

/** Send an orphaned vehicle straight to the nearest stop still on its line. */
function rejoin(w: World, t: Vehicle, line: Line, at: Stop, overshoot: number): void {
  const target = nearestOnLine(w, line, at.pos);
  Object.assign(t, {
    fromStation: at.id,
    toStation: target.id,
    path: [at.pos, target.pos],
    pathLen: Math.max(1, dist(at.pos, target.pos)),
    d: overshoot,
    state: 'moving',
    dockedAt: null,
    stopDecided: true,
    stopping: true,
    orphan: true,
  });
}

function arrive(w: World, t: Vehicle, overshoot: number): void {
  const st = w.stopById(t.toStation)!;
  const line = w.lineById(t.line);
  if (!line) return w.retireVehicle(t, st);
  if (t.orphan) {
    const idx = line.stops.indexOf(st.id);
    if (idx < 0) {
      t.riders = t.riders.filter((r) => (st.covers.has(r.dest) ? (w.deliver(r, st), false) : true));
      return rejoin(w, t, line, st, overshoot);
    }
    t.orphan = false;
    t.fromIdx = idx;
    t.dir = departDir(line, idx, t.dir);
    return dock(t, st);
  }
  t.fromIdx = t.toIdx;
  t.fromStation = st.id;
  t.dir = departDir(line, t.fromIdx, t.dir);
  if (t.stopping) return dock(t, st);
  startSegment(t, line, overshoot);
}

export function dock(t: Vehicle, st: Stop): void {
  t.state = 'dwelling';
  t.speed = 0;
  t.dockedAt = st.id;
  t.fromStation = st.id;
  t.d = t.pathLen;
  t.dwell = t.type.minDwell;
}

export function startSegment(t: Vehicle, line: Line, overshoot: number): void {
  const j = nextIdx(line, t.fromIdx, t.dir);
  const sp = segPath(line, t.fromIdx, t.dir);
  Object.assign(t, {
    toIdx: j,
    fromStation: line.stops[t.fromIdx],
    toStation: line.stops[j],
    path: sp.path,
    pathLen: sp.len,
    d: overshoot,
    state: 'moving',
    dockedAt: null,
    stopDecided: false,
    stopping: false,
  });
}

function updateDwell(w: World, t: Vehicle, dt: number): void {
  t.dwell -= dt;
  if (t.dwell > 0) return;
  const st = w.stopById(t.dockedAt!)!;
  const line = w.lineById(t.line);
  if (!line) return w.retireVehicle(t, st);
  const step = t.type.dwellPerPassenger;
  const choices = new Map<string, Choice | null>();
  // Several passengers can move per tick when the per-passenger time is shorter than a tick.
  for (let guard = 0; t.dwell <= 0 && guard < 40; guard++) {
    if (t.orphan || !dwellAction(w, t, st, choices)) {
      t.dockedAt = null;
      if (t.orphan) return rejoin(w, t, line, st, 0);
      return startSegment(t, line, 0);
    }
    t.dwell += step;
  }
}

/** Move one passenger off or onto the vehicle; false when nobody is left to move. */
function dwellAction(w: World, t: Vehicle, st: Stop, choices: Map<string, Choice | null>): boolean {
  for (let k = 0; k < t.riders.length; k++) {
    const r = t.riders[k];
    const d = w.router.decideAlight(t, st, r.dest);
    if (d === 'stay') continue;
    t.riders.splice(k, 1);
    r.rides.push([t.line, t.odo - r.boardOdo]);
    if (d === 'deliver') w.deliver(r, st);
    else if (st.waiting.length < CONFIG.stop[st.mode].capacity) st.waiting.push(r);
    else w.lost++;
    return true;
  }
  if (t.riders.length >= t.type.capacity) return false;
  for (let k = 0; k < st.waiting.length; k++) {
    const p = st.waiting[k];
    const key = `${p.dest}:${p.walked}`;
    if (!choices.has(key)) choices.set(key, w.router.decide(st, p.dest, t, !p.walked));
    const c = choices.get(key);
    if (c?.kind !== 'board' || c.line !== t.line || c.dir !== t.dir) continue;
    st.waiting.splice(k, 1);
    p.boardOdo = t.odo;
    t.riders.push(p);
    return true;
  }
  return false;
}

/** Re-attach vehicles to their line after an edit, keeping progress along unchanged segments. */
export function resyncVehicles(w: World): void {
  for (const t of w.vehicles) {
    const line = w.lineById(t.line);
    if (!line) continue;
    if (t.state === 'dwelling') {
      const idx = line.stops.indexOf(t.dockedAt!);
      if (idx >= 0) {
        t.orphan = false;
        t.fromIdx = idx;
        t.dir = departDir(line, idx, t.dir);
      } else t.orphan = true;
      continue;
    }
    const fi = line.stops.indexOf(t.fromStation);
    const ti = line.stops.indexOf(t.toStation);
    let dir: 0 | 1 | -1 = 0;
    if (fi >= 0 && ti >= 0) {
      if (nextIdx(line, fi, 1) === ti && (line.loop || fi + 1 < line.stops.length)) dir = 1;
      else if (nextIdx(line, fi, -1) === ti && (line.loop || fi - 1 >= 0)) dir = -1;
    }
    if (dir === 0) {
      t.orphan = true;
      continue;
    }
    const frac = t.pathLen > 0 ? t.d / t.pathLen : 0;
    const sp = segPath(line, fi, dir);
    Object.assign(t, { orphan: false, fromIdx: fi, toIdx: ti, dir, path: sp.path, pathLen: sp.len, d: frac * sp.len });
  }
}
