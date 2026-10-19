import { CONFIG } from './config';
import { dist, pointAt, type Vec2 } from './geom';
import { departDir, nextIdx, roundTrip, segIndex } from './router';
import type { Line, Stop, Vehicle } from './types';
import type { World } from './world';

/* Vehicle movement along line segments; loading and unloading live in World. */

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

/** Stop only where someone gets off or someone waiting wants this vehicle. */
function shouldStop(w: World, t: Vehicle): boolean {
  const line = w.lineById(t.line);
  if (t.orphan || !line) return true;
  const st = w.stopById(t.toStation)!;
  if (t.load.some((g) => g.alight === st.id)) return true;
  if (loadOf(t) >= t.type.capacity - 0.5) return false;
  return w.boardable(t, line, st, departDir(line, t.toIdx, t.dir)) >= 1;
}

export const loadOf = (t: Vehicle): number => t.load.reduce((n, g) => n + g.n, 0);

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
      w.unload(t, st, (g) => g.dest === st.id);
      return rejoin(w, t, line, st, overshoot);
    }
    t.orphan = false;
    t.fromIdx = idx;
    t.dir = departDir(line, idx, t.dir);
    dock(t, st);
    return exchange(w, t, line, st);
  }
  t.fromIdx = t.toIdx;
  t.fromStation = st.id;
  t.dir = departDir(line, t.fromIdx, t.dir);
  if (!t.stopping) return startSegment(t, line, overshoot);
  dock(t, st);
  exchange(w, t, line, st);
}

/** Unload and load at a stop; the dwell grows with the number of people or cargo moved. */
function exchange(w: World, t: Vehicle, line: Line, st: Stop): void {
  const moved = w.unload(t, st, (g) => g.alight === st.id) + w.board(t, line, st, t.dir);
  t.dwell = t.type.minDwell + moved * t.type.dwellPerUnit;
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
  if (t.orphan) {
    t.dockedAt = null;
    return rejoin(w, t, line, st, 0);
  }
  // With full load on, wait at the first stop until full (or until the wait limit).
  if (t.fromIdx === 0 && line.fullLoad) {
    w.board(t, line, st, t.dir);
    if (loadOf(t) < t.type.capacity - 0.5 && t.held < CONFIG.fullLoadMaxMonths * CONFIG.monthSeconds) {
      t.held += 0.5;
      t.dwell = 0.5;
      return;
    }
  }
  // Hold at the first stop until the previous vehicle of the same kind is a fair share of a round trip ahead.
  if (t.fromIdx === 0) {
    const fleet = w.vehiclesOn(line.id, t.type.carries).length;
    const gap = (roundTrip(line, t.type) / fleet) * 0.8;
    const since = w.time - line.departed[t.type.carries];
    if (fleet > 1 && since < gap) {
      t.dwell = Math.min(gap - since, 2);
      return;
    }
    line.departed[t.type.carries] = w.time;
  }
  w.board(t, line, st, t.dir); // top up with whoever arrived while it stood
  t.held = 0;
  t.dockedAt = null;
  startSegment(t, line, 0);
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
