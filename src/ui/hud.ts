import { CARGO_LABEL, CONFIG, INDUSTRY, TOWN_CARGO, vehicleFor } from '../sim/config';
import { Economy } from '../sim/economy';
import type { Carries, Freight, Line, Mode } from '../sim/types';
import { loadOf } from '../sim/vehicles';
import { money, type World } from '../sim/world';
import { THEME } from '../render/renderer';
import type { Tool } from './editor';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const ICON = {
  pause: '<svg viewBox="0 0 16 16"><rect x="3" y="2" width="3.5" height="12"/><rect x="9.5" y="2" width="3.5" height="12"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M4 2l10 6-10 6z"/></svg>',
  fast: '<svg viewBox="0 0 16 16"><path d="M1 3l7 5-7 5zM8 3l7 5-7 5z"/></svg>',
  faster: '<svg viewBox="0 0 16 16"><path d="M0 4l5 4-5 4zM5.5 4l5 4-5 4zM11 4l5 4-5 4z"/></svg>',
  info: '<svg viewBox="0 0 16 16"><circle cx="8" cy="4" r="1.6"/><rect x="6.6" y="6.6" width="2.8" height="7.4" rx="1"/></svg>',
  select: '<svg viewBox="0 0 24 24"><path d="M6 3l12 9-5.2 1.1 3 6.4-2.6 1.2-3-6.4L6 18z" fill="currentColor"/></svg>',
  rail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M8 3L6 21M16 3l2 18"/><path d="M6.5 7h11M6 12h12M5.5 17h13" stroke-width="1.8"/></svg>',
  road: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 3L4 21M17 3l3 18"/><path d="M12 4v3M12 10.5v3M12 17v3"/></svg>',
  bulldoze: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>',
  lines: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  finance: '<svg viewBox="0 0 24 24"><text x="12" y="18" text-anchor="middle" font-size="17" font-weight="700" fill="currentColor" font-family="system-ui">$</text></svg>',
};

const TOOLS: { tool: Tool; label: string; icon: string }[] = [
  { tool: 'select', label: 'Select', icon: ICON.select },
  { tool: 'rail', label: 'Station', icon: ICON.rail },
  { tool: 'road', label: 'Road stop', icon: ICON.road },
  { tool: 'bulldoze', label: 'Demolish', icon: ICON.bulldoze },
];

export type Sheet =
  | { kind: 'stop'; id: number }
  | { kind: 'line'; id: number; confirmDelete?: boolean }
  | { kind: 'lines' }
  | { kind: 'finance' }
  | { kind: 'town'; id: number }
  | { kind: 'industry'; id: number };

const HELP: { title: string; text: string }[] = [
  {
    title: 'Your transport company',
    text: 'Six towns need passenger service, and farms and forests need their cargo moved. Build stations and road stops, join them into lines, and buy vehicles. Every line shows what it earns.',
  },
  {
    title: 'Build a line',
    text: 'Pick Station or Road stop and tap the map. Then, with Select, drag from one stop to another. Track and roads follow the land: rivers need bridges and hills cost more. Country roads and town streets are already built, so road lines along them are almost free.',
  },
  {
    title: 'Passengers',
    text: 'Tap a line to buy trains or buses. People travel between towns and between parts of a town; a bus stop next to a station lets them change. Fares grow with distance, and long lines between small towns can lose money.',
  },
  {
    title: 'Freight',
    text: 'Farms grow grain for the food plant; forests send logs to the sawmill. Put a stop inside the dashed ring around an industry, link it to the factory, and buy trucks or freight trains. Factories then send food and goods to towns.',
  },
  {
    title: 'Towns grow',
    text: 'Towns with good passenger service and steady food and goods grow, up to about four times their size. Bigger towns travel more. In Finance you can set ticket prices: dearer tickets earn more per rider, but fewer people travel.',
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
  resume(): void;
  helpToggled(open: boolean): void;
  sheetChanged(sheet: Sheet | null): void;
  focus(target: { stop?: number; line?: number }): void;
}

export interface HudState {
  world: World;
  speed: number;
  tool: Tool;
  started: boolean;
  /** A saved company exists that the title screen can continue. */
  saved: boolean;
}

const FREIGHT_LABEL = (f: Freight) => (f === 'pax' ? 'Passengers' : CARGO_LABEL[f]);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const round = (x: number) => Math.round(x).toLocaleString('en-US');

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
      case 'resume':
        return this.cb.resume();
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
      case 'buy':
      case 'sell': {
        // arg is `${lineId}.${carries}`
        const [id, carries] = arg.split('.') as [string, Carries];
        if (act === 'sell') w.sellVehicle(Number(id), carries);
        else {
          const r = w.addVehicle(Number(id), carries);
          if (typeof r === 'string') this.toast(r);
        }
        return;
      }
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
      case 'price': {
        const mode = arg.slice(0, -1) as Mode;
        const dir = arg.endsWith('+') ? 1 : -1;
        w.econ.setPrice(mode, w.econ.price[mode] + dir * CONFIG.price.step);
        return;
      }
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
      const by = w.waitingBy(st);
      const inds = w.industriesAt(st);
      key = ['stop', st.id, Math.round(w.waitingTotal(st)), st.residents, lines.map((l) => l.id).join(), inds.length].join('|');
      html = () => {
        const cap = CONFIG.stop[st.mode].capacity;
        const waiting = (Object.keys(by) as Freight[]).map((f) => `${FREIGHT_LABEL(f)} ${round(by[f]!)}`).join(' · ') || 'Nobody';
        const rows = lines.map((l) => this.lineRow(w, l)).join('');
        const town = st.town >= 0 ? w.towns[st.town].name : 'Countryside';
        return this.sheetFrame(
          st.name,
          `${st.mode === 'rail' ? 'Station' : 'Road stop'} · ${town}`,
          `<div class="stats">
            ${stat('Waiting', `${round(w.waitingTotal(st))} / ${cap}`, w.waitingTotal(st) >= cap * 0.9)}
            ${stat('Residents', round(st.residents))}
          </div>
          <p class="hint">${waiting}</p>
          ${inds.length ? `<p class="hint">Serves ${inds.map((i) => `<b>${i.name}</b>`).join(', ')}</p>` : ''}
          ${rows ? `<div class="list">${rows}</div>` : `<p class="hint">No line stops here yet. With Select, drag from this ${st.mode === 'rail' ? 'station to another station' : 'stop to another road stop'}.</p>`}
          ${lines.length === 0 ? `<button class="ghost danger" data-act="demolish:${st.id}">Demolish</button>` : ''}`,
        );
      };
    } else if (sh?.kind === 'line') {
      const l = w.lineById(sh.id);
      if (!l) return this.openSheet(null);
      const vs = w.vehiclesOn(l.id);
      const len = l.segs.reduce((n, s2) => n + s2.length, 0);
      const onBoard = vs.reduce((n, v) => n + loadOf(v), 0);
      const room = vs.reduce((n, v) => n + v.type.capacity, 0);
      key = ['line', l.id, vs.map((v) => v.type.key).join(), Math.round(l.revenueMonth / 1000), l.profitLast, Math.round(onBoard), l.stops.length, sh.confirmDelete, Math.round(w.econ.cash / 1000)].join('|');
      html = () =>
        this.sheetFrame(
          `<span class="dot" style="background:${THEME.lines[l.color]}"></span>${l.name}`,
          `${l.mode === 'rail' ? 'Rail' : 'Road'} line · ${l.stops.length} stops · ${(len / 1000).toFixed(1)} km${l.loop ? ' · loop' : ''}`,
          `<div class="stats">
            ${stat('Profit / month', money(l.profitLast), l.profitLast < 0)}
            ${stat('Carried / month', round(l.carriedLast))}
            ${stat('On board', `${round(onBoard)} / ${room}`)}
          </div>
          ${this.fleetRow(w, l, 'pax')}
          ${this.fleetRow(w, l, 'cargo')}
          <p class="hint">${vs.length ? 'Passenger vehicles carry people; freight vehicles carry whatever cargo waits at the stops for this line.' : 'Buy a vehicle to start service.'}</p>
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
    } else if (sh?.kind === 'industry') {
      const ind = w.industries[sh.id];
      const route = w.cargoRoute(ind);
      const out = ind.accepts ? ind.receivedLast : ind.rate;
      key = ['ind', ind.id, Math.round(out), Math.round(ind.shippedLast), Math.round(ind.receivedLast), route?.stop, route?.dest].join('|');
      html = () => {
        const info = INDUSTRY[ind.kind];
        const takers = this.consumers(w, ind.produces);
        const routeText = route
          ? `Ships ${CARGO_LABEL[ind.produces].toLowerCase()} from <b>${w.stopById(route.stop)!.name}</b> to <b>${w.stopById(route.dest)!.name}</b>.`
          : `No route yet. Build a station or road stop inside the dashed ring, then a line with freight vehicles to ${takers}.`;
        return this.sheetFrame(
          ind.name,
          info.label,
          `<div class="stats">
            ${stat(`${CARGO_LABEL[ind.produces]} / month`, round(out))}
            ${stat('Shipped', ind.producedLast > 0 ? pct(ind.shippedLast / ind.producedLast) : '·')}
            ${ind.accepts ? stat(`${CARGO_LABEL[ind.accepts]} in`, round(ind.receivedLast)) : ''}
          </div>
          <p class="hint">${
            ind.accepts
              ? `Turns ${CARGO_LABEL[ind.accepts].toLowerCase()} into ${CARGO_LABEL[ind.produces].toLowerCase()}: what arrives one month leaves the next.`
              : 'Produces more when most of its output is shipped, and less when it piles up.'
          }</p>
          <p class="hint">${routeText}</p>`,
        );
      };
    } else if (sh?.kind === 'town') {
      const t = w.towns[sh.id];
      key = ['town', t.id, t.pop, Math.round(t.tripsLast), Math.round(t.supplyLast)].join('|');
      html = () => {
        const g = CONFIG.growth;
        const mine = w.houses.filter((h) => h.town === t.id);
        const covered = mine.reduce((n, h) => n + (h.stop >= 0 ? h.residents : 0), 0) / Math.max(1, t.pop);
        return this.sheetFrame(
          t.name,
          `${round(t.pop)} people · room to grow to about ${round(t.basePop * g.capFactor)}`,
          `<div class="stats">
            ${stat('Reach a stop', pct(covered))}
            ${stat('Trips / month', round(t.tripsLast))}
            ${stat('Food and goods', round(t.supplyLast))}
            ${stat('Growth', `+${round(t.growthLast)}`)}
          </div>
          <p class="hint">Grows with passenger service (${pct(Math.min(1, t.tripsLast / Math.max(1, t.pop * g.tripsPerResident)))} of what it can use) and with ${TOWN_CARGO.map((c) => CARGO_LABEL[c].toLowerCase()).join(' and ')} deliveries (${pct(Math.min(1, t.supplyLast / Math.max(1, t.pop * g.supplyPerResident)))}).</p>`,
        );
      };
    } else if (sh?.kind === 'finance') {
      const e = w.econ;
      const L = e.last;
      key = ['fin', Math.round(e.cash / 1000), e.loan, Economy.net(L), Math.round(w.delivered), e.price.rail, e.price.road].join('|');
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
          <div class="prices">
            <h3>Ticket prices</h3>
            ${priceRow(w, 'rail')}
            ${priceRow(w, 'road')}
            <p class="hint">Dearer tickets earn more per rider, but fewer people travel and towns grow slower. Freight rates are fixed.</p>
          </div>
          <table class="ledger">
            <caption>Last month</caption>
            ${ledgerRow('Fares', L.fares)}
            ${ledgerRow('Freight', L.freight)}
            ${ledgerRow('Vehicle running', L.running)}
            ${ledgerRow('Track, roads and stops', L.maintenance)}
            ${ledgerRow('Loan interest', L.interest)}
            ${ledgerRow('Construction', L.construction)}
            ${ledgerRow('Vehicles bought and sold', L.vehicles)}
            <tr class="total"><th>Net</th><td>${money(Economy.net(L))}</td></tr>
          </table>
          <p class="hint">${round(w.delivered)} passengers and ${round(w.deliveredCargo)} cargo delivered · ${Math.round(w.coverage() * 100)}% of residents reach a stop</p>`,
        );
    }
    this.set(this.sheetEl, 'sheet', key, html);
  }

  /** Who takes a cargo, for hints. */
  private consumers(w: World, c: keyof typeof CARGO_LABEL): string {
    const names = w.industries.filter((i) => i.accepts === c).map((i) => i.name);
    if (TOWN_CARGO.includes(c)) names.push('a stop in any town');
    return names.join(' or ');
  }

  private fleetRow(w: World, l: Line, carries: Carries): string {
    const type = vehicleFor(l.mode, carries);
    const n = w.vehiclesOn(l.id, carries).length;
    return `<div class="fleet">
      <span class="grow">${n} ${type.name.toLowerCase()}${n === 1 ? '' : 's'}<small>${type.capacity} ${carries === 'pax' ? 'seats' : 'units of cargo'} · ${money(type.runningPerMonth)}/month</small></span>
      <button class="ghost step" data-act="sell:${l.id}.${carries}" aria-label="Sell a ${type.name.toLowerCase()}" ${n ? '' : 'disabled'}>−</button>
      <button class="primary buy" data-act="buy:${l.id}.${carries}">Buy ${money(type.price)}</button>
    </div>`;
  }

  private lineRow(w: World, l: Line): string {
    const n = w.vehiclesOn(l.id).length;
    return `<button class="list-row" data-act="open-line:${l.id}">
      <span class="dot" style="background:${THEME.lines[l.color]}"></span>
      <span class="grow">${l.name}<small>${n} vehicle${n === 1 ? '' : 's'}${n === 0 ? ' · needs a vehicle' : ''} · ${round(l.carriedLast)} carried</small></span>
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
    else if (!s.started) key = `start:${s.saved}`;
    else if (w.over) key = `over:${Math.round(w.delivered)}`;
    this.set(this.overlay, 'overlay', key, () => {
      if (this.help !== null) return this.helpCard();
      if (!s.started)
        return `<div class="overlay"><div class="card">
          <h1>Small Transit</h1>
          <p>Run a transport company in a river valley. Carry passengers between six towns and freight from farms and forests, and stay in the black.</p>
          <div class="actions">${
            s.saved
              ? '<button class="primary" data-act="resume">Continue</button><button class="ghost" data-act="start">New company</button>'
              : '<button class="primary" data-act="start">New company</button>'
          }<button class="ghost" data-act="help">How to play</button></div>
          ${s.saved ? '<p class="hint">Your company is saved every month and when you leave. A new company replaces it.</p>' : ''}
        </div></div>`;
      if (w.over) {
        const { year, month } = w.date();
        return `<div class="overlay"><div class="card">
          <h2>Bankrupt</h2>
          <p>Your company closed in ${MONTHS[month]} ${year} after carrying ${round(w.delivered)} passengers and ${round(w.deliveredCargo)} cargo.</p>
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

const ledgerRow = (label: string, n: number) => `<tr><th>${label}</th><td class="${n < 0 ? 'neg' : ''}">${n === 0 ? '·' : money(n)}</td></tr>`;
