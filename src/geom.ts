// The image tool's arithmetic, kept apart from the pages so that it is
// tested on its own (.dev/test/image.test.ts): the crop box, and the long
// picture of 合并文档.
import type { Pt, Rect } from "./marks";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

// fitRatio is the largest box of a width / height r in a picture W × H,
// centered.
export function fitRatio(W: number, H: number, r: number): Rect {
  let w = W;
  let h = w / r;
  if (h > H) {
    h = H;
    w = h * r;
  }
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w: Math.round(w), h: Math.round(h) };
}

// resizeBox moves a handle (n, se, w…) of a box o to a point, within a
// picture W × H, keeping a width / height ratio when there is one (not 0).
export function resizeBox(o: Rect, h: string, p: Pt, W: number, H: number, ratio: number): Rect {
  let [l, t, r, b] = [o.x, o.y, o.x + o.w, o.y + o.h];
  if (h.includes("w")) l = clamp(p.x, 0, r - 1);
  if (h.includes("e")) r = clamp(p.x, l + 1, W);
  if (h.includes("n")) t = clamp(p.y, 0, b - 1);
  if (h.includes("s")) b = clamp(p.y, t + 1, H);
  if (ratio) {
    let w = r - l;
    let hh = b - t;
    const horiz = h.includes("e") || h.includes("w");
    const vert = h.includes("n") || h.includes("s");
    if (horiz && (!vert || w / ratio >= hh)) hh = w / ratio;
    else w = hh * ratio;
    // Within the picture, from the side that does not move.
    const maxW = h.includes("w") ? r : h.includes("e") ? W - l : Math.min(o.x + o.w / 2, W - o.x - o.w / 2) * 2;
    const maxH = h.includes("n") ? b : h.includes("s") ? H - t : Math.min(o.y + o.h / 2, H - o.y - o.h / 2) * 2;
    const k = Math.min(1, maxW / w, maxH / hh);
    w *= k;
    hh *= k;
    if (h.includes("w")) l = r - w;
    else if (h.includes("e")) r = l + w;
    else {
      l = o.x + o.w / 2 - w / 2;
      r = l + w;
    }
    if (h.includes("n")) t = b - hh;
    else if (h.includes("s")) b = t + hh;
    else {
      t = o.y + o.h / 2 - hh / 2;
      b = t + hh;
    }
  }
  return { x: Math.round(l), y: Math.round(t), w: Math.max(1, Math.round(r - l)), h: Math.max(1, Math.round(b - t)) };
}

// The longest picture a canvas holds; Chromium's limit is 32767.
export const maxLong = 32000;

// longLayout lays pictures of sizes dims out one over another, as wide as
// the widest (at most max, unless 0, and 8000), with a margin of the
// width around and between them (0 none, 1 2%, 2 5%); too long a picture
// is made narrower. It returns the width, the margin and each one's
// height.
export function longLayout(dims: [number, number][], max: number, margin: number) {
  let width = Math.max(...dims.map(([w]) => w));
  if (max) width = Math.min(width, max);
  width = Math.min(width, 8000);
  const gapOf = (w: number) => Math.round(w * [0, 0.02, 0.05][margin]!);
  const heightsAt = (w: number) => dims.map(([pw, ph]) => Math.max(1, Math.round((ph * (w - 2 * gapOf(w))) / pw)));
  const total = (w: number) => heightsAt(w).reduce((s, h) => s + h, 0) + gapOf(w) * (dims.length + 1);
  let shrunk = false;
  while (total(width) > maxLong && width > 1) {
    width = Math.max(1, Math.floor((width * maxLong) / total(width)) - (shrunk ? 1 : 0));
    shrunk = true;
  }
  return { width, gap: gapOf(width), heights: heightsAt(width), height: total(width), shrunk };
}
