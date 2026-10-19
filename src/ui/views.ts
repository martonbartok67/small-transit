import { THEME } from '../render/theme';
import { CARGO_LABEL, CONFIG, INDUSTRY, modelsFor, TOWN_CARGO } from '../sim/config';
import { Economy } from '../sim/economy';
import type { Carries, Freight, Industry, Ledger, Line, Mode, Vehicle } from '../sim/types';
import { loadOf } from '../sim/vehicles';
import { money, type World } from '../sim/world';
import {
  actions,
  bar,
  board,
  bullet,
  button,
  chart,
  delta,
  empty,
  hint,
  list,
  lv,
  meter,
  pct,
  plural,
  round,
  row,
  section,
  segs,
  spark,
  stepper,
  stripMap,
  switchRow,
  tile,
  val,
  VEHICLE_ICON,
  type Live,
} from './components';
import { ICON } from './icons';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type LineFilter = 'all' | 'rail' | 'road' | 'losing';
export type WorldTab = 'towns' | 'industries';
export type CompanyTab = 'overview' | 'ledger' | 'bank' | 'news';

/** What the panel shows. The four pages open from the bottom bar; the rest inspect something on the map. */
export type Sheet =
  | { kind: 'lines'; filter?: LineFilter }
  | { kind: 'vehicles' }
  | { kind: 'world'; tab: WorldTab }
  | { kind: 'company'; tab: CompanyTab }
  | { kind: 'stop'; id: number }
  | { kind: 'line'; id: number; confirmDelete?: boolean }
  | { kind: 'buy'; line: number; carries: Carries }
  | { kind: 'vehicle'; id: number }
  | { kind: 'town'; id: number }
  | { kind: 'industry'; id: number };

export const PAGES = ['lines', 'vehicles', 'world', 'company'] as const;
export const isPage = (s: Sheet) => (PAGES as readonly string[]).includes(s.kind);

/** A rendered panel: structure (rebuilt only when `key` changes) plus live values patched in place. */
export interface View {
  key: string;
  /** Header markup: a title block, a line bullet, or a station nameplate. */
  head: string;
  body: string;
  live: Record<string, Live>;
}

const FREIGHT_LABEL = (f: Freight) => (f === 'pax' ? 'Passengers' : CARGO_LABEL[f]);
const MODE_ICON: Record<Mode, string> = { rail: ICON.train, road: ICON.bus };

const title = (t: string, sub: string, lead = '') => `${lead}<div class="grow"><h2>${t}</h2><p>${sub}</p></div>`;
const pageTitle = (t: string, sub: string) => `<div class="grow page-title"><h2>${t}</h2><p>${sub}</p></div>`;

export function view(w: World, sh: Sheet, graphics: boolean): View | null {
  switch (sh.kind) {
    case 'lines':
      return linesPage(w, sh.filter ?? 'all');
    case 'vehicles':
      return fleetPage(w);
    case 'world':
      return worldPage(w, sh.tab);
    case 'company':
      return companyPage(w, sh.tab, graphics);
    case 'stop':
      return stopView(w, sh.id);
    case 'line':
      return lineView(w, sh.id, !!sh.confirmDelete);
    case 'buy':
      return buyView(w, sh.line, sh.carries);
    case 'vehicle':
      return vehicleView(w, sh.id);
    case 'town':
      return townView(w, sh.id);
    case 'industry':
      return industryView(w, sh.id);
  }
}

// ---------- pages ----------

/** A stop's name without "Station" or "Stop", for tight spaces. */
const short = (name: string) => name.replace(/ (Station|Stop)( \d+)?$/, '$2').replace(/ Centre\b/, '');

function ends(w: World, l: Line): string {
  const name = (id: number) => short(w.stopById(id)?.name ?? '?');
  if (l.loop) return `Loop · ${plural(l.stops.length, 'stop')}`;
  return `${name(l.stops[0])} ⇄ ${name(l.stops[l.stops.length - 1])}`;
}

function lineRow(w: World, l: Line): string {
  const n = w.vehiclesOn(l.id).length;
  return row({
    act: `open-line:${l.id}`,
    lead: bullet(l),
    title: ends(w, l),
    meta: n ? `${plural(n, 'vehicle')} · ${round(l.carriedLast)} carried` : '<span class="warn-text">Needs a vehicle</span>',
    trail: `${spark(l.history, THEME.lines[l.color])}${val(money(l.profitLast), l.profitLast < 0)}`,
  });
}

function linesPage(w: World, filter: LineFilter): View {
  const total = w.lines.reduce((n, l) => n + l.profitLast, 0);
  const carried = w.lines.reduce((n, l) => n + l.carriedLast, 0);
  const shown = w.lines.filter((l) => (filter === 'all' ? true : filter === 'losing' ? l.profitLast < 0 : l.mode === filter));
  const losing = w.lines.filter((l) => l.profitLast < 0).length;
  const f = (k: LineFilter, label: string) => ({ act: `filter:${k}`, label, on: filter === k });
  return {
    key: `lines|${filter}|${w.month}|${w.lines.map((l) => `${l.id}:${w.vehiclesOn(l.id).length}`).join()}`,
    head: pageTitle('Lines', `${plural(w.lines.length, 'line')} · ${plural(w.vehicles.length, 'vehicle')}`),
    body: w.lines.length
      ? `${board([
          { label: 'Profit', value: val(money(total), total < 0), note: 'last month' },
          { label: 'Carried', value: val(round(carried)), note: 'last month' },
          { label: 'Losing', value: val(String(losing), losing > 0), note: plural(losing, 'line') },
        ])}
        ${segs([f('all', 'All'), f('rail', 'Rail'), f('road', 'Road'), f('losing', 'Losing')])}
        ${shown.length ? list(shown.map((l) => lineRow(w, l))) : hint('No lines match.')}`
      : empty(
          ICON.navLines,
          'No lines yet. Build two stations, then drag from one to the other on the map to join them.',
          button('primary', 'build', 'Build a station', { icon: ICON.plus }),
        ),
    live: {},
  };
}

function vehicleRow(w: World, v: Vehicle, live: Record<string, Live>): string {
  const x = loadOf(v) / v.type.capacity;
  live[`load-${v.id}`] = { text: pct(x) };
  return row({
    act: `open-vehicle:${v.id}`,
    lead: tile(VEHICLE_ICON[v.type.kind], v.type.livery),
    title: v.type.name,
    meta: `${w.ageYears(v).toFixed(1)} years · ${money(w.runningCost(v))}/month`,
    trail: `<span class="load">${bar(x)}${lv(`load-${v.id}`, { text: pct(x) })}</span>`,
  });
}

function fleetPage(w: World): View {
  const live: Record<string, Live> = {};
  const running = w.vehicles.reduce((n, v) => n + w.runningCost(v), 0);
  const avg = w.vehicles.length ? w.vehicles.reduce((n, v) => n + loadOf(v) / v.type.capacity, 0) / w.vehicles.length : 0;
  live.avg = { text: pct(avg) };
  const groups = w.lines
    .map((l) => ({ l, vs: w.vehiclesOn(l.id) }))
    .filter((g) => g.vs.length)
    .map((g) => `${section(`${bullet(g.l, 'sm')} ${ends(w, g.l)}`, `<span class="count">${g.vs.length}</span>`)}${list(g.vs.map((v) => vehicleRow(w, v, live)))}`);
  const orphans = w.vehicles.filter((v) => v.line < 0 || !w.lineById(v.line));
  if (orphans.length) groups.push(`${section('Being sold')}${list(orphans.map((v) => vehicleRow(w, v, live)))}`);
  return {
    key: `vehicles|${w.month}|${w.vehicles.map((v) => `${v.id}${v.type.key}${v.line}`).join()}`,
    head: pageTitle('Fleet', `${plural(w.vehicles.length, 'vehicle')} on ${plural(w.lines.length, 'line')}`),
    body: w.vehicles.length
      ? `${board([
          { label: 'Vehicles', value: val(String(w.vehicles.length)) },
          { label: 'Running', value: val(money(running)), note: 'a month' },
          { label: 'Avg load', value: lv('avg', live.avg) },
        ])}${groups.join('')}`
      : empty(ICON.navFleet, 'No vehicles yet. Open a line and buy a train, bus or truck to start service.', button('secondary', 'nav:lines', 'Open lines')),
    live,
  };
}

function worldPage(w: World, tab: WorldTab): View {
  const pop = w.towns.reduce((n, t) => n + t.pop, 0);
  const t = (k: WorldTab, label: string) => ({ act: `world:${k}`, label, on: tab === k });
  let body = '';
  if (tab === 'towns') {
    const towns = [...w.towns].sort((a, b) => b.pop - a.pop);
    body = list(
      towns.map((tw) =>
        row({
          act: `open-town:${tw.id}`,
          lead: tile(ICON.town, '#5b6670'),
          title: tw.name,
          meta: `${round(tw.tripsLast)} trips · ${round(tw.supplyLast)} deliveries`,
          trail: `<span class="stack">${val(round(tw.pop))}${delta(tw.growthLast, `+${round(tw.growthLast)}`)}</span>`,
        }),
      ),
    );
  } else {
    body = list(
      w.industries.map((i) => {
        const out = i.accepts ? i.receivedLast : i.rate;
        const shipped = i.producedLast > 0 ? i.shippedLast / i.producedLast : 0;
        return row({
          act: `open-industry:${i.id}`,
          lead: tile(ICON.factory, THEME.cargo[i.produces]),
          title: i.name,
          meta: `${INDUSTRY[i.kind].label} · ${CARGO_LABEL[i.produces]} ${round(out)}/month`,
          trail: `<span class="stack">${val(i.producedLast > 0 ? pct(shipped) : '·')}<small>shipped</small></span>`,
        });
      }),
    );
  }
  return {
    key: `world|${tab}|${w.month}`,
    head: pageTitle('World', 'Six towns and eight industries in the valley'),
    body: `${board([
      { label: 'People', value: val(round(pop)) },
      { label: 'Reach a stop', value: val(pct(w.coverage())) },
      { label: 'Delivered', value: val(round(w.delivered + w.deliveredCargo)) },
    ])}${segs([t('towns', 'Towns'), t('industries', 'Industries')])}${body}`,
    live: {},
  };
}

function companyPage(w: World, tab: CompanyTab, graphics: boolean): View {
  const e = w.econ;
  const { year, month } = w.date();
  const t = (k: CompanyTab, label: string) => ({ act: `company:${k}`, label, on: tab === k });
  const live: Record<string, Live> = {
    cash: { text: money(e.cash), bad: e.cash < 0 },
    value: { text: money(w.companyValue()) },
    loan: { text: money(e.loan) },
    monthNet: { text: money(Economy.net(e.month)), bad: Economy.net(e.month) < 0 },
  };
  let body = '';
  let key = `company|${tab}|${w.month}|${graphics}`;
  if (tab === 'overview') {
    const last = Economy.net(e.last);
    body = `${board([
      { label: 'Cash', value: lv('cash', live.cash) },
      { label: 'Value', value: lv('value', live.value) },
      { label: 'This month', value: lv('monthNet', live.monthNet), note: `Last month ${delta(last)}` },
    ])}
      ${section(`Cash, last ${e.history.length} months`)}
      ${chart(
        e.history.map((h) => h.cash),
        { color: '#0a5bd3' },
      )}
      ${section('Operating profit')}
      ${chart(
        e.history.map((h) => h.operating),
        { bars: true, color: '#0a8f4e' },
      )}
      ${hint(`Income less running costs, before building and buying vehicles. ${round(w.delivered)} passengers and ${round(w.deliveredCargo)} cargo delivered so far.`)}
      ${section('Game')}
      ${list([row({ act: 'help', lead: tile(ICON.help, '#0a5bd3'), title: 'How to play', meta: 'Six short pages' })])}
      ${switchRow('gfx', graphics, 'High graphics', 'Smoke, clouds, glints and glow. Turn off on slower phones.')}`;
  } else if (tab === 'ledger') {
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
    body = `<table class="ledger">
        <thead><tr><th></th><th>Last month</th><th>${year}</th><th>${year - 1}</th></tr></thead>
        <tbody>${rows.map(([label, k]) => `<tr><th>${label}</th>${cell(e.last[k])}${cell(e.year[k])}${cell(e.lastYear[k])}</tr>`).join('')}</tbody>
        <tfoot><tr><th>Net</th>${cell(Economy.net(e.last))}${cell(Economy.net(e.year))}${cell(Economy.net(e.lastYear))}</tr></tfoot>
      </table>
      ${hint(`${year} runs to the end of last month. Vehicles bought includes sales and renewals.`)}`;
  } else if (tab === 'bank') {
    key += `|${e.loan}|${e.price.rail}|${e.price.road}|${Math.round(e.cash / 1e5)}`;
    body = `${board([
      { label: 'Cash', value: lv('cash', live.cash) },
      { label: 'Loan', value: lv('loan', live.loan), note: `of ${money(CONFIG.maxLoan)}` },
      { label: 'Interest', value: val(`${money((e.loan * CONFIG.interestPerYear) / 12)}`), note: 'a month' },
    ])}
      <div class="loan-track">${bar(e.loan / CONFIG.maxLoan, 'var(--ink)')}</div>
      ${actions(
        button('primary', 'borrow', `Borrow ${money(CONFIG.loanStep)}`, { off: e.loan >= CONFIG.maxLoan }),
        button('secondary', 'repay', `Repay ${money(CONFIG.loanStep)}`, { off: !(e.loan > 0 && e.cash > 0) }),
      )}
      ${hint(`Interest is ${Math.round(CONFIG.interestPerYear * 100)}% a year, charged monthly.`)}
      ${section('Ticket prices')}
      ${priceRow(w, 'rail')}
      ${priceRow(w, 'road')}
      ${hint('Dearer tickets earn more per rider, but fewer people travel and towns grow slower. Freight rates are fixed.')}`;
  } else {
    const items = [...w.news].reverse();
    key += `|${w.news.length}`;
    body = items.length
      ? `<div class="timeline">${items
          .map((n) => `<div class="news ${n.tone}"><i></i><small>${MONTHS[n.month % 12]} ${CONFIG.startYear + Math.floor(n.month / 12)}</small><span>${n.text}</span></div>`)
          .join('')}</div>`
      : empty(ICON.news, 'Nothing yet. Towns passing milestones, new vehicle models and changes at industries appear here.');
  }
  return {
    key,
    head: pageTitle('Company', `${MONTHS[month]} ${year} · value ${money(w.companyValue())}`),
    body: `${segs([t('overview', 'Overview'), t('ledger', 'Ledger'), t('bank', 'Bank'), t('news', 'News')])}${body}`,
    live,
  };
}

function priceRow(w: World, mode: Mode): string {
  const level = w.econ.price[mode];
  const { min, max } = CONFIG.price;
  const km = mode === 'rail' ? 2 : 0.5;
  return `<div class="row">
    <span class="lead">${tile(MODE_ICON[mode], mode === 'rail' ? '#111418' : '#0a5bd3')}</span>
    <span class="grow"><span class="t">${mode === 'rail' ? 'Rail' : 'Road'}</span><small>${km} km trip ${money(w.ticket(mode, km * 1000))} · demand ${Math.round(w.econ.demand(mode) * 100)}%</small></span>
    ${stepper({ down: `price:${mode}-`, up: `price:${mode}+`, value: `${Math.round(level * 100)}%`, downOff: level <= min + 1e-9, upOff: level >= max - 1e-9, label: `${mode} price` })}
  </div>`;
}

// ---------- inspectors ----------

function lineView(w: World, id: number, confirmDelete: boolean): View | null {
  const l = w.lineById(id);
  if (!l) return null;
  const color = THEME.lines[l.color];
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
  const stops = l.stops.map((sid) => {
    const others = w.linesAt(sid).filter((o) => o.id !== l.id);
    return { id: sid, name: w.stopById(sid)?.name ?? '?', transfer: others.length ? `<span class="transfers">${others.map((o) => bullet(o, 'sm')).join('')}</span>` : '' };
  });
  const fleet = (carries: Carries) => {
    const mine = w.vehiclesOn(l.id, carries);
    const label = l.mode === 'rail' ? (carries === 'pax' ? 'Passenger trains' : 'Freight trains') : carries === 'pax' ? 'Buses' : 'Trucks';
    const kind = l.mode === 'rail' ? (carries === 'pax' ? 'train' : 'freight') : carries === 'pax' ? 'bus' : 'truck';
    const names = new Map<string, number>();
    for (const v of mine) names.set(v.type.name, (names.get(v.type.name) ?? 0) + 1);
    return `<div class="row fleet">
      <span class="lead">${tile(VEHICLE_ICON[kind], color)}</span>
      <span class="grow"><span class="t">${label}</span><small>${[...names].map(([n, k]) => `${k} × ${n}`).join(', ') || 'None yet'}</small></span>
      <button class="btn round" data-act="sell:${l.id}.${carries}" aria-label="Sell one" ${mine.length ? '' : 'disabled'}>${ICON.minus}</button>
      <b class="fleet-n">${mine.length}</b>
      <button class="btn round primary" data-act="buy-pick:${l.id}.${carries}" aria-label="Buy">${ICON.plus}</button>
    </div>`;
  };
  return {
    key: `line|${id}|${vs.map((v) => v.type.key).join()}|${l.stops.join()}|${l.fullLoad}|${confirmDelete}|${w.month}|${renew.length}|${w.networkVersion}`,
    head: title(l.name, `${l.mode === 'rail' ? 'Rail' : 'Road'} · ${plural(l.stops.length, 'stop')} · ${(len / 1000).toFixed(1)} km${l.loop ? ' · loop' : ''}`, bullet(l, 'lg')),
    body: `${board([
      { label: 'Profit', value: lv('profit', live.profit), note: 'last month' },
      { label: 'This month', value: lv('month', live.month) },
      { label: 'Carried', value: lv('carried', live.carried) },
      { label: 'On board', value: lv('board', live.board) },
    ])}
      ${section('Vehicles')}
      ${list([fleet('pax'), fleet('cargo')])}
      ${vs.length ? '' : hint('Tap + to buy a vehicle and start service.')}
      ${switchRow(`full-load:${l.id}`, l.fullLoad, 'Full load at the first stop', `Vehicles wait at ${w.stopById(l.stops[0])?.name ?? 'the first stop'} until full, up to a month. Best for freight.`)}
      ${actions(button('secondary', `renew:${l.id}`, renew.length ? `Renew ${plural(renew.length, 'vehicle')} · ${money(renewCost)}` : 'All vehicles are new', { icon: ICON.renew, off: !renew.length, wide: true }))}
      ${section('Route')}
      ${stripMap(stops, color, l.loop)}
      ${vs.length ? `${section('Running now')}${list(vs.map((v) => vehicleRow(w, v, live)))}` : ''}
      ${section(`Profit, last ${l.history.length} months`)}
      ${chart(l.history, { bars: true, color })}
      ${actions(button('danger', `delete-line:${l.id}`, confirmDelete ? 'Tap again to delete this line' : 'Delete line'))}`,
    live,
  };
}

function stopView(w: World, id: number): View | null {
  const st = w.stopById(id);
  if (!st) return null;
  const lines = w.linesAt(st.id);
  const inds = w.industriesAt(st);
  const by = w.waitingBy(st);
  const kinds = Object.keys(by) as Freight[];
  const cap = CONFIG.stop[st.mode].capacity;
  const total = w.waitingTotal(st);
  const town = st.town >= 0 ? w.towns[st.town].name : 'Countryside';
  const live: Record<string, Live> = { wait: { text: `${round(total)} / ${cap}`, bad: total >= cap * 0.9 }, res: { text: round(st.residents) }, fill: { text: pct(total / cap) } };
  for (const f of kinds) live[`w-${f}`] = { text: round(by[f]!) };
  return {
    key: `stop|${id}|${kinds.join()}|${lines.map((l) => l.id).join()}|${inds.length}|${st.town}`,
    // A station nameplate: the stop's name on a black band, with the lines that call here.
    head: `<div class="grow"><div class="nameplate ${st.mode}"><span class="np-icon">${MODE_ICON[st.mode]}</span><span class="np-name">${st.name}</span></div>
      <p>${st.mode === 'rail' ? 'Station' : 'Road stop'} · ${town}${lines.length ? ` · <span class="np-lines">${lines.map((l) => bullet(l, 'sm')).join('')}</span>` : ''}</p></div>`,
    body: `${board([
      { label: 'Waiting', value: lv('wait', live.wait) },
      { label: 'In reach', value: lv('res', live.res), note: 'residents' },
    ])}
      <div class="meter"><span class="grow">Platform full</span>${bar(total / cap, total >= cap * 0.9 ? 'var(--bad)' : 'var(--signal)')}${lv('fill', live.fill)}</div>
      ${section('Waiting for')}
      ${kinds.length ? list(kinds.map((f) => row({ lead: f === 'pax' ? tile(ICON.town, '#5b6670') : tile(ICON.factory, THEME.cargo[f]), title: FREIGHT_LABEL(f), trail: lv(`w-${f}`, live[`w-${f}`]) }))) : hint('Nobody is waiting.')}
      ${inds.length ? `${section('Industries in reach')}${list(inds.map((i) => row({ act: `open-industry:${i.id}`, lead: tile(ICON.factory, THEME.cargo[i.produces]), title: i.name, meta: INDUSTRY[i.kind].label })))}` : ''}
      ${section('Lines calling here')}
      ${lines.length ? list(lines.map((l) => lineRow(w, l))) : hint(`No line stops here yet. Drag from this ${st.mode === 'rail' ? 'station to another station' : 'stop to another road stop'} to build one.`)}
      ${lines.length === 0 ? actions(button('danger', `demolish:${st.id}`, 'Demolish')) : ''}`,
    live,
  };
}

function buyView(w: World, lineId: number, carries: Carries): View | null {
  const l = w.lineById(lineId);
  if (!l) return null;
  const year = w.date().year;
  const all = modelsFor(l.mode, carries);
  const have = w.vehiclesOn(l.id, carries).length;
  const cash = w.econ.cash;
  const top = (k: 'speed' | 'capacity' | 'runningPerMonth') => Math.max(...all.map((m) => m[k]));
  const spec = (label: string, x: number, text: string) => `<div class="spec"><small>${label}</small>${bar(x, 'var(--ink)')}<b>${text}</b></div>`;
  // What can be bought now first, newest on top; future models after, soonest first.
  const order = [...all.filter((m) => m.year <= year).reverse(), ...all.filter((m) => m.year > year)];
  const cards = order.map((m) => {
    const ok = m.year <= year;
    const room = w.vehiclesOn(l.id).length < CONFIG.maxVehiclesPerLine;
    return `<div class="model${ok ? '' : ' locked'}">
      <div class="model-head"><span class="livery" style="background:${m.livery}"></span>${tile(VEHICLE_ICON[m.kind], m.livery)}<span class="grow"><span class="t">${m.name}</span><small>${ok ? `Since ${m.year}` : `Available from ${m.year}`}</small></span></div>
      ${spec('Speed', m.speed / top('speed'), `${m.speed} km/h`)}
      ${spec(carries === 'pax' ? 'Seats' : 'Capacity', m.capacity / top('capacity'), String(m.capacity))}
      ${spec('Running', m.runningPerMonth / top('runningPerMonth'), `${money(m.runningPerMonth)}/mo`)}
      ${ok ? button('primary', `buy:${l.id}.${m.key}`, `Buy for ${money(m.price)}`, { off: cash < m.price || !room, wide: true }) : ''}
    </div>`;
  });
  const what = l.mode === 'rail' ? (carries === 'pax' ? 'a train' : 'a freight train') : carries === 'pax' ? 'a bus' : 'a truck';
  return {
    key: `buy|${lineId}|${carries}|${year}|${have}|${Math.floor(cash / 5e4)}`,
    head: title(`Buy ${what}`, `For ${l.name} · ${have} running · ${money(cash)} in the bank`, bullet(l, 'lg')),
    body: `<div class="models">${cards.join('')}</div>
      ${hint('Newer models carry more, faster, and cost less to run per seat, but more per vehicle: they pay on busy lines and lose money on quiet ones.')}`,
    live: {},
  };
}

function vehicleView(w: World, id: number): View | null {
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
  const built = CONFIG.startYear + Math.floor(v.bornAt / CONFIG.monthSeconds / 12);
  return {
    key: `vehicle|${id}|${v.type.key}|${w.month}|${[...by.keys()].join()}`,
    head: title(v.type.name, `${line ? line.name : 'No line'} · built ${built}`, tile(VEHICLE_ICON[v.type.kind], v.type.livery, 'lg')),
    body: `${board([
      { label: 'Load', value: lv('load', live.load) },
      { label: 'Heading', value: lv('where', live.where) },
      { label: 'Speed', value: lv('speed', live.speed) },
    ])}
      ${actions(button('primary', `follow:${v.id}`, 'Follow', { icon: ICON.follow }), line ? button('secondary', `open-line:${line.id}`, 'Open line') : '')}
      ${section('On board')}
      ${by.size ? list([...by].map(([f, k]) => row({ title: FREIGHT_LABEL(f), trail: val(round(k)) }))) : hint('Empty right now.')}
      ${section('Details')}
      ${list([
        row({ title: 'Age', trail: val(`${w.ageYears(v).toFixed(1)} years`) }),
        row({ title: 'Running cost', trail: val(`${money(w.runningCost(v))}/month`) }),
        row({ title: 'Resale value', trail: val(money(w.saleValue(v))) }),
      ])}
      ${hint(`Renewing now would bring a new ${model.name} for ${money(cost)}. Use Renew on the line to renew its fleet.`)}
      ${actions(button('danger', `sell-vehicle:${v.id}`, `Sell for ${money(w.saleValue(v))}`))}`,
    live,
  };
}

function townView(w: World, id: number): View | null {
  const t = w.towns[id];
  if (!t) return null;
  const g = CONFIG.growth;
  const mine = w.houses.filter((h) => h.town === t.id);
  const covered = mine.reduce((n, h) => n + (h.stop >= 0 ? h.residents : 0), 0) / Math.max(1, t.pop);
  const activity = Math.min(1, t.tripsLast / Math.max(1, t.pop * g.tripsPerResident));
  const supply = Math.min(1, t.supplyLast / Math.max(1, t.pop * g.supplyPerResident));
  return {
    key: `town|${id}|${w.month}`,
    head: title(t.name, `Town · room to grow to about ${round(t.basePop * g.capFactor)}`, tile(ICON.town, '#5b6670', 'lg')),
    body: `${board([
      { label: 'Population', value: val(round(t.pop)), note: delta(t.growthLast, `+${round(t.growthLast)}`) },
      { label: 'Reach a stop', value: val(pct(covered)) },
      { label: 'Trips', value: val(round(t.tripsLast)), note: 'last month' },
    ])}
      ${section('What makes it grow')}
      ${meter('Passenger service', activity)}
      ${meter('Deliveries', supply, 'var(--good)')}
      ${list(TOWN_CARGO.map((c) => row({ lead: tile(ICON.factory, THEME.cargo[c]), title: `${CARGO_LABEL[c]} delivered`, meta: 'last month', trail: val(round(t.supplyLastBy[c] ?? 0)) })))}
      ${hint(`Bring ${TOWN_CARGO.map((c) => CARGO_LABEL[c].toLowerCase()).join(', ')} to any stop in town, and carry its people: both bars full means the fastest growth.`)}
      ${section(`Population, last ${t.history.length} months`)}
      ${chart(t.history, { color: '#111418', count: true })}`,
    live: {},
  };
}

/** The supply chain this industry sits in, left to right, with it highlighted. */
function chain(w: World, ind: Industry): string {
  const node = (label: string, color: string, on: boolean) => `<span class="node${on ? ' on' : ''}"><i style="background:${color}"></i>${label}</span>`;
  const arrow = '<span class="arrow">→</span>';
  if (ind.accepts) {
    const from = w.industries.find((i) => i.produces === ind.accepts);
    const to = TOWN_CARGO.includes(ind.produces) ? node('Towns', '#5b6670', false) : '';
    return `<div class="chain">${from ? node(from.name, THEME.cargo[from.produces], false) + arrow : ''}${node(ind.name, THEME.cargo[ind.produces], true)}${to ? arrow + to : ''}</div>`;
  }
  const to = w.industries.find((i) => i.accepts === ind.produces);
  return `<div class="chain">${node(ind.name, THEME.cargo[ind.produces], true)}${to ? arrow + node(to.name, THEME.cargo[to.produces], false) + arrow + node('Towns', '#5b6670', false) : ''}</div>`;
}

function industryView(w: World, id: number): View | null {
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
    head: title(ind.name, `${INDUSTRY[ind.kind].label} · makes ${CARGO_LABEL[ind.produces].toLowerCase()}`, tile(ICON.factory, THEME.cargo[ind.produces], 'lg')),
    body: `${board([
      { label: `${CARGO_LABEL[ind.produces]} / month`, value: val(round(out)) },
      { label: 'Shipped', value: val(ind.producedLast > 0 ? pct(ind.shippedLast / ind.producedLast) : '·') },
      ...(ind.accepts ? [{ label: `${CARGO_LABEL[ind.accepts]} in`, value: val(round(ind.receivedLast)) }] : []),
    ])}
      ${section('Supply chain')}
      ${chain(w, ind)}
      <div class="callout${route ? ' ok' : ''}">${routeText}</div>
      ${hint(
        ind.accepts
          ? `Turns ${CARGO_LABEL[ind.accepts].toLowerCase()} into ${CARGO_LABEL[ind.produces].toLowerCase()}: what arrives one month leaves the next.`
          : 'Produces more when most of its output is shipped, and less when it piles up.',
      )}
      ${section(`Output, last ${ind.history.length} months`)}
      ${chart(ind.history, { bars: true, color: THEME.cargo[ind.produces], count: true })}`,
    live: {},
  };
}

/** Identity of a sheet, ignoring view state, to keep scroll position across rebuilds of the same sheet. */
export function sheetId(s: Sheet): string {
  return 'id' in s ? `${s.kind}:${s.id}` : s.kind === 'buy' ? `buy:${s.line}:${s.carries}` : s.kind;
}
