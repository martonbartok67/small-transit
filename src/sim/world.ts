import { CONFIG, VEHICLES, vehicleFor } from './config';
import { Economy } from './economy';
import { dist, octilinearOptions, offsetPolyline, pointAt, pointInPolygon, polylineLength, type Vec2 } from './geom';
import { Rng } from './rng';
import { departDir, Router } from './router';
import { assignCatchment, buildTowns, growTown, isDry, refreshPopulations } from './towns';
import type { District, House, Line, MapDef, Mode, Passenger, Segment, SimEvent, Stop, Town, Vehicle } from './types';
import { dock, resyncVehicles, segPath, updateVehicle } from './vehicles';

export const LINE_SPACING: Record<Mode, number> = { rail: 11, bus: 7 };
export const LINE_COLORS = 8;

export interface LinePreview {
  ok: boolean;
  paths: Vec2[][];
  cost: number;
  reason?: string;
}

interface Way {
  mode: Mode;
  key: string;
  path: Vec2[];
  length: number;
}

interface DemandCache {
  version: number;
  share: number;
  dests: { district: number; w: number }[];
}

/** Bump when the save layout changes; older saves are then ignored. */
export const SAVE_VERSION = 1;

type Saved = Omit<Stop, 'covers' | 'byDistrict'> & { covers: number[]; byDistrict: [number, number][] };

export class World {
  readonly rng: Rng;
  time = 0;
  towns: Town[];
  districts: District[];
  houses: House[];
  stops: Stop[] = [];
  lines: Line[] = [];
  vehicles: Vehicle[] = [];
  econ = new Economy();
  events: SimEvent[] = [];
  over: { month: number } | null = null;
  /** Passengers who gave up (full stop or waited too long) this session. */
  lost = 0;
  delivered = 0;
  networkVersion = 0;
  readonly router: Router;

  private nextId = 1;
  private monthIndex = 0;
  private ways = new Map<string, Way>();
  private baseCache = new Map<string, { path: Vec2[]; cost: number }>();
  private demand = new Map<number, DemandCache>();
  private walkTimer = 0;

  constructor(
    readonly map: MapDef,
    readonly seed: number,
  ) {
    this.rng = new Rng(seed);
    const t = buildTowns(map, this.rng);
    this.towns = t.towns;
    this.districts = t.districts;
    this.houses = t.houses;
    const self = this;
    this.router = new Router({
      get stops() {
        return self.stops;
      },
      get lines() {
        return self.lines;
      },
      get vehicles() {
        return self.vehicles;
      },
      stopById: (id) => self.stopById(id),
      speedOf: (l) => vehicleFor(l.mode).speed,
      dwellOf: (l) => vehicleFor(l.mode).minDwell + 1,
    });
  }

  // ---------- lookups ----------

  get month(): number {
    return Math.floor(this.time / CONFIG.monthSeconds);
  }

  /** e.g. { year: 1951, month: 2 } (0-based month). */
  date(): { year: number; month: number } {
    return { year: CONFIG.startYear + Math.floor(this.month / 12), month: this.month % 12 };
  }

  stopById(id: number): Stop | undefined {
    return this.stops.find((s) => s.id === id);
  }

  lineById(id: number): Line | undefined {
    return this.lines.find((l) => l.id === id);
  }

  vehiclesOn(lineId: number): Vehicle[] {
    return this.vehicles.filter((v) => v.line === lineId);
  }

  linesAt(stopId: number): Line[] {
    return this.lines.filter((l) => l.stops.includes(stopId));
  }

  townRadius(t: Town): number {
    return 120 + Math.sqrt(t.pop) * 9;
  }

  // ---------- main step ----------

  step(dt: number): void {
    if (this.over) return;
    this.time += dt;
    this.router.update(this.time);
    this.spawnPassengers(dt);
    this.walkTimer -= dt;
    if (this.walkTimer <= 0) {
      this.walkTimer = 0.5;
      this.housekeeping();
    }
    for (const v of this.vehicles.slice()) updateVehicle(this, v, dt);
    this.chargeRunningCosts(dt);
    if (this.month > this.monthIndex) {
      this.monthIndex = this.month;
      this.closeMonth();
    }
  }

  private chargeRunningCosts(dt: number): void {
    const f = dt / CONFIG.monthSeconds;
    for (const v of this.vehicles) {
      const c = v.type.runningPerMonth * f;
      this.econ.charge('running', c);
      const line = this.lineById(v.line);
      if (line) line.costMonth += c;
    }
    let maint = 0;
    for (const w of this.ways.values()) maint += w.length * CONFIG.way[w.mode].maintenance;
    for (const s of this.stops) maint += CONFIG.stop[s.mode].maintenance;
    this.econ.charge('maintenance', maint * f);
  }

  private closeMonth(): void {
    for (const l of this.lines) {
      l.profitLast = l.revenueMonth - l.costMonth;
      l.carriedLast = l.carriedMonth;
      l.revenueMonth = l.costMonth = l.carriedMonth = 0;
    }
    let grew = false;
    for (const t of this.towns) {
      t.tripsLast = t.tripsMonth;
      t.tripsMonth = 0;
      t.growthLast = growTown(this.map, t, this.houses, this.districts, this.rng);
      grew ||= t.growthLast > 0;
    }
    if (grew) {
      refreshPopulations(this.towns, this.districts, this.houses);
      assignCatchment(this.houses, this.stops);
      this.router.invalidate();
    }
    const bankrupt = this.econ.closeMonth();
    this.events.push({ type: 'monthEnd', month: this.monthIndex });
    if (bankrupt) {
      this.over = { month: this.monthIndex };
      this.events.push({ type: 'bankrupt' });
    } else if (this.econ.negativeMonths > 0) {
      const left = CONFIG.bankruptMonths - this.econ.negativeMonths;
      this.events.push({ type: 'warning', text: `Cash is negative. Borrow or cut costs: ${left} month${left === 1 ? '' : 's'} until bankruptcy.` });
    }
  }

  // ---------- passengers ----------

  /** Reachable destinations from a stop, weighted by a gravity model; cached per router graph. */
  private demandAt(s: Stop): DemandCache {
    const hit = this.demand.get(s.id);
    if (hit && hit.version === this.router.version) return hit;
    // Destinations reachable on foot from here are not transit trips.
    const near = new Set(s.covers);
    for (const o of this.stops) if (o.id !== s.id && dist(o.pos, s.pos) <= CONFIG.walkRange) o.covers.forEach((d) => near.add(d));
    let all = 0;
    let reach = 0;
    const dests: { district: number; w: number }[] = [];
    for (const d of this.districts) {
      if (near.has(d.id) || d.pop === 0) continue;
      const w = d.pop / Math.pow(Math.max(300, dist(s.pos, d.center)), CONFIG.gravityExponent);
      all += w;
      if (!isFinite(this.router.costFrom(s.id, d.id))) continue;
      reach += w;
      dests.push({ district: d.id, w });
    }
    const c = { version: this.router.version, share: all > 0 ? reach / all : 0, dests };
    this.demand.set(s.id, c);
    return c;
  }

  private spawnPassengers(dt: number): void {
    for (const s of this.stops) {
      if (s.residents === 0) continue;
      const dem = this.demandAt(s);
      if (dem.share === 0) continue;
      s.spawnAcc += ((s.residents * CONFIG.tripRate * dem.share * this.econ.demand(s.mode)) / CONFIG.monthSeconds) * dt;
      while (s.spawnAcc >= 1) {
        s.spawnAcc -= 1;
        const pick = this.rng.weighted(dem.dests, (x) => x.w);
        if (!pick) break;
        if (s.waiting.length >= CONFIG.stop[s.mode].capacity) {
          this.lost++;
          continue;
        }
        s.waiting.push({ id: this.nextId++, dest: pick.district, origin: s.id, spawnedAt: this.time, rides: [], boardOdo: 0, walked: false });
        const town = this.mainTown(s);
        if (town) town.tripsMonth++;
      }
    }
  }

  private mainTown(s: Stop): Town | undefined {
    let best = -1;
    let bn = 0;
    s.byDistrict.forEach((n, d) => {
      if (n > bn) {
        bn = n;
        best = d;
      }
    });
    return best >= 0 ? this.towns[this.districts[best].town] : undefined;
  }

  /** Twice a second: give up after waiting too long, and walk to a better nearby stop. */
  private housekeeping(): void {
    const limit = CONFIG.patienceMonths * CONFIG.monthSeconds;
    for (const s of this.stops) {
      const before = s.waiting.length;
      s.waiting = s.waiting.filter((p) => this.time - p.spawnedAt < limit);
      this.lost += before - s.waiting.length;
      for (let k = s.waiting.length - 1; k >= 0; k--) {
        const p = s.waiting[k];
        if (p.walked) continue;
        const c = this.router.decide(s, p.dest, undefined, true);
        if (c?.kind !== 'walk') continue;
        const to = this.stopById(c.to)!;
        s.waiting.splice(k, 1);
        p.walked = true;
        if (to.covers.has(p.dest)) this.deliver(p, to);
        else if (to.waiting.length < CONFIG.stop[to.mode].capacity) to.waiting.push(p);
        else this.lost++;
      }
    }
  }

  /** Passenger reached a stop covering their destination: collect the fare, split by distance ridden. */
  deliver(p: Passenger, at: Stop): void {
    this.delivered++;
    const town = this.towns[this.districts[p.dest].town];
    town.tripsMonth++;
    const ridden = p.rides.reduce((n, [, d]) => n + d, 0);
    if (ridden <= 0) return;
    const origin = this.stopById(p.origin);
    const straight = origin ? dist(origin.pos, at.pos) : ridden;
    let fare = 0;
    for (const [lineId, d] of p.rides) {
      const line = this.lineById(lineId);
      const part = (this.ticket(line?.mode ?? at.mode, straight) * d) / ridden;
      fare += part;
      if (!line) continue;
      line.revenueMonth += part;
      line.carriedMonth++;
    }
    this.econ.earn(fare);
    this.events.push({ type: 'deliver', stop: at.id, fare, line: p.rides[p.rides.length - 1][0] });
  }

  /** Price of a trip of this straight-line length, wholly on one mode, at the current price level. */
  ticket(mode: Mode, distance: number): number {
    const f = CONFIG.fare[mode];
    return (f.base + f.perUnit * distance) * this.econ.price[mode];
  }

  // ---------- building: stops ----------

  canPlaceStop(mode: Mode, pos: Vec2): string | null {
    if (!isDry(this.map, pos, 20)) return 'Too close to water or the map edge';
    const spacing = CONFIG.stop[mode].minSpacing;
    for (const s of this.stops) {
      if (dist(s.pos, pos) < (s.mode === mode ? spacing : 40)) return 'Too close to another stop';
    }
    if (this.econ.cash < CONFIG.stop[mode].price) return `Need ${money(CONFIG.stop[mode].price)}`;
    return null;
  }

  placeStop(mode: Mode, pos: Vec2): Stop | string {
    const why = this.canPlaceStop(mode, pos);
    if (why) return why;
    this.econ.spend('construction', CONFIG.stop[mode].price);
    const s: Stop = {
      id: this.nextId++,
      mode,
      pos,
      name: this.nameFor(mode, pos),
      waiting: [],
      covers: new Set(),
      residents: 0,
      byDistrict: new Map(),
      spawnAcc: 0,
      bornAt: this.time,
    };
    this.stops.push(s);
    assignCatchment(this.houses, this.stops);
    this.router.invalidate();
    this.networkVersion++;
    return s;
  }

  private nameFor(mode: Mode, pos: Vec2): string {
    let best: District | undefined;
    for (const d of this.districts) if (!best || dist(d.center, pos) < dist(best.center, pos)) best = d;
    const place = best && dist(best.center, pos) < 900 ? best.name : 'Countryside';
    const base = `${place} ${mode === 'rail' ? 'Station' : 'Stop'}`;
    const taken = new Set(this.stops.map((s) => s.name));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  }

  removeStop(id: number): string | null {
    const s = this.stopById(id);
    if (!s) return 'No stop there';
    if (this.linesAt(id).length) return 'Remove it from its lines first';
    this.lost += s.waiting.length;
    this.stops.splice(this.stops.indexOf(s), 1);
    assignCatchment(this.houses, this.stops);
    this.router.invalidate();
    this.networkVersion++;
    return null;
  }

  // ---------- building: lines ----------

  private wayCostOf(mode: Mode, path: Vec2[]): number {
    const c = CONFIG.way[mode];
    const len = polylineLength(path);
    const n = Math.max(1, Math.ceil(len / 10));
    let cost = 0;
    for (let i = 0; i < n; i++) {
      const p = pointAt(path, ((i + 0.5) / n) * len).p;
      const step = len / n;
      if (this.map.water.some((w) => pointInPolygon(p, w))) cost += c.bridge * step;
      else if (mode === 'bus' && this.towns.some((t) => dist(t.center, p) < this.townRadius(t) * 0.9)) cost += 0; // town streets exist
      else cost += c.build * step * (this.map.hills.some((h) => pointInPolygon(p, h)) ? c.hill : 1);
    }
    return cost;
  }

  /** Cheaper of the two octilinear routes between two stops, canonical per pair. */
  private basePath(mode: Mode, a: number, b: number): { path: Vec2[]; cost: number } {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${mode}:${lo}-${hi}`;
    let hit = this.baseCache.get(key);
    if (!hit) {
      const opts = octilinearOptions(this.stopById(lo)!.pos, this.stopById(hi)!.pos).map((path) => ({ path, cost: this.wayCostOf(mode, path) }));
      hit = opts[0].cost <= opts[1].cost ? opts[0] : opts[1];
      this.baseCache.set(key, hit);
    }
    return a === lo ? hit : { path: hit.path.slice().reverse(), cost: hit.cost };
  }

  private pairs(stops: number[], loop: boolean): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < stops.length; i++) out.push([stops[i], stops[i + 1]]);
    if (loop && stops.length >= 3) out.push([stops[stops.length - 1], stops[0]]);
    return out;
  }

  private wayKey(mode: Mode, a: number, b: number): string {
    return `${mode}:${Math.min(a, b)}-${Math.max(a, b)}`;
  }

  previewLine(mode: Mode, stops: number[], loop: boolean): LinePreview {
    const pairs = this.pairs(stops, loop);
    const paths = pairs.map(([a, b]) => this.basePath(mode, a, b).path);
    let cost = 0;
    const seen = new Set<string>();
    for (const [a, b] of pairs) {
      const k = this.wayKey(mode, a, b);
      if (this.ways.has(k) || seen.has(k)) continue;
      seen.add(k);
      cost += this.basePath(mode, a, b).cost;
    }
    cost = Math.round(cost);
    const modeOk = stops.every((id) => this.stopById(id)?.mode === mode);
    let reason: string | undefined;
    if (new Set(stops).size !== stops.length) reason = 'A line cannot visit a stop twice';
    else if (!modeOk) reason = mode === 'rail' ? 'Rail lines connect stations only' : 'Bus lines connect bus stops only';
    else if (cost > this.econ.cash) reason = `Need ${money(cost)}`;
    const ok = !reason && stops.length >= 2 && (!loop || stops.length >= 3);
    return { ok, paths, cost, reason };
  }

  /** Create (lineId null) or replace a line. Returns the line, or a reason it was refused. */
  commitLine(lineId: number | null, mode: Mode, stops: number[], loop: boolean): Line | string {
    const pv = this.previewLine(mode, stops, loop);
    if (!pv.ok) return pv.reason ?? 'Invalid line';
    this.econ.spend('construction', pv.cost);
    let line = lineId !== null ? this.lineById(lineId) : undefined;
    if (line) {
      line.stops = stops.slice();
      line.loop = loop;
    } else {
      const sameMode = this.lines.filter((l) => l.mode === mode).length;
      line = {
        id: this.nextId++,
        mode,
        color: this.freeColor(),
        name: `${mode === 'rail' ? 'Rail' : 'Bus'} ${sameMode + 1}`,
        stops: stops.slice(),
        loop,
        segs: [],
        revenueMonth: 0,
        costMonth: 0,
        profitLast: 0,
        carriedMonth: 0,
        carriedLast: 0,
      };
      this.lines.push(line);
    }
    this.rebuildNetwork();
    return line;
  }

  private freeColor(): number {
    const used = this.lines.map((l) => l.color);
    for (let c = 0; c < LINE_COLORS; c++) if (!used.includes(c)) return c;
    return this.lines.length % LINE_COLORS;
  }

  deleteLine(id: number): void {
    const line = this.lineById(id);
    if (!line) return;
    this.lines.splice(this.lines.indexOf(line), 1);
    for (const v of this.vehiclesOn(id)) {
      if (v.state === 'dwelling') this.retireVehicle(v, this.stopById(v.dockedAt!)!);
      else v.line = -1; // finishes its trip, then is sold
    }
    this.rebuildNetwork();
  }

  /** Rebuild ways and offset geometry for every line after any change. */
  private rebuildNetwork(): void {
    const users = new Map<string, number[]>();
    for (const l of this.lines) {
      for (const [a, b] of this.pairs(l.stops, l.loop)) {
        const k = this.wayKey(l.mode, a, b);
        const arr = users.get(k) ?? [];
        arr.push(l.id);
        users.set(k, arr);
      }
    }
    // Ways no line uses any more are abandoned (no refund, no further maintenance).
    for (const k of [...this.ways.keys()]) if (!users.has(k)) this.ways.delete(k);
    for (const l of this.lines) {
      l.segs = this.pairs(l.stops, l.loop).map(([a, b]): Segment => {
        const k = this.wayKey(l.mode, a, b);
        const ids = users.get(k)!.sort((x, y) => x - y);
        const off = (ids.indexOf(l.id) - (ids.length - 1) / 2) * LINE_SPACING[l.mode];
        const lo = Math.min(a, b);
        const base = this.basePath(l.mode, lo, Math.max(a, b));
        if (!this.ways.has(k)) this.ways.set(k, { mode: l.mode, key: k, path: base.path, length: polylineLength(base.path) });
        let path = offsetPolyline(base.path, off);
        if (a !== lo) path = path.reverse();
        return { a, b, path, length: polylineLength(path) };
      });
    }
    this.networkVersion++;
    this.router.invalidate();
    resyncVehicles(this);
  }

  /** Ways (track and road) for drawing. */
  wayList(): Way[] {
    return [...this.ways.values()];
  }

  // ---------- vehicles ----------

  canAddVehicle(lineId: number): string | null {
    const line = this.lineById(lineId);
    if (!line) return 'No such line';
    const type = vehicleFor(line.mode);
    if (this.vehiclesOn(lineId).length >= CONFIG.maxVehiclesPerLine) return 'This line is full';
    if (this.econ.cash < type.price) return `Need ${money(type.price)}`;
    return null;
  }

  addVehicle(lineId: number): Vehicle | string {
    const why = this.canAddVehicle(lineId);
    if (why) return why;
    const line = this.lineById(lineId)!;
    const type = vehicleFor(line.mode);
    this.econ.spend('vehicles', type.price);
    // Spread vehicles along the line instead of stacking them at the first stop.
    const k = this.vehiclesOn(lineId).length;
    const span = line.loop ? line.stops.length : line.stops.length - 1;
    const idx = Math.floor((k * span) / (k + 1)) % Math.max(1, span);
    const dir = departDir(line, idx, 1);
    const sp = segPath(line, idx, dir);
    const st = this.stopById(line.stops[idx])!;
    const v: Vehicle = {
      id: this.nextId++,
      type,
      line: lineId,
      color: line.color,
      fromStation: st.id,
      toStation: st.id,
      fromIdx: idx,
      toIdx: idx,
      dir,
      orphan: false,
      path: sp.path,
      pathLen: 0,
      d: 0,
      speed: 0,
      state: 'moving',
      dwell: 0,
      dockedAt: null,
      stopDecided: true,
      stopping: true,
      riders: [],
      odo: 0,
    };
    dock(v, st);
    this.vehicles.push(v);
    this.router.invalidate();
    return v;
  }

  /** Sell the emptiest vehicle on a line for part of its price. */
  sellVehicle(lineId: number): boolean {
    const vs = this.vehiclesOn(lineId).sort((a, b) => a.riders.length - b.riders.length);
    if (!vs.length) return false;
    const v = vs[0];
    this.retireVehicle(v, this.stopById(v.dockedAt ?? v.fromStation) ?? this.stopById(v.toStation)!);
    return true;
  }

  retireVehicle(v: Vehicle, at: Stop): void {
    for (const r of v.riders) {
      r.rides.push([v.line, v.odo - r.boardOdo]);
      if (at.covers.has(r.dest)) this.deliver(r, at);
      else if (at.waiting.length < CONFIG.stop[at.mode].capacity) at.waiting.push(r);
      else this.lost++;
    }
    v.riders = [];
    this.econ.refund(v.type.price * CONFIG.sellRefund);
    this.vehicles.splice(this.vehicles.indexOf(v), 1);
    this.router.invalidate();
  }

  // ---------- saving ----------

  /** The whole game as JSON. Caches (router, demand, base paths) are left out and rebuilt on load. */
  save(): string {
    const e = this.econ;
    return JSON.stringify({
      v: SAVE_VERSION,
      map: this.map.name,
      seed: this.seed,
      rng: this.rng.state,
      time: this.time,
      nextId: this.nextId,
      monthIndex: this.monthIndex,
      walkTimer: this.walkTimer,
      lost: this.lost,
      delivered: this.delivered,
      networkVersion: this.networkVersion,
      over: this.over,
      econ: { cash: e.cash, loan: e.loan, month: e.month, last: e.last, negativeMonths: e.negativeMonths, price: e.price },
      towns: this.towns,
      districts: this.districts,
      houses: this.houses.map((h) => [h.pos.x, h.pos.y, h.residents, h.town, h.district, h.stop]),
      stops: this.stops.map((s): Saved => ({ ...s, covers: [...s.covers], byDistrict: [...s.byDistrict] })),
      lines: this.lines,
      vehicles: this.vehicles.map((v) => ({ ...v, type: v.type.key })),
      ways: [...this.ways.values()],
    });
  }

  /** Rebuild a world from save(); null when the save is unreadable or from another version or map. */
  static load(map: MapDef, json: string): World | null {
    try {
      const d = JSON.parse(json);
      if (d?.v !== SAVE_VERSION || d.map !== map.name) return null;
      const w = new World(map, d.seed);
      w.rng.state = d.rng;
      w.time = d.time;
      w.nextId = d.nextId;
      w.monthIndex = d.monthIndex;
      w.walkTimer = d.walkTimer;
      w.lost = d.lost;
      w.delivered = d.delivered;
      w.networkVersion = d.networkVersion;
      w.over = d.over;
      Object.assign(w.econ, d.econ);
      w.towns = d.towns;
      w.districts = d.districts;
      w.houses = (d.houses as number[][]).map(([x, y, residents, town, district, stop]) => ({ pos: { x, y }, residents, town, district, stop }));
      w.stops = (d.stops as Saved[]).map((s) => ({ ...s, covers: new Set(s.covers), byDistrict: new Map(s.byDistrict) }));
      w.lines = d.lines;
      w.vehicles = (d.vehicles as (Omit<Vehicle, 'type'> & { type: 'train' | 'bus' })[]).map((v) => ({ ...v, type: VEHICLES[v.type] }));
      w.ways = new Map((d.ways as Way[]).map((x) => [x.key, x]));
      w.router.invalidate();
      return w;
    } catch {
      return null;
    }
  }

  // ---------- reports ----------

  /** Cash minus loan plus what the fleet would sell for. */
  companyValue(): number {
    return this.econ.cash - this.econ.loan + this.vehicles.reduce((n, v) => n + v.type.price * CONFIG.sellRefund, 0);
  }

  coverage(): number {
    let covered = 0;
    let total = 0;
    for (const h of this.houses) {
      total += h.residents;
      if (h.stop >= 0) covered += h.residents;
    }
    return total ? covered / total : 0;
  }
}

export function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}k`;
  return `${sign}$${Math.round(a)}`;
}
