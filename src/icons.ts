// The sidebar's icons: drawn with lines on one 24×24 grid, so that every
// tool's icon has the same size and its name starts at the same place.
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  launcher: svg(`<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>`),
  notes: svg(`<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2.5h6v3H9zM8.5 12l2 2 4-4M8.5 17.5h7"/>`),
  board: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16M5.5 8h1.5M11.5 8h1.5M17.5 8h1.5M11.5 12h1.5"/>`),
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

// The image editor's, on the same grid.
export const editIcons = {
  crop: svg(`<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h4M18 22v-4M10 6h6a2 2 0 0 1 2 2v6"/>`),
  adjust: svg(`<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>`),
  resize: svg(`<rect x="3" y="11" width="10" height="10" rx="1.5"/><path d="M13 3h8v8M21 3l-8 8"/>`),
  mark: markIcons.pen,
  frame: svg(`<rect x="2.5" y="2.5" width="19" height="19" rx="4"/><rect x="7" y="7" width="10" height="10" rx="1.5"/>`),
  pick: svg(`<path d="m14.5 5.5 4 4M4 20l1.5-4.5 9-9 3 3-9 9z"/><path d="m13 4 2.5-2.5a2.1 2.1 0 0 1 3 0l4 4a2.1 2.1 0 0 1 0 3L20 11"/>`),
  redo: svg(`<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>`),
  rotateLeft: svg(`<path d="M3 4v5h5"/><path d="M3.5 9A8.5 8.5 0 1 1 6 18"/>`),
  rotateRight: svg(`<path d="M21 4v5h-5"/><path d="M20.5 9A8.5 8.5 0 1 0 18 18"/>`),
  flipH: svg(`<path d="M12 3v18M9 7 3 17h6zM15 7l6 10h-6z"/>`),
  flipV: svg(`<path d="M3 12h18M7 9 17 3v6zM7 15l10 6v-6z"/>`),
  cutout: svg(`<circle cx="12" cy="7.5" r="3.5"/><path d="M5 21c.6-4.4 3.3-7 7-7s6.4 2.6 7 7"/><path d="M3 3h2M9 3h2M15 3h2M21 3v2M21 9v2M3 9v2M3 15v2" stroke-width="1.4"/>`),
  watermark: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 15.5 9.5 9l2.5 6.5M7.8 13.5h3.4M14 9h3.5M15.75 9v6.5" stroke-width="1.5"/><path d="m4 20 16-16" stroke-width="1.4"/>`),
  censor: svg(`<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke-width="1.1"/><path d="M3.6 3.6H9V9H3.6zM15 9h5.4v6H15zM9 15h6v5.4H9z" fill="currentColor" stroke="none"/>`),
  wand: svg(`<path d="m4 20 11-11M14 4l1 2.5L17.5 7.5 15 8.5 14 11l-1-2.5L10.5 7.5 13 6.5zM19 13l.5 1.5L21 15l-1.5.5L19 17l-.5-1.5L17 15l1.5-.5z"/>`),
  eraser: svg(`<path d="m7 21-4-4a2 2 0 0 1 0-2.8L13.2 4a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L10 21z"/><path d="M7 21h13M8.5 8.5l7 7"/>`),
  move: svg(`<path d="m5 3 14 7-6 1.8L10.5 18z"/><path d="m13 12 6 6"/>`),
  splitX: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>`),
  splitY: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18"/>`),
  join: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v4M12 16v4M9 12h6"/>`),
  eye: svg(`<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`),
  eyeOff: svg(`<path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2"/>`),
  grid: svg(`<rect x="3" y="3" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1"/>`),
};
