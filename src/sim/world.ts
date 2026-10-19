import { CONFIG, INDUSTRY, TOWN_CARGO, VEHICLES, vehicleFor } from './config';
import { Economy } from './economy';
import { dist, offsetPolyline, polylineLength, type Vec2 } from './geom';
import { Rng } from './rng';
import { ahead, departDir, Router } from './router';
import { Terrain } from './terrain';
import { assignCatchment, blockAlong, buildTowns, growTown, isDry, lotKey, refreshPopulations, townRadius, type Lots } from './towns';
import type { Carries, District, Freight, Group, House, Industry, Line, MapDef, Mode, Segment, SimEvent, Stop, Town, Vehicle, VehicleKey } from './types';
import { dock, loadOf, resyncVehicles, segPath, updateVehicle } from './vehicles';

export const LINE_SPACING: Record<Mode, number> = { rail: 9, road: 7 };
export const LINE_COLORS = 8;
/** Bump when the save layout changes; older saves are then ignored. */
export const SAVE_VERSION = 2;

/** Seconds between passenger spawning, cargo production and patience updates. */
const TICK = 0.5;

export interface LinePreview {
  ok: boolean;
  paths: Vec2[][];
  cost: number;
  reason?: string;
}

export interface Way {
  mode: Mode;
  key: string;
  path: Vec2[];
  length: number;
  /** Lines sharing this way; each gets its own parallel track or lane. */
  lanes: number;
}

interface DemandCache {
  version: string;
  share: number;
  dests: { stop: number; w: number }[];
  total: number;
}

const terrains = new WeakMap<MapDef, Terrain>();
/** Houses keep this far from the middle of a road. */
const ROAD_CLEARANCE = 26;
const wayClearance = (w: Way) => (w.mode === 'rail' ? (w.lanes * LINE_SPACING.rail) / 2 + 16 : ROAD_CLEARANCE);
const kindOf = (what: Freight): Carries => (what === 'pax' ? 'pax' : 'cargo');
const keyOf = (what: Freight, dest: number) => `${what}|${dest}`;
export const parseKey = (k: string): { what: Freight; dest: number } => {
  const bar = k.indexOf('|');
  return { what: k.slice(0, bar) as Freight, dest: Number(k.slice(bar + 1)) };
};

export class World {
  readonly rng: Rng;
  readonly terrain: Terrain;
  time = 0;
  towns: Town[];
  districts: District[];
  houses: House[];
  industries: Industry[];
  stops: Stop[] = [];
  lines: Line[] = [];
  vehicles: Vehicle[] = [];
  econ = new Economy();
  events: SimEvent[] = [];
  over: { month: number } | null = null;
  /** Passengers and cargo that gave up waiting or found a full stop. */
  lost = 0;
  /** Passengers who reached their destination. */
  delivered = 0;
  /** Units of cargo that reached an industry or town. */
  deliveredCargo = 0;
  networkVersion = 0;
  /** Increments whenever houses or stops change, so catchment-derived caches refresh. */
  catchVersion = 0;
  readonly router: Router;

  private nextId = 1;
  private monthIndex = 0;
  private ways = new Map<string, Way>();
  private baseCache = new Map<string, { path: Vec2[]; cost: number }>();
  private demand = new Map<number, DemandCache>();
  private cargoRoutes = new Map<number, { version: string; route: { stop: number; dest: number } | null }>();
  private tickTimer = 0;
  private lots: Lots = { used: new Set(), blocked: new Set() };
  private covering = new Map<number, number[]>();
  private stopIndex = new Map<number, Stop>();

  constructor(
    readonly map: MapDef,
    readonly seed: number,
  ) {
    this.rng = new Rng(seed);
    let terrain = terrains.get(map);
    if (!terrain) terrains.set(map, (terrain = new Terrain(map)));
    this.terrain = terrain;
    for (const road of map.roads) blockAlong(this.lots, road, ROAD_CLEARANCE);
    const t = buildTowns(map, this.rng, this.lots);
    this.towns = t.towns;
    this.districts = t.districts;
    this.houses = t.houses;
    this.industries = map.industries.map((d, id) => ({
      id,
      kind: d.kind,
      name: d.name,
      pos: d.pos,
      produces: INDUSTRY[d.kind].produces,
      accepts: INDUSTRY[d.kind].accepts,
      rate: INDUSTRY[d.kind].accepts ? 0 : CONFIG.industry.start,
      producedMonth: 0,
      producedLast: 0,
      shippedMonth: 0,
      shippedLast: 0,
      receivedMonth: 0,
      receivedLast: 0,
    }));
    this.router = new Router(this);
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
    return this.stopIndex.get(id);
  }

  lineById(id: number): Line | undefined {
    return this.lines.find((l) => l.id === id);
  }

  vehiclesOn(lineId: number, carries?: Carries): Vehicle[] {
    return this.vehicles.filter((v) => v.line === lineId && (!carries || v.type.carries === carries));
  }

  linesAt(stopId: number): Line[] {
    return this.lines.filter((l) => l.stops.includes(stopId));
  }

  townRadius(t: Town): number {
    return townRadius(t.pop);
  }

  /** Town streets, which road vehicles use for free. */
  inTown = (p: Vec2): boolean => this.towns.some((t) => dist(t.center, p) < townRadius(t.pop) * 0.9);

  waitingTotal(s: Stop): number {
    let n = 0;
    for (const k in s.waiting) n += s.waiting[k];
    return n;
  }

  /** Waiting at a stop by what is waiting: passengers and each kind of cargo. */
  waitingBy(s: Stop): Partial<Record<Freight, number>> {
    const out: Partial<Record<Freight, number>> = {};
    for (const k in s.waiting) {
      const { what } = parseKey(k);
      out[what] = (out[what] ?? 0) + s.waiting[k];
    }
    return out;
  }

  // ---------- main step ----------

  step(dt: number): void {
    if (this.over) return;
    this.time += dt;
    this.tickTimer -= dt;
    if (this.tickTimer <= 0) {
      this.tickTimer += TICK;
      this.spawnPassengers(TICK);
      this.produceCargo(TICK);
      this.decay(TICK);
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
    for (const w of this.ways.values()) maint += w.length * w.lanes * CONFIG.way[w.mode].maintenance;
    for (const s of this.stops) maint += CONFIG.stop[s.mode].maintenance;
    this.econ.charge('maintenance', maint * f);
  }

  private closeMonth(): void {
    for (const l of this.lines) {
      l.profitLast = l.revenueMonth - l.costMonth;
      l.carriedLast = l.carriedMonth;
      l.revenueMonth = l.costMonth = l.carriedMonth = 0;
    }
    const ic = CONFIG.industry;
    for (const ind of this.industries) {
      ind.producedLast = ind.producedMonth;
      ind.shippedLast = ind.shippedMonth;
      ind.receivedLast = ind.receivedMonth;
      ind.producedMonth = ind.shippedMonth = ind.receivedMonth = 0;
      if (ind.accepts || ind.producedLast <= 0) continue;
      // Primary industries expand when their output is moved and shrink when it piles up.
      const shipped = ind.shippedLast / ind.producedLast;
      if (shipped >= ic.shipWell) ind.rate = Math.min(ic.max, ind.rate * (1 + ic.grow));
      else if (shipped <= ic.shipPoorly) ind.rate = Math.max(ic.start * 0.5, ind.rate * (1 - ic.shrink));
    }
    let grew = false;
    for (const t of this.towns) {
      t.tripsLast = t.tripsMonth;
      t.supplyLast = t.supplyMonth;
      t.tripsMonth = t.supplyMonth = 0;
      t.growthLast = growTown(this.map, t, this.houses, this.districts, this.lots, this.rng);
      grew ||= t.growthLast > 0;
    }
    if (grew) {
      refreshPopulations(this.towns, this.districts, this.houses);
      this.refreshCatchment();
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

  private refreshCatchment(): void {
    this.covering = assignCatchment(this.houses, this.stops, this.towns, this.industries);
    this.catchVersion++;
  }

  // ---------- passengers and cargo ----------

  /** Add travellers to a stop's queue; whatever does not fit is lost. Returns what fit. */
  private queue(s: Stop, what: Freight, dest: number, n: number): number {
    const free = Math.max(0, CONFIG.stop[s.mode].capacity - this.waitingTotal(s));
    const fit = Math.min(n, free);
    if (fit > 0) {
      const k = keyOf(what, dest);
      s.waiting[k] = (s.waiting[k] ?? 0) + fit;
    }
    this.lost += n - fit;
    return fit;
  }

  /** Reachable destinations from a stop, weighted by a gravity model over districts. */
  private demandAt(s: Stop): DemandCache {
    const version = `${this.router.version}:${this.catchVersion}`;
    const hit = this.demand.get(s.id);
    if (hit && hit.version === version) return hit;
    // Districts reachable on foot from here are not transit trips.
    const near = new Set(s.covers);
    for (const o of this.stops) if (o.id !== s.id && dist(o.pos, s.pos) <= CONFIG.walkRange) o.covers.forEach((d) => near.add(d));
    let all = 0;
    let reach = 0;
    const byStop = new Map<number, number>();
    for (const d of this.districts) {
      if (near.has(d.id) || d.pop === 0) continue;
      const w = d.pop / Math.pow(Math.max(300, dist(s.pos, d.center)), CONFIG.gravityExponent);
      all += w;
      let best = -1;
      let bc = Infinity;
      for (const id of this.covering.get(d.id) ?? []) {
        const c = this.router.cost('pax', s.id, id);
        if (c < bc) {
          bc = c;
          best = id;
        }
      }
      if (best < 0) continue;
      reach += w;
      byStop.set(best, (byStop.get(best) ?? 0) + w);
    }
    const dests = [...byStop].map(([stop, w]) => ({ stop, w }));
    const c = { version, share: all > 0 ? reach / all : 0, dests, total: reach };
    this.demand.set(s.id, c);
    return c;
  }

  private spawnPassengers(dt: number): void {
    for (const s of this.stops) {
      if (s.residents === 0) continue;
      const dem = this.demandAt(s);
      if (dem.share === 0 || dem.total === 0) continue;
      const amount = ((s.residents * CONFIG.tripRate * dem.share * this.econ.demand(s.mode)) / CONFIG.monthSeconds) * dt;
      for (const d of dem.dests) this.queue(s, 'pax', d.stop, (amount * d.w) / dem.total);
    }
  }

  /** Where an industry's output goes: the cheapest stop pair from one of its stops to a consumer. */
  cargoRoute(ind: Industry): { stop: number; dest: number } | null {
    const version = `${this.router.version}:${this.catchVersion}`;
    const hit = this.cargoRoutes.get(ind.id);
    if (hit && hit.version === version) return hit.route;
    const c = ind.produces;
    const consumers = this.stops.filter(
      (s) => s.industries.some((j) => this.industries[j].accepts === c) || (TOWN_CARGO.includes(c) && s.town >= 0 && s.residents > 0),
    );
    let route: { stop: number; dest: number } | null = null;
    let best = Infinity;
    for (const src of this.stops) {
      if (!src.industries.includes(ind.id)) continue;
      for (const dst of consumers) {
        if (dst.id === src.id) continue;
        const cost = this.router.cost('cargo', src.id, dst.id);
        if (cost < best) {
          best = cost;
          route = { stop: src.id, dest: dst.id };
        }
      }
    }
    this.cargoRoutes.set(ind.id, { version, route });
    return route;
  }

  private produceCargo(dt: number): void {
    for (const ind of this.industries) {
      const perMonth = ind.accepts ? ind.receivedLast : ind.rate;
      if (perMonth <= 0) continue;
      const amount = (perMonth / CONFIG.monthSeconds) * dt;
      ind.producedMonth += amount;
      const route = this.cargoRoute(ind);
      if (route) this.queue(this.stopById(route.stop)!, ind.produces, route.dest, amount);
    }
  }

  /** Waiting travellers give up at a steady rate. */
  private decay(dt: number): void {
    const keep = Math.exp(-dt / (CONFIG.patienceMonths * CONFIG.monthSeconds));
    for (const s of this.stops) {
      for (const k in s.waiting) {
        const n = s.waiting[k];
        this.lost += n * (1 - keep);
        if (n * keep < 0.05) delete s.waiting[k];
        else s.waiting[k] = n * keep;
      }
    }
  }

  /** How much waiting at `st` would board this vehicle, leaving in direction `dir`. */
  boardable(t: Vehicle, line: Line, st: Stop, dir: 1 | -1): number {
    let n = 0;
    const i = line.stops.indexOf(st.id);
    for (const k in st.waiting) {
      const { what, dest } = parseKey(k);
      if (kindOf(what) !== t.type.carries) continue;
      const hop = this.router.hop(t.type.carries, st.id, dest);
      if (hop?.kind === 'ride' && hop.line === line.id && ahead(line, i, dir, line.stops.indexOf(hop.to))) n += st.waiting[k];
    }
    return n;
  }

  /** Load whoever waits for this vehicle, up to its capacity. Returns the amount moved. */
  board(t: Vehicle, line: Line, st: Stop, dir: 1 | -1): number {
    let free = t.type.capacity - loadOf(t);
    let moved = 0;
    const i = line.stops.indexOf(st.id);
    for (const k in st.waiting) {
      if (free < 0.5) break;
      const { what, dest } = parseKey(k);
      if (kindOf(what) !== t.type.carries) continue;
      const hop = this.router.hop(t.type.carries, st.id, dest);
      if (hop?.kind !== 'ride' || hop.line !== line.id || !ahead(line, i, dir, line.stops.indexOf(hop.to))) continue;
      const take = Math.min(st.waiting[k], free);
      if (take < 0.05) continue;
      st.waiting[k] -= take;
      if (st.waiting[k] < 0.05) delete st.waiting[k];
      free -= take;
      moved += take;
      const g = t.load.find((x) => x.what === what && x.dest === dest && x.alight === hop.to && x.from === st.id);
      if (g) g.n += take;
      else t.load.push({ what, dest, alight: hop.to, from: st.id, n: take });
      if (what === 'pax') {
        if (st.town >= 0) this.towns[st.town].tripsMonth += take;
      } else {
        const src = st.industries.map((j) => this.industries[j]).find((ind) => ind.produces === what);
        if (src) src.shippedMonth += take;
      }
    }
    return moved;
  }

  /** Unload the groups `which` selects at `st`: pay for the leg, then deliver or pass them on. Returns the amount moved. */
  unload(t: Vehicle, st: Stop, which: (g: Group) => boolean): number {
    let moved = 0;
    const line = this.lineById(t.line);
    const keep: Group[] = [];
    for (const g of t.load) {
      if (!which(g)) {
        keep.push(g);
        continue;
      }
      moved += g.n;
      const from = this.stopById(g.from);
      const earned = this.pay(g.what, t.type.mode, from ? dist(from.pos, st.pos) : 0, g.n);
      if (line) {
        line.revenueMonth += earned;
        line.carriedMonth += g.n;
      }
      this.arriveAt(g.what, g.dest, st, g.n);
      this.events.push({ type: 'deliver', stop: st.id, amount: earned, line: t.line });
    }
    t.load = keep;
    return moved;
  }

  /** Travellers reach `st` on their way to `dest`: deliver, walk on, or wait for the next vehicle. */
  private arriveAt(what: Freight, dest: number, st: Stop, n: number, depth = 0): void {
    if (st.id === dest) return this.deliver(what, st, n);
    const hop = depth < 4 ? this.router.hop(kindOf(what), st.id, dest) : null;
    if (!hop) {
      this.lost += n;
      return;
    }
    if (hop.kind === 'walk') return this.arriveAt(what, dest, this.stopById(hop.to)!, n, depth + 1);
    this.queue(st, what, dest, n);
  }

  private deliver(what: Freight, st: Stop, n: number): void {
    if (what === 'pax') {
      this.delivered += n;
      if (st.town >= 0) this.towns[st.town].tripsMonth += n;
      return;
    }
    this.deliveredCargo += n;
    const ind = st.industries.map((j) => this.industries[j]).find((i) => i.accepts === what);
    if (ind) ind.receivedMonth += n;
    else if (st.town >= 0 && TOWN_CARGO.includes(what)) this.towns[st.town].supplyMonth += n;
  }

  /** Pay for one leg of `n` travellers over a straight-line distance; returns the amount. */
  private pay(what: Freight, mode: Mode, distance: number, n: number): number {
    if (what === 'pax') {
      const amount = this.ticket(mode, distance) * n;
      this.econ.earn('fares', amount);
      return amount;
    }
    const amount = this.freightRate(distance) * n;
    this.econ.earn('freight', amount);
    return amount;
  }

  /** Price of one passenger's trip of this straight-line length, at the current price level. */
  ticket(mode: Mode, distance: number): number {
    const f = CONFIG.fare[mode];
    return (f.base + f.perUnit * distance) * this.econ.price[mode];
  }

  /** Pay for one unit of cargo carried this straight-line distance. */
  freightRate(distance: number): number {
    return CONFIG.freightPay.base + CONFIG.freightPay.perUnit * distance;
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
      waiting: {},
      covers: new Set(),
      residents: 0,
      town: -1,
      industries: [],
      bornAt: this.time,
    };
    this.stops.push(s);
    this.stopIndex.set(s.id, s);
    this.refreshCatchment();
    this.router.invalidate();
    this.networkVersion++;
    return s;
  }

  private nameFor(mode: Mode, pos: Vec2): string {
    let best: District | undefined;
    for (const d of this.districts) if (!best || dist(d.center, pos) < dist(best.center, pos)) best = d;
    const inTown = this.towns.some((t) => dist(t.center, pos) < townRadius(t.pop) * 1.1);
    const ind = this.industries.find((i) => dist(i.pos, pos) <= CONFIG.industryReach[mode]);
    const place = !inTown && ind ? ind.name : best && dist(best.center, pos) < 900 ? best.name : 'Countryside';
    const base = `${place} ${mode === 'rail' ? 'Station' : 'Stop'}`;
    const taken = new Set(this.stops.map((s) => s.name));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  }

  removeStop(id: number): string | null {
    const s = this.stopById(id);
    if (!s) return 'No stop there';
    if (this.linesAt(id).length) return 'Remove it from its lines first';
    this.lost += this.waitingTotal(s);
    this.stops.splice(this.stops.indexOf(s), 1);
    this.stopIndex.delete(id);
    this.refreshCatchment();
    this.router.invalidate();
    this.networkVersion++;
    return null;
  }

  // ---------- building: lines ----------

  /** Cheapest terrain-following route between two stops, canonical per pair. */
  private basePath(mode: Mode, a: number, b: number): { path: Vec2[]; cost: number } {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = this.wayKey(mode, a, b);
    const way = this.ways.get(key);
    let hit = way ? { path: way.path, cost: 0 } : this.baseCache.get(key);
    if (!hit) {
      const path = this.terrain.route(mode, this.stopById(lo)!.pos, this.stopById(hi)!.pos, this.inTown);
      hit = { path, cost: this.terrain.pathCost(mode, path, this.inTown) };
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
    const modeOk = stops.every((id) => this.stopById(id)?.mode === mode);
    let reason: string | undefined;
    if (new Set(stops).size !== stops.length) reason = 'A line cannot visit a stop twice';
    else if (!modeOk) reason = mode === 'rail' ? 'Rail lines connect stations only' : 'Road lines connect road stops only';
    if (reason) return { ok: false, paths: [], cost: 0, reason };
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
    if (cost > this.econ.cash) reason = `Need ${money(cost)}`;
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
        name: `${mode === 'rail' ? 'Rail' : 'Road'} ${sameMode + 1}`,
        stops: stops.slice(),
        loop,
        segs: [],
        revenueMonth: 0,
        costMonth: 0,
        profitLast: 0,
        carriedMonth: 0,
        carriedLast: 0,
        departed: { pax: -1e9, cargo: -1e9 },
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

  /** Rebuild ways and per-line geometry after any change. */
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
    const cleared: Way[] = [];
    for (const l of this.lines) {
      l.segs = this.pairs(l.stops, l.loop).map(([a, b]): Segment => {
        const k = this.wayKey(l.mode, a, b);
        const ids = users.get(k)!.sort((x, y) => x - y);
        const off = (ids.indexOf(l.id) - (ids.length - 1) / 2) * LINE_SPACING[l.mode];
        const lo = Math.min(a, b);
        const base = this.basePath(l.mode, lo, Math.max(a, b));
        const way = this.ways.get(k);
        if (way) way.lanes = ids.length;
        else {
          const fresh: Way = { mode: l.mode, key: k, path: base.path, length: polylineLength(base.path), lanes: ids.length };
          this.ways.set(k, fresh);
          cleared.push(fresh);
        }
        let path = offsetPolyline(base.path, off);
        if (a !== lo) path = path.reverse();
        return { a, b, path, length: polylineLength(path) };
      });
    }
    if (cleared.length) this.demolishUnder(cleared);
    this.networkVersion++;
    this.router.invalidate();
    resyncVehicles(this);
  }

  /** New track or road clears the houses in its way, as in a real town. */
  private demolishUnder(ways: Way[]): void {
    const gone = new Set<number>();
    for (const w of ways) blockAlong(this.lots, w.path, wayClearance(w)).forEach((k) => gone.add(k));
    const key = (h: House) => lotKey(Math.round(h.pos.x / CONFIG.lot), Math.round(h.pos.y / CONFIG.lot));
    const before = this.houses.length;
    this.houses = this.houses.filter((h) => {
      if (!gone.has(key(h))) return true;
      this.lots.used.delete(key(h));
      return false;
    });
    if (this.houses.length === before) return;
    refreshPopulations(this.towns, this.districts, this.houses);
    this.refreshCatchment();
  }

  /** Ways (track and road) for drawing. */
  wayList(): Way[] {
    return [...this.ways.values()];
  }

  // ---------- vehicles ----------

  canAddVehicle(lineId: number, carries: Carries = 'pax'): string | null {
    const line = this.lineById(lineId);
    if (!line) return 'No such line';
    const type = vehicleFor(line.mode, carries);
    if (this.vehiclesOn(lineId).length >= CONFIG.maxVehiclesPerLine) return 'This line is full';
    if (this.econ.cash < type.price) return `Need ${money(type.price)}`;
    return null;
  }

  addVehicle(lineId: number, carries: Carries = 'pax'): Vehicle | string {
    const why = this.canAddVehicle(lineId, carries);
    if (why) return why;
    const line = this.lineById(lineId)!;
    const type = vehicleFor(line.mode, carries);
    this.econ.spend('vehicles', type.price);
    // Spread vehicles along the line instead of stacking them at the first stop.
    const k = this.vehiclesOn(lineId, carries).length;
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
      load: [],
      odo: 0,
    };
    dock(v, st);
    this.vehicles.push(v);
    this.router.invalidate();
    return v;
  }

  /** Sell the emptiest vehicle of a kind on a line for part of its price. */
  sellVehicle(lineId: number, carries: Carries = 'pax'): boolean {
    const vs = this.vehiclesOn(lineId, carries).sort((a, b) => loadOf(a) - loadOf(b));
    if (!vs.length) return false;
    const v = vs[0];
    this.retireVehicle(v, this.stopById(v.dockedAt ?? v.fromStation) ?? this.stopById(v.toStation)!);
    return true;
  }

  retireVehicle(v: Vehicle, at: Stop): void {
    this.unload(v, at, () => true);
    this.econ.refund(v.type.price * CONFIG.sellRefund);
    this.vehicles.splice(this.vehicles.indexOf(v), 1);
    this.router.invalidate();
  }

  // ---------- saving ----------

  /** The whole game as JSON. Caches and catchment are left out and rebuilt on load. */
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
      tickTimer: this.tickTimer,
      lost: this.lost,
      delivered: this.delivered,
      deliveredCargo: this.deliveredCargo,
      networkVersion: this.networkVersion,
      over: this.over,
      econ: { cash: e.cash, loan: e.loan, month: e.month, last: e.last, negativeMonths: e.negativeMonths, price: e.price },
      towns: this.towns,
      districts: this.districts,
      industries: this.industries,
      houses: this.houses.map((h) => [h.pos.x, h.pos.y, h.residents, h.town, h.district, h.roof]),
      stops: this.stops.map((s) => ({ id: s.id, mode: s.mode, pos: s.pos, name: s.name, waiting: s.waiting, bornAt: s.bornAt })),
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
      w.tickTimer = d.tickTimer;
      w.lost = d.lost;
      w.delivered = d.delivered;
      w.deliveredCargo = d.deliveredCargo;
      w.networkVersion = d.networkVersion;
      w.over = d.over;
      Object.assign(w.econ, d.econ);
      w.towns = d.towns;
      w.districts = d.districts;
      w.industries = d.industries;
      w.houses = (d.houses as number[][]).map(([x, y, residents, town, district, roof]) => ({ pos: { x, y }, residents, town, district, stop: -1, roof }));
      w.lots.used = new Set(w.houses.map((h) => lotKey(Math.round(h.pos.x / CONFIG.lot), Math.round(h.pos.y / CONFIG.lot))));
      w.stops = (d.stops as Pick<Stop, 'id' | 'mode' | 'pos' | 'name' | 'waiting' | 'bornAt'>[]).map((s) => ({ ...s, covers: new Set(), residents: 0, town: -1, industries: [] }));
      w.stopIndex = new Map(w.stops.map((s) => [s.id, s]));
      w.lines = d.lines;
      w.vehicles = (d.vehicles as (Omit<Vehicle, 'type'> & { type: VehicleKey })[]).map((v) => ({ ...v, type: VEHICLES[v.type] }));
      w.ways = new Map((d.ways as Way[]).map((x) => [x.key, x]));
      for (const way of w.ways.values()) blockAlong(w.lots, way.path, wayClearance(way));
      w.refreshCatchment();
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

  /** Industries a stop ships for, with what it would carry and where. */
  industriesAt(s: Stop): Industry[] {
    return s.industries.map((i) => this.industries[i]);
  }
}

export function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}k`;
  return `${sign}$${Math.round(a)}`;
}
