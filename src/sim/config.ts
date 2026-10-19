import type { Mode, VehicleType } from './types';

/** Every balance number in one place. Values are first guesses, tuned with the test bot. */
export const CONFIG = {
  monthSeconds: 30,
  startYear: 1950,
  startCash: 1_500_000,
  maxLoan: 3_000_000,
  loanStep: 250_000,
  interestPerYear: 0.05,
  bankruptMonths: 3,

  /** Ticket at list price: base + perUnit × straight-line trip distance, split between modes by distance ridden on each. */
  fare: {
    rail: { base: 10, perUnit: 0.22 },
    bus: { base: 30, perUnit: 0.14 },
  } satisfies Record<Mode, { base: number; perUnit: number }>,
  /** Ticket price levels the player can set per mode (1 = list price); demand scales by level^-elasticity. */
  price: { min: 0.5, max: 2, step: 0.1, elasticity: 1.5 },

  /** Trips per resident per month toward reachable destinations. */
  tripRate: 0.6,
  gravityExponent: 1.2,
  /** Passengers give up after waiting this many months. */
  patienceMonths: 2,
  walkRange: 160,
  walkSpeed: 15,

  growth: { base: 0.002, served: 0.03, activityPerResident: 0.05 },
  houseResidents: [1, 7] as [number, number],

  stop: {
    rail: { price: 50_000, maintenance: 1_000, catchment: 260, capacity: 400, minSpacing: 150 },
    bus: { price: 5_000, maintenance: 100, catchment: 160, capacity: 80, minSpacing: 80 },
  } satisfies Record<Mode, { price: number; maintenance: number; catchment: number; capacity: number; minSpacing: number }>,

  /** Per world unit of new track or road; hills multiply, water uses the bridge price instead. */
  way: {
    rail: { build: 120, bridge: 800, hill: 2.5, maintenance: 1.2 },
    bus: { build: 25, bridge: 300, hill: 1.8, maintenance: 0.2 },
  } satisfies Record<Mode, { build: number; bridge: number; hill: number; maintenance: number }>,

  maxVehiclesPerLine: 12,
  sellRefund: 0.7,
};

export const VEHICLES: Record<'train' | 'bus', VehicleType> = {
  train: {
    key: 'train',
    name: 'Train',
    mode: 'rail',
    speed: 160,
    accel: 40,
    decel: 80,
    capacity: 80,
    price: 320_000,
    runningPerMonth: 14_000,
    dwellPerPassenger: 0.03,
    minDwell: 1,
    carLength: 30,
    cars: 2,
  },
  bus: {
    key: 'bus',
    name: 'Bus',
    mode: 'bus',
    speed: 85,
    accel: 40,
    decel: 60,
    capacity: 36,
    price: 60_000,
    runningPerMonth: 1_500,
    dwellPerPassenger: 0.08,
    minDwell: 0.5,
    carLength: 18,
    cars: 1,
  },
};

export const vehicleFor = (mode: Mode): VehicleType => (mode === 'rail' ? VEHICLES.train : VEHICLES.bus);
