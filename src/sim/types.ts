import type { Polygon, Vec2 } from './geom';

export type Mode = 'rail' | 'bus';

export interface District {
  id: number;
  town: number;
  name: string;
  center: Vec2;
  /** Residents living in this district, refreshed when houses change. */
  pop: number;
}

export interface House {
  pos: Vec2;
  residents: number;
  town: number;
  district: number;
  /** Stop whose catchment serves this house (nearest covering stop), or -1. */
  stop: number;
}

export interface Town {
  id: number;
  name: string;
  center: Vec2;
  pop: number;
  /** Passengers starting or ending here this month and last month, for growth and the town sheet. */
  tripsMonth: number;
  tripsLast: number;
  growthLast: number;
}

export interface Passenger {
  id: number;
  dest: number; // district id
  origin: number; // stop id
  spawnedAt: number;
  /** Distance ridden per line, so fares can be split between lines. */
  rides: [line: number, dist: number][];
  boardOdo: number;
  walked: boolean;
}

export interface Stop {
  id: number;
  mode: Mode;
  pos: Vec2;
  name: string;
  waiting: Passenger[];
  /** Districts whose residents this stop reaches (any house in the catchment). */
  covers: Set<number>;
  /** Residents assigned to this stop (houses for which it is the nearest covering stop). */
  residents: number;
  /** Residents per district assigned to this stop, for demand generation. */
  byDistrict: Map<number, number>;
  spawnAcc: number;
  bornAt: number;
}

export interface Segment {
  a: number;
  b: number;
  path: Vec2[];
  length: number;
}

export interface Line {
  id: number;
  mode: Mode;
  color: number;
  name: string;
  stops: number[];
  loop: boolean;
  segs: Segment[];
  revenueMonth: number;
  costMonth: number;
  profitLast: number;
  carriedMonth: number;
  carriedLast: number;
}

export interface VehicleType {
  key: 'train' | 'bus';
  name: string;
  mode: Mode;
  speed: number;
  accel: number;
  decel: number;
  capacity: number;
  price: number;
  runningPerMonth: number;
  dwellPerPassenger: number;
  minDwell: number;
  /** Visual length per car and number of cars. */
  carLength: number;
  cars: number;
}

export interface Vehicle {
  id: number;
  type: VehicleType;
  /** Line id, or -1 when its line was deleted and it is finishing its trip. */
  line: number;
  color: number;
  fromStation: number;
  toStation: number;
  fromIdx: number;
  toIdx: number;
  dir: 1 | -1;
  orphan: boolean;
  path: Vec2[];
  pathLen: number;
  d: number;
  speed: number;
  state: 'moving' | 'dwelling';
  dwell: number;
  dockedAt: number | null;
  stopDecided: boolean;
  stopping: boolean;
  riders: Passenger[];
  odo: number;
}

export interface Ledger {
  fares: number;
  running: number;
  maintenance: number;
  interest: number;
  construction: number;
  vehicles: number;
}

export interface TownDef {
  name: string;
  center: Vec2;
  pop: number;
  districts: 1 | 2 | 3;
}

export interface MapDef {
  name: string;
  halfW: number;
  halfH: number;
  water: Polygon[];
  hills: Polygon[];
  towns: TownDef[];
}

export type SimEvent =
  | { type: 'deliver'; stop: number; fare: number; line: number }
  | { type: 'monthEnd'; month: number }
  | { type: 'warning'; text: string }
  | { type: 'bankrupt' };
