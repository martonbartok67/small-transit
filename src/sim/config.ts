import type { Carries, Cargo, IndustryKind, Mode, VehicleKind, VehicleType } from './types';

/** Every balance number in one place. Tuned with the test bots; see tests/sim.test.ts. */
export const CONFIG = {
  monthSeconds: 30,
  startYear: 1950,
  startCash: 1_500_000,
  maxLoan: 3_000_000,
  loanStep: 250_000,
  interestPerYear: 0.05,
  bankruptMonths: 3,

  /** Ticket per leg at list price: base + perUnit × straight-line distance ridden. */
  fare: {
    rail: { base: 10, perUnit: 0.22 },
    road: { base: 30, perUnit: 0.14 },
  } satisfies Record<Mode, { base: number; perUnit: number }>,
  /** Freight pay per unit of cargo per leg: base + perUnit × straight-line distance. */
  freightPay: { base: 20, perUnit: 0.2 },
  /** Ticket price levels the player can set per mode (1 = list price); passenger demand scales by level^-elasticity. */
  price: { min: 0.5, max: 2, step: 0.1, elasticity: 1.5 },

  /** Trips per resident per month toward reachable destinations. */
  tripRate: 0.3,
  gravityExponent: 1.2,
  /** Waiting passengers and cargo give up at this rate (mean wait before giving up, in months). */
  patienceMonths: 2,
  walkRange: 160,
  walkSpeed: 15,

  /**
   * Monthly town growth: base + passengers × activity + cargo × supply, all scaled by
   * (1 − pop / (capFactor × starting pop)) so towns level off instead of exploding.
   */
  growth: { base: 0.001, passengers: 0.012, cargo: 0.01, capFactor: 4, tripsPerResident: 0.06, supplyPerResident: 0.03 },
  houseResidents: [1, 7] as [number, number],
  /** Houses sit on a lot grid; every streetEvery-th lot line is a street. */
  lot: 24,
  streetEvery: 7,

  stop: {
    rail: { price: 50_000, maintenance: 1_000, catchment: 260, capacity: 400, minSpacing: 150 },
    road: { price: 5_000, maintenance: 100, catchment: 160, capacity: 120, minSpacing: 80 },
  } satisfies Record<Mode, { price: number; maintenance: number; catchment: number; capacity: number; minSpacing: number }>,
  /** Industries within this distance of a stop ship and receive through it. */
  industryReach: { rail: 320, road: 240 } satisfies Record<Mode, number>,

  /** Per world unit of new track or road; hills multiply, water uses the bridge price instead. */
  way: {
    rail: { build: 120, bridge: 800, hill: 2.5, maintenance: 1.2 },
    road: { build: 25, bridge: 300, hill: 1.8, maintenance: 0.2 },
  } satisfies Record<Mode, { build: number; bridge: number; hill: number; maintenance: number }>,
  /** Cell size of the route-finding grid, in world units. */
  grid: 50,

  /** Primary output starts at `start`, grows when most of it is shipped and shrinks when little is. */
  industry: { start: 120, max: 600, grow: 0.04, shrink: 0.015, shipWell: 0.7, shipPoorly: 0.25 },

  maxVehiclesPerLine: 12,
  /** A new vehicle sells back for this share of its price, less a share per year of age. */
  sellRefund: 0.7,
  /** Older vehicles cost more to run and are worth less. */
  aging: { costPerYear: 0.03, valueLossPerYear: 0.04, minValue: 0.15 },
  /** With full load on, a vehicle waits at the first stop until full, but never longer than this. */
  fullLoadMaxMonths: 1,
};

export const INDUSTRY: Record<IndustryKind, { label: string; produces: Cargo; accepts: Cargo | null }> = {
  farm: { label: 'Farm', produces: 'grain', accepts: null },
  forest: { label: 'Forest', produces: 'logs', accepts: null },
  oilwell: { label: 'Oil well', produces: 'oil', accepts: null },
  foodplant: { label: 'Food plant', produces: 'food', accepts: 'grain' },
  sawmill: { label: 'Sawmill', produces: 'goods', accepts: 'logs' },
  refinery: { label: 'Refinery', produces: 'fuel', accepts: 'oil' },
};

/** Cargo that towns consume; delivering it helps them grow. */
export const TOWN_CARGO: readonly Cargo[] = ['food', 'goods', 'fuel'];

export const CARGO_LABEL: Record<Cargo, string> = { grain: 'Grain', logs: 'Logs', oil: 'Oil', food: 'Food', goods: 'Goods', fuel: 'Fuel' };

type ModelSpec = Omit<VehicleType, 'key' | 'mode' | 'carries' | 'accel' | 'decel' | 'dwellPerUnit' | 'minDwell'>;

const KIND: Record<VehicleKind, Pick<VehicleType, 'mode' | 'carries' | 'accel' | 'decel' | 'dwellPerUnit' | 'minDwell'>> = {
  train: { mode: 'rail', carries: 'pax', accel: 40, decel: 80, dwellPerUnit: 0.03, minDwell: 1 },
  freight: { mode: 'rail', carries: 'cargo', accel: 25, decel: 60, dwellPerUnit: 0.02, minDwell: 1.5 },
  bus: { mode: 'road', carries: 'pax', accel: 40, decel: 60, dwellPerUnit: 0.08, minDwell: 0.5 },
  truck: { mode: 'road', carries: 'cargo', accel: 35, decel: 60, dwellPerUnit: 0.1, minDwell: 0.6 },
};

/**
 * Every vehicle model, by the year it becomes available. Newer models are faster,
 * bigger and cheaper to run per seat, but cost more to buy and to run per vehicle,
 * so they pay on busy lines and lose money on quiet ones.
 */
const MODELS: Record<string, ModelSpec> = {
  steam: { name: 'Steam Express', kind: 'train', year: 1950, speed: 160, capacity: 80, price: 320_000, runningPerMonth: 14_000, carLength: 30, cars: 3, livery: '#2b2f33' },
  railcar: { name: 'Diesel Railcar', kind: 'train', year: 1962, speed: 180, capacity: 110, price: 420_000, runningPerMonth: 16_000, carLength: 30, cars: 3, livery: '#b5402f' },
  intercity: { name: 'Diesel Intercity', kind: 'train', year: 1975, speed: 210, capacity: 160, price: 600_000, runningPerMonth: 21_000, carLength: 30, cars: 4, livery: '#2c5b87' },
  electric: { name: 'Electric Express', kind: 'train', year: 1990, speed: 250, capacity: 240, price: 900_000, runningPerMonth: 27_000, carLength: 30, cars: 5, livery: '#e9ecef' },
  goods: { name: 'Steam Goods', kind: 'freight', year: 1950, speed: 120, capacity: 120, price: 280_000, runningPerMonth: 11_000, carLength: 26, cars: 4, livery: '#2b2f33' },
  dieselfreight: { name: 'Diesel Freight', kind: 'freight', year: 1965, speed: 140, capacity: 200, price: 420_000, runningPerMonth: 15_000, carLength: 26, cars: 5, livery: '#c9822b' },
  heavyfreight: { name: 'Heavy Freight', kind: 'freight', year: 1985, speed: 160, capacity: 320, price: 700_000, runningPerMonth: 22_000, carLength: 26, cars: 6, livery: '#3d6b3f' },
  bus: { name: 'City Bus', kind: 'bus', year: 1950, speed: 85, capacity: 36, price: 60_000, runningPerMonth: 1_500, carLength: 20, cars: 1, livery: '#e0ab2e' },
  coach: { name: 'Coach', kind: 'bus', year: 1966, speed: 100, capacity: 45, price: 85_000, runningPerMonth: 1_800, carLength: 22, cars: 1, livery: '#3f7fc4' },
  articulated: { name: 'Articulated Bus', kind: 'bus', year: 1984, speed: 105, capacity: 70, price: 140_000, runningPerMonth: 2_600, carLength: 30, cars: 1, livery: '#3aa36b' },
  truck: { name: 'Flatbed Truck', kind: 'truck', year: 1950, speed: 80, capacity: 25, price: 55_000, runningPerMonth: 1_000, carLength: 18, cars: 1, livery: '#b8412f' },
  boxtruck: { name: 'Box Truck', kind: 'truck', year: 1964, speed: 95, capacity: 35, price: 80_000, runningPerMonth: 1_300, carLength: 20, cars: 1, livery: '#4f6d8f' },
  semi: { name: 'Semi Truck', kind: 'truck', year: 1982, speed: 110, capacity: 55, price: 140_000, runningPerMonth: 2_000, carLength: 26, cars: 1, livery: '#8f3a6b' },
};

export const VEHICLES: Record<string, VehicleType> = Object.fromEntries(
  Object.entries(MODELS).map(([key, m]) => [key, { key, ...KIND[m.kind], ...m }]),
);

/** Models of one kind of service on one mode, oldest first. */
export const modelsFor = (mode: Mode, carries: Carries): VehicleType[] =>
  Object.values(VEHICLES)
    .filter((t) => t.mode === mode && t.carries === carries)
    .sort((a, b) => a.year - b.year);

/** Models a company can buy in `year`. */
export const availableModels = (mode: Mode, carries: Carries, year: number): VehicleType[] => modelsFor(mode, carries).filter((t) => t.year <= year);

/** The newest model of a service available in `year` (the 1950 model before then). */
export const vehicleFor = (mode: Mode, carries: Carries = 'pax', year: number = CONFIG.startYear): VehicleType => {
  const av = availableModels(mode, carries, year);
  return av.length ? av[av.length - 1] : modelsFor(mode, carries)[0];
};
