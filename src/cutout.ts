// 去背景: the background of a picture taken away by its color, from the
// edges inward (and from points clicked), so that what the outlines close
// in stays even when it is of the background's color, as a white dress on
// white. No model: it suits pictures on a plain background, as drawings
// and AI pictures. Kept apart from the page so that it is tested on its
// own (.dev/test/image.test.ts).

// Pixels is an ImageData's shape, RGBA from the top left.
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type RGB = [number, number, number];

// distance is how far two colors are: their largest channel difference.
const distance = (d: Uint8ClampedArray, i: number, c: RGB) => Math.max(Math.abs(d[i]! - c[0]), Math.abs(d[i + 1]! - c[1]), Math.abs(d[i + 2]! - c[2]));

// ringColor is the color most of a ring of pixels inset from the edges
// has: the commonest of their colors in coarse steps, averaged within that
// step; and how much of the ring it is.
function ringColor(p: Pixels, inset: number): { c: RGB; share: number } {
  const { data, width, height } = p;
  const w = width - 2 * inset;
  const h = height - 2 * inset;
  if (w < 2 || h < 2) return { c: [255, 255, 255], share: 0 };
  const buckets = new Map<number, [number, number, number, number]>();
  let all = 0;
  const add = (x: number, y: number) => {
    all++;
    const i = ((y + inset) * width + x + inset) * 4;
    if (data[i + 3]! < 128) return;
    const key = (data[i]! >> 4) * 256 + (data[i + 1]! >> 4) * 16 + (data[i + 2]! >> 4);
    const b = buckets.get(key) ?? [0, 0, 0, 0];
    b[0] += data[i]!;
    b[1] += data[i + 1]!;
    b[2] += data[i + 2]!;
    b[3]++;
    buckets.set(key, b);
  };
  for (let x = 0; x < w; x++) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    add(0, y);
    add(w - 1, y);
  }
  let best: [number, number, number, number] | null = null;
  for (const b of buckets.values()) if (!best || b[3] > best[3]) best = b;
  if (!best) return { c: [255, 255, 255], share: 0 };
  return { c: [Math.round(best[0] / best[3]), Math.round(best[1] / best[3]), Math.round(best[2] / best[3])], share: best[3] / all };
}

// frameInset is how far in from the edges the background is looked at: a
// few pixels, past the thin frame some pictures have.
const frameInset = (p: Pixels) => Math.max(3, Math.round(Math.min(p.width, p.height) * 0.01));

// borderColor is the background's color: what most of the edges are, a
// few pixels in.
export function borderColor(p: Pixels): RGB {
  return ringColor(p, frameInset(p)).c;
}

// fill marks, in bg, the pixels joined to the start ones (4 ways) whose
// color is within tol of ref.
function fill(p: Pixels, bg: Uint8Array, starts: number[], ref: RGB, tol: number) {
  const { data, width: w, height: h } = p;
  const stack: number[] = [];
  for (const s of starts) if (!bg[s] && distance(data, s * 4, ref) <= tol) stack.push(s);
  while (stack.length) {
    const i = stack.pop()!;
    if (bg[i]) continue;
    if (distance(data, i * 4, ref) > tol) continue;
    bg[i] = 1;
    const x = i % w;
    if (x > 0 && !bg[i - 1]) stack.push(i - 1);
    if (x < w - 1 && !bg[i + 1]) stack.push(i + 1);
    if (i >= w && !bg[i - w]) stack.push(i - w);
    if (i < w * (h - 1) && !bg[i + w]) stack.push(i + w);
  }
}

export interface CutOptions {
  border: boolean; // from the edges inward, by their color
  seeds: { x: number; y: number }[]; // points clicked, each by its own color
  tol: number; // 0 … 255, how far a color may be from the background's
}

// The width of the soft edge, in color distance beyond tol: a pixel that
// far from the background color is all picture.
const soft = 48;

// cutout returns the picture with its background transparent. The pixels
// along the cut are part picture, part background: they get an alpha by
// how far their color is from the background's, and the background's
// color taken out of them, so that no white seam stays around a figure.
export function cutout(p: Pixels, o: CutOptions): Uint8ClampedArray<ArrayBuffer> {
  const { data, width: w, height: h } = p;
  const n = w * h;
  const bg = new Uint8Array(n);
  // Which background color each removed pixel was measured against, for
  // the soft edge: the edges' color, or a seed's.
  const refs: RGB[] = [];
  const refOf = new Uint8Array(n);
  if (o.border) {
    const k = frameInset(p);
    const ref = ringColor(p, k).c;
    refs.push(ref);
    // A thin frame of another color around the picture goes too: the
    // pixels of the outer band of its color.
    const outer = ringColor(p, 0);
    if (outer.share > 0.5 && Math.max(...outer.c.map((v, i) => Math.abs(v - ref[i]!))) > 40) {
      const band = Math.max(o.tol, 60);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (x >= k && x < w - k && y >= k && y < h - k) continue;
          const i = y * w + x;
          if (distance(data, i * 4, outer.c) <= band) bg[i] = 1;
        }
    }
    // From the edges, and from the ring a few pixels in, past a frame.
    const starts: number[] = [];
    for (const d of [0, k])
      if (w > 2 * d && h > 2 * d) {
        for (let x = d; x < w - d; x++) starts.push(d * w + x, (h - 1 - d) * w + x);
        for (let y = d; y < h - d; y++) starts.push(y * w + d, y * w + w - 1 - d);
      }
    fill(p, bg, starts, ref, o.tol);
  }
  for (const s of o.seeds) {
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = y * w + x;
    const ref: RGB = [data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!];
    const before = bg.slice();
    fill(p, bg, [i], ref, o.tol);
    refs.push(ref);
    for (let j = 0; j < n; j++) if (bg[j] && !before[j]) refOf[j] = refs.length - 1;
  }
  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < n; i++) if (bg[i]) out[i * 4 + 3] = 0;
  // The soft edge: the picture's pixels beside the background.
  for (let i = 0; i < n; i++) {
    if (bg[i]) continue;
    const x = i % w;
    const nb = x > 0 && bg[i - 1] ? i - 1 : x < w - 1 && bg[i + 1] ? i + 1 : i >= w && bg[i - w] ? i - w : i < n - w && bg[i + w] ? i + w : -1;
    if (nb < 0) continue;
    const ref = refs[refOf[nb]!]!;
    const k = i * 4;
    const a = Math.min(1, Math.max(0, (distance(data, k, ref) - o.tol) / soft));
    if (a >= 1) continue;
    out[k + 3] = Math.round(data[k + 3]! * a);
    if (a > 0.05)
      for (let c = 0; c < 3; c++) out[k + c] = Math.round((data[k + c]! - ref[c]! * (1 - a)) / a);
  }
  return out;
}

// opaqueBox is the box of the pixels not (nearly) transparent, or null
// for none.
export function opaqueBox(p: Pixels): { x: number; y: number; w: number; h: number } | null {
  const { data, width: w, height: h } = p;
  let [l, t, r, b] = [w, h, -1, -1];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3]! > 8) {
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
  return r < 0 ? null : { x: l, y: t, w: r - l + 1, h: b - t + 1 };
}
