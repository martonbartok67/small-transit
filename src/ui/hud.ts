import type { Layer } from '../render/renderer';
import { CONFIG } from '../sim/config';
import { Economy } from '../sim/economy';
import type { Carries, CompanyUpgrade, Mode, StopUpgrade } from '../sim/types';
import { money, type World } from '../sim/world';
import { marker, plural, round, type Live } from './components';
import type { Tool } from './editor';
import { ICON } from './icons';
import { isPage, MONTHS, sheetId, view, type CompanyTab, type LineFilter, type Sheet, type View, type WorldTab } from './views';

export { MONTHS, type Sheet };

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const NAV: { act: string; label: string; icon: string; root: Sheet['kind'] }[] = [
  { act: 'nav:lines', label: 'Lines', icon: ICON.navLines, root: 'lines' },
  { act: 'nav:vehicles', label: 'Fleet', icon: ICON.navFleet, root: 'vehicles' },
  { act: 'nav:world', label: 'World', icon: ICON.navWorld, root: 'world' },
  { act: 'nav:company', label: 'Company', icon: ICON.navCompany, root: 'company' },
];

const BUILD: { tool: Tool; label: string; icon: string; price?: Mode }[] = [
  { tool: 'rail', label: 'Station', icon: ICON.train, price: 'rail' },
  { tool: 'road', label: 'Road stop', icon: ICON.bus, price: 'road' },
  { tool: 'bulldoze', label: 'Demolish', icon: ICON.demolish },
];

export const LAYERS: { layer: Layer; label: string; hint: string; swatch: string }[] = [
  { layer: 'lines', label: 'Lines', hint: 'Line colours over the map', swatch: 'linear-gradient(135deg,#e2231a 0 33%,#0072ce 33% 66%,#00a651 66%)' },
  { layer: 'plain', label: 'Plain', hint: 'Just the landscape and vehicles', swatch: '#dfe7d4' },
  { layer: 'coverage', label: 'Coverage', hint: 'Which houses reach a stop', swatch: 'linear-gradient(135deg,#0a8f4e 0 50%,#d7263d 50%)' },
  { layer: 'cargo', label: 'Cargo', hint: 'Where each industry ships', swatch: 'linear-gradient(135deg,#f0cc4a 0 50%,#9a6532 50%)' },
];

const HELP: { title: string; text: string; icon: string; color: string }[] = [
  {
    title: 'Your transport company',
    icon: ICON.navCompany,
    color: '#0072ce',
    text: 'Six towns need passenger service, and farms, forests and an oil well need their cargo moved. Build stations and road stops, join them into lines, and buy vehicles. Every line shows what it earns.',
  },
  {
    title: 'Build a line',
    icon: ICON.train,
    color: '#e2231a',
    text: 'Tap Build, pick Station or Road stop and tap the map. Then drag from one stop to another. Track and roads follow the land: rivers need bridges and hills cost more. Country roads and town streets are already built, so road lines along them are almost free.',
  },
  {
    title: 'Vehicles',
    icon: ICON.bus,
    color: '#00a651',
    text: 'Open a line to buy vehicles. Each year brings new models: faster and bigger, but dearer to buy and run. Vehicles cost more to run as they age; renew them from the line. Turn on Full load to make vehicles wait at the first stop until they are full.',
  },
  {
    title: 'Freight',
    icon: ICON.freight,
    color: '#f47920',
    text: 'Farms grow grain for the food plant, forests send logs to the sawmill, and the oil well feeds the refinery. Put a stop inside the dashed ring around an industry, link it to the factory, and buy trucks or freight trains. Factories then send food, goods and fuel to towns.',
  },
  {
    title: 'Towns grow',
    icon: ICON.town,
    color: '#8e3e97',
    text: 'Towns with good passenger service and steady food, goods and fuel grow, up to about four times their size. In Company you can set ticket prices: dearer tickets earn more per rider, but fewer people travel. The layers button at the top shows coverage and cargo flows.',
  },
  {
    title: 'Keep riders happy',
    icon: ICON.navLines,
    color: '#ffc20e',
    text: 'Riders give every passenger line up to five stars for short waits, room on board, comfortable vehicles, a kept timetable and fair fares. More stars bring more riders. Set a timetable on a line to run every few days, and upgrade busy stops and the company when money allows.',
  },
  {
    title: 'Stay solvent',
    icon: ICON.coin,
    color: '#00a0b0',
    text: `If your cash stays below zero for ${CONFIG.bankruptMonths} month-ends in a row, the company goes bankrupt. Borrow from the Bank in Company and repay when you can. Drag empty ground to move the map${COARSE ? ' and pinch to zoom' : ', scroll to zoom'}.`,
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
  collectAway(): void;
}

export interface HudState {
  world: World;
  speed: number;
  tool: Tool;
  layer: Layer;
  started: boolean;
  /** A saved company exists that the title screen can continue. */
  saved: boolean;
  /** High graphics: ambient motion, smoke and glow. */
  graphics: boolean;
}

/** How often panels refresh their numbers, in ms. Structure changes apply on the next refresh. */
const REFRESH_MS = 250;
/** Pixels a drag must travel before the panel snaps to the other height. */
const SNAP = 60;

/**
 * DOM overlay: status board and speed at the top, navigation and Build at the bottom,
 * and one panel that peeks (inspecting something on the map) or fills the screen (pages).
 * Acts on click, so a scroll that starts on a button is not a tap, and never rebuilds
 * the panel while it is being touched.
 */
export class Hud {
  private keys = new Map<string, string>();
  private top: HTMLElement;
  private nav: HTMLElement;
  private tray: HTMLElement;
  private slot: HTMLElement;
  private overlay: HTMLElement;
  private toastEl: HTMLElement;
  private popEl: HTMLElement;
  private toastTimer = 0;
  private help: number | null = null;
  private stack: Sheet[] = [];
  /** Full height, or peeking at the bottom of the map. */
  private expanded = false;
  private layersOpen = false;
  private trayOpen = false;
  private touching = false;
  private releaseTimer = 0;
  private lastRefresh = 0;
  private dirty = true;
  private world!: World;
  private graphics = true;
  private tool: Tool = 'select';
  /** Cash as shown: eases toward the real figure. */
  private shownCash: number | null = null;
  private lastFrame = 0;
  private leaveTimer = 0;
  private overlayKind = '';
  private drag: { y: number; start: number; moved: boolean; t: number } | null = null;
  private draggedAt = 0;
  /** Income waiting to be collected after time away. */
  private away: { hours: number; amount: number } | null = null;

  constructor(
    root: HTMLElement,
    private cb: HudCallbacks,
  ) {
    root.innerHTML =
      '<div class="top"></div><div class="pop-slot"></div><div class="panel-slot"></div><div class="tray"></div><nav class="nav"></nav><div class="overlay-slot"></div><div class="toast"></div>';
    this.top = root.querySelector('.top')!;
    this.nav = root.querySelector('.nav')!;
    this.tray = root.querySelector('.tray')!;
    this.slot = root.querySelector('.panel-slot')!;
    this.overlay = root.querySelector('.overlay-slot')!;
    this.toastEl = root.querySelector('.toast')!;
    this.popEl = root.querySelector('.pop-slot')!;
    root.addEventListener('click', (e) => this.onAct(e));
    // While a finger is on the panel, keep its DOM still so scrolling and taps are never interrupted.
    this.slot.addEventListener('pointerdown', (e) => {
      clearTimeout(this.releaseTimer);
      this.touching = true;
      this.dragStart(e);
    });
    window.addEventListener('pointermove', (e) => this.dragMove(e), { passive: true });
    const release = (e: PointerEvent) => {
      this.dragEnd(e);
      clearTimeout(this.releaseTimer);
      this.releaseTimer = window.setTimeout(() => (this.touching = false), 350);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    // Momentum scrolling continues after the finger lifts: keep holding while it scrolls.
    this.slot.addEventListener(
      'scroll',
      () => {
        this.touching = true;
        clearTimeout(this.releaseTimer);
        this.releaseTimer = window.setTimeout(() => (this.touching = false), 350);
      },
      { capture: true, passive: true },
    );
  }

  // ---------- panel drag: peek <-> full, or down to close ----------

  private get panel(): HTMLElement | null {
    return this.slot.querySelector<HTMLElement>('.panel:not(.leave)');
  }

  private get wide(): boolean {
    return window.innerWidth >= 900;
  }

  private dragStart(e: PointerEvent): void {
    const p = this.panel;
    if (!p || this.wide) return;
    const t = e.target as HTMLElement;
    const body = p.querySelector<HTMLElement>('.panel-body')!;
    // Full panels drag from the grip and header only, so their body scrolls; peeking ones drag from anywhere.
    const handle = !!t.closest('.grip-zone, .panel-head');
    if (this.expanded && !handle && !(body.scrollTop <= 0 && body.contains(t))) return;
    this.drag = { y: e.clientY, start: this.offset(p), moved: false, t: performance.now() };
  }

  /** Current downward offset of the panel inside its slot, in px. */
  private offset(p: HTMLElement): number {
    return p.getBoundingClientRect().top - this.slot.getBoundingClientRect().top;
  }

  private dragMove(e: PointerEvent): void {
    const d = this.drag;
    const p = this.panel;
    if (!d || !p) return;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.abs(dy) < 8) return;
      // A full panel scrolled to the top only drags when pulled down.
      const body = p.querySelector<HTMLElement>('.panel-body')!;
      if (this.expanded && dy < 0 && body.contains(e.target as Node)) return void (this.drag = null);
      d.moved = true;
      p.classList.add('dragging');
    }
    p.style.transform = `translateY(${Math.max(0, d.start + dy)}px)`;
  }

  private dragEnd(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    const p = this.panel;
    if (!d || !p || !d.moved) return;
    p.classList.remove('dragging');
    p.style.transform = '';
    const dy = e.clientY - d.y;
    const fast = Math.abs(dy) / Math.max(1, performance.now() - d.t) > 0.6;
    if (dy < -SNAP || (fast && dy < 0)) this.setExpanded(true);
    else if (dy > SNAP || (fast && dy > 0)) {
      if (this.expanded && !isPage(this.stack[0])) this.setExpanded(false);
      else this.openSheet(null);
    }
    // The click that ends a drag is not a tap.
    this.draggedAt = performance.now();
  }

  private setExpanded(on: boolean): void {
    this.expanded = on;
    this.panel?.classList.toggle('full', on);
    this.panel?.classList.toggle('peek', !on);
  }

  // ---------- public ----------

  /** Screen bands the HUD covers, so the map is laid out between them. */
  insets(): { top: number; bottom: number } {
    const p = this.panel;
    const navTop = this.nav.getBoundingClientRect().top;
    const trayTop = this.tray.classList.contains('open') ? this.tray.getBoundingClientRect().top : navTop;
    const panelTop = p && !this.expanded && !this.wide ? p.getBoundingClientRect().top : Infinity;
    return { top: this.top.getBoundingClientRect().bottom + 6, bottom: window.innerHeight - Math.min(navTop, trayTop, panelTop) + 6 };
  }

  toast(msg: string, ms = 2200, tone: 'info' | 'bad' | 'good' = 'info'): void {
    this.toastEl.textContent = msg;
    this.toastEl.className = `toast show ${tone}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  /** A brief green or red flash on the status board, at month end. */
  flashCash(good: boolean): void {
    const el = this.top.querySelector('.status');
    if (!el) return;
    el.classList.remove('flash-good', 'flash-bad');
    void (el as HTMLElement).offsetWidth; // restart the animation
    el.classList.add(good ? 'flash-good' : 'flash-bad');
  }

  /** Offer what the company earned while the app was closed. */
  showAway(hours: number, amount: number): void {
    this.away = { hours, amount };
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

  /** Show a sheet on its own (from the map or the bar); null closes. Pages open full, inspectors peek. */
  openSheet(s: Sheet | null): void {
    this.stack = s ? [s] : [];
    this.expanded = !!s && isPage(s);
    if (s) this.trayOpen = false;
    this.changed();
  }

  /** Show a sheet on top of the current one, with a back button. Choosing a vehicle model needs the room. */
  pushSheet(s: Sheet): void {
    this.stack.push(s);
    if (s.kind === 'buy') this.expanded = true;
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
    if (!el || (el as HTMLButtonElement).disabled || performance.now() - this.draggedAt < 300) return;
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
      case 'build':
        // Build toggles the tray; with a tool picked it puts the tool down.
        if (this.tool !== 'select') {
          this.trayOpen = false;
          return this.cb.setTool('select');
        }
        this.trayOpen = !this.trayOpen;
        if (this.trayOpen) this.openSheet(null);
        return;
      case 'build-done':
        this.trayOpen = false;
        return this.cb.setTool('select');
      case 'tool':
        this.layersOpen = false;
        this.trayOpen = true;
        if (this.sheet) this.openSheet(null);
        return this.cb.setTool(this.tool === arg ? 'select' : (arg as Tool));
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
      case 'expand':
        return this.setExpanded(!this.expanded);
      case 'back':
        this.stack.pop();
        return this.changed();
      case 'nav': {
        const root = this.stack[0];
        if (root?.kind === arg && this.stack.length === 1) return this.openSheet(null);
        if (this.tool !== 'select') this.cb.setTool('select');
        return this.openSheet(
          arg === 'world' ? { kind: 'world', tab: 'towns' } : arg === 'company' ? { kind: 'company', tab: 'overview' } : ({ kind: arg } as Sheet),
        );
      }
      case 'company':
        if (this.sheet?.kind === 'company') return this.replaceTop({ kind: 'company', tab: arg as CompanyTab });
        return this.openSheet({ kind: 'company', tab: (arg || 'overview') as CompanyTab });
      case 'world':
        return this.replaceTop({ kind: 'world', tab: arg as WorldTab });
      case 'interval': {
        const [id, rest] = arg.split('.');
        const carries = rest.slice(0, -1) as Carries;
        const l = w.lineById(Number(id));
        if (!l) return;
        const now = l.interval[carries];
        // Off steps up to every day; one day steps down to off.
        w.setInterval(l.id, carries, rest.endsWith('+') ? now + 1 : now - 1);
        return;
      }
      case 'up-stop': {
        const [id, track] = arg.split('.');
        const why = w.buyStopUpgrade(Number(id), track as StopUpgrade);
        return this.toast(why ?? 'Upgraded', 2200, why ? 'bad' : 'good');
      }
      case 'up-co': {
        const why = w.buyCompanyUpgrade(arg as CompanyUpgrade);
        return this.toast(why ?? 'Upgraded for the whole company', 2200, why ? 'bad' : 'good');
      }
      case 'collect':
        this.away = null;
        return this.cb.collectAway();
      case 'filter':
        return this.replaceTop({ kind: 'lines', filter: arg as LineFilter });
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
        this.toast(typeof r === 'string' ? r : `Bought a ${r.type.name}`, 2200, typeof r === 'string' ? 'bad' : 'good');
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
        this.toast(k ? `Renewed ${plural(k, 'vehicle')}` : 'Nothing to renew, or not enough cash', 2200, k ? 'good' : 'bad');
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
        if (why) this.toast(why, 2200, 'bad');
        else this.openSheet(null);
        return;
      }
      case 'borrow':
        if (!w.econ.borrow()) this.toast(`Loan limit is ${money(CONFIG.maxLoan)}`, 2200, 'bad');
        return;
      case 'repay':
        if (!w.econ.repay()) this.toast(w.econ.loan > 0 ? 'Not enough cash to repay' : 'No loan to repay', 2200, 'bad');
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
    this.tool = s.tool;
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    // Cash rolls toward its new value instead of jumping.
    if (this.shownCash === null || !s.started || Math.abs(cash - this.shownCash) < 500) this.shownCash = cash;
    else this.shownCash += (cash - this.shownCash) * Math.min(1, dt * 6);

    this.renderTop(s, `${MONTHS[month]} ${year}`.toUpperCase(), Economy.net(w.econ.last));
    this.renderNav(s);
    this.set(this.popEl, 'pop', `${this.layersOpen}|${s.layer}`, () =>
      this.layersOpen
        ? `<div class="pop" role="menu"><div class="pop-title">Map layer</div>${LAYERS.map(
            (l) =>
              `<button class="pop-row${l.layer === s.layer ? ' on' : ''}" data-act="layer:${l.layer}"><i class="swatch" style="background:${l.swatch}"></i><span class="grow"><span class="t">${l.label}</span><small>${l.hint}</small></span>${l.layer === s.layer ? ICON.check : ''}</button>`,
          ).join('')}</div>`
        : '',
    );

    if (this.dirty || now - this.lastRefresh >= REFRESH_MS) {
      this.lastRefresh = now;
      this.renderPanel(w);
    }
    this.renderOverlay(w, s);
  }

  // ---------- top: status board and speed ----------

  private renderTop(s: HudState, date: string, net: number): void {
    // Built once; only state classes and live numbers change, so the sliding thumb can animate.
    this.set(this.top, 'top', 'static', () => {
      const btn = (act: string, icon: string, label: string) => `<button class="spd" data-act="${act}" aria-label="${label}">${icon}</button>`;
      return `
        <button class="status" data-act="company:overview" aria-label="Company">
          <b data-live="cash">${money(this.shownCash ?? 0)}</b>
          <span class="status-sub"><span data-live="date">${date}</span><span class="delta-slot" data-live="net"></span></span>
        </button>
        <div class="clock">
          <div class="speed"><i class="thumb"></i>${btn('speed:0', ICON.pause, 'Pause')}${btn('speed:1', ICON.play, 'Play')}${btn('speed:2', ICON.fast, 'Fast')}${btn('speed:4', ICON.faster, 'Fastest')}</div>
          <button class="round-btn" data-act="layers" aria-label="Map layers">${ICON.layers}</button>
        </div>`;
    });
    const idx = [0, 1, 2, 4].indexOf(s.speed);
    const sp = this.top.querySelector<HTMLElement>('.speed')!;
    if (sp.style.getPropertyValue('--i') !== String(idx)) sp.style.setProperty('--i', String(idx));
    sp.classList.toggle('paused', s.speed === 0);
    this.top.querySelectorAll<HTMLElement>('.spd').forEach((b, i) => b.classList.toggle('on', i === idx));
    this.top.querySelector('[data-act="layers"]')!.classList.toggle('on', s.layer !== 'lines' || this.layersOpen);
    const netEl = this.top.querySelector<HTMLElement>('[data-live="net"]')!;
    netEl.classList.toggle('down', net < 0);
    netEl.classList.toggle('up', net > 0);
    this.patch(this.top, {
      cash: { text: money(this.shownCash!), bad: s.world.econ.cash < 0 },
      date: { text: date },
      net: { text: net ? `${net < 0 ? '▼' : '▲'} ${money(Math.abs(net))}` : '' },
    });
  }

  // ---------- bottom: navigation and the Build tray ----------

  private renderNav(s: HudState): void {
    this.set(this.nav, 'nav', 'static', () => {
      const tab = (t: (typeof NAV)[number]) => `<button class="tab" data-act="${t.act}" data-root="${t.root}">${t.icon}<span>${t.label}</span></button>`;
      return `${tab(NAV[0])}${tab(NAV[1])}<button class="build-btn" data-act="build" aria-label="Build"><span class="build-ring">${ICON.plus}</span><span>Build</span></button>${tab(NAV[2])}${tab(NAV[3])}`;
    });
    const root = this.stack[0]?.kind;
    this.nav.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.classList.toggle('on', b.dataset.root === root));
    const building = s.tool !== 'select';
    const bb = this.nav.querySelector<HTMLElement>('.build-btn')!;
    bb.classList.toggle('active', building || this.trayOpen);
    const ring = bb.querySelector<HTMLElement>('.build-ring')!;
    const icon = building ? (BUILD.find((b) => b.tool === s.tool)?.icon ?? ICON.plus) : this.trayOpen ? ICON.close : ICON.plus;
    if (ring.dataset.icon !== `${s.tool}|${this.trayOpen}`) {
      ring.dataset.icon = `${s.tool}|${this.trayOpen}`;
      ring.innerHTML = icon;
    }

    const open = this.trayOpen || building;
    this.tray.classList.toggle('open', open);
    this.set(this.tray, 'tray', 'static', () => {
      const item = (b: (typeof BUILD)[number]) =>
        `<button class="tool" data-act="tool:${b.tool}" data-tool="${b.tool}"><span class="tool-icon">${b.icon}</span><span class="t">${b.label}</span><small>${b.price ? money(CONFIG.stop[b.price].price) : 'Refunds part'}</small></button>`;
      return `${BUILD.map(item).join('')}<button class="tool done" data-act="build-done"><span class="tool-icon">${ICON.check}</span><span class="t">Done</span><small>Back to map</small></button>`;
    });
    this.tray.querySelectorAll<HTMLElement>('.tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === s.tool));
  }

  // ---------- the panel ----------

  private renderPanel(w: World): void {
    const sh = this.sheet;
    const v = sh ? view(w, sh, this.graphics) : null;
    if (sh && !v) {
      // The thing this panel showed is gone (deleted line, sold vehicle): step back.
      this.stack.pop();
      this.changed();
      return;
    }
    const key = v ? `${this.stack.length}|${v.key}` : 'none';
    const stale = this.keys.get('sheet') !== key;
    if (stale && (!this.touching || this.dirty)) {
      const body = this.slot.querySelector('.panel-body');
      const id = sh ? sheetId(sh) : '';
      const sameSheet = this.keys.get('sheet-id') === id;
      const sameTab = this.keys.get('sheet-tab') === JSON.stringify(sh);
      const scroll = sameSheet && sameTab && body ? body.scrollTop : 0;
      const depth = Number(this.keys.get('sheet-depth') ?? 0);
      this.keys.set('sheet', key);
      this.keys.set('sheet-id', id);
      this.keys.set('sheet-tab', JSON.stringify(sh));
      this.keys.set('sheet-depth', String(this.stack.length));
      clearTimeout(this.leaveTimer);
      if (!v) {
        // Slide the old panel away before removing it.
        const old = this.slot.querySelector('.panel');
        if (old) {
          old.classList.add('leave');
          this.leaveTimer = window.setTimeout(() => (this.slot.innerHTML = ''), 220);
        }
      } else {
        // A new panel rises; moving through the back stack slides sideways; switching tabs fades; a refresh does not move.
        const motion = sameSheet
          ? sameTab
            ? ''
            : ' enter-swap'
          : !depth || !this.panel
            ? ' enter'
            : this.stack.length > depth
              ? ' enter-fwd'
              : this.stack.length < depth
                ? ' enter-back'
                : ' enter-swap';
        this.slot.innerHTML = this.frame(v, sh!, motion);
      }
      const fresh = this.slot.querySelector('.panel-body');
      if (fresh) fresh.scrollTop = scroll;
    }
    this.panel?.classList.toggle('full', this.expanded);
    this.panel?.classList.toggle('peek', !this.expanded);
    this.dirty = false;
    if (v) this.patch(this.slot, v.live);
  }

  private frame(v: View, sh: Sheet, motion: string): string {
    const back = this.stack.length > 1 ? `<button class="icon-btn" data-act="back" aria-label="Back">${ICON.back}</button>` : '';
    const page = isPage(sh) && this.stack.length === 1;
    return `<section class="panel${page ? ' page' : ''}${motion} ${this.expanded ? 'full' : 'peek'}" role="dialog">
      <div class="grip-zone" data-act="expand" aria-label="Expand"><i class="grip"></i></div>
      <header class="panel-head">${back}${v.head}<button class="icon-btn" data-act="close" aria-label="Close">${ICON.close}</button></header>
      <div class="panel-body">${v.body}</div>
    </section>`;
  }

  // ---------- overlays ----------

  private renderOverlay(w: World, s: HudState): void {
    let key = 'none';
    if (this.help !== null) key = `help:${this.help}`;
    else if (this.away && s.started && !w.over) key = `away:${Math.round(this.away.amount)}`;
    else if (!s.started) key = `start:${s.saved}`;
    else if (w.over) key = `over:${Math.round(w.delivered)}`;
    const kind = key.split(':')[0];
    // The backdrop fades in only when an overlay first appears, not on each help page.
    const enter = kind !== this.overlayKind ? ' enter' : '';
    this.set(this.overlay, 'overlay', key, () => {
      this.overlayKind = kind;
      if (this.help !== null) return this.helpCard(enter);
      if (key.startsWith('away')) {
        const a = this.away!;
        const h = a.hours >= 1 ? `${Math.floor(a.hours)} h ${Math.round((a.hours % 1) * 60)} min` : `${Math.round(a.hours * 60)} min`;
        return `<div class="overlay${enter}"><div class="sign">
          <div class="sign-band good"><div class="stripes" aria-hidden="true"><i></i><i></i><i></i><i></i></div><h1>While you were away</h1><span class="sign-sub">${h} · lines kept running</span></div>
          <div class="away-amount"><small>Earned</small><b>+${money(a.amount)}</b><span>Half of last month's operating profit for each hour, up to ${CONFIG.away.maxHours} hours.</span></div>
          <div class="departures"><button class="departure" data-act="collect">${marker('#0a8f4e', '$')}<span class="grow"><span class="t">Collect</span><small>Add it to your cash and carry on</small></span><span class="chev">${ICON.chevron}</span></button></div>
        </div></div>`;
      }
      if (!s.started) {
        const dep = (act: string, color: string, label: string, title: string, meta: string) =>
          `<button class="departure" data-act="${act}">${marker(color, label)}<span class="grow"><span class="t">${title}</span><small>${meta}</small></span><span class="chev">${ICON.chevron}</span></button>`;
        return `<div class="overlay title${enter}"><div class="sign">
          <div class="sign-band">
            <div class="stripes" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
            <h1>Small Transit</h1>
            <span class="sign-sub">Rail · Road · 1950 to 1990</span>
          </div>
          <p class="sign-lede">Run a transport company in a river valley. Carry passengers between six towns and freight from farms, forests and an oil well, and stay in the black.</p>
          <div class="departures">
            <div class="dep-head"><span>Departures</span><span>Platform</span></div>
            ${s.saved ? dep('resume', '#e2231a', '1', 'Continue', 'Your company, where you left it') : ''}
            ${dep('start', '#0072ce', s.saved ? '2' : '1', 'New company', s.saved ? 'Replaces the saved company' : 'Start in 1950 with $1.5M')}
            ${dep('help', '#00a651', s.saved ? '3' : '2', 'How to play', `${HELP.length} short pages`)}
          </div>
        </div></div>`;
      }
      if (w.over) {
        const { year, month } = w.date();
        return `<div class="overlay${enter}"><div class="sign">
          <div class="sign-band bad"><h1>Bankrupt</h1><span class="sign-sub">Service ended ${MONTHS[month]} ${year}</span></div>
          <p class="sign-lede">Your company carried ${round(w.delivered)} passengers and ${round(w.deliveredCargo)} cargo before it closed.</p>
          <div class="departures">${`<button class="departure" data-act="start">${marker('#0072ce', '1')}<span class="grow"><span class="t">Start again</span><small>A new company in 1950</small></span><span class="chev">${ICON.chevron}</span></button>`}</div>
        </div></div>`;
      }
      return '';
    });
  }

  private helpCard(enter: string): string {
    const page = this.help!;
    const h = HELP[page];
    const last = page === HELP.length - 1;
    const steps = HELP.map(
      (x, i) => `<button class="step${i === page ? ' on' : ''}${i < page ? ' done' : ''}" data-act="help-go:${i}" aria-label="Page ${i + 1}" style="--c:${x.color}">${i + 1}</button>`,
    ).join('<i class="step-rule"></i>');
    return `<div class="overlay${enter}"><div class="help-card" role="dialog" aria-label="How to play">
      <div class="help-top"><div class="steps">${steps}</div><button class="icon-btn" data-act="help-close" aria-label="Close">${ICON.close}</button></div>
      <div class="help-page">
        <span class="help-icon" style="--c:${h.color}">${h.icon}</span>
        <h2>${h.title}</h2>
        <p>${h.text}</p>
      </div>
      <div class="help-nav">
        <button class="btn secondary" data-act="help-go:${page - 1}" ${page === 0 ? 'disabled' : ''}><span>Back</span></button>
        <button class="btn primary" data-act="${last ? 'help-close' : `help-go:${page + 1}`}"><span>${last ? 'Start playing' : 'Next'}</span></button>
      </div>
    </div></div>`;
  }
}
