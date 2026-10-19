import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/sim/config';
import { Economy } from '../src/sim/economy';
import { dist, v } from '../src/sim/geom';
import { VALLEY } from '../src/sim/maps/valley';
import { money, World } from '../src/sim/world';
import { reckless, runMonths, sensible } from './bot';

const must = <T>(r: T | string): T => {
  if (typeof r === 'string') throw new Error(r);
  return r;
};

const near = (w: World, kind: string) => w.industries.find((i) => i.kind === kind)!;

describe('towns', () => {
  it('generates the map deterministically, on whole lots', () => {
    const a = new World(VALLEY, 5);
    const b = new World(VALLEY, 5);
    expect(a.houses.length).toBe(b.houses.length);
    expect(a.towns.map((t) => t.pop)).toEqual(b.towns.map((t) => t.pop));
    for (const t of a.towns) expect(t.pop).toBeGreaterThan(VALLEY.towns[t.id].pop * 0.95);
    expect(a.houses.every((h) => h.pos.x % CONFIG.lot === 0 && h.pos.y % CONFIG.lot === 0)).toBe(true);
  });

  it('levels off instead of growing without limit', () => {
    const w = new World(VALLEY, 3);
    runMonths(w, 20 * 12, sensible);
    expect(w.over).toBeNull();
    for (const t of w.towns) expect(t.pop).toBeLessThanOrEqual(t.basePop * CONFIG.growth.capFactor * 1.02);
    // Stops are not permanently overflowing.
    const full = w.stops.filter((s) => w.waitingTotal(s) >= CONFIG.stop[s.mode].capacity * 0.95);
    expect(full.length).toBeLessThanOrEqual(Math.ceil(w.stops.length * 0.2));
  }, 120_000);
});

describe('terrain', () => {
  it('routes track around a lake instead of bridging it', () => {
    const w = new World(VALLEY, 1);
    w.econ.cash = 1e8;
    const a = must(w.placeStop('rail', v(-2750, 1350)));
    const b = must(w.placeStop('rail', v(-1700, 1800)));
    const pv = w.previewLine('rail', [a.id, b.id], false);
    expect(pv.ok).toBe(true);
    const straight = dist(a.pos, b.pos) * CONFIG.way.rail.build;
    expect(pv.cost).toBeLessThan(straight * 1.6);
    expect(pv.paths[0].length).toBeGreaterThan(2); // it bends
  });

  it('runs road lines along existing country roads almost for free', () => {
    const w = new World(VALLEY, 1);
    const a = must(w.placeStop('road', w.towns[0].center));
    const b = must(w.placeStop('road', w.towns[3].center));
    const pv = w.previewLine('road', [a.id, b.id], false);
    expect(pv.ok).toBe(true);
    expect(pv.cost).toBeLessThan(dist(a.pos, b.pos) * CONFIG.way.road.build * 0.15);
  });
});

describe('passengers', () => {
  it('carries rail passengers between towns and earns fares', () => {
    const w = new World(VALLEY, 2);
    const a = must(w.placeStop('rail', w.towns[0].center));
    const b = must(w.placeStop('rail', w.towns[4].center));
    const line = must(w.commitLine(null, 'rail', [a.id, b.id], false));
    must(w.addVehicle(line.id));
    runMonths(w, 4);
    expect(w.delivered).toBeGreaterThan(50);
    expect(w.econ.last.fares).toBeGreaterThan(0);
    expect(line.carriedLast).toBeGreaterThan(0);
  });

  it('carries bus passengers between districts of one town', () => {
    const w = new World(VALLEY, 3);
    const t = w.towns[4];
    const a = must(w.placeStop('road', v(t.center.x, t.center.y - 330)));
    const b = must(w.placeStop('road', v(t.center.x, t.center.y + 380)));
    const line = must(w.commitLine(null, 'road', [a.id, b.id], false));
    must(w.addVehicle(line.id));
    runMonths(w, 4);
    expect(line.carriedLast).toBeGreaterThan(10);
  });

  it('lets passengers walk from a bus stop to a nearby station and ride on', () => {
    const w = new World(VALLEY, 4);
    w.econ.cash = 1e8;
    const t = w.towns[0];
    const sa = must(w.placeStop('rail', t.center));
    const sb = must(w.placeStop('rail', w.towns[4].center));
    const rail = must(w.commitLine(null, 'rail', [sa.id, sb.id], false));
    must(w.addVehicle(rail.id));
    const feeder = must(w.placeStop('road', v(sa.pos.x + 120, sa.pos.y)));
    const far = must(w.placeStop('road', v(t.center.x, t.center.y - 400)));
    const bus = must(w.commitLine(null, 'road', [far.id, feeder.id], false));
    must(w.addVehicle(bus.id));
    expect(dist(feeder.pos, sa.pos)).toBeLessThan(CONFIG.walkRange);
    expect(w.router.hop('pax', far.id, sb.id)).toEqual({ kind: 'ride', line: bus.id, to: feeder.id });
    expect(w.router.hop('pax', feeder.id, sb.id)).toEqual({ kind: 'walk', to: sa.id });
    runMonths(w, 4);
    expect(bus.carriedLast).toBeGreaterThan(0);
  });

  it('refuses work it cannot pay for, and lines of the wrong mode', () => {
    const w = new World(VALLEY, 1);
    const a = must(w.placeStop('rail', w.towns[0].center));
    const bus = must(w.placeStop('road', w.towns[1].center));
    expect(w.commitLine(null, 'rail', [a.id, bus.id], false)).toMatch(/stations only/);
    w.econ.cash = 10;
    expect(w.placeStop('rail', w.towns[2].center)).toMatch(/Need/);
  });

  it('keeps vehicles consistent through line edits and deletion', () => {
    const w = new World(VALLEY, 1);
    w.econ.cash = 1e8;
    const s = [0, 4, 1].map((i) => must(w.placeStop('rail', w.towns[i].center)));
    const line = must(w.commitLine(null, 'rail', [s[0].id, s[1].id], false));
    must(w.addVehicle(line.id));
    must(w.addVehicle(line.id));
    runMonths(w, 1);
    must(w.commitLine(line.id, 'rail', [s[0].id, s[1].id, s[2].id], false));
    runMonths(w, 1);
    must(w.commitLine(line.id, 'rail', [s[1].id, s[2].id], false));
    runMonths(w, 1);
    const cashBefore = w.econ.cash;
    w.deleteLine(line.id);
    runMonths(w, 1);
    expect(w.vehicles.length).toBe(0);
    expect(w.econ.cash).toBeGreaterThan(cashBefore - 50_000); // sold at the refund rate, minus a month of upkeep
  });
});

describe('cargo', () => {
  it('runs a farm to food plant to town chain that pays and supplies the town', () => {
    const w = new World(VALLEY, 1);
    const farm = near(w, 'farm');
    const plant = near(w, 'foodplant');
    const a = must(w.placeStop('road', v(farm.pos.x + 80, farm.pos.y)));
    const b = must(w.placeStop('road', v(plant.pos.x + 80, plant.pos.y)));
    const town = w.towns[3];
    const c = must(w.placeStop('road', town.center));
    expect(a.industries).toContain(farm.id);
    expect(b.industries).toContain(plant.id);
    const l1 = must(w.commitLine(null, 'road', [a.id, b.id], false));
    const l2 = must(w.commitLine(null, 'road', [b.id, c.id], false));
    for (let k = 0; k < 3; k++) must(w.addVehicle(l1.id, 'cargo'));
    for (let k = 0; k < 2; k++) must(w.addVehicle(l2.id, 'cargo'));
    expect(w.cargoRoute(farm)).toEqual({ stop: a.id, dest: b.id });
    runMonths(w, 8);
    expect(plant.receivedLast).toBeGreaterThan(0);
    expect(town.supplyLast).toBeGreaterThan(0);
    expect(w.econ.last.freight).toBeGreaterThan(0);
    expect(l1.profitLast + l2.profitLast).toBeGreaterThan(0);
  });

  it('only buses carry passengers and only trucks carry cargo', () => {
    const w = new World(VALLEY, 1);
    const farm = near(w, 'farm');
    const plant = near(w, 'foodplant');
    const a = must(w.placeStop('road', v(farm.pos.x + 80, farm.pos.y)));
    const b = must(w.placeStop('road', v(plant.pos.x + 80, plant.pos.y)));
    const l = must(w.commitLine(null, 'road', [a.id, b.id], false));
    must(w.addVehicle(l.id, 'pax'));
    expect(w.cargoRoute(farm)).toBeNull();
    runMonths(w, 2);
    expect(plant.receivedLast).toBe(0);
  });

  it('grows a farm whose output is shipped, and shrinks one that is ignored', () => {
    const w = new World(VALLEY, 1);
    w.econ.cash = 1e8;
    const farm = near(w, 'farm');
    const idle = w.industries.find((i) => i.kind === 'farm' && i !== farm)!;
    const plant = near(w, 'foodplant');
    const a = must(w.placeStop('rail', v(farm.pos.x + 100, farm.pos.y)));
    const b = must(w.placeStop('rail', v(plant.pos.x + 100, plant.pos.y)));
    const l = must(w.commitLine(null, 'rail', [a.id, b.id], false));
    for (let k = 0; k < 2; k++) must(w.addVehicle(l.id, 'cargo'));
    runMonths(w, 12);
    expect(farm.rate).toBeGreaterThan(CONFIG.industry.start);
    expect(idle.rate).toBeLessThan(CONFIG.industry.start);
  });
});

describe('economy', () => {
  it('charges interest monthly and tracks the ledger', () => {
    const e = new Economy();
    e.borrow();
    e.borrow();
    const loan = e.loan;
    const cash = e.cash;
    e.closeMonth();
    expect(e.last.interest).toBeCloseTo((-loan * CONFIG.interestPerYear) / 12);
    expect(e.cash).toBeCloseTo(cash - (loan * CONFIG.interestPerYear) / 12);
    expect(Economy.net(e.last)).toBeCloseTo(e.last.interest);
  });

  it('trades riders for revenue per rider through ticket prices', () => {
    const e = new Economy();
    e.setPrice('rail', 9);
    expect(e.price.rail).toBe(CONFIG.price.max);
    e.setPrice('road', 0.73);
    expect(e.price.road).toBeCloseTo(0.7);
    expect(e.demand('road')).toBeGreaterThan(1);
    expect(e.demand('rail')).toBeLessThan(0.5);

    const play = (level: number) => {
      const w = new World(VALLEY, 4);
      w.econ.setPrice('rail', level);
      const a = must(w.placeStop('rail', w.towns[1].center));
      const b = must(w.placeStop('rail', w.towns[4].center));
      must(w.addVehicle(must(w.commitLine(null, 'rail', [a.id, b.id], false)).id));
      runMonths(w, 6);
      return { ticket: w.ticket('rail', 2000), spawned: w.delivered + w.lost + w.waitingTotal(a) + w.waitingTotal(b) };
    };
    const cheap = play(0.6);
    const dear = play(1.6);
    expect(dear.ticket).toBeCloseTo(cheap.ticket * (1.6 / 0.6));
    expect(dear.spawned).toBeLessThan(cheap.spawned * 0.4);
  });

  it('lets most two-town rail lines pay their way with one train, and all between bigger towns', () => {
    const losers: string[] = [];
    const small = new Set([...VALLEY.towns.keys()].sort((x, y) => VALLEY.towns[x].pop - VALLEY.towns[y].pop).slice(0, 2));
    let bigLosers = 0;
    for (let i = 0; i < VALLEY.towns.length; i++) {
      for (let j = i + 1; j < VALLEY.towns.length; j++) {
        const w = new World(VALLEY, 1);
        w.econ.cash = 1e8;
        const a = must(w.placeStop('rail', w.towns[i].center));
        const b = must(w.placeStop('rail', w.towns[j].center));
        must(w.addVehicle(must(w.commitLine(null, 'rail', [a.id, b.id], false)).id));
        runMonths(w, 6);
        const cash = w.econ.cash;
        runMonths(w, 6);
        if (w.econ.cash > cash) continue;
        losers.push(`${w.towns[i].name}-${w.towns[j].name} ${money((w.econ.cash - cash) / 6)}/mo`);
        if (!small.has(i) && !small.has(j)) bigLosers++;
      }
    }
    console.log(`one-train rail lines losing money: ${losers.join(', ') || 'none'}`);
    expect(bigLosers).toBe(0);
    expect(losers.length).toBeLessThanOrEqual(5);
  }, 120_000);

  it('goes bankrupt after three negative month-ends in a row', () => {
    const w = new World(VALLEY, 8);
    w.econ.cash = -1;
    runMonths(w, 2.5);
    expect(w.over).toBeNull();
    runMonths(w, 1);
    expect(w.over).not.toBeNull();
  });

  it('replays identically from the same seed', () => {
    const play = () => {
      const w = new World(VALLEY, 99);
      runMonths(w, 18, sensible);
      return [Math.round(w.econ.cash), Math.round(w.delivered), w.rng.state];
    };
    expect(play()).toEqual(play());
  });

  it('rewards a sensible network and punishes a reckless one', () => {
    const report: string[] = [];
    for (const seed of [1, 2, 3]) {
      const good = new World(VALLEY, seed);
      runMonths(good, 60, sensible);
      const bad = new World(VALLEY, seed);
      runMonths(bad, 60, reckless);
      report.push(
        `seed ${seed}: sensible ${money(good.companyValue())} value, ${good.lines.length} lines, ${Math.round(good.delivered)} passengers, ${Math.round(good.deliveredCargo)} cargo, pop ${good.towns.reduce((n, t) => n + t.pop, 0)}${good.over ? ' BANKRUPT' : ''} | reckless ${bad.over ? `bankrupt month ${bad.over.month}` : money(bad.econ.cash - bad.econ.loan)}`,
      );
      expect(good.over).toBeNull();
      expect(good.companyValue()).toBeGreaterThan(CONFIG.startCash * 1.3);
      expect(good.deliveredCargo).toBeGreaterThan(0);
      expect(bad.over).not.toBeNull();
    }
    console.log(report.join('\n'));
  }, 120_000);
});

describe('saving', () => {
  it('saves and loads a running game without losing anything', () => {
    const w = new World(VALLEY, 6);
    runMonths(w, 14, sensible);
    w.econ.setPrice('road', 1.3);
    const json = w.save();
    const back = must(World.load(VALLEY, json) ?? 'unreadable save');
    expect(back.save()).toBe(json);
    expect(back.econ.price.road).toBeCloseTo(1.3);
    expect(back.vehicles.every((x) => x.type.capacity > 0)).toBe(true);
    expect(back.stops.map((s) => s.residents)).toEqual(w.stops.map((s) => s.residents));
    const delivered = back.delivered;
    runMonths(back, 6, sensible);
    expect(back.over).toBeNull();
    expect(back.delivered).toBeGreaterThan(delivered);
  }, 60_000);

  it('ignores saves it cannot read', () => {
    expect(World.load(VALLEY, 'not json')).toBeNull();
    expect(World.load(VALLEY, JSON.stringify({ v: 1 }))).toBeNull();
  });
});
