import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/sim/config';
import { Economy } from '../src/sim/economy';
import { dist } from '../src/sim/geom';
import { VALLEY } from '../src/sim/maps/valley';
import type { Passenger, Stop } from '../src/sim/types';
import { money, World } from '../src/sim/world';
import { reckless, runMonths, sensible } from './bot';

const must = <T>(r: T | string): T => {
  if (typeof r === 'string') throw new Error(r);
  return r;
};

/** Record the lines each delivered passenger rode. */
function tapDeliveries(w: World): number[][] {
  const log: number[][] = [];
  const orig = w.deliver.bind(w);
  w.deliver = (p: Passenger, at: Stop) => {
    log.push(p.rides.map(([l]) => l));
    orig(p, at);
  };
  return log;
}

describe('towns', () => {
  it('generates the map deterministically', () => {
    const a = new World(VALLEY, 5);
    const b = new World(VALLEY, 5);
    expect(a.houses.length).toBe(b.houses.length);
    expect(a.towns.map((t) => t.pop)).toEqual(b.towns.map((t) => t.pop));
    for (const t of a.towns) expect(t.pop).toBeGreaterThan(VALLEY.towns[t.id].pop * 0.95);
  });
});

describe('network', () => {
  it('carries rail passengers between towns and earns fares', () => {
    const w = new World(VALLEY, 2);
    const a = must(w.placeStop('rail', w.towns[0].center));
    const b = must(w.placeStop('rail', w.towns[4].center));
    const line = must(w.commitLine(null, 'rail', [a.id, b.id], false));
    must(w.addVehicle(line.id));
    runMonths(w, 3);
    expect(w.delivered).toBeGreaterThan(20);
    expect(w.econ.last.fares).toBeGreaterThan(0);
    expect(line.carriedLast).toBeGreaterThan(0);
  });

  it('carries bus passengers between districts of one town', () => {
    const w = new World(VALLEY, 3);
    const elm = w.districts.filter((d) => d.town === 4);
    const stops = elm.map((d) => must(w.placeStop('bus', d.center)));
    const line = must(w.commitLine(null, 'bus', stops.map((s) => s.id), true));
    must(w.addVehicle(line.id));
    runMonths(w, 2);
    expect(w.delivered).toBeGreaterThan(10);
  });

  it('lets passengers walk from a bus stop to a nearby station and ride on', () => {
    const w = new World(VALLEY, 4);
    const log = tapDeliveries(w);
    const ash = w.towns[0];
    const north = w.districts.find((d) => d.town === 0 && d.name.endsWith('North'))!;
    const sa = must(w.placeStop('rail', ash.center));
    const se = must(w.placeStop('rail', w.towns[4].center));
    const rail = must(w.commitLine(null, 'rail', [sa.id, se.id], false));
    w.econ.cash = 10_000_000;
    for (let k = 0; k < 3; k++) must(w.addVehicle(rail.id));
    const feeder = must(w.placeStop('bus', { x: sa.pos.x + 110, y: sa.pos.y }));
    const far = must(w.placeStop('bus', north.center));
    expect(dist(feeder.pos, sa.pos)).toBeLessThan(CONFIG.walkRange);
    const bus = must(w.commitLine(null, 'bus', [far.id, feeder.id], false));
    must(w.addVehicle(bus.id));
    runMonths(w, 4);
    expect(log.some((rides) => rides.includes(bus.id) && rides.includes(rail.id))).toBe(true);
  });

  it('refuses work it cannot pay for, and lines of the wrong mode', () => {
    const w = new World(VALLEY, 6);
    const a = must(w.placeStop('rail', w.towns[0].center));
    const bus = must(w.placeStop('bus', w.towns[4].center));
    expect(w.commitLine(null, 'rail', [a.id, bus.id], false)).toMatch(/stations only/);
    w.econ.cash = 1000;
    expect(w.placeStop('rail', w.towns[2].center)).toMatch(/Need/);
  });

  it('keeps vehicles consistent through line edits and deletion', () => {
    const w = new World(VALLEY, 7);
    const ids = [0, 4, 5].map((t) => must(w.placeStop('rail', w.towns[t].center)).id);
    w.econ.cash = 10_000_000;
    const line = must(w.commitLine(null, 'rail', ids, false));
    for (let k = 0; k < 3; k++) must(w.addVehicle(line.id));
    runMonths(w, 1);
    must(w.commitLine(line.id, 'rail', [ids[0], ids[2]], false));
    runMonths(w, 1);
    const cashBefore = w.econ.cash;
    w.deleteLine(line.id);
    runMonths(w, 1);
    expect(w.vehicles.length).toBe(0);
    expect(w.econ.cash).toBeGreaterThan(cashBefore); // sold at the refund rate
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
    e.setPrice('bus', 0.73);
    expect(e.price.bus).toBeCloseTo(0.7);
    expect(e.demand('bus')).toBeGreaterThan(1);
    expect(e.demand('rail')).toBeLessThan(0.5);

    const play = (level: number) => {
      const w = new World(VALLEY, 4);
      w.econ.setPrice('rail', level);
      const a = must(w.placeStop('rail', w.towns[1].center));
      const b = must(w.placeStop('rail', w.towns[4].center));
      const line = must(w.commitLine(null, 'rail', [a.id, b.id], false));
      must(w.addVehicle(line.id));
      runMonths(w, 6);
      return { ticket: w.ticket('rail', 2000), spawned: w.delivered + w.lost + a.waiting.length + b.waiting.length };
    };
    const cheap = play(0.6);
    const dear = play(1.6);
    expect(dear.ticket).toBeCloseTo(cheap.ticket * (1.6 / 0.6));
    expect(dear.spawned).toBeLessThan(cheap.spawned * 0.4);
  });

  it('lets every two-town rail line pay its way with one train', () => {
    const losers: string[] = [];
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
        if (w.econ.cash <= cash) losers.push(`${w.towns[i].name}-${w.towns[j].name}`);
      }
    }
    expect(losers).toEqual([]);
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
      return [Math.round(w.econ.cash), w.delivered, w.rng.state];
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
        `seed ${seed}: sensible ${money(good.companyValue())} value, ${good.lines.length} lines, ${good.delivered} delivered, pop ${good.towns.reduce((n, t) => n + t.pop, 0)}${good.over ? ' BANKRUPT' : ''} | reckless ${bad.over ? `bankrupt month ${bad.over.month}` : money(bad.econ.cash - bad.econ.loan)}`,
      );
      expect(good.over).toBeNull();
      expect(good.companyValue()).toBeGreaterThan(CONFIG.startCash * 1.3);
      expect(bad.over).not.toBeNull();
    }
    console.log(report.join('\n'));
  }, 120_000);
});

describe('saving', () => {
  it('saves and loads a running game without losing anything', () => {
    const w = new World(VALLEY, 6);
    runMonths(w, 8, sensible);
    w.econ.setPrice('bus', 1.3);
    const json = w.save();
    const back = must(World.load(VALLEY, json) ?? 'unreadable save');
    expect(back.save()).toBe(json);
    expect(back.econ.price.bus).toBeCloseTo(1.3);
    expect(back.vehicles.every((v) => v.type.capacity > 0)).toBe(true);
    const delivered = back.delivered;
    runMonths(back, 6, sensible);
    expect(back.over).toBeNull();
    expect(back.delivered).toBeGreaterThan(delivered);
    expect(Number.isFinite(back.econ.cash)).toBe(true);
  }, 60_000);

  it('ignores saves it cannot read', () => {
    expect(World.load(VALLEY, 'not json')).toBeNull();
    expect(World.load(VALLEY, JSON.stringify({ v: -1 }))).toBeNull();
  });
});
