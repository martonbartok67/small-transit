import type { Cargo, IndustryKind, Mode, VehicleKey, VehicleType } from './types';

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
  sellRefund: 0.7,
};

export const INDUSTRY: Record<IndustryKind, { label: string; produces: Cargo; accepts: Cargo | null }> = {
  farm: { label: 'Farm', produces: 'grain', accepts: null },
  forest: { label: 'Forest', produces: 'logs', accepts: null },
  foodplant: { label: 'Food plant', produces: 'food', accepts: 'grain' },
  sawmill: { label: 'Sawmill', produces: 'goods', accepts: 'logs' },
};

/** Cargo that towns consume; delivering it helps them grow. */
export const TOWN_CARGO: readonly Cargo[] = ['food', 'goods'];

export const CARGO_LABEL: Record<Cargo, string> = { grain: 'Grain', logs: 'Logs', food: 'Food', goods: 'Goods' };

export const VEHICLES: Record<VehicleKey, VehicleType> = {
  train: {
    key: 'train',
    name: 'Train',
    mode: 'rail',
    carries: 'pax',
    speed: 160,
    accel: 40,
    decel: 80,
    capacity: 80,
    price: 320_000,
    runningPerMonth: 14_000,
    dwellPerUnit: 0.03,
    minDwell: 1,
    carLength: 30,
    cars: 3,
  },
  freight: {
    key: 'freight',
    name: 'Freight train',
    mode: 'rail',
    carries: 'cargo',
    speed: 120,
    accel: 25,
    decel: 60,
    capacity: 120,
    price: 280_000,
    runningPerMonth: 11_000,
    dwellPerUnit: 0.02,
    minDwell: 1.5,
    carLength: 26,
    cars: 4,
  },
  bus: {
    key: 'bus',
    name: 'Bus',
    mode: 'road',
    carries: 'pax',
    speed: 85,
    accel: 40,
    decel: 60,
    capacity: 36,
    price: 60_000,
    runningPerMonth: 1_500,
    dwellPerUnit: 0.08,
    minDwell: 0.5,
    carLength: 20,
    cars: 1,
  },
  truck: {
    key: 'truck',
    name: 'Truck',
    mode: 'road',
    carries: 'cargo',
    speed: 80,
    accel: 35,
    decel: 60,
    capacity: 25,
    price: 55_000,
    runningPerMonth: 1_000,
    dwellPerUnit: 0.1,
    minDwell: 0.6,
    carLength: 18,
    cars: 1,
  },
};

/** The vehicle a mode uses for passengers or cargo. */
export const vehicleFor = (mode: Mode, carries: 'pax' | 'cargo' = 'pax'): VehicleType =>
  mode === 'rail' ? (carries === 'pax' ? VEHICLES.train : VEHICLES.freight) : carries === 'pax' ? VEHICLES.bus : VEHICLES.truck;
