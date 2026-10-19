import { CARGO_LABEL, CONFIG } from '../sim/config';
import { dist, distToSegment, pointInPolygon, v, type Polygon, type Vec2 } from '../sim/geom';
import { townRadius } from '../sim/towns';
import type { Cargo, House, Industry, Stop, Vehicle } from '../sim/types';
import { loadOf, vehiclePose } from '../sim/vehicles';
import { LINE_SPACING, money, type World } from '../sim/world';
import type { Camera } from '../ui/camera';
import { lineHandles, type Editor } from '../ui/editor';

export const THEME = {
  outside: '#748a58',
  grass: '#a2b977',
  hill: '#b8b687',
  hillEdge: '#9f9d6f',
  forest: '#62884a',
  tree: '#4b6f36',
  treeLight: '#6f9a52',
  field: ['#d3c383', '#b7c36c'],
  fieldRow: ['#bfae6c', '#a2af58'],
  water: '#5f97c0',
  waterEdge: '#8fbbd8',
  road: '#76726b',
  roadEdge: '#58554f',
  roadDash: '#ece6d3',
  street: '#8c887f',
  ballast: '#a79d8c',
  sleeper: '#66513f',
  rail: '#34322f',
  /** House roofs: the sunlit side, then the shaded side of each gable. */
  roofs: ['#c46a46', '#9a6249', '#7a828d', '#d0a676'],
  roofsShade: ['#97492d', '#734431', '#5a616b', '#a8804f'],
  /** Flat roofs of downtown shops and offices. */
  shops: ['#a7adb4', '#c2b8a6', '#8d97a4', '#b9bec4'],
  sidewalk: '#bdb6a8',
  shadow: 'rgba(25,35,15,0.24)',
  platform: '#dcd6c8',
  stationRoof: '#44505b',
  busStop: '#2d6cae',
  ink: '#1c2125',
  label: '#ffffff',
  bad: '#e2553f',
  loco: '#2c5b87',
  coach: '#e6dcc0',
  wagon: '#6f655b',
  bus: '#e0ab2e',
  truck: '#b8412f',
  lines: ['#e8503a', '#3b7ddd', '#2fae64', '#f0a828', '#9b5ac6', '#14a8b8', '#ec6fa6', '#8a9a2a'],
  cargo: { grain: '#e5c24a', logs: '#8b5a2b', oil: '#9aa1a8', food: '#d65f5f', goods: '#6a90cc', fuel: '#a463c9' } satisfies Record<Cargo, string>,
};

/** What the map emphasises: line colours, nothing, house coverage, or cargo flows. */
export type Layer = 'lines' | 'plain' | 'coverage' | 'cargo';

const LOUPE_R = 64;
const LOUPE_ZOOM = 1.8;
/** Below this zoom the town roofs come from a cached bitmap instead of being drawn one by one. */
const ROOF_CACHE_ZOOM = 0.2;
const ROOF_CACHE_SCALE = 0.25;

interface Patterns {
  grass: CanvasPattern;
  forest: CanvasPattern;
  hill: CanvasPattern;
  field: CanvasPattern[];
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private pat: Patterns;
  private roofCache: { canvas: HTMLCanvasElement; key: string } | null = null;
  private fields = new Map<number, { poly: Polygon; kind: number }[]>();
  private stopAngles = { version: -1, map: new Map<number, number>() };
  private streets: { key: string; segs: number[] } = { key: '', segs: [] };
  private trees: { map: unknown; pts: { x: number; y: number; r: number }[] } = { map: null, pts: [] };
  /** Screen px reserved for the HUD above and below the map. */
  insets = { top: 64, bottom: 92 };
  layer: Layer = 'lines';

  constructor(
    private canvas: HTMLCanvasElement,
    private cam: Camera,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.pat = makePatterns(this.ctx);
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  draw(world: World, editor: Editor, now: number): void {
    // iOS home-screen apps settle their viewport late without a reliable resize event.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.clientWidth !== this.w || this.canvas.clientHeight !== this.h || dpr !== this.dpr) this.resize();
    this.cam.setViewport(0, this.insets.top, this.w, this.h - this.insets.top - this.insets.bottom);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = THEME.outside;
    ctx.fillRect(0, 0, this.w, this.h);
    this.applyCamera(this.cam.zoom, this.cam.x, this.cam.y, this.cam.cx, this.cam.cy);
    this.drawScene(world, editor, now, this.cam.zoom);
    if (editor.editing && editor.touch) this.drawLoupe(world, editor, now);
  }

  private applyCamera(z: number, x: number, y: number, cx: number, cy: number): void {
    this.ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (cx - x * z), this.dpr * (cy - y * z));
  }

  private drawScene(world: World, editor: Editor, now: number, z: number): void {
    const px = (n: number) => n / z;
    this.drawGround(world, px);
    if (z > 0.1) this.drawTrees(world);
    this.drawStreets(world, px, z);
    this.drawRoads(world, px, z);
    this.drawTrack(world, px, z);
    this.drawBuildings(world, z);
    for (const ind of world.industries) this.drawIndustry(ind, px, z);
    if (this.layer === 'coverage') this.drawCoverage(world, px);
    if (this.layer === 'cargo') this.drawCargoFlows(world, px, now);
    if (editor.tool === 'rail' || editor.tool === 'road' || this.layer === 'cargo') this.drawReach(world, editor.tool === 'road' ? 'road' : 'rail', px);
    const pv = editor.preview();
    this.drawLines(world, editor, px, pv?.lineId ?? null);
    if (pv) this.drawPreview(world, editor, px);
    for (const s of world.stops) this.drawStop(world, s, px, now);
    for (const t of world.vehicles) this.drawVehicle(t, px, z);
    this.drawLabels(world, px, z);
  }

  private polygon(poly: Vec2[]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }

  private trace(path: Vec2[]): void {
    const ctx = this.ctx;
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  }

  private visible(p: Vec2, pad: number): boolean {
    const c = this.cam;
    const hw = c.viewport.w / 2 / c.zoom + pad;
    const hh = c.viewport.h / 2 / c.zoom + pad;
    return Math.abs(p.x - c.x) < hw && Math.abs(p.y - c.y) < hh;
  }

  // ---------- landscape ----------

  private drawGround(world: World, px: (n: number) => number): void {
    const ctx = this.ctx;
    const m = world.map;
    ctx.fillStyle = this.pat.grass;
    ctx.fillRect(-m.halfW, -m.halfH, m.halfW * 2, m.halfH * 2);
    for (const f of this.farmFields(world)) {
      ctx.fillStyle = this.pat.field[f.kind];
      this.polygon(f.poly);
      ctx.fill();
    }
    ctx.fillStyle = this.pat.hill;
    ctx.strokeStyle = THEME.hillEdge;
    ctx.lineWidth = px(1.5);
    ctx.lineJoin = 'round';
    for (const h of m.hills) {
      this.polygon(h);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = this.pat.forest;
    for (const f of m.forests) {
      this.polygon(f);
      ctx.fill();
    }
    ctx.fillStyle = THEME.water;
    ctx.strokeStyle = THEME.waterEdge;
    ctx.lineWidth = Math.max(px(2), 8);
    for (const w of m.water) {
      this.polygon(w);
      ctx.stroke();
      ctx.fill();
    }
  }

  /** A patchwork of fields around each farm, laid out once. */
  private farmFields(world: World): { poly: Polygon; kind: number }[] {
    const all: { poly: Polygon; kind: number }[] = [];
    for (const ind of world.industries) {
      if (ind.kind !== 'farm') continue;
      let f = this.fields.get(ind.id);
      if (!f) {
        f = [];
        const a = ((ind.id * 37) % 40) * (Math.PI / 180) - 0.35;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const W = 170;
        const H = 120;
        for (let gx = -2; gx <= 1; gx++) {
          for (let gy = -2; gy <= 1; gy++) {
            if ((gx === -1 || gx === 0) && (gy === -1 || gy === 0)) continue; // farmyard
            const x0 = gx * (W + 12) + 6;
            const y0 = gy * (H + 12) + 6;
            const corners = [v(x0, y0), v(x0 + W, y0), v(x0 + W, y0 + H), v(x0, y0 + H)];
            const poly = corners.map((c) => v(ind.pos.x + c.x * ca - c.y * sa, ind.pos.y + c.x * sa + c.y * ca));
            f.push({ poly, kind: (gx + gy + 4) % 2 });
          }
        }
        this.fields.set(ind.id, f);
      }
      all.push(...f);
    }
    return all;
  }

  /** Streets run round every block that has a building on it. */
  private drawStreets(world: World, px: (n: number) => number, z: number): void {
    const S = CONFIG.lot * CONFIG.streetEvery;
    const key = `${world.catchVersion}:${world.houses.length}:${world.seed}`;
    if (this.streets.key !== key) {
      const blocks = new Set<string>();
      for (const h of world.houses) blocks.add(`${Math.floor(h.pos.x / S)},${Math.floor(h.pos.y / S)}`);
      const edges = new Set<string>();
      for (const b of blocks) {
        const [bx, by] = b.split(',').map(Number);
        edges.add(`h${bx},${by}`).add(`h${bx},${by + 1}`).add(`v${bx},${by}`).add(`v${bx + 1},${by}`);
      }
      const segs: number[] = [];
      for (const e of edges) {
        const [x, y] = e.slice(1).split(',').map(Number);
        if (e[0] === 'h') segs.push(x * S, y * S, (x + 1) * S, y * S);
        else segs.push(x * S, y * S, x * S, (y + 1) * S);
      }
      this.streets = { key, segs };
    }
    const ctx = this.ctx;
    const segs = this.streets.segs;
    const trace = () => {
      ctx.beginPath();
      for (let i = 0; i < segs.length; i += 4) {
        if (!this.visible(v((segs[i] + segs[i + 2]) / 2, (segs[i + 1] + segs[i + 3]) / 2), S)) continue;
        ctx.moveTo(segs[i], segs[i + 1]);
        ctx.lineTo(segs[i + 2], segs[i + 3]);
      }
    };
    ctx.lineCap = 'square';
    if (z < 0.25) {
      ctx.strokeStyle = THEME.street;
      ctx.lineWidth = Math.max(12, px(1.2));
      trace();
      ctx.stroke();
      return;
    }
    trace();
    ctx.strokeStyle = THEME.sidewalk;
    ctx.lineWidth = 19;
    ctx.stroke();
    ctx.strokeStyle = THEME.street;
    ctx.lineWidth = 11;
    ctx.stroke();
  }

  /** Scattered trees in the countryside, laid out once per map. */
  private drawTrees(world: World): void {
    if (this.trees.map !== world.map) this.trees = { map: world.map, pts: scatterTrees(world) };
    const ctx = this.ctx;
    const pts = this.trees.pts;
    for (const [color, k, dx] of [
      [THEME.shadow, 1, 4],
      [THEME.tree, 1, 0],
      [THEME.treeLight, 0.45, -0.3],
    ] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const t of pts) {
        if (!this.visible(t, 40)) continue;
        const r = t.r * k;
        const ox = dx > 1 ? dx : dx * t.r;
        ctx.moveTo(t.x + ox + r, t.y + ox);
        ctx.arc(t.x + ox, t.y + ox, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  private drawRoads(world: World, px: (n: number) => number, z: number): void {
    const ctx = this.ctx;
    const paths = [...world.map.roads, ...world.wayList().filter((w) => w.mode === 'road').map((w) => w.path)];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const width = Math.max(20, px(3));
    for (const [color, wd] of [
      [THEME.roadEdge, width + Math.max(4, px(1))],
      [THEME.road, width],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = wd;
      ctx.beginPath();
      for (const p of paths) this.trace(p);
      ctx.stroke();
    }
    if (z > 0.35) {
      ctx.strokeStyle = THEME.roadDash;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([14, 14]);
      ctx.beginPath();
      for (const p of paths) this.trace(p);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawTrack(world: World, px: (n: number) => number, z: number): void {
    const ctx = this.ctx;
    const ways = world.wayList().filter((w) => w.mode === 'rail');
    if (!ways.length) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const w of ways) {
      ctx.strokeStyle = THEME.ballast;
      ctx.lineWidth = Math.max(w.lanes * LINE_SPACING.rail + 8, px(4));
      ctx.beginPath();
      this.trace(w.path);
      ctx.stroke();
    }
    for (const w of ways) {
      for (let k = 0; k < w.lanes; k++) {
        const off = (k - (w.lanes - 1) / 2) * LINE_SPACING.rail;
        const path = off ? offsetPath(w.path, off) : w.path;
        if (z > 0.35) {
          ctx.strokeStyle = THEME.sleeper;
          ctx.lineWidth = 8;
          ctx.lineCap = 'butt';
          ctx.setLineDash([2.2, 4.5]);
          ctx.beginPath();
          this.trace(path);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = THEME.rail;
          ctx.lineWidth = 1.1;
          for (const side of [-2.4, 2.4]) {
            ctx.beginPath();
            this.trace(offsetPath(path, side));
            ctx.stroke();
          }
          ctx.lineCap = 'round';
        } else {
          ctx.strokeStyle = THEME.rail;
          ctx.lineWidth = Math.max(3, px(1.4));
          ctx.beginPath();
          this.trace(path);
          ctx.stroke();
        }
      }
    }
  }

  /** Houses with gabled roofs (sunlit and shaded halves), downtown blocks with flat roofs, and their shadows. */
  private drawBuildings(world: World, z: number): void {
    if (z < ROOF_CACHE_ZOOM) return this.drawBuildingCache(world);
    const vis = world.houses.filter((h) => this.visible(h.pos, 40));
    paintBuildings(this.ctx, vis, z);
  }

  /** Zoomed out, all buildings come from one bitmap that is redrawn only when houses change. */
  private drawBuildingCache(world: World): void {
    const m = world.map;
    const key = `${world.catchVersion}:${world.houses.length}:${world.seed}`;
    if (this.roofCache?.key !== key) {
      const canvas = this.roofCache?.canvas ?? document.createElement('canvas');
      canvas.width = Math.ceil(m.halfW * 2 * ROOF_CACHE_SCALE);
      canvas.height = Math.ceil(m.halfH * 2 * ROOF_CACHE_SCALE);
      const c = canvas.getContext('2d')!;
      c.setTransform(ROOF_CACHE_SCALE, 0, 0, ROOF_CACHE_SCALE, m.halfW * ROOF_CACHE_SCALE, m.halfH * ROOF_CACHE_SCALE);
      paintBuildings(c, world.houses, ROOF_CACHE_SCALE);
      this.roofCache = { canvas, key };
    }
    this.ctx.drawImage(this.roofCache.canvas, -m.halfW, -m.halfH, m.halfW * 2, m.halfH * 2);
  }

  // ---------- industry ----------

  private drawIndustry(ind: Industry, px: (n: number) => number, z: number): void {
    if (!this.visible(ind.pos, 300)) return;
    const ctx = this.ctx;
    const { x, y } = ind.pos;
    if (z < 0.14) {
      // A marker that stays readable when the whole map is on screen.
      const r = px(7);
      ctx.fillStyle = THEME.cargo[ind.produces];
      ctx.strokeStyle = THEME.ink;
      ctx.lineWidth = px(2);
      ctx.beginPath();
      ctx.rect(x - r, y - r, r * 2, r * 2);
      ctx.fill();
      ctx.stroke();
      return;
    }
    const box = (bx: number, by: number, w: number, h: number, fill: string, roof?: string) => {
      ctx.fillStyle = fill;
      ctx.fillRect(x + bx, y + by, w, h);
      if (roof) {
        ctx.fillStyle = roof;
        ctx.fillRect(x + bx, y + by, w, h * 0.45);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + bx, y + by, w, h);
    };
    const silo = (cx: number, cy: number, r: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x + cx, y + cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    const logs = (lx: number, ly: number) => {
      for (let i = 0; i < 4; i++) box(lx, ly + i * 7, 34, 5, THEME.cargo.logs);
    };
    switch (ind.kind) {
      case 'farm':
        ctx.fillStyle = '#c9b88d';
        ctx.fillRect(x - 150, y - 110, 300, 220);
        box(-60, -40, 70, 50, '#a8432f', '#7d2f22');
        box(25, -30, 40, 30, '#9b8f7d', '#6f655a');
        silo(-80, 30, 16, '#d8d2c4');
        silo(-45, 35, 12, '#d8d2c4');
        break;
      case 'forest':
        box(-30, -20, 50, 34, '#7a5b3a', '#5a4129');
        logs(30, -26);
        logs(-70, 20);
        break;
      case 'foodplant':
        ctx.fillStyle = '#9a978e';
        ctx.fillRect(x - 120, y - 80, 240, 170);
        box(-100, -60, 120, 80, '#c9c3b5', '#8d939b');
        box(30, -55, 70, 50, '#b9b2a2', '#7e848c');
        silo(-70, 50, 18, '#e3ded2');
        silo(-30, 50, 18, '#e3ded2');
        box(60, 20, 14, 40, '#7b4a3a');
        break;
      case 'oilwell': {
        ctx.fillStyle = '#b9ab88';
        ctx.fillRect(x - 120, y - 80, 240, 170);
        for (const [jx, jy] of [[-70, -30], [10, -45], [-30, 30]]) {
          // Pumpjack: a base, a beam and a horse head.
          box(jx - 14, jy + 6, 28, 8, '#4a4a4a');
          ctx.strokeStyle = '#2b2b2b';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(x + jx - 16, y + jy - 6);
          ctx.lineTo(x + jx + 16, y + jy + 2);
          ctx.stroke();
          silo(jx + 18, jy + 3, 4, '#2b2b2b');
        }
        silo(65, 20, 22, '#d8d2c4');
        silo(65, -30, 16, '#d8d2c4');
        break;
      }
      case 'refinery':
        ctx.fillStyle = '#9d9a92';
        ctx.fillRect(x - 140, y - 90, 280, 190);
        for (const [tx, ty, tr] of [[-100, -55, 22], [-50, -55, 22], [-100, 0, 22], [-50, 0, 22]]) silo(tx, ty, tr, '#e2ddd0');
        box(10, -70, 18, 90, '#6d7680');
        box(40, -60, 14, 80, '#6d7680');
        box(70, -40, 50, 60, '#c9c3b5', '#8d939b');
        box(-120, 45, 110, 30, '#b9b2a2', '#7e848c');
        ctx.fillStyle = '#f2a43a';
        ctx.beginPath();
        ctx.arc(x + 100, y - 70, 7, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'sawmill':
        ctx.fillStyle = '#9b8e74';
        ctx.fillRect(x - 130, y - 70, 260, 150);
        box(-110, -45, 150, 50, '#9b7650', '#6d4f33');
        logs(55, -45);
        logs(55, 10);
        box(-100, 25, 60, 30, '#c8a46e');
        break;
    }
  }

  /** While placing a stop: catchments of existing stops and the reach of each industry. */
  private drawReach(world: World, mode: 'rail' | 'road', px: (n: number) => number): void {
    const ctx = this.ctx;
    ctx.lineWidth = px(1.5);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    for (const s of world.stops) {
      if (s.mode !== mode) continue;
      ctx.beginPath();
      ctx.arc(s.pos.x, s.pos.y, CONFIG.stop[mode].catchment, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.setLineDash([px(6), px(6)]);
    for (const ind of world.industries) {
      ctx.strokeStyle = THEME.cargo[ind.produces];
      ctx.lineWidth = px(2.5);
      ctx.beginPath();
      ctx.arc(ind.pos.x, ind.pos.y, CONFIG.industryReach[mode], 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /** Coverage layer: every house green if a stop reaches it, red if not, with stop catchments. */
  private drawCoverage(world: World, px: (n: number) => number): void {
    const ctx = this.ctx;
    const m = world.map;
    ctx.fillStyle = 'rgba(14,19,23,0.55)';
    ctx.fillRect(-m.halfW, -m.halfH, m.halfW * 2, m.halfH * 2);
    const s = Math.max(10, px(2));
    for (const served of [false, true]) {
      ctx.fillStyle = served ? '#6fdc8c' : '#ff7a63';
      ctx.beginPath();
      for (const h of world.houses) {
        if (h.stop >= 0 !== served || !this.visible(h.pos, 20)) continue;
        ctx.rect(h.pos.x - s / 2, h.pos.y - s / 2, s, s);
      }
      ctx.fill();
    }
    ctx.lineWidth = px(1.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    for (const st of world.stops) {
      ctx.beginPath();
      ctx.arc(st.pos.x, st.pos.y, CONFIG.stop[st.mode].catchment, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Cargo layer: an arrow from each industry's stop to where its cargo goes, as wide as last month's shipments. */
  private drawCargoFlows(world: World, px: (n: number) => number, now: number): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    for (const ind of world.industries) {
      const route = world.cargoRoute(ind);
      const color = THEME.cargo[ind.produces];
      if (!route) {
        const out = ind.accepts ? ind.receivedLast : ind.rate;
        if (out <= 0) continue;
        // Output with nowhere to go: a pulsing ring.
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 250);
        ctx.lineWidth = px(4);
        ctx.beginPath();
        ctx.arc(ind.pos.x, ind.pos.y, 190, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      const a = world.stopById(route.stop)!.pos;
      const b = world.stopById(route.dest)!.pos;
      const len = dist(a, b) || 1;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      const tip = v(b.x - ux * px(14), b.y - uy * px(14));
      const width = px(Math.max(2.5, Math.min(10, ind.shippedLast / 25)));
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash([px(2), px(5)]);
      ctx.beginPath();
      ctx.moveTo(ind.pos.x, ind.pos.y);
      ctx.lineTo(a.x, a.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      const head = px(16);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(tip.x + ux * head * 0.6, tip.y + uy * head * 0.6);
      ctx.lineTo(tip.x - ux * head - uy * head * 0.6, tip.y - uy * head + ux * head * 0.6);
      ctx.lineTo(tip.x - ux * head + uy * head * 0.6, tip.y - uy * head - ux * head * 0.6);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ---------- network ----------

  private lineWidth(px: (n: number) => number, selected: boolean): number {
    const base = Math.min(px(3), 6);
    return selected ? base * 2 : base;
  }

  private drawLines(world: World, editor: Editor, px: (n: number) => number, skip: number | null): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const line of world.lines) {
      if (line.id === skip) continue;
      const selected = line.id === editor.selectedLine;
      // Other layers hide line colours, except for the line being looked at.
      if (this.layer !== 'lines' && !selected) continue;
      const lw = this.lineWidth(px, selected);
      ctx.strokeStyle = THEME.lines[line.color];
      ctx.globalAlpha = selected || editor.selectedLine < 0 ? 0.9 : 0.45;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (const seg of line.segs) this.trace(seg.path);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (editor.tool !== 'select') continue;
      for (const h of lineHandles(line, editor.handleLength())) {
        ctx.lineWidth = Math.max(lw, px(3));
        ctx.beginPath();
        ctx.moveTo(h.base.x, h.base.y);
        ctx.lineTo(h.tip.x, h.tip.y);
        const bar = px(9);
        ctx.moveTo(h.tip.x + h.dir.y * bar, h.tip.y - h.dir.x * bar);
        ctx.lineTo(h.tip.x - h.dir.y * bar, h.tip.y + h.dir.x * bar);
        ctx.stroke();
      }
    }
  }

  private drawPreview(world: World, editor: Editor, px: (n: number) => number): void {
    const pv = editor.preview()!;
    const ctx = this.ctx;
    const existing = pv.lineId !== null ? world.lineById(pv.lineId) : undefined;
    const color = existing ? THEME.lines[existing.color] : THEME.label;
    const paths = pv.stops.length >= 2 ? world.previewLine(pv.mode, pv.stops, pv.loop).paths : [];
    const pairs: [number, number][] = [];
    for (let i = 0; i + 1 < pv.stops.length; i++) pairs.push([pv.stops[i], pv.stops[i + 1]]);
    if (pv.loop) pairs.push([pv.stops[pv.stops.length - 1], pv.stops[0]]);
    ctx.lineWidth = Math.max(px(4), 8);
    ctx.strokeStyle = pv.ok ? color : THEME.bad;
    ctx.globalAlpha = pv.ok ? 0.95 : 0.7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    paths.forEach((path, i) => {
      const [a, b] = pairs[i];
      if (pv.to !== null && a === pv.from && b === pv.to) return;
      ctx.beginPath();
      this.trace(path);
      ctx.stroke();
    });
    const from = pv.from !== null ? world.stopById(pv.from) : undefined;
    if (from) {
      ctx.setLineDash([px(2), px(10)]);
      ctx.beginPath();
      ctx.moveTo(from.pos.x, from.pos.y);
      ctx.lineTo(editor.cursor.x, editor.cursor.y);
      const to = pv.to !== null ? world.stopById(pv.to) : undefined;
      if (to) ctx.lineTo(to.pos.x, to.pos.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    // Cost tag beside the finger.
    if (pv.stops.length >= 2) {
      const label = pv.reason ?? (pv.cost > 0 ? money(pv.cost) : 'Free');
      this.tag(label, v(editor.cursor.x + px(24), editor.cursor.y - px(28)), px, pv.ok ? THEME.ink : THEME.bad);
    }
  }

  private tag(text: string, at: Vec2, px: (n: number) => number, bg: string): void {
    const ctx = this.ctx;
    ctx.font = `600 ${px(12)}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width + px(14);
    const h = px(22);
    ctx.fillStyle = bg;
    roundRect(ctx, at.x, at.y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = THEME.label;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, at.x + px(7), at.y + px(0.5));
  }

  /** Direction of the track or road leaving each stop, so platforms line up with it. */
  private stopAngle(world: World, s: Stop): number {
    if (this.stopAngles.version !== world.networkVersion) {
      const map = new Map<number, number>();
      for (const l of world.lines) {
        for (const seg of l.segs) {
          const p = seg.path;
          if (p.length < 2) continue;
          if (!map.has(seg.a)) map.set(seg.a, Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x));
          const n = p.length;
          if (!map.has(seg.b)) map.set(seg.b, Math.atan2(p[n - 1].y - p[n - 2].y, p[n - 1].x - p[n - 2].x));
        }
      }
      this.stopAngles = { version: world.networkVersion, map };
    }
    return this.stopAngles.map.get(s.id) ?? 0;
  }

  private drawStop(world: World, s: Stop, px: (n: number) => number, now: number): void {
    if (!this.visible(s.pos, 200)) return;
    const ctx = this.ctx;
    const age = world.time - s.bornAt;
    const pop = age < 0.4 ? 0.7 + 0.3 * (age / 0.4) : 1;
    const full = world.waitingTotal(s) >= CONFIG.stop[s.mode].capacity * 0.9;
    ctx.save();
    ctx.translate(s.pos.x, s.pos.y);
    if (s.mode === 'rail') {
      ctx.rotate(this.stopAngle(world, s));
      const L = Math.max(100, px(18)) * pop;
      const W = Math.max(30, px(9)) * pop;
      ctx.fillStyle = THEME.platform;
      ctx.strokeStyle = THEME.ink;
      ctx.lineWidth = Math.max(2, px(1.5));
      ctx.fillRect(-L / 2, -W / 2, L, W);
      ctx.strokeRect(-L / 2, -W / 2, L, W);
      ctx.fillStyle = THEME.stationRoof;
      ctx.fillRect(-L * 0.3, -W / 2 - W * 0.7, L * 0.6, W * 0.7);
      ctx.strokeRect(-L * 0.3, -W / 2 - W * 0.7, L * 0.6, W * 0.7);
    } else {
      const r = Math.max(11, px(6)) * pop;
      ctx.fillStyle = THEME.busStop;
      ctx.strokeStyle = THEME.label;
      ctx.lineWidth = Math.max(2.5, px(1.6));
      roundRect(ctx, -r, -r, r * 2, r * 2, r * 0.35);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = THEME.label;
      ctx.fillRect(-r * 0.45, -r * 0.45, r * 0.9, r * 0.5);
    }
    ctx.restore();
    if (full) {
      // A small pulsing marker instead of a number: this stop turns people away.
      const r = Math.max(px(4), 6) * (0.85 + 0.15 * Math.sin(now / 200));
      ctx.fillStyle = THEME.bad;
      ctx.beginPath();
      ctx.arc(s.pos.x + px(12), s.pos.y - px(12), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawVehicle(t: Vehicle, px: (n: number) => number, z: number): void {
    if (!this.visible(t.path[0], 4000) && !this.visible(t.path[t.path.length - 1], 4000)) return;
    const ctx = this.ctx;
    const k = t.type.key;
    const len = Math.max(t.type.carLength, px(k === 'train' || k === 'freight' ? 7 : 6));
    const wid = Math.max(k === 'train' || k === 'freight' ? 9 : 8, px(3.5));
    const gap = Math.max(2, px(0.8));
    const main = mainCargo(t);
    const fill = loadOf(t) / t.type.capacity;
    ctx.globalAlpha = t.line < 0 ? 0.5 : 1;
    for (let c = 0; c < t.type.cars; c++) {
      const pose = vehiclePose(t, c * (len + gap));
      ctx.save();
      ctx.translate(pose.p.x, pose.p.y);
      ctx.rotate(Math.atan2(pose.t.y, pose.t.x));
      let body: string = THEME.coach;
      if (k === 'bus') body = t.type.livery;
      else if (k === 'truck') body = THEME.wagon;
      else if (c === 0) body = t.type.livery;
      else if (k === 'freight') body = THEME.wagon;
      ctx.fillStyle = body;
      roundRect(ctx, -len / 2, -wid / 2, len, wid, Math.min(wid / 3, 3));
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = Math.max(1, px(0.6));
      ctx.stroke();
      if (z > 0.3) {
        if (k === 'bus' || (k === 'train' && c > 0)) {
          // Window band.
          ctx.fillStyle = 'rgba(30,40,50,0.55)';
          ctx.fillRect(-len / 2 + 3, -wid / 2 + 2, len - 6, wid * 0.28);
        }
        if (k === 'truck') {
          ctx.fillStyle = t.type.livery;
          ctx.fillRect(len / 2 - len * 0.3, -wid / 2, len * 0.3, wid);
        }
      }
      // Cargo shows as a coloured load filling the wagon or truck bed.
      if ((k === 'freight' && c > 0) || k === 'truck') {
        if (main && fill > 0.02) {
          ctx.fillStyle = THEME.cargo[main];
          const bed = k === 'truck' ? len * 0.65 : len - 4;
          ctx.fillRect(-len / 2 + 2, -wid / 2 + 2, bed * Math.min(1, fill + 0.15), wid - 4);
        }
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- labels ----------

  private text(s: string, x: number, y: number, size: number, weight: number, px: (n: number) => number, color = THEME.label): void {
    const ctx = this.ctx;
    ctx.font = `${weight} ${px(size)}px system-ui, sans-serif`;
    ctx.lineWidth = px(3.5);
    ctx.strokeStyle = 'rgba(20,24,27,0.85)';
    ctx.lineJoin = 'round';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  private drawLabels(world: World, px: (n: number) => number, z: number): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of world.towns) {
      if (!this.visible(t.center, 1200)) continue;
      // Above the town, so stations at its centre stay visible.
      const top = t.center.y - townRadius(t.pop) * 0.85;
      this.text(t.name, t.center.x, top - px(9), 16, 800, px);
      this.text(`${t.pop.toLocaleString('en-US')}`, t.center.x, top + px(9), 11.5, 600, px, '#dfe6d6');
    }
    if (z >= 0.14) {
      for (const ind of world.industries) {
        if (!this.visible(ind.pos, 300)) continue;
        const out = ind.accepts ? ind.receivedLast : ind.rate;
        this.text(ind.name, ind.pos.x, ind.pos.y - px(30) - 60, 12.5, 700, px);
        this.text(`${CARGO_LABEL[ind.produces]} ${Math.round(out)}/mo`, ind.pos.x, ind.pos.y - px(15) - 60, 11, 600, px, THEME.cargo[ind.produces]);
      }
    }
    for (const s of world.stops) {
      if (z < (s.mode === 'rail' ? 0.3 : 0.7) || !this.visible(s.pos, 200)) continue;
      const n = Math.round(world.waitingTotal(s));
      this.text(n ? `${s.name} · ${n}` : s.name, s.pos.x, s.pos.y + px(s.mode === 'rail' ? 26 : 20), 11, 600, px);
    }
  }

  /** Magnified view above the finger while drawing a line on a touch screen. */
  private drawLoupe(world: World, editor: Editor, now: number): void {
    const ctx = this.ctx;
    const f = this.cam.toScreen(editor.cursor);
    const above = f.y - LOUPE_R - 56 > this.insets.top - 40;
    const c = v(Math.max(LOUPE_R + 6, Math.min(this.w - LOUPE_R - 6, f.x)), above ? f.y - LOUPE_R - 56 : f.y + LOUPE_R + 56);
    const z = this.cam.zoom * LOUPE_ZOOM;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.beginPath();
    ctx.arc(c.x, c.y, LOUPE_R, 0, Math.PI * 2);
    ctx.fillStyle = THEME.grass;
    ctx.fill();
    ctx.clip();
    this.applyCamera(z, editor.cursor.x, editor.cursor.y, c.x, c.y);
    this.drawScene(world, editor, now, z);
    ctx.restore();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.strokeStyle = THEME.label;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(c.x, c.y, LOUPE_R, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function mainCargo(t: Vehicle): Cargo | null {
  let best: Cargo | null = null;
  let n = 0;
  for (const g of t.load) {
    if (g.what !== 'pax' && g.n > n) {
      n = g.n;
      best = g.what;
    }
  }
  return best;
}

/** Offset a polyline sideways (positive = left of travel), for parallel tracks and rails. */
function offsetPath(path: Vec2[], off: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    out.push(v(path[i].x - (dy / l) * off, path[i].y + (dx / l) * off));
  }
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Small repeating tiles for grass, forest, hills and fields; drawn in world units. */
function makePatterns(ctx: CanvasRenderingContext2D): Patterns {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const tile = (size: number, paint: (c: CanvasRenderingContext2D) => void): CanvasPattern => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d')!;
    paint(c);
    return ctx.createPattern(cv, 'repeat')!;
  };
  const grass = tile(160, (c) => {
    c.fillStyle = THEME.grass;
    c.fillRect(0, 0, 160, 160);
    for (let i = 0; i < 70; i++) {
      c.fillStyle = rnd() < 0.5 ? 'rgba(80,110,50,0.10)' : 'rgba(255,255,220,0.08)';
      const r = 6 + rnd() * 18;
      c.beginPath();
      c.arc(rnd() * 160, rnd() * 160, r, 0, Math.PI * 2);
      c.fill();
    }
  });
  const forest = tile(96, (c) => {
    c.fillStyle = THEME.forest;
    c.fillRect(0, 0, 96, 96);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 96;
      const y = rnd() * 96;
      const r = 7 + rnd() * 6;
      for (const [dx, dy] of [[0, 0], [96, 0], [-96, 0], [0, 96], [0, -96]]) {
        c.fillStyle = THEME.tree;
        c.beginPath();
        c.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = THEME.treeLight;
        c.beginPath();
        c.arc(x + dx - r * 0.3, y + dy - r * 0.3, r * 0.45, 0, Math.PI * 2);
        c.fill();
      }
    }
  });
  const hill = tile(64, (c) => {
    c.fillStyle = THEME.hill;
    c.fillRect(0, 0, 64, 64);
    c.strokeStyle = 'rgba(90,80,40,0.16)';
    c.lineWidth = 2;
    for (let i = -64; i < 128; i += 16) {
      c.beginPath();
      c.moveTo(i, 0);
      c.lineTo(i + 64, 64);
      c.stroke();
    }
  });
  const field = [0, 1].map((k) =>
    tile(24, (c) => {
      c.fillStyle = THEME.field[k];
      c.fillRect(0, 0, 24, 24);
      c.fillStyle = THEME.fieldRow[k];
      for (let y = 0; y < 24; y += 8) c.fillRect(0, y, 24, 3);
    }),
  );
  return { grass, forest, hill, field };
}

/** Where a building stands and which way its roof ridge runs (along the street it faces). */
function footprint(h: House): { x: number; y: number; w: number; h: number; vertical: boolean } {
  if (h.shop) {
    const s = 17 + h.residents * 0.7;
    return { x: h.pos.x - s / 2, y: h.pos.y - s / 2, w: s, h: s, vertical: false };
  }
  const s = 13 + h.residents * 1.15;
  const m = ((Math.round(h.pos.x / CONFIG.lot) % CONFIG.streetEvery) + CONFIG.streetEvery) % CONFIG.streetEvery;
  const vertical = m === 1 || m === CONFIG.streetEvery - 1;
  const w = vertical ? s * 0.78 : s;
  const hh = vertical ? s : s * 0.78;
  return { x: h.pos.x - w / 2, y: h.pos.y - hh / 2, w, h: hh, vertical };
}

/** Draw buildings in a few batched passes: shadows, sunlit and shaded roof halves, flat roofs. */
function paintBuildings(ctx: CanvasRenderingContext2D, houses: House[], z: number): void {
  const fps = houses.map(footprint);
  if (z > 0.22) {
    ctx.fillStyle = THEME.shadow;
    ctx.beginPath();
    for (const f of fps) ctx.rect(f.x + 2.5, f.y + 3, f.w, f.h);
    ctx.fill();
  }
  for (let c = 0; c < THEME.roofs.length; c++) {
    for (const shade of [false, true]) {
      ctx.fillStyle = shade ? THEME.roofsShade[c] : THEME.roofs[c];
      ctx.beginPath();
      houses.forEach((h, i) => {
        if (h.shop || h.roof !== c) return;
        const f = fps[i];
        if (f.vertical) ctx.rect(shade ? f.x + f.w / 2 : f.x, f.y, f.w / 2, f.h);
        else ctx.rect(f.x, shade ? f.y + f.h / 2 : f.y, f.w, f.h / 2);
      });
      ctx.fill();
    }
    ctx.fillStyle = THEME.shops[c];
    ctx.beginPath();
    houses.forEach((h, i) => {
      if (!h.shop || h.roof !== c) return;
      const f = fps[i];
      ctx.rect(f.x, f.y, f.w, f.h);
    });
    ctx.fill();
  }
  if (z > 0.55) {
    // Parapets and rooftop plant on the flat roofs.
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1.2;
    ctx.fillStyle = 'rgba(60,66,72,0.55)';
    ctx.beginPath();
    houses.forEach((h, i) => {
      if (!h.shop) return;
      const f = fps[i];
      ctx.rect(f.x + 2.5, f.y + 2.5, f.w - 5, f.h - 5);
    });
    ctx.stroke();
    ctx.beginPath();
    houses.forEach((h, i) => {
      if (!h.shop) return;
      const f = fps[i];
      ctx.rect(f.x + f.w * 0.55, f.y + f.h * 0.2, 4, 4);
    });
    ctx.fill();
  }
}

/** Clumps of trees across open country: not in water, forests, towns (at full size), industry yards or on roads. */
function scatterTrees(world: World): { x: number; y: number; r: number }[] {
  let seed = 99_991;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const m = world.map;
  const near = (p: Vec2, path: Vec2[], d: number) => {
    for (let i = 1; i < path.length; i++) if (distToSegment(p, path[i - 1], path[i]) < d) return true;
    return false;
  };
  const open = (p: Vec2) =>
    !m.water.some((w) => pointInPolygon(p, w)) &&
    !m.forests.some((f) => pointInPolygon(p, f)) &&
    !world.towns.some((t) => dist(t.center, p) < townRadius(t.basePop * CONFIG.growth.capFactor) + 60) &&
    !world.industries.some((i) => dist(i.pos, p) < 260) &&
    !m.roads.some((rd) => near(p, rd, 50));
  const out: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < 420; i++) {
    const c = v((rnd() * 2 - 1) * (m.halfW - 60), (rnd() * 2 - 1) * (m.halfH - 60));
    if (!open(c)) continue;
    const n = 2 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      const p = v(c.x + (rnd() - 0.5) * 100, c.y + (rnd() - 0.5) * 100);
      if (open(p)) out.push({ x: p.x, y: p.y, r: 9 + rnd() * 7 });
    }
  }
  return out;
}
