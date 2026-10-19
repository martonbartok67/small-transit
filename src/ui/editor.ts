import { dist, distToSegment, norm, sub, v, type Vec2 } from '../sim/geom';
import { townRadius } from '../sim/towns';
import type { Industry, Line, Mode, Stop, Town, Vehicle } from '../sim/types';
import { vehiclePose } from '../sim/vehicles';
import type { World } from '../sim/world';
import type { Camera } from './camera';

export type Tool = 'select' | 'rail' | 'road' | 'bulldoze';

type Drag =
  | { kind: 'pan'; last: Vec2 }
  | { kind: 'press'; start: Vec2; stop?: Stop; line?: Line; seg?: number; vehicle?: Vehicle }
  | { kind: 'new'; mode: Mode; stops: number[]; loop: boolean }
  | { kind: 'extend'; line: Line; head: boolean; stops: number[]; loop: boolean }
  | { kind: 'segment'; line: Line; stops: number[]; loop: boolean; insertPos: number; inserted: number[]; changed: boolean };

export interface EditPreview {
  mode: Mode;
  lineId: number | null;
  stops: number[];
  loop: boolean;
  ok: boolean;
  cost: number;
  reason?: string;
  from: number | null;
  to: number | null;
}

export interface EditorEvents {
  tapStop(s: Stop): void;
  tapLine(l: Line): void;
  tapIndustry(i: Industry): void;
  tapTown(t: Town): void;
  tapEmpty(): void;
  lineCreated(l: Line): void;
  toast(msg: string): void;
}

const DRAG_PX = 10;

/** Handle at an open line's end: the stub tip and outward direction. */
export function lineHandles(line: Line, length: number): { head: boolean; tip: Vec2; dir: Vec2; base: Vec2 }[] {
  if (line.loop || line.segs.length === 0) return [];
  const first = line.segs[0].path;
  const last = line.segs[line.segs.length - 1].path;
  const mk = (head: boolean, base: Vec2, inner: Vec2) => {
    const dir = norm(sub(base, inner));
    return { head, base, dir, tip: v(base.x + dir.x * length, base.y + dir.y * length) };
  };
  return [mk(true, first[0], first[1]), mk(false, last[last.length - 1], last[last.length - 2])];
}

/**
 * Turns one-finger gestures into tool actions, pans and line edits.
 * Two-finger gestures belong to main.ts, which cancels the editor first.
 */
export class Editor {
  tool: Tool = 'select';
  drag: Drag | null = null;
  cursor: Vec2 = v(0, 0);
  touch = false;
  selectedLine = -1;
  private lastHover: number | null = null;

  constructor(
    private world: () => World,
    private cam: Camera,
    private ev: EditorEvents,
  ) {}

  setPointer(type: string): void {
    this.touch = type === 'touch';
  }

  get active(): boolean {
    return this.drag !== null;
  }

  /** True while a line is being drawn (renderer shows the loupe and preview). */
  get editing(): boolean {
    const k = this.drag?.kind;
    return k === 'new' || k === 'extend' || k === 'segment';
  }

  private get r(): number {
    return (this.touch ? 30 : 18) / this.cam.zoom;
  }

  handleLength(): number {
    return 26 / this.cam.zoom;
  }

  stopAt(p: Vec2, mode?: Mode): Stop | null {
    let best: Stop | null = null;
    let bd = this.r;
    for (const s of this.world().stops) {
      if (mode && s.mode !== mode) continue;
      const d = dist(s.pos, p);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  vehicleAt(p: Vec2): Vehicle | null {
    for (const t of this.world().vehicles) if (t.line >= 0 && dist(vehiclePose(t).p, p) < this.r * 0.8) return t;
    return null;
  }

  segmentAt(p: Vec2): { line: Line; seg: number } | null {
    let best: { line: Line; seg: number } | null = null;
    let bd = this.r * 0.6;
    for (const line of this.world().lines) {
      line.segs.forEach((s, k) => {
        for (let i = 1; i < s.path.length; i++) {
          const d = distToSegment(p, s.path[i - 1], s.path[i]);
          if (d < bd) {
            bd = d;
            best = { line, seg: k };
          }
        }
      });
    }
    return best;
  }

  private handleAt(p: Vec2): { line: Line; head: boolean } | null {
    for (const line of this.world().lines) {
      for (const h of lineHandles(line, this.handleLength())) if (dist(h.tip, p) < this.r * 0.9) return { line, head: h.head };
    }
    return null;
  }

  down(sx: number, sy: number): void {
    const p = this.cam.toWorld(sx, sy);
    this.cursor = p;
    if (this.tool === 'select') {
      const h = this.handleAt(p);
      if (h) {
        const stops = h.head ? h.line.stops.slice().reverse() : h.line.stops.slice();
        this.drag = { kind: 'extend', line: h.line, head: h.head, stops, loop: false };
        this.lastHover = stops[stops.length - 1];
        return;
      }
    }
    const stop = this.stopAt(p);
    const vehicle = stop ? null : this.vehicleAt(p);
    const seg = stop || vehicle ? null : this.segmentAt(p);
    this.drag = {
      kind: 'press',
      start: v(sx, sy),
      stop: stop ?? undefined,
      vehicle: vehicle ?? undefined,
      line: seg?.line,
      seg: seg?.seg,
    };
  }

  move(sx: number, sy: number): void {
    const p = this.cam.toWorld(sx, sy);
    this.cursor = p;
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pan') {
      this.cam.panBy(sx - d.last.x, sy - d.last.y);
      d.last = v(sx, sy);
      return;
    }
    if (d.kind === 'press') {
      if (Math.hypot(sx - d.start.x, sy - d.start.y) < DRAG_PX) return;
      // A drag that starts on a stop or a segment edits lines (select tool only); anything else pans.
      if (this.tool === 'select' && d.stop) {
        this.drag = { kind: 'new', mode: d.stop.mode, stops: [d.stop.id], loop: false };
        this.lastHover = d.stop.id;
      } else if (this.tool === 'select' && d.line && d.seg !== undefined) {
        this.drag = {
          kind: 'segment',
          line: d.line,
          stops: d.line.stops.slice(),
          loop: d.line.loop,
          insertPos: d.seg + 1,
          inserted: [],
          changed: false,
        };
        this.lastHover = null;
        this.selectedLine = d.line.id;
      } else {
        this.drag = { kind: 'pan', last: v(sx, sy) };
        this.cam.panBy(sx - d.start.x, sy - d.start.y);
        return;
      }
    }
    const e = this.drag!;
    const mode = e.kind === 'new' ? e.mode : e.kind === 'extend' || e.kind === 'segment' ? e.line.mode : undefined;
    const hover = this.stopAt(p, mode)?.id ?? null;
    if (hover === this.lastHover) return;
    this.lastHover = hover;
    if (hover === null) return;
    if (e.kind === 'segment') this.enterSegment(e, hover);
    else if (e.kind === 'new' || e.kind === 'extend') this.enterEnd(e, hover);
  }

  private enterEnd(d: { stops: number[]; loop: boolean }, y: number): void {
    const s = d.stops;
    if (d.loop) {
      if (y === s[s.length - 1]) d.loop = false;
      return;
    }
    if (s.length >= 2 && y === s[s.length - 2]) s.pop();
    else if (s.length >= 3 && y === s[0]) d.loop = true;
    else if (!s.includes(y)) s.push(y);
  }

  private enterSegment(d: Extract<Drag, { kind: 'segment' }>, y: number): void {
    const s = d.stops;
    const n = s.length;
    const removable = (idx: number) => (d.loop ? n >= 4 : idx > 0 && idx < n - 1);
    const leftIdx = d.insertPos - 1;
    const rightIdx = d.insertPos % n;
    if (d.inserted.length && y === s[d.insertPos - 2]) {
      s.splice(d.insertPos - 1, 1);
      d.inserted.pop();
      d.insertPos--;
    } else if (!s.includes(y)) {
      s.splice(d.insertPos, 0, y);
      d.insertPos++;
      d.inserted.push(y);
    } else if (!d.inserted.length && y === s[leftIdx] && removable(leftIdx)) {
      s.splice(leftIdx, 1);
      d.insertPos--;
    } else if (!d.inserted.length && y === s[rightIdx] && removable(rightIdx)) {
      s.splice(rightIdx, 1);
      if (rightIdx < d.insertPos) d.insertPos--;
    } else return;
    d.changed = true;
  }

  up(sx: number, sy: number): void {
    const w = this.world();
    this.cursor = this.cam.toWorld(sx, sy);
    const d = this.drag;
    this.drag = null;
    this.lastHover = null;
    if (!d) return;
    const result = (r: Line | string, created = false) => {
      if (typeof r === 'string') this.ev.toast(r);
      else if (created) this.ev.lineCreated(r);
    };
    switch (d.kind) {
      case 'press':
        return this.tap(d);
      case 'new':
        if (d.stops.length >= 2) result(w.commitLine(null, d.mode, d.stops, d.loop), true);
        return;
      case 'extend': {
        const stops = d.head ? d.stops.slice().reverse() : d.stops;
        if (stops.length < 2) {
          w.deleteLine(d.line.id);
          this.ev.toast(`${d.line.name} removed`);
        } else result(w.commitLine(d.line.id, d.line.mode, stops, d.loop));
        return;
      }
      case 'segment':
        if (!d.changed) return;
        if (d.stops.length < 2) w.deleteLine(d.line.id);
        else result(w.commitLine(d.line.id, d.line.mode, d.stops, d.loop && d.stops.length >= 3));
        return;
    }
  }

  private tap(d: Extract<Drag, { kind: 'press' }>): void {
    const w = this.world();
    if (this.tool === 'rail' || this.tool === 'road') {
      const r = w.placeStop(this.tool, this.cursor);
      if (typeof r === 'string') this.ev.toast(r);
      return;
    }
    if (this.tool === 'bulldoze') {
      if (d.stop) {
        const why = w.removeStop(d.stop.id);
        this.ev.toast(why ?? `${d.stop.name} demolished`);
      } else if (d.line) this.ev.tapLine(d.line);
      return;
    }
    if (d.stop) this.ev.tapStop(d.stop);
    else if (d.vehicle) {
      const l = w.lineById(d.vehicle.line);
      if (l) this.ev.tapLine(l);
    } else if (d.line) this.ev.tapLine(d.line);
    else {
      const p = this.cursor;
      const ind = w.industries.find((i) => dist(i.pos, p) < Math.max(150, this.r));
      const town = w.towns.find((t) => dist(t.center, p) < townRadius(t.pop) * 0.5);
      if (ind) this.ev.tapIndustry(ind);
      else if (town) this.ev.tapTown(town);
      else this.ev.tapEmpty();
    }
  }

  cancel(): void {
    this.drag = null;
    this.lastHover = null;
  }

  preview(): EditPreview | null {
    const d = this.drag;
    if (!d || (d.kind !== 'new' && d.kind !== 'extend' && d.kind !== 'segment')) return null;
    const w = this.world();
    const mode = d.kind === 'new' ? d.mode : d.line.mode;
    const lineId = d.kind === 'new' ? null : d.line.id;
    const stops = d.kind === 'extend' && d.head ? d.stops.slice().reverse() : d.stops;
    const loop = d.loop && stops.length >= 3;
    const pv = w.previewLine(mode, stops, loop);
    const ok = stops.length < 2 ? true : pv.ok;
    if (d.kind === 'segment') {
      const n = d.stops.length;
      return { mode, lineId, stops, loop, ok, cost: pv.cost, reason: pv.reason, from: d.stops[d.insertPos - 1] ?? null, to: n ? d.stops[d.insertPos % n] : null };
    }
    return { mode, lineId, stops, loop, ok, cost: pv.cost, reason: pv.reason, from: d.loop ? null : d.stops[d.stops.length - 1], to: null };
  }
}
