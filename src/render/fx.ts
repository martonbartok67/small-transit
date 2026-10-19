import type { Vec2 } from '../sim/geom';

/* Cosmetic effects in world space: smoke, steam, dust and floating income. Driven by real time, never by the simulation. */

export type PuffKind = 'steam' | 'smoke' | 'dust';

interface Puff {
  kind: PuffKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  grow: number;
  age: number;
  life: number;
}

interface Floater {
  stop: number;
  x: number;
  y: number;
  amount: number;
  age: number;
}

const MAX_PUFFS = 260;
const FLOATER_LIFE = 1.6;
/** Income at the same place within this many seconds joins the floater already rising there. */
const MERGE = 0.6;
/** World units: income at stops this close together shows as one tag. */
const NEAR = 160;

const PUFF_COLOR: Record<PuffKind, string> = {
  steam: '#ffffff',
  smoke: '#5d6166',
  dust: '#bfae88',
};

export class Fx {
  private puffs: Puff[] = [];
  private floaters: Floater[] = [];

  /** Advance by real seconds. */
  update(dt: number): void {
    for (const p of this.puffs) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 0.8;
      p.vy *= 1 - dt * 0.8;
      p.r += p.grow * dt;
    }
    this.puffs = this.puffs.filter((p) => p.age < p.life);
    for (const f of this.floaters) f.age += dt;
    this.floaters = this.floaters.filter((f) => f.age < FLOATER_LIFE);
  }

  puff(kind: PuffKind, at: Vec2, r: number, vx = 0, vy = 0, life = 1.4): void {
    if (this.puffs.length >= MAX_PUFFS) this.puffs.shift();
    const j = () => (Math.random() - 0.5) * r * 0.6;
    this.puffs.push({ kind, x: at.x + j(), y: at.y + j(), vx, vy, r, grow: r * (kind === 'dust' ? 1.6 : 1.1), age: 0, life: life * (0.8 + Math.random() * 0.4) });
  }

  /** A ring of dust where something was just built. */
  burst(at: Vec2, size: number, n = 10): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const sp = size * (1.2 + Math.random());
      this.puff('dust', at, size * 0.35, Math.cos(a) * sp, Math.sin(a) * sp, 0.9);
    }
  }

  income(stop: number, at: Vec2, amount: number): void {
    if (amount <= 0) return;
    // Stops close together (a bus stop beside a station) share one tag, so tags never stack.
    const here = this.floaters.filter((x) => x.stop === stop || Math.hypot(x.x - at.x, x.y - at.y) < NEAR);
    const f = here.find((x) => x.age < MERGE);
    if (f) return void (f.amount += amount);
    // An older tag at this stop hurries to fade so the two never stack.
    for (const old of here) old.age = Math.max(old.age, FLOATER_LIFE * 0.7);
    this.floaters.push({ stop, x: at.x, y: at.y, amount, age: 0 });
  }

  get busy(): boolean {
    return this.puffs.length > 0 || this.floaters.length > 0;
  }

  drawPuffs(ctx: CanvasRenderingContext2D): void {
    for (const p of this.puffs) {
      const t = p.age / p.life;
      ctx.globalAlpha = (p.kind === 'smoke' ? 0.35 : 0.55) * (1 - t) * Math.min(1, p.age * 8);
      ctx.fillStyle = PUFF_COLOR[p.kind];
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Rising "+$1.2k" tags, sized in screen pixels. */
  drawFloaters(ctx: CanvasRenderingContext2D, px: (n: number) => number, label: (n: number) => string): void {
    if (!this.floaters.length) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${px(13)}px 'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif`;
    ctx.lineJoin = 'round';
    for (const f of this.floaters) {
      const t = f.age / FLOATER_LIFE;
      const ease = 1 - (1 - t) ** 3;
      const pop = f.age < 0.18 ? 0.6 + 0.4 * (f.age / 0.18) : 1;
      const y = f.y - px(22) - px(34) * ease;
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      ctx.save();
      ctx.translate(f.x, y);
      ctx.scale(pop, pop);
      const s = `+${label(f.amount)}`;
      ctx.lineWidth = px(4);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeText(s, 0, 0);
      ctx.fillStyle = '#0a8f4e';
      ctx.fillText(s, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
