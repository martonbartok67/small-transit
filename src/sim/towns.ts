import { CONFIG } from './config';
import { dist, distToPolygonEdge, pointInPolygon, v, type Vec2 } from './geom';
import type { Rng } from './rng';
import type { District, House, MapDef, Stop, Town } from './types';

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

export function buildTowns(map: MapDef, rng: Rng): { towns: Town[]; districts: District[]; houses: House[] } {
  const towns: Town[] = [];
  const districts: District[] = [];
  const houses: House[] = [];
  map.towns.forEach((def, id) => {
    towns.push({ id, name: def.name, center: def.center, pop: 0, tripsMonth: 0, tripsLast: 0, growthLast: 0 });
    for (const d of DISTRICT_LAYOUT[def.districts]) {
      districts.push({ id: districts.length, town: id, name: def.name + d.suffix, center: v(def.center.x + d.off.x, def.center.y + d.off.y), pop: 0 });
    }
    const radius = 120 + Math.sqrt(def.pop) * 9;
    let pop = 0;
    for (let tries = 0; pop < def.pop && tries < def.pop * 4; tries++) {
      const r = Math.sqrt(rng.next()) * radius;
      const a = rng.next() * Math.PI * 2;
      const p = v(def.center.x + Math.cos(a) * r, def.center.y + Math.sin(a) * r);
      const h = placeHouse(map, houses, districts, id, p, rng);
      if (h) pop += h.residents;
    }
  });
  refreshPopulations(towns, districts, houses);
  return { towns, districts, houses };
}

/** Add a house at p if the spot is free; returns it or null. */
export function placeHouse(map: MapDef, houses: House[], districts: District[], town: number, at: Vec2, rng: Rng): House | null {
  const p = v(Math.round(at.x), Math.round(at.y)); // whole units keep saves small
  if (!isDry(map, p)) return null;
  for (const h of houses) if (Math.abs(h.pos.x - p.x) < 16 && Math.abs(h.pos.y - p.y) < 16) return null;
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
  const h: House = { pos: p, residents: lo + rng.int(hi - lo + 1), town, district: best, stop: -1 };
  houses.push(h);
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

/** Assign every house to its nearest covering stop and rebuild each stop's coverage. */
export function assignCatchment(houses: House[], stops: Stop[]): void {
  for (const s of stops) {
    s.covers = new Set();
    s.residents = 0;
    s.byDistrict = new Map();
  }
  for (const h of houses) {
    h.stop = -1;
    let bd = Infinity;
    for (const s of stops) {
      const d = dist(s.pos, h.pos);
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
    if (!s) continue;
    s.residents += h.residents;
    s.byDistrict.set(h.district, (s.byDistrict.get(h.district) ?? 0) + h.residents);
  }
}

/** Monthly growth: a small natural rate plus a bonus for coverage and real ridership. */
export function growTown(map: MapDef, town: Town, houses: House[], districts: District[], rng: Rng): number {
  const mine = houses.filter((h) => h.town === town.id);
  if (mine.length === 0) return 0;
  const covered = mine.reduce((n, h) => n + (h.stop >= 0 ? h.residents : 0), 0) / Math.max(1, town.pop);
  const activity = Math.min(1, town.tripsLast / Math.max(1, town.pop * CONFIG.growth.activityPerResident));
  const rate = CONFIG.growth.base + CONFIG.growth.served * covered * activity;
  let target = town.pop * rate;
  let added = 0;
  for (let tries = 0; target > 0 && tries < 200; tries++) {
    const near = rng.pick(mine).pos;
    const a = rng.next() * Math.PI * 2;
    const r = 20 + rng.next() * 30;
    const h = placeHouse(map, houses, districts, town.id, v(near.x + Math.cos(a) * r, near.y + Math.sin(a) * r), rng);
    if (!h) continue;
    mine.push(h);
    target -= h.residents;
    added += h.residents;
  }
  return added;
}
