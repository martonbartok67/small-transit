import type { Cargo } from '../sim/types';

/**
 * Every colour the map uses. One sun from the top-left lights the whole valley:
 * sunlit faces are warm, shadows fall to the bottom-right and are cool.
 */
export const THEME = {
  outside: '#5c7046',
  grass: '#9fbf74',
  /** Soft light and dark patches over the grass. */
  grassLight: 'rgba(255,250,210,0.10)',
  grassDark: 'rgba(60,95,40,0.12)',
  hill: '#c2bd8a',
  /** Contour bands, from the foot of a hill to its top. */
  hillBands: ['#c9c491', '#d0ca98', '#d7d1a0'],
  hillEdge: '#a39e6b',
  forest: '#4f7a3f',
  tree: '#3f6a32',
  treeLight: '#78a656',
  field: ['#dccb87', '#b9c86e'],
  fieldRow: ['#c8b670', '#a3b55a'],
  waterDeep: '#3f86b8',
  water: '#5a9fcb',
  waterShallow: '#7dbbdc',
  waterEdge: 'rgba(235,248,255,0.55)',
  road: '#6b6a68',
  roadEdge: '#4a4945',
  roadKerb: 'rgba(255,255,255,0.10)',
  roadDash: '#f4ecd2',
  street: '#85827b',
  ballast: '#b2a691',
  ballastEdge: '#8e836f',
  sleeper: '#5d4734',
  rail: '#2a2a2a',
  railShine: 'rgba(220,226,232,0.65)',
  /** House roofs: the sunlit side, then the shaded side of each gable. */
  roofs: ['#d0704a', '#a8634a', '#74808d', '#e0b47c'],
  roofsShade: ['#9c4a2f', '#7a4532', '#535d69', '#b0864f'],
  /** Flat roofs of downtown shops and offices, and their south walls. */
  shops: ['#b4bac1', '#cbc1ae', '#97a2b0', '#c4c9ce'],
  wall: '#e3d9c6',
  wallShade: '#b9ad97',
  sidewalk: '#c5bead',
  shadow: 'rgba(22,36,30,0.30)',
  platform: '#e4dfd2',
  stationRoof: '#3b4651',
  stationRoofLight: '#56636f',
  busStop: '#2f74c0',
  busStopLight: '#5c9be0',
  ink: '#151a1e',
  label: '#ffffff',
  labelMuted: '#dbe4d3',
  bad: '#ff5b47',
  coach: '#ece3c9',
  wagon: '#6f655b',
  window: 'rgba(24,34,44,0.7)',
  headlight: 'rgba(255,238,170,0.30)',
  lines: ['#ff5a45', '#3d8bff', '#1fc27a', '#ffb020', '#a466ff', '#14c4d4', '#ff6fae', '#9bc53d'],
  /** Dark rim under every line so it reads on grass, water and roofs alike. */
  lineCasing: 'rgba(14,20,26,0.55)',
  cargo: { grain: '#f0cc4a', logs: '#9a6532', oil: '#a3aab2', food: '#ee6a5f', goods: '#6e9ce0', fuel: '#b46ee0' } satisfies Record<Cargo, string>,
  /** Industry yards and buildings. */
  industry: {
    farmYard: '#cdbd92',
    barn: '#b4472f',
    barnRoof: '#842f20',
    shed: '#a3978a',
    shedRoof: '#71675c',
    silo: '#e2ddd0',
    lumberHut: '#7d5c3a',
    lumberRoof: '#5a4129',
    concrete: '#a19e96',
    hall: '#d1cbbd',
    hallRoof: '#8f96a0',
    hall2: '#c0b9a9',
    hall2Roof: '#80868f',
    chimney: '#7b4a3a',
    oilYard: '#bfb18e',
    pump: '#3d3d3d',
    pumpBeam: '#262626',
    tank: '#e6e1d4',
    pipe: '#6d7680',
    flare: '#ffb547',
    sawYard: '#a29579',
    sawHall: '#a17b53',
    sawRoof: '#6d4f33',
    planks: '#d2ae76',
  },
};

/** Unit vector from a building toward its shadow (the sun is up and to the left). */
export const SUN = { x: 0.6, y: 0.8 };
