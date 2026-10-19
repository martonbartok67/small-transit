import { describe, expect, it } from 'vitest';
import { availableModels, CONFIG } from '../src/sim/config';
import { townRadius } from '../src/sim/towns';
import { loadOf } from '../src/sim/vehicles';
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

  it('builds compact towns with a downtown', () => {
    const w = new World(VALLEY, 2);
    for (const t of w.towns) {
      const mine = w.houses.filter((h) => h.town === t.id);
      const inside = mine.filter((h) => dist(h.pos, t.center) < townRadius(t.pop) * 1.2).length;
      expect(inside / mine.length).toBeGreaterThan(0.95);
      expect(mine.some((h) => h.shop)).toBe(true);
      expect(mine.filter((h) => h.shop).every((h) => dist(h.pos, t.center) < townRadius(t.pop) * 0.4)).toBe(true);
    }
  });

  it('levels off instead of growing without limit', () => {
    const w = new World(VALLEY, 3);
    runMonths(w, 20 * 12, sensible);
    expect(w.over).toBeNull();
    for (const t of w.towns) expect(t.pop).toBeLessThanOrEqual(t.basePop * CONFIG.growth.capFactor * 1.02);
    expect(w.econ.history.length).toBe(36);
    expect(w.towns.every((t) => t.history.length === 36)).toBe(true);
    expect(w.lines.every((l) => l.history.length <= 24)).toBe(true);
    expect(w.news.length).toBeGreaterThan(5);
    expect(w.news.length).toBeLessThanOrEqual(60);
    expect(w.vehicles.some((x) => x.type.year > CONFIG.startYear)).toBe(true); // the bot modernised
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

  it('runs an oil well to refinery to town chain that supplies fuel', () => {
    const w = new World(VALLEY, 1);
    w.econ.cash = 1e8;
    const well = near(w, 'oilwell');
    const refinery = near(w, 'refinery');
    const a = must(w.placeStop('rail', v(well.pos.x + 120, well.pos.y - 150)));
    const b = must(w.placeStop('rail', v(refinery.pos.x - 150, refinery.pos.y - 120)));
    const town = w.towns[5];
    const c = must(w.placeStop('road', v(refinery.pos.x + 60, refinery.pos.y - 200)));
    const d = must(w.placeStop('road', town.center));
    const rail = must(w.commitLine(null, 'rail', [a.id, b.id], false));
    must(w.addVehicle(rail.id, 'cargo'));
    const road = must(w.commitLine(null, 'road', [c.id, d.id], false));
    must(w.addVehicle(road.id, 'cargo'));
    must(w.addVehicle(road.id, 'cargo'));
    expect(dist(b.pos, c.pos)).toBeGreaterThan(CONFIG.walkRange); // the refinery ships from its own road stop
    runMonths(w, 8);
    expect(refinery.receivedLast + refinery.history.slice(-3).reduce((n, x) => n + x, 0)).toBeGreaterThan(0);
    expect(town.supplyLastBy.fuel ?? 0).toBeGreaterThan(0);
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

describe('vehicles over the years', () => {
  /** Jump the clock to the start of `year` (one month close, no simulation in between). */
  const jumpTo = (w: World, year: number) => {
    w.time = (year - CONFIG.startYear) * 12 * CONFIG.monthSeconds + 0.01;
    w.step(1 / 60);
  };

  it('unlocks newer models by year and refuses them before', () => {
    const w = new World(VALLEY, 1);
    w.econ.cash = 1e8;
    const a = must(w.placeStop('rail', w.towns[0].center));
    const b = must(w.placeStop('rail', w.towns[4].center));
    const line = must(w.commitLine(null, 'rail', [a.id, b.id], false));
    expect(w.modelsForLine(line.id, 'pax').map((m) => m.key)).toEqual(['steam']);
    expect(w.addVehicle(line.id, 'railcar')).toMatch(/available from 1962/);
    expect(w.addVehicle(line.id, 'bus')).toMatch(/cannot run/);
    jumpTo(w, 1962);
    expect(w.date().year).toBe(1962);
    expect(w.news.some((n) => n.text.includes('Diesel Railcar'))).toBe(true);
    expect(availableModels('rail', 'pax', 1962).map((m) => m.key)).toEqual(['steam', 'railcar']);
    expect(must(w.addVehicle(line.id, 'railcar')).type.name).toBe('Diesel Railcar');
    expect(must(w.addVehicle(line.id)).type.key).toBe('railcar'); // 'pax' buys the newest
  });

  it('costs more to run and sells for less as it ages, and renewal replaces it', () => {
    const w = new World(VALLEY, 1);
    w.econ.cash = 1e8;
    const a = must(w.placeStop('rail', w.towns[0].center));
    const b = must(w.placeStop('rail', w.towns[4].center));
    const line = must(w.commitLine(null, 'rail', [a.id, b.id], false));
    const v = must(w.addVehicle(line.id));
    const fresh = { run: w.runningCost(v), value: w.saleValue(v) };
    expect(fresh.value).toBeCloseTo(v.type.price * CONFIG.sellRefund);
    jumpTo(w, 1960);
    expect(w.ageYears(v)).toBeCloseTo(10, 1);
    expect(w.runningCost(v)).toBeCloseTo(fresh.run * (1 + 10 * CONFIG.aging.costPerYear), -2);
    expect(w.saleValue(v)).toBeLessThan(fresh.value * 0.5);
    jumpTo(w, 1963);
    const cash = w.econ.cash;
    const { model, cost } = w.renewal(v);
    expect(model.key).toBe('railcar');
    expect(w.renewVehicles(line.id)).toBe(1);
    expect(v.type.key).toBe('railcar');
    expect(w.ageYears(v)).toBeCloseTo(0, 2);
    expect(w.econ.cash).toBeCloseTo(cash - cost);
    expect(w.renewVehicles(line.id)).toBe(0); // nothing left to renew
  });

  it('waits for a full load at the first stop when asked', () => {
    const w = new World(VALLEY, 1);
    const farm = near(w, 'farm');
    const plant = near(w, 'foodplant');
    const a = must(w.placeStop('road', v(farm.pos.x + 80, farm.pos.y)));
    const b = must(w.placeStop('road', v(plant.pos.x + 80, plant.pos.y)));
    const l = must(w.commitLine(null, 'road', [a.id, b.id], false));
    w.setFullLoad(l.id, true);
    const t = must(w.addVehicle(l.id, 'cargo'));
    const departures: number[] = [];
    let was = t.state;
    for (let i = 0; i < 6 * CONFIG.monthSeconds * 60; i++) {
      w.step(1 / 60);
      if (was === 'dwelling' && t.state === 'moving' && t.fromIdx === 0) departures.push(loadOf(t));
      was = t.state;
    }
    expect(departures.length).toBeGreaterThan(1);
    for (const d of departures) expect(d).toBeGreaterThan(t.type.capacity - 0.6);
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

  it('upgrades a save from the previous version', () => {
    const w = new World(VALLEY, 7);
    runMonths(w, 10, sensible);
    const d = JSON.parse(w.save());
    // Reshape into the version 2 layout: no models, histories, news or oil chain.
    const old = {
      ...d,
      v: 2,
      news: undefined,
      econ: { cash: d.econ.cash, loan: d.econ.loan, month: d.econ.month, last: d.econ.last, negativeMonths: d.econ.negativeMonths, price: d.econ.price },
      towns: d.towns.map(({ supplyBy, supplyLastBy, history, ...t }: Record<string, unknown>) => t),
      industries: d.industries.slice(0, 6).map(({ history, notedRate, ...i }: Record<string, unknown>) => i),
      lines: d.lines.map(({ fullLoad, history, ...l }: Record<string, unknown>) => l),
      vehicles: d.vehicles.map(({ bornAt, held, ...x }: Record<string, unknown>) => ({ ...x, type: { steam: 'train', goods: 'freight' }[x.type as string] ?? x.type })),
      houses: d.houses.map((h: number[]) => h.slice(0, 6)),
    };
    const back = must(World.load(VALLEY, JSON.stringify(old)) ?? 'old save refused');
    expect(back.industries.length).toBe(VALLEY.industries.length);
    expect(back.vehicles.map((x) => x.type.key).sort()).toEqual(w.vehicles.map((x) => x.type.key).sort());
    expect(back.econ.cash).toBeCloseTo(w.econ.cash);
    const delivered = back.delivered;
    runMonths(back, 4, sensible);
    expect(back.over).toBeNull();
    expect(back.delivered).toBeGreaterThan(delivered);
    expect(back.lines.every((l) => Array.isArray(l.history))).toBe(true);
  }, 60_000);

  it('ignores saves it cannot read', () => {
    expect(World.load(VALLEY, 'not json')).toBeNull();
    expect(World.load(VALLEY, JSON.stringify({ v: 1, map: 'Valley' }))).toBeNull();
  });
});
