import { CONFIG, vehicleFor } from '../sim/config';
import { Economy } from '../sim/economy';
import type { Line } from '../sim/types';
import { money, type World } from '../sim/world';
import { THEME } from '../render/renderer';
import type { Tool } from './editor';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const ICON = {
  pause: '<svg viewBox="0 0 16 16"><rect x="3" y="2" width="3.5" height="12"/><rect x="9.5" y="2" width="3.5" height="12"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M4 2l10 6-10 6z"/></svg>',
  fast: '<svg viewBox="0 0 16 16"><path d="M1 3l7 5-7 5zM8 3l7 5-7 5z"/></svg>',
  faster: '<svg viewBox="0 0 16 16"><path d="M0 4l5 4-5 4zM5.5 4l5 4-5 4zM11 4l5 4-5 4z"/></svg>',
  info: '<svg viewBox="0 0 16 16"><circle cx="8" cy="4" r="1.6"/><rect x="6.6" y="6.6" width="2.8" height="7.4" rx="1"/></svg>',
  select:
    '<svg viewBox="0 0 24 24"><path d="M6 3l12 9-5.2 1.1 3 6.4-2.6 1.2-3-6.4L6 18z" fill="currentColor"/></svg>',
  rail: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>',
  bus: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>',
  bulldoze:
    '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>',
  lines:
    '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  finance:
    '<svg viewBox="0 0 24 24"><text x="12" y="18" text-anchor="middle" font-size="17" font-weight="700" fill="currentColor" font-family="system-ui">$</text></svg>',
};

const TOOLS: { tool: Tool; label: string; icon: string }[] = [
  { tool: 'select', label: 'Select', icon: ICON.select },
  { tool: 'rail', label: 'Station', icon: ICON.rail },
  { tool: 'bus', label: 'Bus stop', icon: ICON.bus },
  { tool: 'bulldoze', label: 'Demolish', icon: ICON.bulldoze },
];

export type Sheet =
  | { kind: 'stop'; id: number }
  | { kind: 'line'; id: number; confirmDelete?: boolean }
  | { kind: 'lines' }
  | { kind: 'finance' }
  | { kind: 'town'; id: number };

const HELP: { title: string; text: string }[] = [
  {
    title: 'Connect the towns',
    text: 'People in six towns want to travel. Pick the Station tool and tap near houses to build a rail station. Houses turn darker once a stop reaches them.',
  },
  {
    title: 'Build a line',
    text: 'With Select, drag from one station to another. The price of new track shows by your finger; water needs costly bridges and hills cost more. Bus stops join with bus lines the same way, and roads inside towns are free.',
  },
  {
    title: 'Buy vehicles',
    text: 'Tap a line to buy trains or buses. More vehicles carry more people but each costs money every month. A line with no vehicles carries nobody.',
  },
  {
    title: 'Earn fares',
    text: 'Fares grow with distance. Place bus stops near a station so people from the whole town can reach the train. Well-served towns grow, and bigger towns travel more.',
  },
  {
    title: 'Stay solvent',
    text: `If your cash stays below zero for ${CONFIG.bankruptMonths} month-ends in a row, the company goes bankrupt. Borrow in Finance and repay when you can. Drag empty ground to move the map${COARSE ? ' and pinch to zoom' : ', scroll to zoom'}.`,
  },
];

export interface HudCallbacks {
  setSpeed(s: number): void;
  setTool(t: Tool): void;
  start(): void;
  helpToggled(open: boolean): void;
  sheetChanged(sheet: Sheet | null): void;
  focus(stopOrLine: { stop?: number; line?: number }): void;
}

export interface HudState {
  world: World;
  speed: number;
  tool: Tool;
  started: boolean;
}

/** DOM overlay. Acts on pointerdown and re-renders a region only when its content key changes. */
export class Hud {
  private keys = new Map<string, string>();
  private top: HTMLElement;
  private bar: HTMLElement;
  private sheetEl: HTMLElement;
  private overlay: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer = 0;
  private help: number | null = null;
  sheet: Sheet | null = null;
  private world!: World;

  constructor(
    root: HTMLElement,
    private cb: HudCallbacks,
  ) {
    root.innerHTML =
      '<div class="top"></div><div class="sheet-slot"></div><div class="bar"></div><div class="overlay-slot"></div><div class="toast" style="opacity:0"></div>';
    this.top = root.querySelector('.top')!;
    this.bar = root.querySelector('.bar')!;
    this.sheetEl = root.querySelector('.sheet-slot')!;
    this.overlay = root.querySelector('.overlay-slot')!;
    this.toastEl = root.querySelector('.toast')!;
    root.addEventListener('pointerdown', (e) => this.onAct(e));
  }

  /** Screen bands the HUD covers, so the map is laid out between them. */
  insets(): { top: number; bottom: number } {
    return { top: this.top.getBoundingClientRect().bottom + 6, bottom: window.innerHeight - this.bar.getBoundingClientRect().top + 6 };
  }

  toast(msg: string, ms = 2200): void {
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.style.opacity = '0'), ms);
  }

  get helpOpen(): boolean {
    return this.help !== null;
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

  openSheet(s: Sheet | null): void {
    this.sheet = s;
    this.cb.sheetChanged(s);
  }

  private onAct(e: PointerEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    e.preventDefault();
    const [act, arg] = el.dataset.act!.split(':');
    const w = this.world;
    const n = Number(arg);
    switch (act) {
      case 'speed':
        return this.cb.setSpeed(n);
      case 'tool':
        return this.cb.setTool(arg as Tool);
      case 'start':
        return this.cb.start();
      case 'help':
        return this.openHelp();
      case 'help-go':
        this.help = Math.max(0, Math.min(HELP.length - 1, n));
        return;
      case 'help-close':
        return this.closeHelp();
      case 'sheet-close':
        return this.openSheet(null);
      case 'lines':
        return this.openSheet(this.sheet?.kind === 'lines' ? null : { kind: 'lines' });
      case 'finance':
        return this.openSheet(this.sheet?.kind === 'finance' ? null : { kind: 'finance' });
      case 'open-line':
        this.cb.focus({ line: n });
        return this.openSheet({ kind: 'line', id: n });
      case 'open-stop':
        this.cb.focus({ stop: n });
        return this.openSheet({ kind: 'stop', id: n });
      case 'buy': {
        const r = w.addVehicle(n);
        if (typeof r === 'string') this.toast(r);
        return;
      }
      case 'sell':
        w.sellVehicle(n);
        return;
      case 'delete-line':
        if (this.sheet?.kind === 'line' && this.sheet.confirmDelete) {
          w.deleteLine(n);
          this.toast('Line deleted. Its vehicles are sold as they reach a stop.');
          return this.openSheet({ kind: 'lines' });
        }
        this.sheet = { kind: 'line', id: n, confirmDelete: true };
        return;
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
    }
  }

  private set(el: HTMLElement, id: string, key: string, html: () => string): void {
    if (this.keys.get(id) === key) return;
    this.keys.set(id, key);
    el.innerHTML = html();
  }

  update(s: HudState): void {
    const w = (this.world = s.world);
    const { year, month } = w.date();
    const cash = w.econ.cash;
    this.set(this.top, 'top', [Math.round(cash / 1000), year, month, s.speed].join('|'), () => {
      const btn = (act: string, icon: string, on: boolean, label: string) =>
        `<button class="icon-btn${on ? ' on' : ''}" data-act="${act}" aria-label="${label}">${icon}</button>`;
      return `
        <button class="cash${cash < 0 ? ' neg' : ''}" data-act="finance" aria-label="Finance">${money(cash)}<small>${MONTHS[month]} ${year}</small></button>
        <div class="clock">
          ${btn('speed:0', ICON.pause, s.speed === 0, 'Pause')}
          ${btn('speed:1', ICON.play, s.speed === 1, 'Play')}
          ${btn('speed:2', ICON.fast, s.speed === 2, 'Fast')}
          ${btn('speed:4', ICON.faster, s.speed === 4, 'Fastest')}
          ${btn('help', ICON.info, false, 'How to play')}
        </div>`;
    });

    this.set(this.bar, 'bar', [s.tool, this.sheet?.kind].join('|'), () => {
      const tools = TOOLS.map(
        (t) => `<button class="tool${s.tool === t.tool ? ' on' : ''}" data-act="tool:${t.tool}">${t.icon}<span>${t.label}</span></button>`,
      ).join('');
      const k = this.sheet?.kind;
      return `${tools}<span class="sep"></span>
        <button class="tool${k === 'lines' || k === 'line' ? ' on' : ''}" data-act="lines">${ICON.lines}<span>Lines</span></button>
        <button class="tool${k === 'finance' ? ' on' : ''}" data-act="finance">${ICON.finance}<span>Finance</span></button>`;
    });

    this.renderSheet(w);
    this.renderOverlay(w, s);
  }

  private renderSheet(w: World): void {
    const sh = this.sheet;
    let key = 'none';
    let html = () => '';
    if (sh?.kind === 'stop') {
      const st = w.stopById(sh.id);
      if (!st) return this.openSheet(null);
      const lines = w.linesAt(st.id);
      key = ['stop', st.id, st.waiting.length, st.residents, lines.map((l) => l.id).join()].join('|');
      html = () => {
        const cap = CONFIG.stop[st.mode].capacity;
        const rows = lines.map((l) => this.lineRow(w, l)).join('');
        return this.sheetFrame(
          st.name,
          st.mode === 'rail' ? 'Rail station' : 'Bus stop',
          `<div class="stats">
            ${stat('Waiting', `${st.waiting.length} / ${cap}`)}
            ${stat('Residents', st.residents.toLocaleString('en-US'))}
          </div>
          ${rows ? `<div class="list">${rows}</div>` : `<p class="hint">No line stops here yet. With Select, drag from this ${st.mode === 'rail' ? 'station to another station' : 'stop to another bus stop'}.</p>`}
          ${lines.length === 0 ? `<button class="ghost danger" data-act="demolish:${st.id}">Demolish</button>` : ''}`,
        );
      };
    } else if (sh?.kind === 'line') {
      const l = w.lineById(sh.id);
      if (!l) return this.openSheet(null);
      const vs = w.vehiclesOn(l.id);
      const type = vehicleFor(l.mode);
      const len = l.segs.reduce((n, s2) => n + s2.length, 0);
      const riders = vs.reduce((n, v) => n + v.riders.length, 0);
      key = ['line', l.id, vs.length, Math.round(l.revenueMonth / 1000), Math.round(l.costMonth / 1000), l.profitLast, riders, l.stops.length, sh.confirmDelete, Math.round(w.econ.cash / 1000)].join('|');
      html = () =>
        this.sheetFrame(
          `<span class="dot" style="background:${THEME.lines[l.color]}"></span>${l.name}`,
          `${l.mode === 'rail' ? 'Rail' : 'Bus'} line · ${l.stops.length} stops · ${(len / 1000).toFixed(1)} km${l.loop ? ' · loop' : ''}`,
          `<div class="stats">
            ${stat(`${type.name}s`, `${vs.length}`)}
            ${stat('On board', `${riders}/${vs.length * type.capacity}`)}
            ${stat('Profit / month', money(l.profitLast), l.profitLast < 0)}
            ${stat('Carried / month', `${l.carriedLast}`)}
          </div>
          <div class="row-actions">
            <button class="primary" data-act="buy:${l.id}">Buy ${type.name.toLowerCase()} · ${money(type.price)}</button>
            <button class="ghost" data-act="sell:${l.id}" ${vs.length ? '' : 'disabled'}>Sell · +${money(type.price * CONFIG.sellRefund)}</button>
          </div>
          <p class="hint">Each ${type.name.toLowerCase()} carries ${type.capacity} and costs ${money(type.runningPerMonth)} a month to run.</p>
          <button class="ghost danger" data-act="delete-line:${l.id}">${sh.confirmDelete ? 'Tap again to delete' : 'Delete line'}</button>`,
        );
    } else if (sh?.kind === 'lines') {
      key = ['lines', w.lines.map((l) => `${l.id}:${w.vehiclesOn(l.id).length}:${Math.round(l.profitLast)}`).join()].join('|');
      html = () =>
        this.sheetFrame(
          'Lines',
          `${w.lines.length} line${w.lines.length === 1 ? '' : 's'} · ${w.vehicles.length} vehicles`,
          w.lines.length
            ? `<div class="list">${w.lines.map((l) => this.lineRow(w, l)).join('')}</div>`
            : '<p class="hint">No lines yet. Build two stations, then drag from one to the other with Select.</p>',
        );
    } else if (sh?.kind === 'finance') {
      const e = w.econ;
      const L = e.last;
      key = ['fin', Math.round(e.cash / 1000), e.loan, Economy.net(L), w.delivered].join('|');
      html = () =>
        this.sheetFrame(
          'Finance',
          `Company value ${money(w.companyValue())} (cash − loan + fleet)`,
          `<div class="stats">
            ${stat('Cash', money(e.cash), e.cash < 0)}
            ${stat('Loan', `${money(e.loan)} of ${money(CONFIG.maxLoan)}`)}
          </div>
          <div class="row-actions">
            <button class="primary" data-act="borrow">Borrow ${money(CONFIG.loanStep)}</button>
            <button class="ghost" data-act="repay" ${e.loan > 0 ? '' : 'disabled'}>Repay ${money(CONFIG.loanStep)}</button>
          </div>
          <table class="ledger">
            <caption>Last month</caption>
            ${ledgerRow('Fares', L.fares)}
            ${ledgerRow('Vehicle running', L.running)}
            ${ledgerRow('Track, roads and stops', L.maintenance)}
            ${ledgerRow('Loan interest', L.interest)}
            ${ledgerRow('Construction', L.construction)}
            ${ledgerRow('Vehicles bought and sold', L.vehicles)}
            <tr class="total"><th>Net</th><td>${money(Economy.net(L))}</td></tr>
          </table>
          <p class="hint">${w.delivered.toLocaleString('en-US')} passengers delivered · ${Math.round(w.coverage() * 100)}% of residents reach a stop</p>`,
        );
    }
    this.set(this.sheetEl, 'sheet', key, html);
  }

  private lineRow(w: World, l: Line): string {
    const n = w.vehiclesOn(l.id).length;
    return `<button class="list-row" data-act="open-line:${l.id}">
      <span class="dot" style="background:${THEME.lines[l.color]}"></span>
      <span class="grow">${l.name}<small>${n} ${vehicleFor(l.mode).name.toLowerCase()}${n === 1 ? '' : 's'}${n === 0 ? ' · needs a vehicle' : ''}</small></span>
      <span class="${l.profitLast < 0 ? 'neg' : ''}">${money(l.profitLast)}</span>
    </button>`;
  }

  private sheetFrame(title: string, sub: string, body: string): string {
    return `<div class="sheet" role="dialog">
      <div class="sheet-head"><div><h2>${title}</h2><p>${sub}</p></div>
      <button class="close" data-act="sheet-close" aria-label="Close">✕</button></div>
      <div class="sheet-body">${body}</div>
    </div>`;
  }

  private renderOverlay(w: World, s: HudState): void {
    let key = 'none';
    if (this.help !== null) key = `help:${this.help}`;
    else if (!s.started) key = 'start';
    else if (w.over) key = `over:${w.delivered}`;
    this.set(this.overlay, 'overlay', key, () => {
      if (this.help !== null) return this.helpCard();
      if (key === 'start')
        return `<div class="overlay"><div class="card">
          <h1>Small Transit</h1>
          <p>Run a transport company. Connect six towns by rail and bus, and stay in the black.</p>
          <div class="actions"><button class="primary" data-act="start">New company</button><button class="ghost" data-act="help">How to play</button></div>
        </div></div>`;
      if (w.over) {
        const { year, month } = w.date();
        return `<div class="overlay"><div class="card">
          <h2>Bankrupt</h2>
          <p>Your company closed in ${MONTHS[month]} ${year} after delivering ${w.delivered.toLocaleString('en-US')} passengers.</p>
          <div class="actions"><button class="primary" data-act="start">Start again</button></div>
        </div></div>`;
      }
      return '';
    });
  }

  private helpCard(): string {
    const page = this.help!;
    const h = HELP[page];
    const last = page === HELP.length - 1;
    const dots = HELP.map((_, i) => `<button class="dot-btn${i === page ? ' on' : ''}" data-act="help-go:${i}" aria-label="Page ${i + 1}"></button>`).join('');
    return `<div class="overlay"><div class="card help" role="dialog" aria-label="How to play">
      <button class="close" data-act="help-close" aria-label="Close">✕</button>
      <div class="step">${page + 1} of ${HELP.length}</div>
      <h2>${h.title}</h2>
      <p>${h.text}</p>
      <div class="help-nav">
        <button class="ghost" data-act="help-go:${page - 1}" ${page === 0 ? 'disabled' : ''}>Back</button>
        <div class="dots">${dots}</div>
        <button class="primary" data-act="${last ? 'help-close' : `help-go:${page + 1}`}">${last ? 'Play' : 'Next'}</button>
      </div>
    </div></div>`;
  }
}

const stat = (label: string, value: string, bad = false) =>
  `<div class="stat"><small>${label}</small><b class="${bad ? 'neg' : ''}">${value}</b></div>`;

const ledgerRow = (label: string, n: number) => `<tr><th>${label}</th><td class="${n < 0 ? 'neg' : ''}">${n === 0 ? '·' : money(n)}</td></tr>`;
