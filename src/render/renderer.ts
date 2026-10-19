import { CARGO_LABEL, CONFIG } from '../sim/config';
import { dist, distToSegment, pointInPolygon, v, type Polygon, type Vec2 } from '../sim/geom';
import { townRadius } from '../sim/towns';
import type { Cargo, House, Industry, Stop, Vehicle } from '../sim/types';
import { loadOf, vehiclePose } from '../sim/vehicles';
import { LINE_SPACING, money, type World } from '../sim/world';
import type { Camera } from '../ui/camera';
import { lineHandles, type Editor } from '../ui/editor';
import { Fx } from './fx';
import { SUN, THEME } from './theme';


/** What the map emphasises: line colours, nothing, house coverage, or cargo flows. */
export type Layer = 'lines' | 'plain' | 'coverage' | 'cargo';

const LOUPE_R = 64;
const LOUPE_ZOOM = 1.8;
/** Below this zoom the town roofs come from a cached bitmap instead of being drawn one by one. */
const ROOF_CACHE_ZOOM = 0.2;
const ROOF_CACHE_SCALE = 0.25;
const MAP_FONT = "'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif";
const HOUSE_RISE_MS = 450;

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
  readonly fx = new Fx();
  /** Real seconds since the last frame, for effects. */
  private dt = 0;
  private lastNow = 0;
  private ground: { canvas: HTMLCanvasElement; key: string; map: unknown; ready: boolean } = { canvas: document.createElement('canvas'), key: '', map: null, ready: false };
  private houseBorn = new WeakMap<House, number>();
  private houseKey: { world: World | null; key: string } = { world: null, key: '' };
  private stopsSeen: { world: World | null; ids: Set<number> } = { world: null, ids: new Set() };
  private glints: { map: unknown; pts: { x: number; y: number; phase: number }[] } = { map: null, pts: [] };
  private roofCache: { canvas: HTMLCanvasElement; key: string } | null = null;
  private fields = new Map<number, { poly: Polygon; kind: number }[]>();
  private stopAngles = { version: -1, map: new Map<number, number>() };
  private streets: { key: string; segs: number[] } = { key: '', segs: [] };
  private trees: { map: unknown; pts: { x: number; y: number; r: number }[] } = { map: null, pts: [] };
  /** Screen px reserved for the HUD above and below the map. */
  insets = { top: 64, bottom: 92 };
  layer: Layer = 'lines';
  /** Ambient motion (sway, shimmer, clouds, smoke). Off for reduced motion or the low graphics setting. */
  motion = true;

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
    this.dt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;
    this.fx.update(this.dt);
    this.noteNewStops(world);
    this.applyCamera(this.cam.zoom, this.cam.x, this.cam.y, this.cam.cx, this.cam.cy);
    this.drawScene(world, editor, now, this.cam.zoom, true);
    if (editor.editing && editor.touch) this.drawLoupe(world, editor, now);
  }


  private applyCamera(z: number, x: number, y: number, cx: number, cy: number): void {
    this.ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (cx - x * z), this.dpr * (cy - y * z));
  }

  private drawScene(world: World, editor: Editor, now: number, z: number, main = false): void {
    const px = (n: number) => n / z;
    if (main) this.drawGroundCached(world, px);
    else this.drawGround(world, px);
    if (this.motion && z > 0.2) this.drawShimmer(world, now);
    if (z > 0.1) this.drawTrees(world, now);
    this.drawStreets(world, px, z);
    this.drawRoads(world, px, z);
    this.drawTrack(world, px, z);
    this.drawBuildings(world, z, now);
    for (const ind of world.industries) this.drawIndustry(ind, px, z, now, this.dt);
    if (this.layer === 'coverage') this.drawCoverage(world, px);
    if (this.layer === 'cargo') this.drawCargoFlows(world, px, now);
    if (editor.tool === 'rail' || editor.tool === 'road' || this.layer === 'cargo') this.drawReach(world, editor.tool === 'road' ? 'road' : 'rail', px);
    const pv = editor.preview();
    this.drawLines(world, editor, px, pv?.lineId ?? null, now);
    if (pv) this.drawPreview(world, editor, px);
    for (const s of world.stops) this.drawStop(world, s, px, now);
    for (const t of world.vehicles) this.drawVehicle(t, px, z);
    this.fx.drawPuffs(this.ctx);
    if (this.motion) this.drawClouds(world, now);
    this.drawLabels(world, px, z);
    this.fx.drawFloaters(this.ctx, px, money);
  }

  /** Light glinting on the water: short streaks that drift back and forth. */
  private drawShimmer(world: World, now: number): void {
    if (this.glints.map !== world.map) this.glints = { map: world.map, pts: scatterGlints(world.map.water) };
    const ctx = this.ctx;
    const t = now / 1000;
    ctx.strokeStyle = 'rgba(235,248,255,0.35)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const g of this.glints.pts) {
      if (!this.visible(g, 40)) continue;
      const k = Math.sin(t * 0.9 + g.phase);
      const x = g.x + k * 14;
      const len = 6 + 12 * Math.abs(k);
      ctx.moveTo(x - len, g.y);
      ctx.lineTo(x + len, g.y);
    }
    ctx.stroke();
  }

  /** A few soft cloud shadows drifting across the valley. */
  private drawClouds(world: World, now: number): void {
    const ctx = this.ctx;
    const m = world.map;
    const span = m.halfW * 2 + 2400;
    const t = now / 1000;
    for (let i = 0; i < 5; i++) {
      const x = (((i * 1777 + t * 14) % span) + span) % span - m.halfW - 1200;
      const y = -m.halfH + ((i * 1013) % (m.halfH * 2)) + Math.sin(t * 0.05 + i) * 80;
      for (const [dx, dy, r] of [[0, 0, 520], [380, 90, 380], [-360, 120, 340]]) {
        const cx = x + dx;
        const cy = y + dy;
        if (!this.visible(v(cx, cy), r)) continue;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(18,30,40,0.10)');
        g.addColorStop(1, 'rgba(18,30,40,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
  }

  /**
   * The landscape under everything only changes when the camera moves. Once the camera
   * has held still for a frame it is painted into a bitmap, and later frames just copy it.
   */
  private drawGroundCached(world: World, px: (n: number) => number): void {
    const c = this.cam;
    const key = `${c.x}|${c.y}|${c.zoom}|${this.canvas.width}|${this.canvas.height}|${c.cx}|${c.cy}`;
    const g = this.ground;
    if (g.key === key && g.map === world.map) {
      const ctx = this.ctx;
      if (!g.ready) {
        const cv = g.canvas;
        cv.width = this.canvas.width;
        cv.height = this.canvas.height;
        const off = cv.getContext('2d')!;
        off.setTransform(ctx.getTransform());
        const main = this.ctx;
        this.ctx = off;
        this.drawGround(world, px);
        this.ctx = main;
        g.ready = true;
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(g.canvas, 0, 0);
      ctx.restore();
      return;
    }
    // Still moving: draw directly and remember where the camera is.
    g.key = key;
    g.map = world.map;
    g.ready = false;
    this.drawGround(world, px);
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
    // Hills and forests stand up from the plain: a shadow on the far side of the sun first.
    ctx.fillStyle = THEME.shadow;
    for (const poly of [...m.hills, ...m.forests]) {
      const d = m.forests.includes(poly) ? 10 : 22;
      this.polygon(poly.map((p) => v(p.x + SUN.x * d, p.y + SUN.y * d)));
      ctx.fill();
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = THEME.hillEdge;
    ctx.lineWidth = px(1.5);
    for (const h of m.hills) {
      ctx.fillStyle = this.pat.hill;
      this.polygon(h);
      ctx.fill();
      ctx.stroke();
      // Contour bands, each a little lighter and nudged toward the sun.
      shrinkRings(h).forEach((ring, i) => {
        ctx.fillStyle = THEME.hillBands[i];
        this.polygon(ring);
        ctx.fill();
      });
    }
    ctx.fillStyle = this.pat.forest;
    for (const f of m.forests) {
      this.polygon(f);
      ctx.fill();
    }
    // Water: a lighter shallow rim and a bright shoreline inside each body.
    for (const w of m.water) {
      ctx.save();
      this.polygon(w);
      ctx.fillStyle = THEME.waterDeep;
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = THEME.water;
      ctx.lineWidth = 60;
      ctx.stroke();
      ctx.strokeStyle = THEME.waterShallow;
      ctx.lineWidth = 26;
      ctx.stroke();
      ctx.strokeStyle = THEME.waterEdge;
      ctx.lineWidth = Math.max(px(1.5), 6);
      ctx.stroke();
      ctx.restore();
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

  /** Scattered trees in the countryside, laid out once per map: shadow, canopy, then a sunlit cap that sways a little. */
  private drawTrees(world: World, now: number): void {
    if (this.trees.map !== world.map) this.trees = { map: world.map, pts: scatterTrees(world) };
    const ctx = this.ctx;
    const pts = this.trees.pts.filter((t) => this.visible(t, 40));
    const sway = this.motion ? now / 900 : 0;
    const pass = (color: string, place: (t: { x: number; y: number; r: number }, i: number) => [number, number, number]) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      pts.forEach((t, i) => {
        const [x, y, r] = place(t, i);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      });
      ctx.fill();
    };
    pass(THEME.shadow, (t) => [t.x + SUN.x * t.r * 0.8, t.y + SUN.y * t.r * 0.8, t.r * 1.05]);
    pass(THEME.tree, (t) => [t.x, t.y, t.r]);
    pass(THEME.treeLight, (t) => {
      const s = Math.sin(sway + t.x * 0.013 + t.y * 0.007) * t.r * 0.08;
      return [t.x - t.r * 0.3 + s, t.y - t.r * 0.32, t.r * 0.5];
    });
  }

  private drawRoads(world: World, px: (n: number) => number, z: number): void {
    const ctx = this.ctx;
    const paths = [...world.map.roads, ...world.wayList().filter((w) => w.mode === 'road').map((w) => w.path)];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const width = Math.max(20, px(3));
    for (const [color, wd] of [
      [THEME.roadEdge, width + Math.max(4, px(1))],
      [THEME.roadKerb, width],
      [THEME.road, width - Math.max(2, px(0.5))],
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
    for (const [color, extra] of [
      [THEME.ballastEdge, 4],
      [THEME.ballast, 0],
    ] as const) {
      ctx.strokeStyle = color;
      for (const w of ways) {
        ctx.lineWidth = Math.max(w.lanes * LINE_SPACING.rail + 8, px(4)) + extra;
        ctx.beginPath();
        this.trace(w.path);
        ctx.stroke();
      }
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
          for (const [color, wd, dy] of [
            [THEME.rail, 1.3, 0],
            [THEME.railShine, 0.45, -0.3],
          ] as const) {
            ctx.strokeStyle = color;
            ctx.lineWidth = wd;
            for (const side of [-2.4, 2.4]) {
              ctx.beginPath();
              this.trace(offsetPath(path, side + dy));
              ctx.stroke();
            }
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
  private drawBuildings(world: World, z: number, now: number): void {
    this.noteNewHouses(world, now);
    if (z < ROOF_CACHE_ZOOM) return this.drawBuildingCache(world);
    const vis = world.houses.filter((h) => this.visible(h.pos, 40));
    // Houses that just went up rise out of the ground; everything else draws in one batch.
    const rising = this.motion ? vis.filter((h) => now - (this.houseBorn.get(h) ?? 0) < HOUSE_RISE_MS) : [];
    paintBuildings(this.ctx, rising.length ? vis.filter((h) => !rising.includes(h)) : vis, z);
    if (rising.length) paintBuildings(this.ctx, rising, z, (h) => easeOutBack(Math.min(1, (now - this.houseBorn.get(h)!) / HOUSE_RISE_MS)));
  }

  /** Remember when each house first appeared; houses already there when a game loads count as old. */
  private noteNewHouses(world: World, now: number): void {
    const key = `${world.catchVersion}:${world.houses.length}`;
    if (this.houseKey.world === world && this.houseKey.key === key) return;
    const fresh = this.houseKey.world === world;
    this.houseKey = { world, key };
    for (const h of world.houses) {
      if (this.houseBorn.has(h)) continue;
      this.houseBorn.set(h, fresh ? now : 0);
      if (fresh && this.motion) this.fx.burst(h.pos, 10, 4);
    }
  }

  /** Dust where a stop was just built. */
  private noteNewStops(world: World): void {
    if (this.stopsSeen.world !== world) this.stopsSeen = { world, ids: new Set(world.stops.map((s) => s.id)) };
    for (const s of world.stops) {
      if (this.stopsSeen.ids.has(s.id)) continue;
      this.stopsSeen.ids.add(s.id);
      if (this.motion) this.fx.burst(s.pos, s.mode === 'rail' ? 40 : 22, 12);
    }
  }

  /** Dust along a newly built line. */
  lineBuilt(paths: Vec2[][]): void {
    if (!this.motion) return;
    let n = 0;
    for (const path of paths) {
      for (let i = 0; i < path.length && n < 40; i += Math.max(1, Math.floor(path.length / 8)), n++) this.fx.burst(path[i], 14, 3);
    }
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

  private drawIndustry(ind: Industry, px: (n: number) => number, z: number, now: number, dt: number): void {
    if (!this.visible(ind.pos, 300)) return;
    const ctx = this.ctx;
    const { x, y } = ind.pos;
    const I = THEME.industry;
    if (z < 0.14) {
      // A marker that stays readable when the whole map is on screen.
      const r = px(7);
      ctx.fillStyle = THEME.shadow;
      roundRect(ctx, x - r + px(2), y - r + px(2.5), r * 2, r * 2, px(3));
      ctx.fill();
      ctx.fillStyle = THEME.cargo[ind.produces];
      ctx.strokeStyle = THEME.label;
      ctx.lineWidth = px(2);
      roundRect(ctx, x - r, y - r, r * 2, r * 2, px(3));
      ctx.fill();
      ctx.stroke();
      return;
    }
    const working = ind.accepts ? ind.receivedLast > 0 : ind.rate > 0;
    const t = this.motion ? now / 1000 : 0;
    const smoke = (cx: number, cy: number, kind: 'smoke' | 'steam' = 'smoke') => {
      if (this.motion && working && z > 0.2 && Math.random() < dt * 5) this.fx.puff(kind, v(x + cx, y + cy), 7, 10 + Math.random() * 8, -14, 2.4);
    };
    const yard = (bx: number, by: number, w: number, h: number, fill: string) => {
      ctx.fillStyle = fill;
      roundRect(ctx, x + bx, y + by, w, h, 10);
      ctx.fill();
    };
    // A building with height: shadow, south wall, then roof with a lit ridge band.
    const box = (bx: number, by: number, w: number, h: number, fill: string, roof?: string, H = 10) => {
      ctx.fillStyle = THEME.shadow;
      ctx.fillRect(x + bx + SUN.x * H * 1.4, y + by + SUN.y * H * 1.4, w, h);
      ctx.fillStyle = shade(fill, -0.22);
      ctx.fillRect(x + bx, y + by + h - H, w, H);
      ctx.fillStyle = fill;
      ctx.fillRect(x + bx, y + by - H, w, h);
      if (roof) {
        ctx.fillStyle = roof;
        ctx.fillRect(x + bx, y + by - H + h * 0.5, w, h * 0.5);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x + bx, y + by - H, w, h + H);
    };
    // A round tank: shadow, body, and a highlight toward the sun.
    const silo = (cx: number, cy: number, r: number, fill: string) => {
      ctx.fillStyle = THEME.shadow;
      ctx.beginPath();
      ctx.arc(x + cx + SUN.x * r * 0.7, y + cy + SUN.y * r * 0.7, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x + cx, y + cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.arc(x + cx - r * 0.35, y + cy - r * 0.35, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    };
    const logs = (lx: number, ly: number) => {
      for (let i = 0; i < 4; i++) box(lx, ly + i * 7, 34, 5, THEME.cargo.logs, undefined, 2);
    };
    switch (ind.kind) {
      case 'farm':
        yard(-150, -110, 300, 220, I.farmYard);
        box(-60, -40, 70, 50, I.barn, I.barnRoof, 14);
        box(25, -30, 40, 30, I.shed, I.shedRoof, 8);
        silo(-80, 30, 16, I.silo);
        silo(-45, 35, 12, I.silo);
        break;
      case 'forest':
        box(-30, -20, 50, 34, I.lumberHut, I.lumberRoof, 9);
        logs(30, -26);
        logs(-70, 20);
        smoke(-10, -36, 'steam');
        break;
      case 'foodplant':
        yard(-120, -80, 240, 170, I.concrete);
        box(-100, -60, 120, 80, I.hall, I.hallRoof, 16);
        box(30, -55, 70, 50, I.hall2, I.hall2Roof, 12);
        silo(-70, 50, 18, I.tank);
        silo(-30, 50, 18, I.tank);
        box(60, 20, 14, 40, I.chimney, undefined, 30);
        smoke(67, -12);
        break;
      case 'oilwell': {
        yard(-120, -80, 240, 170, I.oilYard);
        [[-70, -30], [10, -45], [-30, 30]].forEach(([jx, jy], i) => {
          // Pumpjack: a base, a beam that rocks while the well produces, and a horse head.
          box(jx - 14, jy + 6, 28, 8, I.pump, undefined, 3);
          const tilt = working ? Math.sin(t * 2.2 + i * 1.7) * 0.35 : 0;
          const ca = Math.cos(tilt) * 17;
          const sa = Math.sin(tilt) * 17;
          ctx.strokeStyle = I.pumpBeam;
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x + jx - ca, y + jy - 2 - sa);
          ctx.lineTo(x + jx + ca, y + jy - 2 + sa);
          ctx.stroke();
          ctx.fillStyle = I.pumpBeam;
          ctx.beginPath();
          ctx.arc(x + jx + ca, y + jy - 2 + sa, 4.5, 0, Math.PI * 2);
          ctx.fill();
        });
        silo(65, 20, 22, I.tank);
        silo(65, -30, 16, I.tank);
        break;
      }
      case 'refinery': {
        yard(-140, -90, 280, 190, I.concrete);
        for (const [tx, ty, tr] of [[-100, -55, 22], [-50, -55, 22], [-100, 0, 22], [-50, 0, 22]]) silo(tx, ty, tr, I.tank);
        box(10, -70, 18, 90, I.pipe, undefined, 30);
        box(40, -60, 14, 80, I.pipe, undefined, 24);
        box(70, -40, 50, 60, I.hall, I.hallRoof, 14);
        box(-120, 45, 110, 30, I.hall2, I.hall2Roof, 8);
        // The flare stack flickers while the refinery runs.
        const f = working ? 0.75 + 0.25 * Math.sin(t * 13) * Math.sin(t * 7.3) : 0.35;
        ctx.fillStyle = 'rgba(255,170,60,0.25)';
        ctx.beginPath();
        ctx.arc(x + 100, y - 70, 14 * f, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = I.flare;
        ctx.beginPath();
        ctx.arc(x + 100, y - 70, 7 * f, 0, Math.PI * 2);
        ctx.fill();
        smoke(19, -102);
        break;
      }
      case 'sawmill':
        yard(-130, -70, 260, 150, I.sawYard);
        box(-110, -45, 150, 50, I.sawHall, I.sawRoof, 14);
        logs(55, -45);
        logs(55, 10);
        box(-100, 25, 60, 30, I.planks, undefined, 4);
        smoke(-20, -62, 'steam');
        break;
    }
  }

  /** While placing a stop: catchments of existing stops and the reach of each industry. */
  private drawReach(world: World, mode: 'rail' | 'road', px: (n: number) => number): void {
    const ctx = this.ctx;
    ctx.lineWidth = px(1.5);
    ctx.fillStyle = 'rgba(10,91,211,0.08)';
    ctx.strokeStyle = 'rgba(10,91,211,0.55)';
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

  private drawLines(world: World, editor: Editor, px: (n: number) => number, skip: number | null, now: number): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const line of world.lines) {
      if (line.id === skip) continue;
      const selected = line.id === editor.selectedLine;
      // Other layers hide line colours, except for the line being looked at.
      if (this.layer !== 'lines' && !selected) continue;
      const lw = this.lineWidth(px, selected);
      const color = THEME.lines[line.color];
      const trace = () => {
        ctx.beginPath();
        for (const seg of line.segs) this.trace(seg.path);
      };
      ctx.globalAlpha = selected || editor.selectedLine < 0 ? 1 : 0.4;
      trace();
      if (selected && this.motion) {
        // A soft glow in the line's colour around the line being looked at.
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = lw * 3.2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = THEME.lineCasing;
      ctx.lineWidth = lw + Math.max(px(2), 3);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.stroke();
      if (selected) {
        // Light dashes flowing along the line, so it reads as a route in motion.
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = lw * 0.35;
        ctx.setLineDash([px(4), px(14)]);
        ctx.lineDashOffset = this.motion ? -px((now / 1000) * 36) : 0;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
      ctx.globalAlpha = 1;
      if (editor.tool !== 'select') continue;
      ctx.strokeStyle = color;
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
    const color = existing ? THEME.lines[existing.color] : THEME.ink;
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
    ctx.font = `700 ${px(12)}px ${MAP_FONT}`;
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
    // Springs up when built: overshoots a little, then settles.
    const pop = age < 0.5 ? easeOutBack(Math.max(0, age) / 0.5) : 1;
    const full = world.waitingTotal(s) >= CONFIG.stop[s.mode].capacity * 0.9;
    const docked = world.vehicles.some((t) => t.state === 'dwelling' && t.dockedAt === s.id);
    if (docked && this.motion) {
      // Boarding: a soft ring ripples out from the stop while a vehicle is in.
      const k = ((now / 1100) % 1 + 1) % 1;
      ctx.strokeStyle = 'rgba(17,20,24,' + (0.45 * (1 - k)).toFixed(3) + ')';
      ctx.lineWidth = px(2);
      ctx.beginPath();
      ctx.arc(s.pos.x, s.pos.y, Math.max(px(10), 18) + px(18) * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(s.pos.x, s.pos.y);
    if (s.mode === 'rail') {
      ctx.rotate(this.stopAngle(world, s));
      const L = Math.max(100, px(18)) * pop;
      const W = Math.max(30, px(9)) * pop;
      const H = W * 0.35;
      const sx = SUN.x * H;
      const sy = SUN.y * H;
      ctx.fillStyle = THEME.shadow;
      ctx.fillRect(-L / 2 + sx, -W / 2 + sy, L, W);
      ctx.fillStyle = THEME.platform;
      ctx.strokeStyle = THEME.ink;
      ctx.lineWidth = Math.max(2, px(1.5));
      roundRect(ctx, -L / 2, -W / 2, L, W, W * 0.15);
      ctx.fill();
      ctx.stroke();
      // Canopy over the platform, with a lit ridge.
      ctx.fillStyle = THEME.shadow;
      ctx.fillRect(-L * 0.3 + sx, -W / 2 - W * 0.7 + sy, L * 0.6, W * 0.7);
      ctx.fillStyle = THEME.stationRoof;
      roundRect(ctx, -L * 0.3, -W / 2 - W * 0.7, L * 0.6, W * 0.7, W * 0.12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = THEME.stationRoofLight;
      ctx.fillRect(-L * 0.3 + 2, -W / 2 - W * 0.7 + 2, L * 0.6 - 4, W * 0.22);
    } else {
      const r = Math.max(11, px(6)) * pop;
      ctx.fillStyle = THEME.shadow;
      roundRect(ctx, -r + r * 0.25, -r + r * 0.35, r * 2, r * 2, r * 0.45);
      ctx.fill();
      ctx.fillStyle = THEME.busStop;
      ctx.strokeStyle = THEME.label;
      ctx.lineWidth = Math.max(2.5, px(1.6));
      roundRect(ctx, -r, -r, r * 2, r * 2, r * 0.45);
      ctx.fill();
      ctx.fillStyle = THEME.busStopLight;
      roundRect(ctx, -r, -r, r * 2, r, r * 0.45);
      ctx.fill();
      roundRect(ctx, -r, -r, r * 2, r * 2, r * 0.45);
      ctx.stroke();
      // A little bus face: windscreen and two headlights.
      ctx.fillStyle = THEME.label;
      roundRect(ctx, -r * 0.5, -r * 0.5, r, r * 0.5, r * 0.12);
      ctx.fill();
      ctx.fillRect(-r * 0.5, r * 0.2, r * 0.22, r * 0.18);
      ctx.fillRect(r * 0.28, r * 0.2, r * 0.22, r * 0.18);
    }
    ctx.restore();
    if (full) {
      // A pulsing warning ring: this stop turns people away.
      const k = this.motion ? (now / 900) % 1 : 0.4;
      const at = v(s.pos.x + px(12), s.pos.y - px(12));
      ctx.fillStyle = THEME.bad;
      ctx.beginPath();
      ctx.arc(at.x, at.y, Math.max(px(4), 6), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = THEME.bad;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = px(2);
      ctx.beginPath();
      ctx.arc(at.x, at.y, Math.max(px(4), 6) + px(10) * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawVehicle(t: Vehicle, px: (n: number) => number, z: number): void {
    if (!this.visible(t.path[0], 4000) && !this.visible(t.path[t.path.length - 1], 4000)) return;
    const ctx = this.ctx;
    const k = t.type.kind;
    const rail = k === 'train' || k === 'freight';
    const len = Math.max(t.type.carLength, px(rail ? 7 : 6));
    const wid = Math.max(rail ? 9 : 8, px(3.5));
    const gap = Math.max(2, px(0.8));
    const main = mainCargo(t);
    const fill = loadOf(t) / t.type.capacity;
    const detail = z > 0.3;
    const sh = Math.max(2.5, px(1.2));
    const cars: { x: number; y: number; a: number }[] = [];
    for (let c = 0; c < t.type.cars; c++) {
      const pose = vehiclePose(t, c * (len + gap));
      cars.push({ x: pose.p.x, y: pose.p.y, a: Math.atan2(pose.t.y, pose.t.x) });
    }
    ctx.globalAlpha = t.line < 0 ? 0.5 : 1;
    // Ground shadows first, so no car's shadow falls on the car ahead.
    ctx.fillStyle = THEME.shadow;
    for (const c of cars) {
      ctx.save();
      ctx.translate(c.x + SUN.x * sh, c.y + SUN.y * sh);
      ctx.rotate(c.a);
      roundRect(ctx, -len / 2, -wid / 2, len, wid, Math.min(wid / 3, 3));
      ctx.fill();
      ctx.restore();
    }
    cars.forEach((p, c) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      const lead = c === 0;
      let body: string = THEME.coach;
      if (k === 'bus') body = t.type.livery;
      else if (k === 'truck') body = THEME.wagon;
      else if (lead) body = t.type.livery;
      else if (k === 'freight') body = THEME.wagon;
      if (lead && detail && this.motion && t.state === 'moving') {
        // Headlights: a faint cone ahead of the lead car.
        ctx.fillStyle = THEME.headlight;
        ctx.beginPath();
        ctx.moveTo(len / 2, -wid * 0.3);
        ctx.lineTo(len / 2 + wid * 2.4, -wid * 0.95);
        ctx.lineTo(len / 2 + wid * 2.4, wid * 0.95);
        ctx.lineTo(len / 2, wid * 0.3);
        ctx.fill();
      }
      ctx.fillStyle = body;
      // Locomotives get a rounded nose; everything else a rounded box.
      const nose = rail && lead ? wid / 2 : Math.min(wid / 3, 3);
      roundRect(ctx, -len / 2, -wid / 2, len, wid, Math.min(wid / 3, 3));
      ctx.fill();
      if (nose > Math.min(wid / 3, 3)) {
        ctx.beginPath();
        ctx.arc(len / 2 - nose, 0, nose, -Math.PI / 2, Math.PI / 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = Math.max(1, px(0.6));
      roundRect(ctx, -len / 2, -wid / 2, len, wid, Math.min(wid / 3, 3));
      ctx.stroke();
      if (detail) {
        // Roof highlight on the sunny side.
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(-len / 2 + 2, -wid / 2 + 1, len - 4, wid * 0.22);
        if (k === 'bus' || (k === 'train' && !lead)) {
          // Windows down both sides.
          ctx.fillStyle = THEME.window;
          ctx.fillRect(-len / 2 + 3, -wid / 2 + 1.2, len - 6, wid * 0.16);
          ctx.fillRect(-len / 2 + 3, wid / 2 - 1.2 - wid * 0.16, len - 6, wid * 0.16);
        }
        if (lead) {
          // Windscreen or cab window at the front.
          ctx.fillStyle = THEME.window;
          ctx.fillRect(len / 2 - (rail ? nose + 3 : 4), -wid * 0.32, 2.2, wid * 0.64);
        }
        if (k === 'truck') {
          ctx.fillStyle = t.type.livery;
          roundRect(ctx, len / 2 - len * 0.3, -wid / 2, len * 0.3, wid, 2);
          ctx.fill();
          ctx.fillStyle = THEME.window;
          ctx.fillRect(len / 2 - 3.5, -wid * 0.32, 2, wid * 0.64);
        }
      }
      // Cargo shows as a coloured load filling the wagon or truck bed.
      if ((k === 'freight' && !lead) || k === 'truck') {
        if (main && fill > 0.02) {
          ctx.fillStyle = THEME.cargo[main];
          const bed = k === 'truck' ? len * 0.65 : len - 4;
          ctx.fillRect(-len / 2 + 2, -wid / 2 + 2, bed * Math.min(1, fill + 0.15), wid - 4);
        }
      }
      ctx.restore();
    });
    ctx.globalAlpha = 1;
    // Exhaust: steam engines puff white, diesels a little grey smoke while pulling away.
    if (this.motion && detail && t.state === 'moving' && this.dt > 0) {
      const steam = t.type.key === 'steam' || t.type.key === 'goods';
      const pulling = t.speed < t.type.speed * 0.9;
      const rate = steam ? 4 + (t.speed / t.type.speed) * 6 : rail && pulling ? 4 : 0;
      if (rate && Math.random() < this.dt * rate) {
        const p = cars[0];
        const ox = Math.cos(p.a) * len * 0.25;
        const oy = Math.sin(p.a) * len * 0.25;
        this.fx.puff(steam ? 'steam' : 'smoke', v(p.x + ox, p.y + oy), wid * (steam ? 0.55 : 0.4), 6, -10, steam ? 1.6 : 1.1);
      }
    }
  }

  // ---------- labels ----------

  /** Map text: ink with a white halo, so it reads on land, water and roofs alike. */
  private text(s: string, x: number, y: number, size: number, weight: number, px: (n: number) => number, color = THEME.ink): void {
    const ctx = this.ctx;
    ctx.font = `${weight} ${px(size)}px ${MAP_FONT}`;
    ctx.lineWidth = px(3.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineJoin = 'round';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  /** A sign plate: black with white caps for towns, white with ink and a cargo square for industries. */
  private plate(s: string, x: number, y: number, size: number, px: (n: number) => number, dot?: string): void {
    const ctx = this.ctx;
    const dark = !dot;
    ctx.font = `800 ${px(size)}px ${MAP_FONT}`;
    const dotW = dot ? px(size * 1.05) : 0;
    const w = ctx.measureText(s).width + px(size * 1.2) + dotW;
    const h = px(size * 1.95);
    ctx.fillStyle = 'rgba(17,20,24,0.18)';
    roundRect(ctx, x - w / 2 + px(1), y - h / 2 + px(2), w, h, px(4));
    ctx.fill();
    ctx.fillStyle = dark ? THEME.ink : '#ffffff';
    roundRect(ctx, x - w / 2, y - h / 2, w, h, px(4));
    ctx.fill();
    if (dot) {
      const d = px(size * 0.62);
      ctx.fillStyle = dot;
      roundRect(ctx, x - w / 2 + px(size * 0.5), y - d / 2, d, d, px(1.5));
      ctx.fill();
    }
    ctx.fillStyle = dark ? '#ffffff' : THEME.ink;
    ctx.fillText(s, x + dotW / 2, y + px(0.5));
  }

  private drawLabels(world: World, px: (n: number) => number, z: number): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of world.towns) {
      if (!this.visible(t.center, 1200)) continue;
      // Above the town, so stations at its centre stay visible.
      const top = t.center.y - townRadius(t.pop) * 0.85;
      this.plate(t.name.toUpperCase(), t.center.x, top - px(10), 14, px);
      this.text(`${t.pop.toLocaleString('en-US')}`, t.center.x, top + px(12), 11, 700, px, THEME.labelMuted);
    }
    if (z >= 0.14) {
      for (const ind of world.industries) {
        if (!this.visible(ind.pos, 300)) continue;
        const out = ind.accepts ? ind.receivedLast : ind.rate;
        this.plate(ind.name, ind.pos.x, ind.pos.y - px(32) - 60, 11.5, px, THEME.cargo[ind.produces]);
        this.text(`${CARGO_LABEL[ind.produces]} ${Math.round(out)}/mo`, ind.pos.x, ind.pos.y - px(13) - 60, 11, 700, px, THEME.labelMuted);
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
    ctx.strokeStyle = THEME.ink;
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
  const grass = tile(256, (c) => {
    c.fillStyle = THEME.grass;
    c.fillRect(0, 0, 256, 256);
    // Large soft patches, then fine speckle; each blob is drawn wrapped so the tile repeats seamlessly.
    const blob = (x: number, y: number, r: number, color: string, soft: boolean) => {
      for (const [dx, dy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256], [256, 256], [-256, -256], [256, -256], [-256, 256]]) {
        if (soft) {
          // Patches fade out at the edge, so they read as texture rather than spots.
          const g = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          g.addColorStop(0, color);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = g;
        } else c.fillStyle = color;
        c.beginPath();
        c.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        c.fill();
      }
    };
    for (let i = 0; i < 18; i++) blob(rnd() * 256, rnd() * 256, 40 + rnd() * 60, rnd() < 0.5 ? THEME.grassDark : THEME.grassLight, true);
    for (let i = 0; i < 220; i++) blob(rnd() * 256, rnd() * 256, 0.8 + rnd() * 1.6, rnd() < 0.5 ? 'rgba(60,95,40,0.07)' : 'rgba(255,255,255,0.12)', false);
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
    for (let i = 0; i < 40; i++) {
      c.fillStyle = rnd() < 0.5 ? 'rgba(110,100,50,0.12)' : 'rgba(255,255,230,0.14)';
      c.fillRect(rnd() * 64, rnd() * 64, 2, 2);
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

interface Footprint {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Wall height: the roof is drawn this far above the ground footprint. */
  H: number;
  vertical: boolean;
}

/** Where a building stands, how tall it is, and which way its roof ridge runs (along the street it faces). */
function footprint(h: House, k = 1): Footprint {
  if (h.shop) {
    const s = (17 + h.residents * 0.7) * k;
    return { x: h.pos.x - s / 2, y: h.pos.y - s / 2, w: s, h: s, H: (7 + h.residents * 0.45) * k, vertical: false };
  }
  const s = (13 + h.residents * 1.15) * k;
  const m = ((Math.round(h.pos.x / CONFIG.lot) % CONFIG.streetEvery) + CONFIG.streetEvery) % CONFIG.streetEvery;
  const vertical = m === 1 || m === CONFIG.streetEvery - 1;
  const w = vertical ? s * 0.78 : s;
  const hh = vertical ? s : s * 0.78;
  return { x: h.pos.x - w / 2, y: h.pos.y - hh / 2, w, h: hh, H: (3 + h.residents * 0.3) * k, vertical };
}

/**
 * Draw buildings in a few batched passes: long shadows, south walls, sunlit and
 * shaded roof halves, flat roofs. `scale` shrinks buildings that are still going up.
 */
function paintBuildings(ctx: CanvasRenderingContext2D, houses: House[], z: number, scale?: (h: House) => number): void {
  const fps = houses.map((h) => footprint(h, scale ? scale(h) : 1));
  if (z > 0.22) {
    ctx.fillStyle = THEME.shadow;
    ctx.beginPath();
    for (const f of fps) {
      const L = f.H * 1.4 + 2;
      ctx.rect(f.x + SUN.x * L, f.y + SUN.y * L, f.w, f.h);
    }
    ctx.fill();
  }
  for (const [shop, color] of [
    [false, THEME.wall],
    [true, THEME.wallShade],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    houses.forEach((h, i) => {
      if (h.shop !== shop) return;
      const f = fps[i];
      ctx.rect(f.x, f.y + f.h - f.H, f.w, f.H);
    });
    ctx.fill();
  }
  for (let c = 0; c < THEME.roofs.length; c++) {
    for (const shade of [false, true]) {
      ctx.fillStyle = shade ? THEME.roofsShade[c] : THEME.roofs[c];
      ctx.beginPath();
      houses.forEach((h, i) => {
        if (h.shop || h.roof !== c) return;
        const f = fps[i];
        const y = f.y - f.H;
        if (f.vertical) ctx.rect(shade ? f.x + f.w / 2 : f.x, y, f.w / 2, f.h);
        else ctx.rect(f.x, shade ? y + f.h / 2 : y, f.w, f.h / 2);
      });
      ctx.fill();
    }
    ctx.fillStyle = THEME.shops[c];
    ctx.beginPath();
    houses.forEach((h, i) => {
      if (!h.shop || h.roof !== c) return;
      const f = fps[i];
      ctx.rect(f.x, f.y - f.H, f.w, f.h);
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
      ctx.rect(f.x + 2.5, f.y - f.H + 2.5, f.w - 5, f.h - 5);
    });
    ctx.stroke();
    ctx.beginPath();
    houses.forEach((h, i) => {
      if (!h.shop) return;
      const f = fps[i];
      ctx.rect(f.x + f.w * 0.55, f.y - f.H + f.h * 0.2, 4, 4);
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

/** Hill contour rings: the outline shrunk toward its centre in steps, drifting toward the sun. */
const ringCache = new WeakMap<Polygon, Polygon[]>();
function shrinkRings(poly: Polygon): Polygon[] {
  let rings = ringCache.get(poly);
  if (!rings) {
    const c = poly.reduce((a, p) => v(a.x + p.x / poly.length, a.y + p.y / poly.length), v(0, 0));
    rings = [0.72, 0.48, 0.26].map((k, i) => poly.map((p) => v(c.x + (p.x - c.x) * k - SUN.x * 30 * (i + 1), c.y + (p.y - c.y) * k - SUN.y * 30 * (i + 1))));
    ringCache.set(poly, rings);
  }
  return rings;
}

/** Lighten (k > 0) or darken (k < 0) a #rrggbb colour. */
const shadeCache = new Map<string, string>();
function shade(hex: string, k: number): string {
  const key = hex + k;
  let out = shadeCache.get(key);
  if (!out) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (c: number) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k);
    out = `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
    shadeCache.set(key, out);
  }
  return out;
}

/** 0 to 1 with a small overshoot at the end, for things that spring into place. */
export function easeOutBack(t: number): number {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

/** Points spread over the water where light glints. */
function scatterGlints(water: Polygon[]): { x: number; y: number; phase: number }[] {
  let seed = 4242;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const out: { x: number; y: number; phase: number }[] = [];
  for (const w of water) {
    const xs = w.map((p) => p.x);
    const ys = w.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (let x = x0; x < x1; x += 70) {
      for (let y = y0; y < y1; y += 70) {
        const p = v(x + rnd() * 60, y + rnd() * 60);
        if (rnd() < 0.5 && pointInPolygon(p, w)) out.push({ x: p.x, y: p.y, phase: rnd() * Math.PI * 2 });
      }
    }
  }
  return out;
}
