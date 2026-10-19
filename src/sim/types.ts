import type { Polygon, Vec2 } from './geom';

export type Mode = 'rail' | 'road';
export type Cargo = 'grain' | 'logs' | 'oil' | 'food' | 'goods' | 'fuel';
/** What a group of travellers is: passengers or one kind of cargo. */
export type Freight = 'pax' | Cargo;
/** What a vehicle carries; passengers and cargo route on separate graphs. */
export type Carries = 'pax' | 'cargo';
export type IndustryKind = 'farm' | 'forest' | 'oilwell' | 'foodplant' | 'sawmill' | 'refinery';

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
  /** Roof colour index, for drawing. */
  roof: number;
  /** Downtown shop or office block rather than a house (drawn differently). */
  shop: boolean;
}

export interface Town {
  id: number;
  name: string;
  center: Vec2;
  pop: number;
  /** Starting population; growth slows as the town approaches CONFIG.growth.capFactor times this. */
  basePop: number;
  /** Passengers boarding or arriving in this town, this month and last. */
  tripsMonth: number;
  tripsLast: number;
  /** Food, goods and fuel delivered to the town, this month and last, in total and by cargo. */
  supplyMonth: number;
  supplyLast: number;
  supplyBy: Partial<Record<Cargo, number>>;
  supplyLastBy: Partial<Record<Cargo, number>>;
  growthLast: number;
  /** Population at each month end, oldest first (last 36 months). */
  history: number[];
}

export interface Industry {
  id: number;
  kind: IndustryKind;
  name: string;
  pos: Vec2;
  produces: Cargo;
  accepts: Cargo | null;
  /** Primary industries: output per month. Secondary industries turn last month's input into output. */
  rate: number;
  producedMonth: number;
  producedLast: number;
  /** Cargo picked up by vehicles at a stop serving this industry. */
  shippedMonth: number;
  shippedLast: number;
  receivedMonth: number;
  receivedLast: number;
  /** Output at each month end, oldest first (last 36 months). */
  history: number[];
  /** Output level last announced in the news. */
  notedRate: number;
}

/** Travellers waiting at a stop, keyed `${freight}|${destStopId}`; counts are fractional. */
export type Waiting = Record<string, number>;

export interface Stop {
  id: number;
  mode: Mode;
  pos: Vec2;
  name: string;
  waiting: Waiting;
  /** Districts whose residents this stop reaches (any house in the catchment). */
  covers: Set<number>;
  /** Residents assigned to this stop (houses for which it is the nearest covering stop). */
  residents: number;
  /** Town this stop sits in, or -1 in the countryside. */
  town: number;
  /** Industries close enough to ship or receive through this stop. */
  industries: number[];
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
  /** When a vehicle of each kind last left the first stop, for spacing them out. */
  departed: Record<Carries, number>;
  /** Vehicles wait at the first stop until full (up to CONFIG.fullLoadMaxMonths). */
  fullLoad: boolean;
  /** Profit at each month end, oldest first (last 24 months). */
  history: number[];
}

/** The four kinds of vehicle; each has several models over the years. */
export type VehicleKind = 'train' | 'freight' | 'bus' | 'truck';

export interface VehicleType {
  /** Model id, e.g. 'steam'. */
  key: string;
  name: string;
  kind: VehicleKind;
  /** First year the model can be bought. */
  year: number;
  /** Main body colour. */
  livery: string;
  mode: Mode;
  carries: Carries;
  speed: number;
  accel: number;
  decel: number;
  capacity: number;
  price: number;
  runningPerMonth: number;
  /** Seconds per passenger or unit of cargo moved at a stop. */
  dwellPerUnit: number;
  minDwell: number;
  /** Visual length per car and number of cars. */
  carLength: number;
  cars: number;
}

/** Travellers aboard a vehicle who boarded at `from` and leave at `alight`. */
export interface Group {
  what: Freight;
  dest: number;
  alight: number;
  from: number;
  n: number;
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
  load: Group[];
  odo: number;
  /** Sim time when bought or last renewed, for aging. */
  bornAt: number;
  /** Seconds spent waiting for a full load at the first stop. */
  held: number;
}

export interface Ledger {
  fares: number;
  freight: number;
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

export interface IndustryDef {
  kind: IndustryKind;
  name: string;
  pos: Vec2;
}

export interface MapDef {
  name: string;
  halfW: number;
  halfH: number;
  water: Polygon[];
  hills: Polygon[];
  forests: Polygon[];
  /** Country roads that already exist; road vehicles use them for free. */
  roads: Vec2[][];
  towns: TownDef[];
  industries: IndustryDef[];
}

export interface News {
  month: number;
  text: string;
  /** Good news, bad news, or neutral information. */
  tone: 'good' | 'bad' | 'info';
}

export type SimEvent =
  | { type: 'deliver'; stop: number; amount: number; line: number }
  | { type: 'monthEnd'; month: number }
  | { type: 'warning'; text: string }
  | { type: 'news'; news: News }
  | { type: 'bankrupt' };
