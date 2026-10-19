import { Audio } from './audio';
import { Renderer, type Layer } from './render/renderer';
import { CONFIG } from './sim/config';
import { Economy } from './sim/economy';
import { v } from './sim/geom';
import { VALLEY } from './sim/maps/valley';
import { vehiclePose } from './sim/vehicles';
import { money, World } from './sim/world';
import { Camera } from './ui/camera';
import { Editor } from './ui/editor';
import { Hud, LAYERS, MONTHS } from './ui/hud';

const STEP = 1 / 60;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const cam = new Camera(VALLEY.halfW, VALLEY.halfH);
const renderer = new Renderer(canvas, cam);
const audio = new Audio();

const SAVE_KEY = 'st-save';
const newWorld = () => new World(VALLEY, (Math.random() * 2 ** 31) | 0);
let world = newWorld();
let speed = 0;
let speedBeforeHelp = 1;
let started = false;

const storage = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, val: string): boolean {
    try {
      localStorage.setItem(k, val);
      return true;
    } catch {
      return false; // storage unavailable or full
    }
  },
  remove(k: string): void {
    try {
      localStorage.removeItem(k);
    } catch {
      /* storage unavailable */
    }
  },
};

let saved = storage.get(SAVE_KEY) !== null;
const savedLayer = storage.get('st-layer') as Layer | null;
let layer: Layer = LAYERS.some((l) => l.layer === savedLayer) ? savedLayer! : 'lines';
let graphics = storage.get('st-gfx') !== 'low';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
/** Ambient motion and effects run only on high graphics and when the player has not asked for less motion. */
function applyGraphics(): void {
  renderer.motion = graphics && !reducedMotion.matches;
  document.documentElement.classList.toggle('low-gfx', !graphics);
}
applyGraphics();
reducedMotion.addEventListener?.('change', applyGraphics);
/** Vehicle the camera follows, or -1. */
let follow = -1;
let saveWarned = false;
/** Keep the running company in storage; a bankrupt one is forgotten. */
function persist(): void {
  if (!started) return;
  if (world.over) {
    storage.remove(SAVE_KEY);
    saved = false;
    return;
  }
  saved = storage.set(SAVE_KEY, world.save());
  if (!saved && !saveWarned) {
    saveWarned = true;
    hud.toast('Could not save: browser storage is unavailable or full.', 4000);
  }
}

const editor = new Editor(() => world, cam, {
  tapStop: (s) => hud.openSheet({ kind: 'stop', id: s.id }),
  tapLine: (l) => hud.openSheet({ kind: 'line', id: l.id }),
  tapIndustry: (i) => hud.openSheet({ kind: 'industry', id: i.id }),
  tapTown: (t) => hud.openSheet({ kind: 'town', id: t.id }),
  tapEmpty: () => hud.openSheet(null),
  lineCreated: (l) => {
    hud.openSheet({ kind: 'line', id: l.id });
    renderer.lineBuilt(l.segs.map((seg) => seg.path));
    hud.toast(`${l.name} built. Buy ${l.mode === 'rail' ? 'a train or a freight train' : 'a bus or a truck'} to start service.`, 3500);
    navigator.vibrate?.(8);
  },
  toast: (m) => hud.toast(m),
});

const hud = new Hud(document.getElementById('hud')!, {
  setSpeed: (s) => (speed = s),
  setLayer: (l) => {
    layer = l;
    storage.set('st-layer', l);
  },
  follow: (id) => (follow = id),
  setGraphics: (high) => {
    graphics = high;
    storage.set('st-gfx', high ? 'high' : 'low');
    applyGraphics();
  },
  setTool: (t) => {
    editor.tool = editor.tool === t && t !== 'select' ? 'select' : t;
    if (editor.tool === 'rail' || editor.tool === 'road') {
      const label = editor.tool === 'rail' ? 'a station' : 'a road stop';
      hud.toast(`Tap the map to build ${label} (${money(CONFIG.stop[editor.tool].price)}). Inside a dashed ring it also serves that industry.`, 3500);
    }
  },
  start: () => {
    begin(newWorld());
    persist();
    if (storage.get('st-help-seen') !== '1') hud.openHelp();
  },
  resume: () => {
    const w = World.load(VALLEY, storage.get(SAVE_KEY) ?? '');
    if (!w || w.over) {
      storage.remove(SAVE_KEY);
      saved = false;
      hud.toast('That save could not be read. Start a new company.', 3500);
      return;
    }
    begin(w);
    const { year, month } = w.date();
    hud.toast(`Welcome back. ${MONTHS[month]} ${year}, ${money(w.econ.cash)} in the bank.`, 3000);
  },
  helpToggled: (open) => {
    if (open) {
      speedBeforeHelp = speed;
      speed = 0;
    } else {
      speed = started ? speedBeforeHelp || 1 : 0;
      storage.set('st-help-seen', '1');
    }
  },
  sheetChanged: (s) => (editor.selectedLine = s?.kind === 'line' ? s.id : -1),
  focus: ({ stop, line, town, industry }) => {
    const l = line !== undefined ? world.lineById(line) : undefined;
    const at =
      stop !== undefined
        ? world.stopById(stop)?.pos
        : town !== undefined
          ? world.towns[town]?.center
          : industry !== undefined
            ? world.industries[industry]?.pos
            : l
              ? world.stopById(l.stops[0])?.pos
              : undefined;
    if (!at) return;
    const p = cam.toScreen(at);
    const vp = cam.viewport;
    if (p.x < vp.x || p.x > vp.x + vp.w || p.y < vp.y || p.y > vp.y + vp.h) cam.lookAt(at);
  },
});

function begin(w: World): void {
  audio.unlock();
  world = w;
  editor.cancel();
  editor.tool = 'select';
  hud.openSheet(null);
  cam.lookAt(v(-900, 0), Math.max(cam.minZoom, cam.viewport.w / 2600));
  started = true;
  speed = 1;
  follow = -1;
}

// ---------- input: one finger edits or pans, two fingers pinch and pan ----------

const pointers = new Map<number, { x: number; y: number }>();
let pinch: { dist: number; mid: { x: number; y: number } } | null = null;
let pinched = false;

const midDist = () => {
  const [a, b] = [...pointers.values()];
  return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
};

canvas.addEventListener('pointerdown', (e) => {
  if (!started || world.over || hud.helpOpen) return;
  audio.unlock();
  if (follow >= 0) {
    follow = -1;
    hud.toast('Stopped following');
  }
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    pinched = false;
    editor.setPointer(e.pointerType);
    editor.down(e.clientX, e.clientY);
  } else if (pointers.size === 2) {
    editor.cancel();
    pinched = true;
    pinch = midDist();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    const now = midDist();
    cam.zoomAt(now.mid.x, now.mid.y, now.dist / Math.max(1, pinch.dist));
    cam.panBy(now.mid.x - pinch.mid.x, now.mid.y - pinch.mid.y);
    pinch = now;
  } else if (!pinched && editor.active) editor.move(e.clientX, e.clientY);
});

const release = (e: PointerEvent) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!pinched && editor.active && pointers.size === 0) editor.up(e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', (e) => {
  pointers.delete(e.pointerId);
  pinch = null;
  editor.cancel();
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (!started) return;
    cam.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  if (hud.helpOpen) {
    if (e.key === 'Escape') hud.closeHelp();
    return;
  }
  if (!started || world.over) return;
  if (e.code === 'Space') {
    e.preventDefault();
    speed = speed === 0 ? 1 : 0;
  } else if (e.key === '1') speed = 1;
  else if (e.key === '2') speed = 2;
  else if (e.key === '3') speed = 4;
  else if (e.key === 'Escape') {
    editor.cancel();
    editor.tool = 'select';
    hud.openSheet(null);
  }
});

window.addEventListener('touchend', () => audio.unlock(), { passive: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  if (started && !world.over) speed = 0;
  persist();
});
// iOS may close a home screen app without another visibility event.
window.addEventListener('pagehide', persist);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ---------- loop ----------

let last = performance.now();
let acc = 0;
function frame(now: number) {
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (started && !world.over) {
    acc += elapsed * speed;
    let steps = 0;
    while (acc >= STEP && steps < 20) {
      world.step(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === 20) acc = 0;
  }
  for (const ev of world.events) {
    if (ev.type === 'warning') {
      hud.toast(ev.text, 5000, 'bad');
      navigator.vibrate?.([30, 80, 30]);
    } else if (ev.type === 'monthEnd') {
      const net = Economy.net(world.econ.last);
      if (net > 0) audio.weekEnd();
      hud.flashCash(net >= 0);
      persist();
    } else if (ev.type === 'deliver') {
      const st = world.stopById(ev.stop);
      if (st) renderer.fx.income(st.id, st.pos, ev.amount);
    } else if (ev.type === 'news') {
      hud.toast(ev.news.text, 3000);
    } else if (ev.type === 'bankrupt') {
      persist();
      audio.gameOver();
      editor.cancel();
      hud.openSheet(null);
    }
  }
  world.events.length = 0;
  hud.update({ world, speed, tool: editor.tool, layer, started, saved, graphics }, now);
  // Behind the title screen the valley drifts slowly past.
  if (!started && renderer.motion) cam.lookAt(v(Math.sin(now / 26000) * 1400 - 400, Math.cos(now / 33000) * 500), Math.max(cam.minZoom, cam.viewport.w / 2200));
  if (follow >= 0) {
    const v = world.vehicles.find((x) => x.id === follow);
    if (v) cam.lookAt(vehiclePose(v).p);
    else follow = -1;
  }
  renderer.layer = layer;
  renderer.insets = hud.insets();
  renderer.draw(world, editor, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (import.meta.env.DEV) Object.assign(window, { __game: { get world() { return world; }, cam, renderer, editor, hud } });
