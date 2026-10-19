import { CONFIG } from '../sim/config';
import { v, type Vec2 } from '../sim/geom';
import type { Stop, Vehicle } from '../sim/types';
import { vehiclePose } from '../sim/vehicles';
import { money, type World } from '../sim/world';
import type { Camera } from '../ui/camera';
import { lineHandles, type Editor } from '../ui/editor';

export const THEME = {
  land: '#ebe7da',
  hill: '#ddd8c0',
  hillEdge: '#cfc8aa',
  water: '#bad4e5',
  waterEdge: '#a8c6db',
  house: '#c4b9ab',
  houseServed: '#8d7f71',
  road: '#d0c9bb',
  ink: '#2b2622',
  muted: '#7d746c',
  paper: '#ffffff',
  bad: '#c8392b',
  lines: ['#d9412b', '#2867d4', '#1a9a55', '#e09b00', '#8b46b3', '#0098a8', '#e0629a', '#6b7a1f'],
};

const LOUPE_R = 64;
const LOUPE_ZOOM = 1.8;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** Screen px reserved for the HUD above and below the map. */
  insets = { top: 64, bottom: 92 };

  constructor(
    private canvas: HTMLCanvasElement,
    private cam: Camera,
  ) {
    this.ctx = canvas.getContext('2d')!;
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
    ctx.fillStyle = THEME.land;
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
    this.drawTerrain(world, px);
    this.drawHouses(world, z);
    if (editor.tool === 'rail' || editor.tool === 'bus') this.drawCatchments(world, editor, px);
    this.drawWays(world, px);
    const pv = editor.preview();
    this.drawLines(world, editor, px, pv?.lineId ?? null);
    if (pv) this.drawPreview(world, editor, px);
    for (const t of world.vehicles) this.drawVehicle(t, px);
    for (const s of world.stops) this.drawStop(world, s, px, z, now);
    this.drawTownLabels(world, px);
  }

  private polygon(poly: Vec2[]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }

  private drawTerrain(world: World, px: (n: number) => number): void {
    const ctx = this.ctx;
    const m = world.map;
    ctx.strokeStyle = THEME.hillEdge;
    ctx.lineWidth = px(1.5);
    ctx.lineJoin = 'round';
    for (const hpoly of m.hills) {
      ctx.fillStyle = THEME.hill;
      this.polygon(hpoly);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = THEME.water;
    ctx.strokeStyle = THEME.waterEdge;
    for (const w of m.water) {
      this.polygon(w);
      ctx.fill();
      ctx.stroke();
    }
    // Map edge.
    ctx.strokeStyle = THEME.hillEdge;
    ctx.lineWidth = px(2);
    ctx.strokeRect(-m.halfW, -m.halfH, m.halfW * 2, m.halfH * 2);
  }

  private visible(p: Vec2, pad: number): boolean {
    const c = this.cam;
    const hw = c.viewport.w / 2 / c.zoom + pad;
    const hh = c.viewport.h / 2 / c.zoom + pad;
    return Math.abs(p.x - c.x) < hw && Math.abs(p.y - c.y) < hh;
  }

  private drawHouses(world: World, z: number): void {
    const ctx = this.ctx;
    // Two batched passes: houses no stop reaches, then houses in a catchment (darker).
    for (const served of [false, true]) {
      ctx.fillStyle = served ? THEME.houseServed : THEME.house;
      ctx.beginPath();
      for (const h of world.houses) {
        if (h.stop >= 0 !== served || !this.visible(h.pos, 20)) continue;
        const s = Math.max(6 + h.residents * 1.5, 2 / z);
        ctx.rect(h.pos.x - s / 2, h.pos.y - s / 2, s, s);
      }
      ctx.fill();
    }
  }

  private drawCatchments(world: World, editor: Editor, px: (n: number) => number): void {
    const ctx = this.ctx;
    const mode = editor.tool as 'rail' | 'bus';
    const r = CONFIG.stop[mode].catchment;
    ctx.fillStyle = 'rgba(43,38,34,0.05)';
    ctx.strokeStyle = 'rgba(43,38,34,0.25)';
    ctx.lineWidth = px(1);
    for (const s of world.stops) {
      if (s.mode !== mode) continue;
      ctx.beginPath();
      ctx.arc(s.pos.x, s.pos.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /** Stroke a polyline with rounded bends. */
  private tracePath(path: Vec2[], radius: number): void {
    const ctx = this.ctx;
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length - 1; i++) ctx.arcTo(path[i].x, path[i].y, path[i + 1].x, path[i + 1].y, radius);
    ctx.lineTo(path[path.length - 1].x, path[path.length - 1].y);
  }

  private drawWays(world: World, px: (n: number) => number): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const w of world.wayList()) {
      if (w.mode !== 'bus') continue;
      ctx.strokeStyle = THEME.road;
      ctx.lineWidth = Math.max(px(8), 14);
      ctx.beginPath();
      this.tracePath(w.path, 40);
      ctx.stroke();
    }
    // Rail: a dark track bed with sleepers.
    for (const w of world.wayList()) {
      if (w.mode !== 'rail') continue;
      ctx.strokeStyle = THEME.ink;
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = Math.max(px(10), 18);
      ctx.beginPath();
      this.tracePath(w.path, 60);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private lineWidth(mode: 'rail' | 'bus', px: (n: number) => number): number {
    return mode === 'rail' ? Math.min(px(6), 10) : Math.min(px(4), 6);
  }

  private drawLines(world: World, editor: Editor, px: (n: number) => number, skip: number | null): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const line of world.lines) {
      if (line.id === skip) continue;
      const color = THEME.lines[line.color];
      ctx.strokeStyle = color;
      const lw = this.lineWidth(line.mode, px);
      ctx.lineWidth = line.id === editor.selectedLine ? lw * 1.8 : lw;
      for (const seg of line.segs) {
        ctx.beginPath();
        this.tracePath(seg.path, line.mode === 'rail' ? 60 : 40);
        ctx.stroke();
      }
      if (editor.tool !== 'select') continue;
      for (const h of lineHandles(line, editor.handleLength())) {
        ctx.lineWidth = lw;
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
    ctx.lineWidth = this.lineWidth(pv.mode, px);
    ctx.strokeStyle = pv.ok ? color : THEME.bad;
    ctx.globalAlpha = pv.ok ? 1 : 0.6;
    paths.forEach((path, i) => {
      const [a, b] = pairs[i];
      if (pv.to !== null && a === pv.from && b === pv.to) return;
      ctx.beginPath();
      this.tracePath(path, pv.mode === 'rail' ? 60 : 40);
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
    ctx.fillStyle = THEME.paper;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, at.x + px(7), at.y + px(0.5));
  }

  private drawVehicle(t: Vehicle, px: (n: number) => number): void {
    const ctx = this.ctx;
    const len = Math.max(t.type.carLength, px(t.type.mode === 'rail' ? 12 : 9));
    const wid = Math.max(t.type.mode === 'rail' ? 11 : 8, px(t.type.mode === 'rail' ? 7 : 6));
    const load = t.riders.length / t.type.capacity;
    for (let c = 0; c < t.type.cars; c++) {
      const pose = vehiclePose(t, c * (len + px(2)));
      ctx.save();
      ctx.translate(pose.p.x, pose.p.y);
      ctx.rotate(Math.atan2(pose.t.y, pose.t.x));
      ctx.globalAlpha = t.line < 0 ? 0.5 : 1;
      ctx.fillStyle = THEME.lines[t.color];
      roundRect(ctx, -len / 2, -wid / 2, len, wid, Math.min(wid / 3, px(3)));
      ctx.fill();
      // Load shown as a white fill from the back of the car.
      if (load > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        const inset = wid * 0.25;
        const fillLen = (len - inset * 2) * Math.min(1, load);
        ctx.fillRect(-len / 2 + inset, -wid / 2 + inset, fillLen, wid - inset * 2);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private drawStop(world: World, s: Stop, px: (n: number) => number, z: number, now: number): void {
    if (!this.visible(s.pos, 200)) return;
    const ctx = this.ctx;
    const age = world.time - s.bornAt;
    const pop = age < 0.4 ? 0.7 + 0.3 * (age / 0.4) : 1;
    const { x, y } = s.pos;
    ctx.lineWidth = px(2.5);
    ctx.strokeStyle = THEME.ink;
    ctx.fillStyle = THEME.paper;
    if (s.mode === 'rail') {
      const r = Math.max(px(9), 14) * pop;
      roundRect(ctx, x - r, y - r, r * 2, r * 2, r * 0.35);
    } else {
      const r = Math.max(px(6), 8) * pop;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    const cap = CONFIG.stop[s.mode].capacity;
    if (s.waiting.length > 0) {
      const full = s.waiting.length >= cap * 0.9;
      const pulse = full ? 0.6 + 0.4 * Math.sin(now / 150) : 1;
      ctx.globalAlpha = pulse;
      this.tag(String(s.waiting.length), v(x + px(12), y - px(14)), px, full ? THEME.bad : THEME.ink);
      ctx.globalAlpha = 1;
    }
    // Bus stops sit close together; name them only when zoomed in enough to read.
    if (z > (s.mode === 'rail' ? 0.32 : 0.75)) {
      ctx.fillStyle = THEME.ink;
      ctx.font = `500 ${px(11)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(s.name, x, y + px(14));
    }
  }

  private drawTownLabels(world: World, px: (n: number) => number): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    for (const t of world.towns) {
      if (!this.visible(t.center, 300)) continue;
      const at = v(t.center.x, t.center.y - world.townRadius(t) - px(10));
      ctx.lineWidth = px(4);
      ctx.strokeStyle = THEME.land;
      ctx.fillStyle = THEME.ink;
      ctx.textBaseline = 'bottom';
      ctx.font = `700 ${px(15)}px system-ui, sans-serif`;
      ctx.strokeText(t.name, at.x, at.y - px(14));
      ctx.fillText(t.name, at.x, at.y - px(14));
      ctx.font = `500 ${px(11)}px system-ui, sans-serif`;
      ctx.fillStyle = THEME.muted;
      const label = `${t.pop.toLocaleString('en-US')} people`;
      ctx.strokeText(label, at.x, at.y);
      ctx.fillText(label, at.x, at.y);
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
    ctx.fillStyle = THEME.land;
    ctx.fill();
    ctx.clip();
    this.applyCamera(z, editor.cursor.x, editor.cursor.y, c.x, c.y);
    this.drawScene(world, editor, now, z);
    ctx.restore();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.strokeStyle = THEME.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, LOUPE_R, 0, Math.PI * 2);
    ctx.stroke();
  }
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
