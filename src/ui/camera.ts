import { v, type Vec2 } from '../sim/geom';

/** Player-controlled view: centre in world units and zoom in screen px per world unit. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 0.3;
  minZoom = 0.05;
  maxZoom = 1.6;
  /** Screen rectangle the map is drawn into (between the HUD bars). */
  viewport = { x: 0, y: 0, w: 1, h: 1 };

  constructor(
    private halfW: number,
    private halfH: number,
  ) {}

  setViewport(x: number, y: number, w: number, h: number): void {
    this.viewport = { x, y, w: Math.max(1, w), h: Math.max(1, h) };
    // Never zoom out further than the whole map.
    this.minZoom = Math.min(w / (2 * this.halfW), h / (2 * this.halfH)) * 0.95;
    this.clamp();
  }

  get cx(): number {
    return this.viewport.x + this.viewport.w / 2;
  }

  get cy(): number {
    return this.viewport.y + this.viewport.h / 2;
  }

  toWorld(sx: number, sy: number): Vec2 {
    return v((sx - this.cx) / this.zoom + this.x, (sy - this.cy) / this.zoom + this.y);
  }

  toScreen(p: Vec2): Vec2 {
    return v((p.x - this.x) * this.zoom + this.cx, (p.y - this.y) * this.zoom + this.cy);
  }

  lookAt(p: Vec2, zoom?: number): void {
    this.x = p.x;
    this.y = p.y;
    if (zoom) this.zoom = zoom;
    this.clamp();
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.clamp();
  }

  /** Zoom by factor keeping the world point under screen (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toWorld(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  private clamp(): void {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
    const mx = Math.max(0, this.halfW - this.viewport.w / 2 / this.zoom);
    const my = Math.max(0, this.halfH - this.viewport.h / 2 / this.zoom);
    this.x = Math.max(-mx, Math.min(mx, this.x));
    this.y = Math.max(-my, Math.min(my, this.y));
  }
}
