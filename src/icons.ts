// The sidebar's icons: drawn with lines on one 24×24 grid, so that every
// tool's icon has the same size and its name starts at the same place.
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  launcher: svg(`<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>`),
  notes: svg(`<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2.5h6v3H9zM8.5 12l2 2 4-4M8.5 17.5h7"/>`),
  monitor: svg(`<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>`),
  flow: svg(`<circle cx="5" cy="12" r="2.5"/><circle cx="19" cy="5.5" r="2.5"/><circle cx="19" cy="18.5" r="2.5"/><path d="M7.5 12h3c3 0 3-6.5 6-6.5M10.5 12c3 0 3 6.5 6 6.5"/>`),
  dev: svg(`<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>`),
  services: svg(`<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/>`),
  monitorOff: svg(`<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M4 3l16 16"/>`),
  clips: svg(`<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2M11.5 12.5h5M11.5 16h5"/>`),
  shot: svg(`<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>`),
  record: svg(`<rect x="2.5" y="5" width="14" height="14" rx="2"/><path d="m16.5 10 5-3v10l-5-3"/><circle cx="9.5" cy="12" r="2.5" fill="currentColor" stroke="none"/>`),
  image: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/>`),
  sidebar: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>`),
  settings: svg(
    `<path d="M4 6h3M11 6h9M4 12h9M17 12h3M4 18h1M9 18h11"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="7" cy="18" r="2"/>`,
  ),
};

// The screenshot toolbar's, on the same grid.
export const markIcons = {
  rect: svg(`<rect x="4" y="5" width="16" height="14" rx="1"/>`),
  ellipse: svg(`<ellipse cx="12" cy="12" rx="8.5" ry="7"/>`),
  arrow: svg(`<path d="M5 19 19 5M10 5h9v9"/>`),
  pen: svg(`<path d="M4 20c2-1 3-4 5-4s2 2 4 2 3-5 7-9M15 4l5 5"/>`),
  mosaic: svg(`<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" stroke-width="1.2"/><path d="M4.6 4.6h4.7v4.7H4.6zM14.7 4.6h4.7v4.7h-4.7zM9.3 9.3h5.4v5.4H9.3zM4.6 14.7h4.7v4.7H4.6zM14.7 14.7h4.7v4.7h-4.7z" fill="currentColor" stroke="none"/>`),
  text: svg(`<path d="M5 6V4h14v2M12 4v16M9 20h6"/>`),
  undo: svg(`<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>`),
  record: svg(`<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>`),
  long: svg(`<rect x="6" y="2.5" width="12" height="19" rx="1.5"/><path d="M9 9l3 3 3-3M9 14l3 3 3-3"/>`),
};
