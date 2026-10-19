/* One icon set. Pictograms (filled, like station signs) for things in the world; thin glyphs for actions. */

const glyph = (d: string, w = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const picto = (d: string) => `<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="${d}"/></svg>`;

export const ICON = {
  // ---- actions ----
  pause: glyph('<path d="M9 5.5v13M15 5.5v13"/>', 3),
  play: picto('M8 4.8v14.4a.8.8 0 0 0 1.2.7l11.5-7.2a.8.8 0 0 0 0-1.4L9.2 4.1A.8.8 0 0 0 8 4.8z'),
  fast: picto('M3 6.2v11.6a.7.7 0 0 0 1.1.6l8.4-5.8a.7.7 0 0 0 0-1.2L4.1 5.6a.7.7 0 0 0-1.1.6zM12 6.2v11.6a.7.7 0 0 0 1.1.6l8.4-5.8a.7.7 0 0 0 0-1.2l-8.4-5.8a.7.7 0 0 0-1.1.6z'),
  faster: picto('M1 7v10l6-5zM8.5 7v10l6-5zM16 7v10l6-5z'),
  layers: glyph('<path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5L12 21l9-4.5"/>'),
  back: glyph('<path d="M15 5l-7 7 7 7"/>', 2.6),
  close: glyph('<path d="M6 6l12 12M18 6L6 18"/>', 2.4),
  chevron: glyph('<path d="M9 5l7 7-7 7"/>', 2.4),
  plus: glyph('<path d="M12 5v14M5 12h14"/>', 2.8),
  minus: glyph('<path d="M5 12h14"/>', 2.8),
  check: glyph('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.8),
  renew: glyph('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/>'),
  follow: glyph('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  help: glyph('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8M12 17h.01"/>'),
  settings: glyph('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3"/>'),
  // ---- navigation ----
  navLines: glyph('<circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.4 6H14a4 4 0 0 1 4 4v5.6"/>'),
  navFleet: glyph('<rect x="3" y="5" width="18" height="12" rx="3"/><path d="M3 11h18M7.5 20v-3M16.5 20v-3"/>'),
  navWorld: glyph('<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  navCompany: glyph('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12.5h18"/>'),
  // ---- pictograms ----
  train: picto('M7.5 2h9A3.5 3.5 0 0 1 20 5.5v9a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 4 14.5v-9A3.5 3.5 0 0 1 7.5 2zM6.5 6v4.5h11V6zm1.75 7a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zm7.5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zM8.3 19h2.2l-1.8 3H6.5zm7.4 0h-2.2l1.8 3h2.2z'),
  bus: picto('M6.5 2h11A3.5 3.5 0 0 1 21 5.5V17a2 2 0 0 1-1.5 1.94V21h-3v-2h-9v2h-3v-2.06A2 2 0 0 1 3 17V5.5A3.5 3.5 0 0 1 6.5 2zM5.5 6v5.5h13V6zM7.5 14a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm9 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z'),
  truck: picto('M2 5.5h12V16H2zM15 8.5h3.6l3.4 4V16h-7zm1.6 1.5v3h3.6l-2.4-3zM6 15.5a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6zm11.5 0a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z'),
  freight: picto('M2 6.5h20v9H2zM4 8.5v5h3.5v-5zm5.5 0v5H13v-5zm5.5 0v5h3.5v-5zM6 16.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'),
  town: picto('M2.5 21v-9.5L8.5 6l6 5.5V21H11v-5H6v5zM15.5 21V8.5H22V21zm2-10v2h2.5v-2zm0 4v2h2.5v-2z'),
  factory: picto('M2 21V11l6 3.5V11l6 3.5V3.5h4V21zm3-4v2h2.5v-2zm5 0v2h2.5v-2zM19 21V8h3v13z'),
  demolish: picto('M9 2.5h6l.8 2H20V7H4V4.5h4.2zM5.5 8.5h13L17.3 21H6.7zM9 11v7.5h1.8V11zm4.2 0v7.5H15V11z'),
  coin: picto('M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-.9 4v1.3c-1.8.3-3 1.5-3 3.1 0 1.9 1.5 2.6 3.3 3l.6.2c1.2.3 1.6.6 1.6 1.2 0 .7-.7 1.1-1.7 1.1-1.1 0-1.9-.5-2.1-1.4H8c.2 1.8 1.4 2.9 3.1 3.2V19h1.8v-1.3c1.9-.3 3.1-1.5 3.1-3.2 0-1.9-1.4-2.6-3.4-3.1l-.5-.1c-1.1-.3-1.5-.6-1.5-1.1 0-.6.6-1 1.5-1 .9 0 1.6.4 1.8 1.2h2c-.2-1.7-1.3-2.8-3-3.1V6z'),
  news: picto('M4 3h13v16a2 2 0 0 0 2 2H5a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1zm2.5 3.5v3h8v-3zm0 5v1.5h8V11.5zm0 3.5v1.5h6V15zM18.5 7H21v12.5a1.25 1.25 0 0 1-2.5 0z'),
};
