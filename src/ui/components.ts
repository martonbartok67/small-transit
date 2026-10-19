import { THEME } from '../render/theme';
import type { Line, VehicleKind } from '../sim/types';
import { money } from '../sim/world';
import { ICON } from './icons';

/* HTML building blocks shared by every page and inspector, in the transit-signage style. */

export type Live = { text: string; bad?: boolean };

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const round = (x: number) => Math.round(x).toLocaleString('en-US');
export const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? '' : s.endsWith('s') ? 'es' : 's'}`;

/** A live value: rendered once with its id, then patched each update without rebuilding the panel. */
export const lv = (id: string, v: Live) => `<b data-live="${id}" class="${v.bad ? 'neg' : ''}">${v.text}</b>`;
export const val = (text: string, bad = false) => `<b class="${bad ? 'neg' : ''}">${text}</b>`;

/** Dark text on light line colours (yellow), white on the rest. */
function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 170 ? '#111418' : '#ffffff';
}

/** The number at the end of a line's name, shown inside its bullet. */
export const lineNo = (l: Line) => l.name.match(/\d+$/)?.[0] ?? String(l.id + 1);

/** A line bullet as on a metro map: rail lines square, road lines round. */
export function bullet(l: Line, size: 'sm' | 'md' | 'lg' = 'md'): string {
  const c = THEME.lines[l.color];
  return `<span class="bullet ${l.mode} ${size}" style="background:${c};color:${inkOn(c)}">${lineNo(l)}</span>`;
}

/** A plain coloured bullet with any label, for menus and help steps. */
export function marker(color: string, label: string, shape: 'rail' | 'road' = 'rail'): string {
  return `<span class="bullet ${shape} md" style="background:${color};color:${inkOn(color)}">${label}</span>`;
}

export const VEHICLE_ICON: Record<VehicleKind, string> = { train: ICON.train, freight: ICON.freight, bus: ICON.bus, truck: ICON.truck };

/** A pictogram on a tinted tile. */
export const tile = (icon: string, color: string, size: 'md' | 'lg' = 'md') => `<span class="picto ${size}" style="--c:${color}">${icon}</span>`;

/** A small coloured square with a label, for cargo. */
export const chip = (color: string, label: string) => `<span class="chip"><i style="background:${color}"></i>${label}</span>`;

/** KPI strip: labelled numbers side by side, separated by hairlines. */
export function board(cells: { label: string; value: string; note?: string }[]): string {
  return `<div class="board">${cells.map((c) => `<div class="cell"><small>${c.label}</small>${c.value}${c.note ? `<em>${c.note}</em>` : ''}</div>`).join('')}</div>`;
}

/** A section label in signage caps, with a rule running to the right edge. */
export const section = (label: string, aside = '') => `<div class="section"><h3>${label}</h3><span class="rule"></span>${aside}</div>`;

/** A list row: leading badge, title with meta below, trailing value, and a chevron when it opens something. */
export function row(o: { act?: string; lead?: string; title: string; meta?: string; trail?: string; chevron?: boolean }): string {
  const inner = `${o.lead ? `<span class="lead">${o.lead}</span>` : ''}<span class="grow"><span class="t">${o.title}</span>${o.meta ? `<small>${o.meta}</small>` : ''}</span>${o.trail ? `<span class="trail">${o.trail}</span>` : ''}${o.chevron ?? !!o.act ? `<span class="chev">${ICON.chevron}</span>` : ''}`;
  return o.act ? `<button class="row" data-act="${o.act}">${inner}</button>` : `<div class="row">${inner}</div>`;
}

export const list = (rows: string[]) => `<div class="list">${rows.join('')}</div>`;

export function segs(items: { act: string; label: string; on: boolean }[]): string {
  return `<div class="segs" style="--n:${items.length};--i:${Math.max(0, items.findIndex((i) => i.on))}"><i class="seg-thumb"></i>${items.map((i) => `<button class="seg${i.on ? ' on' : ''}" data-act="${i.act}">${i.label}</button>`).join('')}</div>`;
}

export function stepper(o: { down: string; up: string; value: string; downOff?: boolean; upOff?: boolean; label: string }): string {
  return `<div class="stepper">
    <button data-act="${o.down}" aria-label="Less ${o.label}" ${o.downOff ? 'disabled' : ''}>${ICON.minus}</button>
    <b>${o.value}</b>
    <button data-act="${o.up}" aria-label="More ${o.label}" ${o.upOff ? 'disabled' : ''}>${ICON.plus}</button>
  </div>`;
}

export const switchRow = (act: string, on: boolean, title: string, meta: string) =>
  `<button class="switch${on ? ' on' : ''}" data-act="${act}" role="switch" aria-checked="${on}"><span class="grow"><span class="t">${title}</span><small>${meta}</small></span><i></i></button>`;

export const button = (kind: 'primary' | 'secondary' | 'danger', act: string, label: string, opts: { icon?: string; off?: boolean; wide?: boolean } = {}) =>
  `<button class="btn ${kind}${opts.wide ? ' wide' : ''}" data-act="${act}" ${opts.off ? 'disabled' : ''}>${opts.icon ?? ''}<span>${label}</span></button>`;

export const actions = (...btns: string[]) => `<div class="actions">${btns.join('')}</div>`;

export const hint = (text: string) => `<p class="hint">${text}</p>`;

/** A horizontal fill bar. */
export const bar = (x: number, color = 'var(--signal)') => `<span class="bar"><i style="width:${Math.round(Math.max(0, Math.min(1, x)) * 100)}%;background:${color}"></i></span>`;

export const meter = (label: string, x: number, color?: string) =>
  `<div class="meter"><span class="grow">${label}</span>${bar(x, color)}<b>${pct(Math.min(1, x))}</b></div>`;

export function empty(icon: string, text: string, action = ''): string {
  return `<div class="empty"><span class="empty-icon">${icon}</span><p>${text}</p>${action}</div>`;
}

/** Up or down arrow with a value, for month-on-month changes. */
export const delta = (n: number, text = money(n)) => `<span class="delta ${n < 0 ? 'down' : 'up'}">${n < 0 ? '▼' : '▲'} ${text.replace('-', '')}</span>`;

/** A line's route as on a station's strip map: a bar in the line colour with each stop on it. */
export function stripMap(stops: { id: number; name: string; transfer: string }[], color: string, loop: boolean): string {
  return `<div class="strip" style="--c:${color}">${stops
    .map(
      (s, i) =>
        `<button class="stop${i === 0 || (!loop && i === stops.length - 1) ? ' end' : ''}" data-act="open-stop:${s.id}"><i></i><span class="grow">${s.name}</span>${s.transfer}<span class="chev">${ICON.chevron}</span></button>`,
    )
    .join('')}${loop ? '<div class="loop-note">Loop: back to the first stop</div>' : ''}</div>`;
}

/** A small line or bar chart as inline SVG, with its range on the right. */
export function chart(values: number[], opts: { color: string; bars?: boolean; count?: boolean }): string {
  if (values.length < 2) return hint('Not enough history yet. Check back after a few months.');
  const W = 300;
  const H = 76;
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
        return `<rect x="${(i * step + 1).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, step - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="${x < 0 ? 'var(--bad)' : opts.color}"/>`;
      })
      .join('');
  } else {
    const pts = values.map((x, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${y(x).toFixed(1)}`).join(' ');
    marks = `<polygon points="0,${y(0)} ${pts} ${W},${y(0)}" fill="${opts.color}" opacity="0.12"/><polyline points="${pts}" fill="none" stroke="${opts.color}" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  }
  const zero = min < 0 ? `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="rgba(17,20,24,.35)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : '';
  const fmt = (n: number) => (opts.count ? round(n) : money(n));
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${marks}${zero}</svg><span class="chart-max">${fmt(max)}</span><span class="chart-min">${fmt(min)}</span></div>`;
}

/** Tiny bars of the last few values, for list rows. */
export function spark(values: number[], color: string): string {
  const vs = values.slice(-6);
  if (vs.length < 2) return '';
  const m = Math.max(1, ...vs.map(Math.abs));
  return `<span class="spark">${vs.map((x) => `<i style="height:${Math.max(8, (Math.abs(x) / m) * 100)}%;background:${x < 0 ? 'var(--bad)' : color}"></i>`).join('')}</span>`;
}
