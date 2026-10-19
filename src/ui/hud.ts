import { CARGO_LABEL, CONFIG, INDUSTRY, modelsFor, TOWN_CARGO } from '../sim/config';
import { Economy } from '../sim/economy';
import type { Carries, Freight, Ledger, Line, Mode, Vehicle, VehicleType } from '../sim/types';
import { loadOf } from '../sim/vehicles';
import { money, type World } from '../sim/world';
import type { Layer } from '../render/renderer';
import { THEME } from '../render/theme';
import type { Tool } from './editor';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const ICON = {
  pause: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5v14M15 5v14" stroke-width="3"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>',
  fast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6v12l8-6zM12 6v12l8-6z" fill="currentColor"/></svg>',
  faster: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 7v10l6-5zM8.5 7v10l6-5zM15.5 7v10l6-5z" fill="currentColor"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5L12 21l9-4.5"/></svg>',
  select: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l14 9.5-6 1.4 3.4 6.6-2.7 1.4-3.4-6.6L6 19.5z" fill="currentColor" stroke-width="1.2"/></svg>',
  rail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 13.2h.01M15 13.2h.01M8 20l2-4M16 20l-2-4"/></svg>',
  road: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="12" rx="3"/><path d="M4 10h16M7.5 16v3M16.5 16v3M8 13h.01M16 13h.01"/></svg>',
  bulldoze: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/></svg>',
  lines: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h6a4 4 0 0 1 4 4v6"/><path d="M5 8v4a6 6 0 0 0 6 6h6" opacity=".55"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" stroke-width="2.6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18" stroke-width="2.4"/></svg>',
  finance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5M4 19h16"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
  vehicles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="10" rx="3"/><path d="M3 11h18M7 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>',
  towns: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18M5 20V10l5-4 5 4v10M15 20v-7h4v7M9 20v-4h2v4"/></svg>',
  industries: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20V11l5 3v-3l5 3V6h3v14zM3 20h18"/><path d="M18 20V9h3v11"/></svg>',
  news: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8M12 17h.01"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
};

const TOOLS: { tool: Tool; label: string; icon: string }[] = [
  { tool: 'select', label: 'Select', icon: ICON.select },
  { tool: 'rail', label: 'Station', icon: ICON.rail },
  { tool: 'road', label: 'Road stop', icon: ICON.road },
  { tool: 'bulldoze', label: 'Demolish', icon: ICON.bulldoze },
];

export const LAYERS: { layer: Layer; label: string; hint: string }[] = [
  { layer: 'lines', label: 'Lines', hint: 'Line colours over the map' },
  { layer: 'plain', label: 'Plain', hint: 'Just the landscape and vehicles' },
  { layer: 'coverage', label: 'Coverage', hint: 'Which houses reach a stop' },
  { layer: 'cargo', label: 'Cargo', hint: 'Where each industry ships' },
];

export type FinanceTab = 'overview' | 'statement' | 'loans';

export type Sheet =
  | { kind: 'menu' }
  | { kind: 'stop'; id: number }
  | { kind: 'line'; id: number; confirmDelete?: boolean }
  | { kind: 'buy'; line: number; carries: Carries }
  | { kind: 'lines' }
  | { kind: 'vehicles' }
  | { kind: 'vehicle'; id: number }
  | { kind: 'towns' }
  | { kind: 'town'; id: number }
  | { kind: 'industries' }
  | { kind: 'industry'; id: number }
  | { kind: 'finance'; tab: FinanceTab }
  | { kind: 'news' };

const HELP: { title: string; text: string }[] = [
  {
    title: 'Your transport company',
    text: 'Six towns need passenger service, and farms, forests and an oil well need their cargo moved. Build stations and road stops, join them into lines, and buy vehicles. Every line shows what it earns.',
  },
  {
    title: 'Build a line',
    text: 'Pick Station or Road stop and tap the map. Then, with Select, drag from one stop to another. Track and roads follow the land: rivers need bridges and hills cost more. Country roads and town streets are already built, so road lines along them are almost free.',
  },
  {
    title: 'Vehicles',
    text: 'Open a line to buy vehicles. Each year brings new models: faster and bigger, but dearer to buy and run. Vehicles cost more to run as they age; renew them from the line. Turn on Full load to make vehicles wait at the first stop until they are full.',
  },
  {
    title: 'Freight',
    text: 'Farms grow grain for the food plant, forests send logs to the sawmill, and the oil well feeds the refinery. Put a stop inside the dashed ring around an industry, link it to the factory, and buy trucks or freight trains. Factories then send food, goods and fuel to towns.',
  },
  {
    title: 'Towns grow',
    text: 'Towns with good passenger service and steady food, goods and fuel grow, up to about four times their size. In Finance you can set ticket prices: dearer tickets earn more per rider, but fewer people travel. The layers button at the top shows coverage and cargo flows.',
  },
  {
    title: 'Stay solvent',
    text: `If your cash stays below zero for ${CONFIG.bankruptMonths} month-ends in a row, the company goes bankrupt. Borrow in Finance and repay when you can. Drag empty ground to move the map${COARSE ? ' and pinch to zoom' : ', scroll to zoom'}.`,
  },
];

export interface HudCallbacks {
  setSpeed(s: number): void;
  setTool(t: Tool): void;
  setLayer(l: Layer): void;
  start(): void;
  resume(): void;
  helpToggled(open: boolean): void;
  sheetChanged(sheet: Sheet | null): void;
  focus(target: { stop?: number; line?: number; town?: number; industry?: number }): void;
  follow(vehicleId: number): void;
  setGraphics(high: boolean): void;
}

export interface HudState {
  world: World;
  speed: number;
  tool: Tool;
  layer: Layer;
  started: boolean;
  /** A saved company exists that the title screen can continue. */
  saved: boolean;
  /** High graphics: ambient motion, smoke, glow and blurred panels. */
  graphics: boolean;
}

/** A rendered sheet: structure (rebuilt only when `key` changes) plus live values patched in place. */
interface View {
  key: string;
  title: string;
  sub: string;
  body: string;
  live: Record<string, Live>;
}
type Live = { text: string; bad?: boolean };

const FREIGHT_LABEL = (f: Freight) => (f === 'pax' ? 'Passengers' : CARGO_LABEL[f]);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const round = (x: number) => Math.round(x).toLocaleString('en-US');
const KIND_NAME: Record<VehicleType['kind'], string> = { train: 'train', freight: 'freight train', bus: 'bus', truck: 'truck' };
const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? '' : s.endsWith('s') ? 'es' : 's'}`;

/** A live value: rendered once with its id, then patched each update without rebuilding the sheet. */
const lv = (id: string, v: Live) => `<b data-live="${id}" class="${v.bad ? 'neg' : ''}">${v.text}</b>`;
const stat = (label: string, value: string) => `<div class="stat"><small>${label}</small>${value}</div>`;
const static_ = (text: string, bad = false) => `<b class="${bad ? 'neg' : ''}">${text}</b>`;

/** How often sheets refresh their numbers, in ms. Structure changes apply on the next refresh. */
const REFRESH_MS = 250;

/** DOM overlay. Acts on click (so a scroll that starts on a button is not a tap) and never rebuilds a sheet while it is being touched. */
export class Hud {
  private keys = new Map<string, string>();
  private top: HTMLElement;
  private bar: HTMLElement;
  private sheetEl: HTMLElement;
  private overlay: HTMLElement;
  private toastEl: HTMLElement;
  private popEl: HTMLElement;
  private toastTimer = 0;
  private help: number | null = null;
  private stack: Sheet[] = [];
  private layersOpen = false;
  private touching = false;
  private releaseTimer = 0;
  private lastRefresh = 0;
  private dirty = true;
  private world!: World;
  private graphics = true;
  /** Cash as shown: eases toward the real figure. */
  private shownCash: number | null = null;
  private lastFrame = 0;
  private leaveTimer = 0;
  private overlayKind = '';

  constructor(
    root: HTMLElement,
    private cb: HudCallbacks,
  ) {
    root.innerHTML =
      '<div class="top"></div><div class="pop-slot"></div><div class="sheet-slot"></div><div class="bar"></div><div class="overlay-slot"></div><div class="toast"></div>';
    this.top = root.querySelector('.top')!;
    this.bar = root.querySelector('.bar')!;
    this.sheetEl = root.querySelector('.sheet-slot')!;
    this.overlay = root.querySelector('.overlay-slot')!;
    this.toastEl = root.querySelector('.toast')!;
    this.popEl = root.querySelector('.pop-slot')!;
    root.addEventListener('click', (e) => this.onAct(e));
    // While a finger is on the sheet, keep its DOM still so scrolling and taps are never interrupted.
    this.sheetEl.addEventListener('pointerdown', () => {
      clearTimeout(this.releaseTimer);
      this.touching = true;
    });
    const release = () => {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = window.setTimeout(() => (this.touching = false), 350);
    };
    this.sheetEl.addEventListener('pointerup', release);
    this.sheetEl.addEventListener('pointercancel', release);
    // Momentum scrolling continues after the finger lifts: keep holding while it scrolls.
    this.sheetEl.addEventListener(
      'scroll',
      () => {
        this.touching = true;
        release();
      },
      { capture: true, passive: true },
    );
  }

  /** Screen bands the HUD covers, so the map is laid out between them. */
  insets(): { top: number; bottom: number } {
    return { top: this.top.getBoundingClientRect().bottom + 6, bottom: window.innerHeight - this.bar.getBoundingClientRect().top + 6 };
  }

  toast(msg: string, ms = 2200, tone: 'info' | 'bad' = 'info'): void {
    this.toastEl.textContent = msg;
    this.toastEl.className = `toast show ${tone}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  /** A brief green or red flash on the cash pill, at month end. */
  flashCash(good: boolean): void {
    const el = this.top.querySelector('.cash');
    if (!el) return;
    el.classList.remove('flash-good', 'flash-bad');
    void (el as HTMLElement).offsetWidth; // restart the animation
    el.classList.add(good ? 'flash-good' : 'flash-bad');
  }

  get helpOpen(): boolean {
    return this.help !== null;
  }

  get sheet(): Sheet | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  openHelp(): void {
    if (this.help !== null) return;
    this.help = 0;
    this.cb.helpToggled(true);
  }

  closeHelp(): void {
    if (this.help === null) return;
    this.help = null;
    this.cb.helpToggled(false);
  }

  /** Show a sheet on its own (from the map or the bars); null closes. */
  openSheet(s: Sheet | null): void {
    this.stack = s ? [s] : [];
    this.changed();
  }

  /** Show a sheet on top of the current one, with a back button. */
  pushSheet(s: Sheet): void {
    this.stack.push(s);
    this.changed();
  }

  private replaceTop(s: Sheet): void {
    this.stack[this.stack.length - 1] = s;
    this.changed();
  }

  private changed(): void {
    this.layersOpen = false;
    this.dirty = true;
    this.touching = false;
    this.cb.sheetChanged(this.sheet);
  }

  private onAct(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    e.preventDefault();
    const [act, arg = ''] = el.dataset.act!.split(':');
    const w = this.world;
    const n = Number(arg);
    this.dirty = true;
    switch (act) {
      case 'speed':
        return this.cb.setSpeed(n);
      case 'gfx':
        return this.cb.setGraphics(!this.graphics);
      case 'tool':
        this.layersOpen = false;
        return this.cb.setTool(arg as Tool);
      case 'layers':
        this.layersOpen = !this.layersOpen;
        return;
      case 'layer':
        this.layersOpen = false;
        return this.cb.setLayer(arg as Layer);
      case 'start':
        return this.cb.start();
      case 'resume':
        return this.cb.resume();
      case 'help':
        this.openSheet(null);
        return this.openHelp();
      case 'help-go':
        this.help = Math.max(0, Math.min(HELP.length - 1, n));
        return;
      case 'help-close':
        return this.closeHelp();
      case 'close':
        return this.openSheet(null);
      case 'back':
        this.stack.pop();
        return this.changed();
      case 'menu':
        return this.openSheet(this.sheet?.kind === 'menu' ? null : { kind: 'menu' });
      case 'lines':
        return this.openSheet(this.sheet?.kind === 'lines' ? null : { kind: 'lines' });
      case 'finance':
        return this.openSheet(this.sheet?.kind === 'finance' ? null : { kind: 'finance', tab: 'overview' });
      case 'go': {
        // From the menu hub: a list sheet, with back to the menu.
        const kind = arg as 'lines' | 'vehicles' | 'towns' | 'industries' | 'news' | 'finance';
        return this.pushSheet(kind === 'finance' ? { kind, tab: 'overview' } : { kind });
      }
      case 'tab':
        if (this.sheet?.kind === 'finance') this.replaceTop({ kind: 'finance', tab: arg as FinanceTab });
        return;
      case 'open-line':
        this.cb.focus({ line: n });
        return this.pushSheet({ kind: 'line', id: n });
      case 'open-stop':
        this.cb.focus({ stop: n });
        return this.pushSheet({ kind: 'stop', id: n });
      case 'open-town':
        this.cb.focus({ town: n });
        return this.pushSheet({ kind: 'town', id: n });
      case 'open-industry':
        this.cb.focus({ industry: n });
        return this.pushSheet({ kind: 'industry', id: n });
      case 'open-vehicle':
        return this.pushSheet({ kind: 'vehicle', id: n });
      case 'buy-pick': {
        const [id, carries] = arg.split('.') as [string, Carries];
        return this.pushSheet({ kind: 'buy', line: Number(id), carries });
      }
      case 'buy': {
        const [id, model] = arg.split('.');
        const r = w.addVehicle(Number(id), model);
        this.toast(typeof r === 'string' ? r : `Bought a ${r.type.name}`);
        return;
      }
      case 'sell': {
        const [id, carries] = arg.split('.') as [string, Carries];
        if (w.sellVehicle(Number(id), carries)) this.toast('Sold the emptiest one');
        return;
      }
      case 'sell-vehicle': {
        const v = w.vehicles.find((x) => x.id === n);
        if (!v) return;
        const value = w.saleValue(v);
        w.retireVehicle(v, w.stopById(v.dockedAt ?? v.fromStation) ?? w.stopById(v.toStation)!);
        this.toast(`Sold for ${money(value)}`);
        this.stack.pop();
        return this.changed();
      }
      case 'renew': {
        const k = w.renewVehicles(n);
        this.toast(k ? `Renewed ${plural(k, 'vehicle')}` : 'Nothing to renew, or not enough cash');
        return;
      }
      case 'full-load': {
        const l = w.lineById(n);
        if (l) w.setFullLoad(n, !l.fullLoad);
        return;
      }
      case 'follow':
        this.cb.follow(n);
        this.openSheet(null);
        return this.toast('Following. Drag the map to stop.');
      case 'delete-line':
        if (this.sheet?.kind === 'line' && this.sheet.confirmDelete) {
          w.deleteLine(n);
          this.toast('Line deleted. Its vehicles are sold as they reach a stop.');
          return this.openSheet({ kind: 'lines' });
        }
        return this.replaceTop({ kind: 'line', id: n, confirmDelete: true });
      case 'demolish': {
        const why = w.removeStop(n);
        if (why) this.toast(why);
        else this.openSheet(null);
        return;
      }
      case 'borrow':
        if (!w.econ.borrow()) this.toast(`Loan limit is ${money(CONFIG.maxLoan)}`);
        return;
      case 'repay':
        if (!w.econ.repay()) this.toast(w.econ.loan > 0 ? 'Not enough cash to repay' : 'No loan to repay');
        return;
      case 'price': {
        const mode = arg.slice(0, -1) as Mode;
        const dir = arg.endsWith('+') ? 1 : -1;
        w.econ.setPrice(mode, w.econ.price[mode] + dir * CONFIG.price.step);
        return;
      }
    }
  }

  private set(el: HTMLElement, id: string, key: string, html: () => string): void {
    if (this.keys.get(id) === key) return;
    this.keys.set(id, key);
    el.innerHTML = html();
  }

  /** Patch live values inside an element without touching anything else. */
  private patch(el: HTMLElement, live: Record<string, Live>): void {
    for (const node of el.querySelectorAll<HTMLElement>('[data-live]')) {
      const v = live[node.dataset.live!];
      if (!v) continue;
      if (node.textContent !== v.text) node.textContent = v.text;
      node.classList.toggle('neg', !!v.bad);
    }
  }

  update(s: HudState, now = performance.now()): void {
    const w = (this.world = s.world);
    const { year, month } = w.date();
    const cash = w.econ.cash;
    this.graphics = s.graphics;
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    // Cash rolls toward its new value instead of jumping.
    if (this.shownCash === null || !s.started || Math.abs(cash - this.shownCash) < 500) this.shownCash = cash;
    else this.shownCash += (cash - this.shownCash) * Math.min(1, dt * 6);
    // Bars are built once; only their state classes change, so the sliding indicators can animate.
    this.set(this.top, 'top', 'static', () => {
      const btn = (act: string, icon: string, label: string) => `<button class="icon-btn" data-act="${act}" aria-label="${label}">${icon}</button>`;
      return `
        <button class="cash" data-act="finance" aria-label="Finance"><b data-live="cash">${money(cash)}</b><small data-live="date">${MONTHS[month]} ${year}</small></button>
        <div class="clock">
          <div class="speed"><i class="thumb"></i>
            ${btn('speed:0', ICON.pause, 'Pause')}${btn('speed:1', ICON.play, 'Play')}${btn('speed:2', ICON.fast, 'Fast')}${btn('speed:4', ICON.faster, 'Fastest')}
          </div>
          ${btn('layers', ICON.layers, 'Map layers')}
        </div>`;
    });
    const speedIdx = [0, 1, 2, 4].indexOf(s.speed);
    const sp = this.top.querySelector<HTMLElement>('.speed')!;
    if (sp.style.getPropertyValue('--i') !== String(speedIdx)) sp.style.setProperty('--i', String(speedIdx));
    sp.classList.toggle('paused', s.speed === 0);
    this.top.querySelectorAll<HTMLElement>('.speed .icon-btn').forEach((b, i) => b.classList.toggle('on', i === speedIdx));
    this.top.querySelector('[data-act="layers"]')!.classList.toggle('on', s.layer !== 'lines' || this.layersOpen);
    this.patch(this.top, { cash: { text: money(this.shownCash), bad: cash < 0 }, date: { text: `${MONTHS[month]} ${year}` } });

    this.set(this.bar, 'bar', 'static', () => {
      const tools = TOOLS.map((t) => `<button class="tool" data-act="tool:${t.tool}">${t.icon}<span>${t.label}</span></button>`).join('');
      return `<div class="tools"><i class="thumb"></i>${tools}</div><span class="sep"></span>
        <button class="tool" data-act="lines">${ICON.lines}<span>Lines</span></button>
        <button class="tool" data-act="menu">${ICON.menu}<span>Menu</span></button>`;
    });
    const toolIdx = TOOLS.findIndex((t) => t.tool === s.tool);
    const tl = this.bar.querySelector<HTMLElement>('.tools')!;
    if (tl.style.getPropertyValue('--i') !== String(toolIdx)) tl.style.setProperty('--i', String(toolIdx));
    tl.querySelectorAll<HTMLElement>('.tool').forEach((b, i) => b.classList.toggle('on', i === toolIdx));
    const k = this.sheet?.kind;
    const inLines = k === 'lines' || k === 'line' || k === 'buy';
    this.bar.querySelector('[data-act="lines"]')!.classList.toggle('on', inLines);
    this.bar.querySelector('[data-act="menu"]')!.classList.toggle('on', !inLines && !!k);

    this.set(this.popEl, 'pop', `${this.layersOpen}|${s.layer}`, () =>
      this.layersOpen
        ? `<div class="pop" role="menu">${LAYERS.map(
            (l) => `<button class="pop-row${l.layer === s.layer ? ' on' : ''}" data-act="layer:${l.layer}"><b>${l.label}</b><small>${l.hint}</small></button>`,
          ).join('')}</div>`
        : '',
    );

    if (this.dirty || now - this.lastRefresh >= REFRESH_MS) {
      this.lastRefresh = now;
      this.renderSheet(w);
    }
    this.renderOverlay(w, s);
  }

  private renderSheet(w: World): void {
    const sh = this.sheet;
    const view = sh ? this.view(w, sh) : null;
    if (sh && !view) {
      // The thing this sheet showed is gone (deleted line, sold vehicle): step back.
      this.stack.pop();
      this.changed();
      return;
    }
    const key = view ? `${this.stack.length}|${view.key}` : 'none';
    const stale = this.keys.get('sheet') !== key;
    if (stale && (!this.touching || this.dirty)) {
      const body = this.sheetEl.querySelector('.sheet-body');
      const sameSheet = this.keys.get('sheet-id') === (sh ? sheetId(sh) : '');
      const scroll = sameSheet && body ? body.scrollTop : 0;
      const depth = Number(this.keys.get('sheet-depth') ?? 0);
      this.keys.set('sheet', key);
      this.keys.set('sheet-id', sh ? sheetId(sh) : '');
      this.keys.set('sheet-depth', String(this.stack.length));
      clearTimeout(this.leaveTimer);
      if (!view) {
        // Slide the old sheet out before removing it.
        const old = this.sheetEl.querySelector('.sheet');
        if (old) {
          old.classList.add('leave');
          this.leaveTimer = window.setTimeout(() => (this.sheetEl.innerHTML = ''), 200);
        }
      } else {
        // A new sheet springs up; moving through the back stack slides sideways; a refresh does not move.
        const motion = sameSheet ? '' : !depth || !this.sheetEl.querySelector('.sheet:not(.leave)') ? ' enter' : this.stack.length > depth ? ' enter-fwd' : this.stack.length < depth ? ' enter-back' : ' enter-swap';
        this.sheetEl.innerHTML = this.frame(view, motion);
      }
      const fresh = this.sheetEl.querySelector('.sheet-body');
      if (fresh) fresh.scrollTop = scroll;
    }
    this.dirty = false;
    if (view) this.patch(this.sheetEl, view.live);
  }

  private frame(v: View, motion = ''): string {
    const back = this.stack.length > 1 ? `<button class="close" data-act="back" aria-label="Back">${ICON.back}</button>` : '';
    return `<div class="sheet${motion}" role="dialog">
      <div class="grip"></div>
      <div class="sheet-head">${back}<div class="grow"><h2>${v.title}</h2><p>${v.sub}</p></div>
      <button class="close" data-act="close" aria-label="Close">${ICON.close}</button></div>
      <div class="sheet-body">${v.body}</div>
    </div>`;
  }

  // ---------- sheets ----------

  private view(w: World, sh: Sheet): View | null {
    switch (sh.kind) {
      case 'menu':
        return this.menuView(w);
      case 'stop':
        return this.stopView(w, sh.id);
      case 'line':
        return this.lineView(w, sh.id, !!sh.confirmDelete);
      case 'buy':
        return this.buyView(w, sh.line, sh.carries);
      case 'lines':
        return this.linesView(w);
      case 'vehicles':
        return this.vehiclesView(w);
      case 'vehicle':
        return this.vehicleView(w, sh.id);
      case 'towns':
        return this.townsView(w);
      case 'town':
        return this.townView(w, sh.id);
      case 'industries':
        return this.industriesView(w);
      case 'industry':
        return this.industryView(w, sh.id);
      case 'finance':
        return this.financeView(w, sh.tab);
      case 'news':
        return this.newsView(w);
    }
  }

  private menuView(w: World): View {
    const lossy = w.lines.filter((l) => l.profitLast < 0).length;
    const tile = (go: string, title: string, sub: string, icon: string) =>
      `<button class="tile" data-act="${go}"><span class="tile-icon">${icon}</span><b>${title}</b><small>${sub}</small></button>`;
    return {
      key: `menu|${w.lines.length}|${w.vehicles.length}|${w.news.length}|${lossy}|${this.graphics}`,
      title: 'Menu',
      sub: 'Your company at a glance',
      body: `<div class="tiles">
        ${tile('go:finance', 'Finance', `Value ${money(w.companyValue())}`, ICON.finance)}
        ${tile('go:lines', 'Lines', `${plural(w.lines.length, 'line')}${lossy ? ` · ${lossy} losing money` : ''}`, ICON.lines)}
        ${tile('go:vehicles', 'Vehicles', plural(w.vehicles.length, 'vehicle'), ICON.vehicles)}
        ${tile('go:towns', 'Towns', `${round(w.towns.reduce((n, t) => n + t.pop, 0))} people`, ICON.towns)}
        ${tile('go:industries', 'Industries', `${w.industries.length} sites`, ICON.industries)}
        ${tile('go:news', 'News', w.news.length ? w.news[w.news.length - 1].text : 'Nothing yet', ICON.news)}
        ${tile('help', 'How to play', 'Six short pages', ICON.help)}
      </div>
      <h3>Settings</h3>
      <button class="switch${this.graphics ? ' on' : ''}" data-act="gfx" role="switch" aria-checked="${this.graphics}">
        <span class="grow">High graphics<small>Smoke, clouds, glints, glow and frosted panels. Turn off on slower phones.</small></span><i></i>
      </button>`,
      live: {},
    };
  }

  private stopView(w: World, id: number): View | null {
    const st = w.stopById(id);
    if (!st) return null;
    const lines = w.linesAt(st.id);
    const inds = w.industriesAt(st);
    const by = w.waitingBy(st);
    const kinds = Object.keys(by) as Freight[];
    const cap = CONFIG.stop[st.mode].capacity;
    const total = w.waitingTotal(st);
    const town = st.town >= 0 ? w.towns[st.town].name : 'Countryside';
    const live: Record<string, Live> = { wait: { text: `${round(total)} / ${cap}`, bad: total >= cap * 0.9 }, res: { text: round(st.residents) } };
    for (const f of kinds) live[`w-${f}`] = { text: round(by[f]!) };
    return {
      key: `stop|${id}|${kinds.join()}|${lines.map((l) => l.id).join()}|${inds.length}|${st.town}`,
      title: st.name,
      sub: `${st.mode === 'rail' ? 'Station' : 'Road stop'} · ${town}`,
      body: `<div class="stats">
          ${stat('Waiting', lv('wait', live.wait))}
          ${stat('Residents in reach', lv('res', live.res))}
        </div>
        ${kinds.length ? `<div class="rows">${kinds.map((f) => `<div class="row"><span class="grow">${FREIGHT_LABEL(f)}</span>${lv(`w-${f}`, live[`w-${f}`])}</div>`).join('')}</div>` : '<p class="hint">Nobody is waiting.</p>'}
        ${inds.length ? `<h3>Industries in reach</h3><div class="list">${inds.map((i) => `<button class="list-row" data-act="open-industry:${i.id}"><span class="dot" style="background:${THEME.cargo[i.produces]}"></span><span class="grow">${i.name}<small>${INDUSTRY[i.kind].label}</small></span></button>`).join('')}</div>` : ''}
        <h3>Lines</h3>
        ${lines.length ? `<div class="list">${lines.map((l) => this.lineRow(w, l)).join('')}</div>` : `<p class="hint">No line stops here yet. With Select, drag from this ${st.mode === 'rail' ? 'station to another station' : 'stop to another road stop'}.</p>`}
        ${lines.length === 0 ? `<button class="ghost danger" data-act="demolish:${st.id}">Demolish</button>` : ''}`,
      live,
    };
  }

  private lineView(w: World, id: number, confirmDelete: boolean): View | null {
    const l = w.lineById(id);
    if (!l) return null;
    const vs = w.vehiclesOn(l.id);
    const len = l.segs.reduce((n, s) => n + s.length, 0);
    const onBoard = vs.reduce((n, v) => n + loadOf(v), 0);
    const room = vs.reduce((n, v) => n + v.type.capacity, 0);
    const renew = vs.map((v) => ({ v, ...w.renewal(v) })).filter((r) => r.model.key !== r.v.type.key || w.ageYears(r.v) >= 1);
    const renewCost = renew.reduce((n, r) => n + r.cost, 0);
    const live: Record<string, Live> = {
      profit: { text: money(l.profitLast), bad: l.profitLast < 0 },
      carried: { text: round(l.carriedLast) },
      board: { text: `${round(onBoard)} / ${round(room)}` },
      month: { text: money(l.revenueMonth - l.costMonth), bad: l.revenueMonth < l.costMonth },
    };
    for (const v of vs) live[`load-${v.id}`] = { text: pct(loadOf(v) / v.type.capacity) };
    const fleetKey = vs.map((v) => v.type.key).join();
    return {
      key: `line|${id}|${fleetKey}|${l.stops.join()}|${l.fullLoad}|${confirmDelete}|${w.month}|${renew.length}`,
      title: `<span class="dot" style="background:${THEME.lines[l.color]}"></span>${l.name}`,
      sub: `${l.mode === 'rail' ? 'Rail' : 'Road'} line · ${l.stops.length} stops · ${(len / 1000).toFixed(1)} km${l.loop ? ' · loop' : ''}`,
      body: `<div class="stats">
          ${stat('Profit last month', lv('profit', live.profit))}
          ${stat('This month so far', lv('month', live.month))}
          ${stat('Carried last month', lv('carried', live.carried))}
          ${stat('On board now', lv('board', live.board))}
        </div>
        <h3>Profit, last ${l.history.length} months</h3>
        ${chart(l.history, { bars: true, color: THEME.lines[l.color] })}
        <h3>Vehicles</h3>
        ${this.fleetRow(w, l, 'pax')}
        ${this.fleetRow(w, l, 'cargo')}
        ${vs.length ? `<div class="list">${vs.map((v) => this.vehicleRow(w, v, false)).join('')}</div>` : '<p class="hint">Buy a vehicle to start service.</p>'}
        <h3>Options</h3>
        <button class="switch${l.fullLoad ? ' on' : ''}" data-act="full-load:${l.id}" role="switch" aria-checked="${l.fullLoad}">
          <span class="grow"><b>Full load at the first stop</b><small>Vehicles wait at ${w.stopById(l.stops[0])?.name ?? 'the first stop'} until full, up to a month. Best for freight.</small></span><i></i>
        </button>
        <button class="ghost" data-act="renew:${l.id}" ${renew.length ? '' : 'disabled'}>${
          renew.length ? `Renew ${plural(renew.length, 'vehicle')} · ${money(renewCost)}` : 'All vehicles are new'
        }</button>
        <p class="hint">Renewing replaces vehicles a year old or more, or of an older model, with the newest model, selling the old ones.</p>
        <h3>Stops</h3>
        <div class="list">${l.stops.map((sid, i) => `<button class="list-row" data-act="open-stop:${sid}"><span class="num">${i + 1}</span><span class="grow">${w.stopById(sid)?.name ?? '?'}</span></button>`).join('')}</div>
        <button class="ghost danger" data-act="delete-line:${l.id}">${confirmDelete ? 'Tap again to delete' : 'Delete line'}</button>`,
      live,
    };
  }

  private fleetRow(w: World, l: Line, carries: Carries): string {
    const vs = w.vehiclesOn(l.id, carries);
    const label = l.mode === 'rail' ? (carries === 'pax' ? 'Passenger trains' : 'Freight trains') : carries === 'pax' ? 'Buses' : 'Trucks';
    const count = new Map<string, number>();
    for (const v of vs) count.set(v.type.name, (count.get(v.type.name) ?? 0) + 1);
    const desc = [...count].map(([name, k]) => `${k} × ${name}`).join(', ') || 'None';
    return `<div class="fleet">
      <span class="grow">${label}<small>${desc}</small></span>
      <button class="ghost step" data-act="sell:${l.id}.${carries}" aria-label="Sell one" ${vs.length ? '' : 'disabled'}>−</button>
      <button class="primary buy" data-act="buy-pick:${l.id}.${carries}">Buy…</button>
    </div>`;
  }

  private buyView(w: World, lineId: number, carries: Carries): View | null {
    const l = w.lineById(lineId);
    if (!l) return null;
    const year = w.date().year;
    const all = modelsFor(l.mode, carries);
    const have = w.vehiclesOn(l.id, carries).length;
    const cash = w.econ.cash;
    const rows = [...all].reverse().map((m) => {
      const ok = m.year <= year;
      return `<div class="model${ok ? '' : ' locked'}">
        <span class="swatch" style="background:${m.livery}"></span>
        <span class="grow"><b>${m.name}</b><small>${m.speed} km/h · ${m.capacity} ${carries === 'pax' ? 'seats' : 'units'} · ${money(m.runningPerMonth)}/month${ok ? '' : ` · from ${m.year}`}</small></span>
        ${ok ? `<button class="primary buy" data-act="buy:${l.id}.${m.key}" ${cash >= m.price && w.vehiclesOn(l.id).length < CONFIG.maxVehiclesPerLine ? '' : 'disabled'}>${money(m.price)}</button>` : ''}
      </div>`;
    });
    return {
      key: `buy|${lineId}|${carries}|${year}|${have}|${Math.floor(cash / 5e4)}`,
      title: `Buy ${l.mode === 'rail' ? (carries === 'pax' ? 'a train' : 'a freight train') : carries === 'pax' ? 'a bus' : 'a truck'}`,
      sub: `For ${l.name} · ${have} running`,
      body: `<div class="models">${rows.join('')}</div>
        <p class="hint">Newer models carry more, faster, and cost less to run per seat, but more per vehicle: they pay on busy lines and lose money on quiet ones.</p>`,
      live: {},
    };
  }

  private lineRow(w: World, l: Line): string {
    const n = w.vehiclesOn(l.id).length;
    return `<button class="list-row" data-act="open-line:${l.id}">
      <span class="dot" style="background:${THEME.lines[l.color]}"></span>
      <span class="grow">${l.name}<small>${plural(n, 'vehicle')}${n === 0 ? ' · needs a vehicle' : ''} · ${round(l.carriedLast)} carried</small></span>
      <span class="${l.profitLast < 0 ? 'neg' : ''}">${money(l.profitLast)}</span>
    </button>`;
  }

  private linesView(w: World): View {
    const total = w.lines.reduce((n, l) => n + l.profitLast, 0);
    return {
      key: `lines|${w.month}|${w.lines.map((l) => `${l.id}:${w.vehiclesOn(l.id).length}`).join()}`,
      title: 'Lines',
      sub: `${plural(w.lines.length, 'line')} · ${plural(w.vehicles.length, 'vehicle')} · ${money(total)} last month`,
      body: w.lines.length
        ? `<div class="list">${w.lines.map((l) => this.lineRow(w, l)).join('')}</div>`
        : '<p class="hint">No lines yet. Build two stations, then drag from one to the other with Select.</p>',
      live: {},
    };
  }

  private vehicleRow(w: World, v: Vehicle, showLine: boolean): string {
    const line = w.lineById(v.line);
    return `<button class="list-row" data-act="open-vehicle:${v.id}">
      <span class="swatch" style="background:${v.type.livery}"></span>
      <span class="grow">${v.type.name}<small>${showLine && line ? `${line.name} · ` : ''}${w.ageYears(v).toFixed(1)} years · ${money(w.runningCost(v))}/month</small></span>
      ${lv(`load-${v.id}`, { text: pct(loadOf(v) / v.type.capacity) })}
    </button>`;
  }

  private vehiclesView(w: World): View {
    const live: Record<string, Live> = {};
    for (const v of w.vehicles) live[`load-${v.id}`] = { text: pct(loadOf(v) / v.type.capacity) };
    const byLine = [...w.vehicles].sort((a, b) => a.line - b.line || a.id - b.id);
    return {
      key: `vehicles|${w.month}|${w.vehicles.map((v) => `${v.id}${v.type.key}`).join()}`,
      title: 'Vehicles',
      sub: `${plural(w.vehicles.length, 'vehicle')} · ${money(w.vehicles.reduce((n, v) => n + w.runningCost(v), 0))} a month to run`,
      body: w.vehicles.length
        ? `<div class="list">${byLine.map((v) => this.vehicleRow(w, v, true)).join('')}</div><p class="hint">The right column shows how full each vehicle is now.</p>`
        : '<p class="hint">No vehicles yet. Open a line to buy one.</p>',
      live,
    };
  }

  private vehicleView(w: World, id: number): View | null {
    const v = w.vehicles.find((x) => x.id === id);
    if (!v) return null;
    const line = w.lineById(v.line);
    const { model, cost } = w.renewal(v);
    const by = new Map<Freight, number>();
    for (const g of v.load) by.set(g.what, (by.get(g.what) ?? 0) + g.n);
    const live: Record<string, Live> = {
      load: { text: `${round(loadOf(v))} / ${v.type.capacity}` },
      where: { text: `${v.state === 'dwelling' ? 'At' : 'To'} ${w.stopById(v.state === 'dwelling' ? (v.dockedAt ?? v.toStation) : v.toStation)?.name ?? '?'}` },
      speed: { text: `${Math.round(v.speed)} km/h` },
    };
    return {
      key: `vehicle|${id}|${v.type.key}|${w.month}|${[...by.keys()].join()}`,
      title: v.type.name,
      sub: `${KIND_NAME[v.type.kind]} on ${line?.name ?? 'no line'} · built ${CONFIG.startYear + Math.floor(v.bornAt / CONFIG.monthSeconds / 12)}`,
      body: `<div class="stats">
          ${stat('Load', lv('load', live.load))}
          ${stat('Heading', lv('where', live.where))}
          ${stat('Speed', lv('speed', live.speed))}
          ${stat('Age', static_(`${w.ageYears(v).toFixed(1)} years`))}
          ${stat('Running / month', static_(money(w.runningCost(v))))}
          ${stat('Resale value', static_(money(w.saleValue(v))))}
        </div>
        ${by.size ? `<div class="rows">${[...by].map(([f, k]) => `<div class="row"><span class="grow">${FREIGHT_LABEL(f)}</span><b>${round(k)}</b></div>`).join('')}</div>` : '<p class="hint">Empty right now.</p>'}
        <div class="row-actions">
          <button class="primary" data-act="follow:${v.id}">Follow</button>
          ${line ? `<button class="ghost" data-act="open-line:${line.id}">Open line</button>` : ''}
        </div>
        <p class="hint">Renewing now would bring a new ${model.name} for ${money(cost)}. Use Renew on the line to renew its fleet.</p>
        <button class="ghost danger" data-act="sell-vehicle:${v.id}">Sell for ${money(w.saleValue(v))}</button>`,
      live,
    };
  }

  private townsView(w: World): View {
    const towns = [...w.towns].sort((a, b) => b.pop - a.pop);
    return {
      key: `towns|${w.month}`,
      title: 'Towns',
      sub: `${round(w.towns.reduce((n, t) => n + t.pop, 0))} people · ${pct(w.coverage())} reach a stop`,
      body: `<div class="list">${towns
        .map(
          (t) => `<button class="list-row" data-act="open-town:${t.id}"><span class="grow">${t.name}<small>${round(t.tripsLast)} trips · ${round(t.supplyLast)} deliveries last month</small></span><span>${round(t.pop)}<small class="up">+${round(t.growthLast)}</small></span></button>`,
        )
        .join('')}</div>`,
      live: {},
    };
  }

  private townView(w: World, id: number): View | null {
    const t = w.towns[id];
    if (!t) return null;
    const g = CONFIG.growth;
    const mine = w.houses.filter((h) => h.town === t.id);
    const covered = mine.reduce((n, h) => n + (h.stop >= 0 ? h.residents : 0), 0) / Math.max(1, t.pop);
    const activity = Math.min(1, t.tripsLast / Math.max(1, t.pop * g.tripsPerResident));
    const supply = Math.min(1, t.supplyLast / Math.max(1, t.pop * g.supplyPerResident));
    return {
      key: `town|${id}|${w.month}`,
      title: t.name,
      sub: `${round(t.pop)} people · room to grow to about ${round(t.basePop * g.capFactor)}`,
      body: `<div class="stats">
          ${stat('Reach a stop', static_(pct(covered)))}
          ${stat('Trips last month', static_(round(t.tripsLast)))}
          ${stat('Growth last month', static_(`+${round(t.growthLast)}`))}
        </div>
        <h3>Population, last ${t.history.length} months</h3>
        ${chart(t.history, { color: THEME.label, count: true })}
        <h3>What makes it grow</h3>
        ${meter('Passenger service', activity)}
        ${meter('Deliveries', supply)}
        <div class="rows">${TOWN_CARGO.map((c) => `<div class="row"><span class="dot" style="background:${THEME.cargo[c]}"></span><span class="grow">${CARGO_LABEL[c]} last month</span><b>${round(t.supplyLastBy[c] ?? 0)}</b></div>`).join('')}</div>
        <p class="hint">Bring ${TOWN_CARGO.map((c) => CARGO_LABEL[c].toLowerCase()).join(', ')} to any stop in town, and carry its people: both bars full means the fastest growth.</p>`,
      live: {},
    };
  }

  private industriesView(w: World): View {
    return {
      key: `industries|${w.month}`,
      title: 'Industries',
      sub: 'Farms, forests and the oil well feed the factories',
      body: `<div class="list">${w.industries
        .map((i) => {
          const out = i.accepts ? i.receivedLast : i.rate;
          const shipped = i.producedLast > 0 ? pct(i.shippedLast / i.producedLast) : '·';
          return `<button class="list-row" data-act="open-industry:${i.id}"><span class="dot" style="background:${THEME.cargo[i.produces]}"></span><span class="grow">${i.name}<small>${INDUSTRY[i.kind].label} · ${CARGO_LABEL[i.produces]} ${round(out)}/month</small></span><span>${shipped}<small>shipped</small></span></button>`;
        })
        .join('')}</div>`,
      live: {},
    };
  }

  private industryView(w: World, id: number): View | null {
    const ind = w.industries[id];
    if (!ind) return null;
    const route = w.cargoRoute(ind);
    const out = ind.accepts ? ind.receivedLast : ind.rate;
    const takers = w.industries.filter((i) => i.accepts === ind.produces).map((i) => i.name);
    if (TOWN_CARGO.includes(ind.produces)) takers.push('a stop in any town');
    const routeText = route
      ? `Ships ${CARGO_LABEL[ind.produces].toLowerCase()} from <b>${w.stopById(route.stop)!.name}</b> to <b>${w.stopById(route.dest)!.name}</b>.`
      : `No route yet. Build a station or road stop inside the dashed ring, then a line with freight vehicles to ${takers.join(' or ')}.`;
    return {
      key: `industry|${id}|${w.month}|${route?.stop}|${route?.dest}`,
      title: ind.name,
      sub: INDUSTRY[ind.kind].label,
      body: `<div class="stats">
          ${stat(`${CARGO_LABEL[ind.produces]} / month`, static_(round(out)))}
          ${stat('Shipped', static_(ind.producedLast > 0 ? pct(ind.shippedLast / ind.producedLast) : '·'))}
          ${ind.accepts ? stat(`${CARGO_LABEL[ind.accepts]} in`, static_(round(ind.receivedLast))) : ''}
        </div>
        <h3>Output, last ${ind.history.length} months</h3>
        ${chart(ind.history, { bars: true, color: THEME.cargo[ind.produces], count: true })}
        <p class="hint">${
          ind.accepts
            ? `Turns ${CARGO_LABEL[ind.accepts].toLowerCase()} into ${CARGO_LABEL[ind.produces].toLowerCase()}: what arrives one month leaves the next.`
            : 'Produces more when most of its output is shipped, and less when it piles up.'
        }</p>
        <p class="hint">${routeText}</p>`,
      live: {},
    };
  }

  private financeView(w: World, tab: FinanceTab): View {
    const e = w.econ;
    const tabs = (['overview', 'statement', 'loans'] as FinanceTab[])
      .map((t) => `<button class="seg${t === tab ? ' on' : ''}" data-act="tab:${t}">${{ overview: 'Overview', statement: 'Statement', loans: 'Loans & prices' }[t]}</button>`)
      .join('');
    const live: Record<string, Live> = {
      cash: { text: money(e.cash), bad: e.cash < 0 },
      value: { text: money(w.companyValue()) },
      loan: { text: `${money(e.loan)} of ${money(CONFIG.maxLoan)}` },
      monthNet: { text: money(Economy.net(e.month)), bad: Economy.net(e.month) < 0 },
    };
    let body = '';
    let key = `finance|${tab}|${w.month}`;
    if (tab === 'overview') {
      body = `<div class="stats">
          ${stat('Cash', lv('cash', live.cash))}
          ${stat('Company value', lv('value', live.value))}
          ${stat('This month so far', lv('monthNet', live.monthNet))}
          ${stat('Last month', static_(money(Economy.net(e.last)), Economy.net(e.last) < 0))}
        </div>
        <h3>Cash, last ${e.history.length} months</h3>
        ${chart(e.history.map((h) => h.cash), { color: '#f2a43a' })}
        <h3>Operating profit each month</h3>
        ${chart(e.history.map((h) => h.operating), { bars: true, color: '#5fb86c' })}
        <p class="hint">Income less running costs, before building and buying vehicles.</p>
        <p class="hint">${round(w.delivered)} passengers and ${round(w.deliveredCargo)} cargo delivered · ${pct(w.coverage())} of residents reach a stop.</p>`;
    } else if (tab === 'statement') {
      const rows: [string, keyof Ledger][] = [
        ['Fares', 'fares'],
        ['Freight', 'freight'],
        ['Vehicle running', 'running'],
        ['Track, roads, stops', 'maintenance'],
        ['Loan interest', 'interest'],
        ['Construction', 'construction'],
        ['Vehicles bought', 'vehicles'],
      ];
      const cell = (n: number) => `<td class="${n < 0 ? 'neg' : ''}">${n === 0 ? '·' : money(n)}</td>`;
      const { year } = w.date();
      body = `<table class="ledger wide">
          <thead><tr><th></th><th>Last month</th><th>${year}</th><th>${year - 1}</th></tr></thead>
          <tbody>${rows.map(([label, k]) => `<tr><th>${label}</th>${cell(e.last[k])}${cell(e.year[k])}${cell(e.lastYear[k])}</tr>`).join('')}</tbody>
          <tfoot><tr class="total"><th>Net</th>${cell(Economy.net(e.last))}${cell(Economy.net(e.year))}${cell(Economy.net(e.lastYear))}</tr></tfoot>
        </table>
        <p class="hint">${year} runs to the end of last month. Vehicles bought includes sales and renewals.</p>`;
    } else {
      key += `|${e.loan}|${e.price.rail}|${e.price.road}|${Math.round(e.cash / 1e5)}`;
      body = `<div class="stats">
          ${stat('Cash', lv('cash', live.cash))}
          ${stat('Loan', lv('loan', live.loan))}
        </div>
        <div class="row-actions">
          <button class="primary" data-act="borrow" ${e.loan < CONFIG.maxLoan ? '' : 'disabled'}>Borrow ${money(CONFIG.loanStep)}</button>
          <button class="ghost" data-act="repay" ${e.loan > 0 && e.cash > 0 ? '' : 'disabled'}>Repay ${money(CONFIG.loanStep)}</button>
        </div>
        <p class="hint">Interest is ${Math.round(CONFIG.interestPerYear * 100)}% a year, charged monthly: ${money((e.loan * CONFIG.interestPerYear) / 12)} a month now.</p>
        <h3>Ticket prices</h3>
        ${priceRow(w, 'rail')}
        ${priceRow(w, 'road')}
        <p class="hint">Dearer tickets earn more per rider, but fewer people travel and towns grow slower. Freight rates are fixed.</p>`;
    }
    return { key, title: 'Finance', sub: `${MONTHS[w.date().month]} ${w.date().year}`, body: `<div class="segs">${tabs}</div>${body}`, live };
  }

  private newsView(w: World): View {
    const items = [...w.news].reverse();
    return {
      key: `news|${w.news.length}|${items[0]?.text}`,
      title: 'News',
      sub: 'What happened in the valley',
      body: items.length
        ? `<div class="list">${items
            .map((n) => {
              const y = CONFIG.startYear + Math.floor(n.month / 12);
              return `<div class="news ${n.tone}"><small>${MONTHS[n.month % 12]} ${y}</small><span>${n.text}</span></div>`;
            })
            .join('')}</div>`
        : '<p class="hint">Nothing yet. Towns passing milestones, new vehicle models and changes at industries appear here.</p>',
      live: {},
    };
  }

  // ---------- overlays ----------

  private renderOverlay(w: World, s: HudState): void {
    let key = 'none';
    if (this.help !== null) key = `help:${this.help}`;
    else if (!s.started) key = `start:${s.saved}`;
    else if (w.over) key = `over:${Math.round(w.delivered)}`;
    const kind = key.split(':')[0];
    // The backdrop fades in only when an overlay first appears, not on each help page.
    const enter = kind !== this.overlayKind ? ' enter' : '';
    this.set(this.overlay, 'overlay', key, () => {
      this.overlayKind = kind;
      if (this.help !== null) return this.helpCard(enter);
      if (!s.started)
        return `<div class="overlay title${enter}"><div class="card">
          <div class="logo" aria-hidden="true"><i></i><i></i><i></i></div>
          <h1>Small <span>Transit</span></h1>
          <div class="tagline">Rail · Road · 1950 to 1990</div>
          <p>Run a transport company in a river valley. Carry passengers between six towns and freight from farms, forests and an oil well, and stay in the black.</p>
          <div class="actions">${
            s.saved
              ? '<button class="primary" data-act="resume">Continue</button><button class="ghost" data-act="start">New company</button>'
              : '<button class="primary" data-act="start">New company</button>'
          }<button class="ghost" data-act="help">How to play</button></div>
          ${s.saved ? '<p class="hint">Your company is saved every month and when you leave. A new company replaces it.</p>' : ''}
        </div></div>`;
      if (w.over) {
        const { year, month } = w.date();
        return `<div class="overlay${enter}"><div class="card bankrupt">
          <h2>Bankrupt</h2>
          <p>Your company closed in ${MONTHS[month]} ${year} after carrying ${round(w.delivered)} passengers and ${round(w.deliveredCargo)} cargo.</p>
          <div class="actions"><button class="primary" data-act="start">Start again</button></div>
        </div></div>`;
      }
      return '';
    });
  }

  private helpCard(enter: string): string {
    const page = this.help!;
    const h = HELP[page];
    const last = page === HELP.length - 1;
    const dots = HELP.map((_, i) => `<button class="dot-btn${i === page ? ' on' : ''}" data-act="help-go:${i}" aria-label="Page ${i + 1}"></button>`).join('');
    return `<div class="overlay${enter}"><div class="card help" role="dialog" aria-label="How to play">
      <button class="close" data-act="help-close" aria-label="Close">${ICON.close}</button>
      <div class="help-page">
        <div class="step">${page + 1} of ${HELP.length}</div>
        <h2>${h.title}</h2>
        <p>${h.text}</p>
      </div>
      <div class="help-nav">
        <button class="ghost" data-act="help-go:${page - 1}" ${page === 0 ? 'disabled' : ''}>Back</button>
        <div class="dots">${dots}</div>
        <button class="primary" data-act="${last ? 'help-close' : `help-go:${page + 1}`}">${last ? 'Play' : 'Next'}</button>
      </div>
    </div></div>`;
  }
}

/** Identity of a sheet, ignoring view state, to keep scroll position across rebuilds of the same sheet. */
function sheetId(s: Sheet): string {
  return 'id' in s ? `${s.kind}:${s.id}` : s.kind === 'buy' ? `buy:${s.line}:${s.carries}` : s.kind;
}

/** A small line or bar chart as inline SVG, with its range on the right. */
function chart(values: number[], opts: { color: string; bars?: boolean; count?: boolean }): string {
  if (values.length < 2) return '<p class="hint">Not enough history yet. Check back after a few months.</p>';
  const W = 300;
  const H = 72;
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const y = (x: number) => H - ((x - min) / span) * H;
  let marks = '';
  if (opts.bars) {
    const step = W / values.length;
    marks = values
      .map((x, i) => {
        const top = Math.min(y(x), y(0));
        const h = Math.max(0.5, Math.abs(y(x) - y(0)));
        return `<rect x="${(i * step + 1).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, step - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${x < 0 ? '#ff7a63' : opts.color}"/>`;
      })
      .join('');
  } else {
    const pts = values.map((x, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${y(x).toFixed(1)}`).join(' ');
    marks = `<polygon points="0,${y(0)} ${pts} ${W},${y(0)}" fill="${opts.color}" opacity="0.15"/><polyline points="${pts}" fill="none" stroke="${opts.color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  }
  const zero = min < 0 ? `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="rgba(255,255,255,.35)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : '';
  const fmt = (n: number) => (opts.count ? round(n) : money(n));
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${marks}${zero}</svg><span class="chart-max">${fmt(max)}</span><span class="chart-min">${fmt(min)}</span></div>`;
}

const meter = (label: string, x: number) =>
  `<div class="meter"><span class="grow">${label}</span><span class="bar-track"><i style="width:${Math.round(Math.min(1, x) * 100)}%"></i></span><b>${pct(Math.min(1, x))}</b></div>`;

const priceRow = (w: World, mode: Mode) => {
  const level = w.econ.price[mode];
  const { min, max } = CONFIG.price;
  const km = mode === 'rail' ? 2 : 0.5;
  return `<div class="price-row">
    <span class="grow">${mode === 'rail' ? 'Rail' : 'Road'}<small>${km} km trip ${money(w.ticket(mode, km * 1000))} · demand ${Math.round(w.econ.demand(mode) * 100)}%</small></span>
    <button class="ghost step" data-act="price:${mode}-" aria-label="Lower ${mode} prices" ${level <= min + 1e-9 ? 'disabled' : ''}>−</button>
    <b>${Math.round(level * 100)}%</b>
    <button class="ghost step" data-act="price:${mode}+" aria-label="Raise ${mode} prices" ${level >= max - 1e-9 ? 'disabled' : ''}>+</button>
  </div>`;
};

