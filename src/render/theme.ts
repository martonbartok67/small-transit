import type { Cargo } from '../sim/types';

/**
 * Every colour the map uses. One sun from the top-left lights the whole valley:
 * sunlit faces are warm, shadows fall to the bottom-right and are cool.
 */
export const THEME = {
  outside: '#cdd7c1',
  grass: '#dfe7d4',
  /** Soft light and dark patches over the grass. */
  grassLight: 'rgba(255,255,255,0.16)',
  grassDark: 'rgba(120,150,100,0.06)',
  hill: '#ebe4cf',
  /** Contour bands, from the foot of a hill to its top. */
  hillBands: ['#efe9d7', '#f3eee0', '#f7f4ea'],
  hillEdge: '#d6ccb0',
  forest: '#b4cfa3',
  tree: '#93b783',
  treeLight: '#bad7aa',
  field: ['#ece3bd', '#d8e3b2'],
  fieldRow: ['#e2d6a6', '#c9d79e'],
  waterDeep: '#7fb6dc',
  water: '#93c3e3',
  waterShallow: '#a9d1ea',
  waterEdge: 'rgba(255,255,255,0.85)',
  road: '#ffffff',
  roadEdge: '#c3c9cf',
  roadKerb: '#eef0f2',
  roadDash: '#d3d8dd',
  street: '#fafaf8',
  ballast: '#cdc9c1',
  ballastEdge: '#b5b0a6',
  sleeper: '#8f877b',
  rail: '#3a3f45',
  railShine: 'rgba(255,255,255,0.7)',
  /** House roofs: the sunlit side, then the shaded side of each gable. */
  roofs: ['#e6a88e', '#d2b9a8', '#b9c3cd', '#eed6ab'],
  roofsShade: ['#cc8d73', '#b89f8e', '#9faab5', '#d6bc90'],
  /** Flat roofs of downtown shops and offices, and their south walls. */
  shops: ['#d9dde2', '#e6e0d6', '#cbd2da', '#e0e4e8'],
  wall: '#f8f6f1',
  wallShade: '#d3d0c9',
  sidewalk: '#d6dade',
  shadow: 'rgba(40,52,64,0.16)',
  platform: '#ffffff',
  stationRoof: '#111418',
  stationRoofLight: '#3b4249',
  busStop: '#0a5bd3',
  busStopLight: '#2c78e4',
  ink: '#111418',
  label: '#ffffff',
  labelMuted: '#4a525b',
  bad: '#d7263d',
  coach: '#f2efe8',
  wagon: '#7d756b',
  window: 'rgba(24,34,44,0.7)',
  headlight: 'rgba(255,226,120,0.35)',
  /** Classic metro line colours. */
  lines: ['#e2231a', '#0072ce', '#00a651', '#ffc20e', '#8e3e97', '#00a0b0', '#f47920', '#ec008c'],
  /** White rim under every line, as on a printed transit map. */
  lineCasing: 'rgba(255,255,255,0.95)',
  cargo: { grain: '#e8b923', logs: '#9a6532', oil: '#6b7480', food: '#e2231a', goods: '#0072ce', fuel: '#8e3e97' } satisfies Record<Cargo, string>,
  /** Industry yards and buildings. */
  industry: {
    farmYard: '#ece2c4',
    barn: '#b4472f',
    barnRoof: '#842f20',
    shed: '#a3978a',
    shedRoof: '#71675c',
    silo: '#f2efe8',
    lumberHut: '#7d5c3a',
    lumberRoof: '#5a4129',
    concrete: '#dcdad5',
    hall: '#e4e0d7',
    hallRoof: '#8f96a0',
    hall2: '#d8d3c8',
    hall2Roof: '#80868f',
    chimney: '#7b4a3a',
    oilYard: '#e8dfc6',
    pump: '#3d3d3d',
    pumpBeam: '#262626',
    tank: '#f4f2ec',
    pipe: '#6d7680',
    flare: '#ffb547',
    sawYard: '#ddd5c3',
    sawHall: '#a17b53',
    sawRoof: '#6d4f33',
    planks: '#d2ae76',
  },
};

/** Unit vector from a building toward its shadow (the sun is up and to the left). */
export const SUN = { x: 0.6, y: 0.8 };
