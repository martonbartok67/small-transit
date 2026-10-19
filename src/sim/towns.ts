import { CONFIG } from './config';
import { dist, distToPolygonEdge, pointInPolygon, v, type Vec2 } from './geom';
import type { Rng } from './rng';
import type { District, House, Industry, MapDef, Stop, Town } from './types';

const DISTRICT_LAYOUT: Record<1 | 2 | 3, { suffix: string; off: Vec2 }[]> = {
  1: [{ suffix: '', off: v(0, 0) }],
  2: [
    { suffix: ' West', off: v(-270, 0) },
    { suffix: ' East', off: v(270, 0) },
  ],
  3: [
    { suffix: ' Centre', off: v(0, 40) },
    { suffix: ' North', off: v(-60, -330) },
    { suffix: ' South', off: v(60, 380) },
  ],
};

export const isDry = (map: MapDef, p: Vec2, margin = 30) =>
  map.water.every((w) => !pointInPolygon(p, w) && distToPolygonEdge(p, w) > margin) &&
  Math.abs(p.x) < map.halfW - 40 &&
  Math.abs(p.y) < map.halfH - 40;

/** Radius of the built-up area of a town of this population (houses fill blocks densely). */
export const townRadius = (pop: number) => 40 + Math.sqrt(pop) * 8;

/** Inside this share of the radius, buildings are shops and offices rather than houses. */
const DOWNTOWN = 0.32;

const mod = (g: number) => ((g % CONFIG.streetEvery) + CONFIG.streetEvery) % CONFIG.streetEvery;
/** Lots on the edge of a block face a street. */
const facesStreet = (gx: number, gy: number) => [1, CONFIG.streetEvery - 1].includes(mod(gx)) || [1, CONFIG.streetEvery - 1].includes(mod(gy));

/** Lower is built first: near the centre, street frontage before back lots, with some noise. */
const lotScore = (center: Vec2, gx: number, gy: number, noise: number) =>
  Math.hypot(gx * CONFIG.lot - center.x, gy * CONFIG.lot - center.y) * (1 + 0.35 * noise) - (facesStreet(gx, gy) ? 40 : 0);

/** Lot index for a world point; houses occupy whole lots. */
export const lotKey = (gx: number, gy: number) => gx * 100_003 + gy;

/** True when lot line g is a street. */
export const isStreet = (g: number) => mod(g) === 0;

/** Lots that hold houses, and lots kept clear for roads and track. */
export interface Lots {
  used: Set<number>;
  blocked: Set<number>;
}

export function buildTowns(map: MapDef, rng: Rng, lots: Lots): { towns: Town[]; districts: District[]; houses: House[] } {
  const towns: Town[] = [];
  const districts: District[] = [];
  const houses: House[] = [];
  map.towns.forEach((def, id) => {
    towns.push({
      id,
      name: def.name,
      center: def.center,
      pop: 0,
      basePop: def.pop,
      tripsMonth: 0,
      tripsLast: 0,
      supplyMonth: 0,
      supplyLast: 0,
      supplyBy: {},
      supplyLastBy: {},
      growthLast: 0,
      history: [],
    });
    for (const d of DISTRICT_LAYOUT[def.districts]) {
      districts.push({ id: districts.length, town: id, name: def.name + d.suffix, center: v(def.center.x + d.off.x, def.center.y + d.off.y), pop: 0 });
    }
    // Fill lots outward from the centre, street frontage first, until the town has its people.
    const radius = townRadius(def.pop) * 1.4;
    const c = def.center;
    const cand: { gx: number; gy: number; score: number }[] = [];
    for (let gx = Math.ceil((c.x - radius) / CONFIG.lot); gx * CONFIG.lot <= c.x + radius; gx++) {
      for (let gy = Math.ceil((c.y - radius) / CONFIG.lot); gy * CONFIG.lot <= c.y + radius; gy++) {
        cand.push({ gx, gy, score: lotScore(c, gx, gy, rng.next()) });
      }
    }
    cand.sort((a, b) => a.score - b.score);
    const downtown = townRadius(def.pop) * DOWNTOWN;
    let pop = 0;
    for (const k of cand) {
      if (pop >= def.pop) break;
      const p = v(k.gx * CONFIG.lot, k.gy * CONFIG.lot);
      const h = placeHouse(map, houses, districts, lots, id, p, rng, dist(p, c) < downtown && rng.next() < 0.85);
      if (h) pop += h.residents;
    }
  });
  refreshPopulations(towns, districts, houses);
  return { towns, districts, houses };
}

/** Add a house on the free lot nearest `at`; returns it or null when the lot is taken, a street or wet. */
export function placeHouse(map: MapDef, houses: House[], districts: District[], lots: Lots, town: number, at: Vec2, rng: Rng, shop = false): House | null {
  const gx = Math.round(at.x / CONFIG.lot);
  const gy = Math.round(at.y / CONFIG.lot);
  const key = lotKey(gx, gy);
  if (isStreet(gx) || isStreet(gy) || lots.used.has(key) || lots.blocked.has(key)) return null;
  const p = v(gx * CONFIG.lot, gy * CONFIG.lot);
  if (!isDry(map, p)) return null;
  let best = -1;
  let bd = Infinity;
  for (const d of districts) {
    if (d.town !== town) continue;
    const dd = dist(d.center, p);
    if (dd < bd) {
      bd = dd;
      best = d.id;
    }
  }
  const [lo, hi] = CONFIG.houseResidents;
  const h: House = { pos: p, residents: lo + rng.int(hi - lo + 1), town, district: best, stop: -1, roof: rng.int(4), shop };
  houses.push(h);
  lots.used.add(key);
  return h;
}

export function refreshPopulations(towns: Town[], districts: District[], houses: House[]): void {
  for (const t of towns) t.pop = 0;
  for (const d of districts) d.pop = 0;
  for (const h of houses) {
    towns[h.town].pop += h.residents;
    districts[h.district].pop += h.residents;
  }
}

/**
 * Assign every house to its nearest covering stop, and every stop its town and
 * the industries in reach. Returns the stops covering each district.
 */
export function assignCatchment(houses: House[], stops: Stop[], towns: Town[], industries: Industry[]): Map<number, number[]> {
  for (const s of stops) {
    s.covers = new Set();
    s.residents = 0;
    let best = -1;
    let bd = Infinity;
    for (const t of towns) {
      const d = dist(t.center, s.pos);
      if (d < townRadius(t.pop) * 1.1 && d < bd) {
        bd = d;
        best = t.id;
      }
    }
    s.town = best;
    s.industries = industries.filter((i) => dist(i.pos, s.pos) <= CONFIG.industryReach[s.mode]).map((i) => i.id);
  }
  for (const h of houses) {
    h.stop = -1;
    let bd = Infinity;
    for (const s of stops) {
      const d = Math.abs(s.pos.x - h.pos.x) + Math.abs(s.pos.y - h.pos.y) < CONFIG.stop[s.mode].catchment * 1.5 ? dist(s.pos, h.pos) : Infinity;
      if (d > CONFIG.stop[s.mode].catchment) continue;
      s.covers.add(h.district);
      if (d < bd) {
        bd = d;
        h.stop = s.id;
      }
    }
  }
  const byId = new Map(stops.map((s) => [s.id, s]));
  for (const h of houses) {
    const s = h.stop >= 0 ? byId.get(h.stop) : undefined;
    if (s) s.residents += h.residents;
  }
  const covering = new Map<number, number[]>();
  for (const s of stops) {
    for (const d of s.covers) {
      const arr = covering.get(d) ?? [];
      arr.push(s.id);
      covering.set(d, arr);
    }
  }
  return covering;
}

/**
 * Monthly growth: a small natural rate, a bonus for passenger service and one for
 * food and goods deliveries, all slowing as the town nears its size limit.
 */
/** Mark the lots within `r` of a path as kept clear; returns the newly blocked lot keys. */
export function blockAlong(lots: Lots, path: Vec2[], r: number): Set<number> {
  const fresh = new Set<number>();
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const n = Math.max(1, Math.ceil(dist(a, b) / 10));
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n;
      const y = a.y + ((b.y - a.y) * k) / n;
      for (let gx = Math.ceil((x - r) / CONFIG.lot); gx * CONFIG.lot <= x + r; gx++) {
        for (let gy = Math.ceil((y - r) / CONFIG.lot); gy * CONFIG.lot <= y + r; gy++) {
          const key = lotKey(gx, gy);
          if (lots.blocked.has(key) || Math.hypot(gx * CONFIG.lot - x, gy * CONFIG.lot - y) > r) continue;
          lots.blocked.add(key);
          fresh.add(key);
        }
      }
    }
  }
  return fresh;
}

export function growTown(map: MapDef, town: Town, houses: House[], districts: District[], lots: Lots, rng: Rng): number {
  const mine = houses.filter((h) => h.town === town.id);
  if (mine.length === 0) return 0;
  const g = CONFIG.growth;
  const covered = mine.reduce((n, h) => n + (h.stop >= 0 ? h.residents : 0), 0) / Math.max(1, town.pop);
  const activity = Math.min(1, town.tripsLast / Math.max(1, town.pop * g.tripsPerResident));
  const supply = Math.min(1, town.supplyLast / Math.max(1, town.pop * g.supplyPerResident));
  const room = Math.max(0, 1 - town.pop / (g.capFactor * town.basePop));
  let target = town.pop * (g.base + g.passengers * covered * activity + g.cargo * supply) * room;
  let added = 0;
  const downtown = townRadius(town.pop) * DOWNTOWN;
  // Each new house goes on the best of a handful of free lots next to existing ones: infill first, then outward.
  for (let tries = 0; target > 0 && tries < 200; tries++) {
    let best: { gx: number; gy: number; score: number } | null = null;
    for (let k = 0; k < 12; k++) {
      const near = rng.pick(mine).pos;
      const gx = Math.round((near.x + (rng.next() - 0.5) * 144) / CONFIG.lot);
      const gy = Math.round((near.y + (rng.next() - 0.5) * 144) / CONFIG.lot);
      const key = lotKey(gx, gy);
      if (isStreet(gx) || isStreet(gy) || lots.used.has(key) || lots.blocked.has(key)) continue;
      const score = lotScore(town.center, gx, gy, rng.next());
      if (!best || score < best.score) best = { gx, gy, score };
    }
    if (!best) continue;
    const p = v(best.gx * CONFIG.lot, best.gy * CONFIG.lot);
    const h = placeHouse(map, houses, districts, lots, town.id, p, rng, dist(p, town.center) < downtown && rng.next() < 0.85);
    if (!h) continue;
    mine.push(h);
    target -= h.residents;
    added += h.residents;
  }
  return added;
}
