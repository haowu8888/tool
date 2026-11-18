// 去水印: the pixels of a mask filled in from the rest of the picture, by
// patches: coarse to fine, each patch over the hole takes its likeness
// from the picture around (PatchMatch), and the hole's pixels are the
// average of the patches over them (Wexler et al.). It works on a box
// around the mask only, so that the time goes with the watermark's size,
// not the picture's. No model: suited to logos and text of moderate size.
import type { Pixels } from "./cutout";

// The patches are R pixels from their center each way: 7 × 7 did as well
// as 9 × 9 on a watermark over hair and lace (.dev/js/wm-tune.ts), at a
// third of the time.
const R = 3;

// The channels worked on: red, green, blue and alpha, so that a
// transparent background fills in transparent.
const CH = 4;

// A level of the work: the box's colors (RGB, as floats), and which
// pixels are of the hole.
interface Level {
  w: number;
  h: number;
  c: Float32Array; // CH per pixel
  hole: Uint8Array; // 1 for a pixel to fill
}

// A small random generator, the same every time: the results are
// repeatable.
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function down(l: Level): Level {
  const w = Math.max(1, l.w >> 1);
  const h = Math.max(1, l.h >> 1);
  const c = new Float32Array(w * h * CH);
  const hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0;
      let any = 0;
      const o = (y * w + x) * CH;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(l.w - 1, x * 2 + dx);
          const sy = Math.min(l.h - 1, y * 2 + dy);
          const i = sy * l.w + sx;
          if (l.hole[i]) {
            any = 1;
            continue;
          }
          for (let k = 0; k < CH; k++) c[o + k] = c[o + k]! + l.c[i * CH + k]!;
          n++;
        }
      // A coarse pixel is of the hole if any of its fine ones is: what is
      // known at a level is known at every finer one.
      hole[y * w + x] = any;
      if (n) for (let k = 0; k < CH; k++) c[o + k]! /= n;
    }
  return { w, h, c, hole };
}

// diffuse fills the hole from its edge inward, each pixel the average of
// its filled neighbors: the start at the coarsest level.
function diffuse(l: Level) {
  const { w, h, c } = l;
  const done = new Uint8Array(w * h);
  let left = 0;
  for (let i = 0; i < w * h; i++) {
    done[i] = l.hole[i] ? 0 : 1;
    if (!done[i]) left++;
  }
  for (let pass = 0; left > 0 && pass < w + h; pass++) {
    const next: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (done[i]) continue;
      const x = i % w;
      let n = 0;
      const sum = [0, 0, 0, 0];
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1]) {
        if (j < 0 || !done[j]) continue;
        for (let k = 0; k < CH; k++) sum[k]! += c[j * CH + k]!;
        n++;
      }
      if (!n) continue;
      for (let k = 0; k < CH; k++) c[i * CH + k] = sum[k]! / n;
      next.push(i);
    }
    for (const i of next) done[i] = 1;
    left -= next.length;
  }
}

// sources are the centers of the patches wholly known and wholly within
// the level: where a patch's likeness may come from.
function sources(l: Level): Int32Array {
  const { w, h, hole } = l;
  const out: number[] = [];
  const bad = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++)
    if (hole[i]) {
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) bad[yy * w + xx] = 1;
        }
    }
  for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) if (!bad[y * w + x]) out.push(y * w + x);
  return Int32Array.from(out);
}

// targets are the centers of the patches that cover a pixel of the hole.
function targets(l: Level): Int32Array {
  const { w, h, hole } = l;
  const near = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++)
    if (hole[i]) {
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) near[yy * w + xx] = 1;
        }
    }
  const out: number[] = [];
  for (let i = 0; i < w * h; i++) if (near[i]) out.push(i);
  return Int32Array.from(out);
}

// dist is the squared difference of the patches at p and q, over the part
// of p's patch within the level, stopping once past best.
function dist(l: Level, p: number, q: number, best: number) {
  const { w, h, c } = l;
  const px = p % w;
  const py = (p - px) / w;
  const qx = q % w;
  const qy = (q - qx) / w;
  let s = 0;
  let n = 0;
  for (let dy = -R; dy <= R; dy++) {
    const y = py + dy;
    if (y < 0 || y >= h) continue;
    for (let dx = -R; dx <= R; dx++) {
      const x = px + dx;
      if (x < 0 || x >= w) continue;
      const a = (y * w + x) * CH;
      const b = ((qy + dy) * w + qx + dx) * CH;
      const d0 = c[a]! - c[b]!;
      const d1 = c[a + 1]! - c[b + 1]!;
      const d2 = c[a + 2]! - c[b + 2]!;
      const d3 = c[a + 3]! - c[b + 3]!;
      s += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3;
      n++;
    }
    if (s > best * n) break;
  }
  return n ? s / n : Infinity;
}

// match improves, for each target patch, which source patch is most like
// it: PatchMatch's propagation from the neighbors and random search.
function match(l: Level, tg: Int32Array, nnf: Int32Array, d: Float32Array, valid: Uint8Array, src: Int32Array, rand: () => number, iters: number) {
  const { w, h } = l;
  const tryQ = (k: number, p: number, q: number) => {
    if (q < 0 || !valid[q]) return;
    const e = dist(l, p, q, d[k]!);
    if (e < d[k]!) {
      d[k] = e;
      nnf[k] = q;
    }
  };
  // Which target a pixel is, to find a neighbor's match.
  const index = new Int32Array(w * h).fill(-1);
  tg.forEach((p, k) => (index[p] = k));
  for (let it = 0; it < iters; it++) {
    const fwd = it % 2 === 0;
    for (let n = 0; n < tg.length; n++) {
      const k = fwd ? n : tg.length - 1 - n;
      const p = tg[k]!;
      const x = p % w;
      const s = fwd ? -1 : 1;
      // Propagation: a neighbor's match, shifted back by one.
      const nx = x + s;
      if (nx >= 0 && nx < w) {
        const j = index[p + s]!;
        if (j >= 0) tryQ(k, p, nnf[j]! - s);
      }
      const ny = p + s * w;
      if (ny >= 0 && ny < w * h) {
        const j = index[ny]!;
        if (j >= 0) tryQ(k, p, nnf[j]! - s * w);
      }
      // Random search around the best, in a shrinking window, and once
      // anywhere.
      const q0 = nnf[k]!;
      const qx = q0 % w;
      const qy = (q0 - qx) / w;
      for (let rad = Math.max(w, h); rad >= 1; rad >>= 1) {
        const cx = Math.round(qx + (rand() * 2 - 1) * rad);
        const cy = Math.round(qy + (rand() * 2 - 1) * rad);
        if (cx >= 0 && cy >= 0 && cx < w && cy < h) tryQ(k, p, cy * w + cx);
      }
      tryQ(k, p, src[Math.floor(rand() * src.length)]!);
    }
  }
}

// vote sets each pixel of the hole to the average of what the matched
// patches over it say, the better matches weighing more.
function vote(l: Level, tg: Int32Array, nnf: Int32Array, d: Float32Array, sharp: boolean) {
  const { w, h, c, hole } = l;
  const sum = new Float32Array(w * h * CH);
  const wt = new Float32Array(w * h);
  // At the end the best matches weigh far more, for a sharper texture
  // than an average of them all.
  const sorted = Float32Array.from(d).sort();
  const sigma2 = Math.max(1e-3, sorted[Math.floor(sorted.length * (sharp ? 0.25 : 0.75))] ?? 1);
  for (let k = 0; k < tg.length; k++) {
    const p = tg[k]!;
    const q = nnf[k]!;
    const weight = Math.exp(-d[k]! / (2 * sigma2));
    const px = p % w;
    const py = (p - px) / w;
    const qx = q % w;
    const qy = (q - qx) / w;
    for (let dy = -R; dy <= R; dy++) {
      const y = py + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const x = px + dx;
        if (x < 0 || x >= w) continue;
        const i = y * w + x;
        if (!hole[i]) continue;
        const b = ((qy + dy) * w + qx + dx) * CH;
        for (let ch = 0; ch < CH; ch++) sum[i * CH + ch] = sum[i * CH + ch]! + c[b + ch]! * weight;
        wt[i] = wt[i]! + weight;
      }
    }
  }
  for (let i = 0; i < w * h; i++) if (hole[i] && wt[i]! > 0) for (let k = 0; k < CH; k++) c[i * CH + k] = sum[i * CH + k]! / wt[i]!;
}

// fillLevel fills a level's hole by patches, starting from the matches of
// the coarser level when there is one; it returns its matches.
function fillLevel(l: Level, rand: () => number, coarse: { l: Level; tg: Int32Array; nnf: Int32Array } | null, rounds: number, sharp: boolean) {
  const src = sources(l);
  const tg = targets(l);
  if (!src.length || !tg.length) return null;
  const valid = new Uint8Array(l.w * l.h);
  for (const q of src) valid[q] = 1;
  const nnf = new Int32Array(tg.length);
  const d = new Float32Array(tg.length);
  // The coarser level's match, scaled, where it gives one.
  const cIndex = coarse ? new Int32Array(coarse.l.w * coarse.l.h).fill(-1) : null;
  if (coarse) coarse.tg.forEach((p, k) => (cIndex![p] = k));
  for (let k = 0; k < tg.length; k++) {
    const p = tg[k]!;
    let q = src[Math.floor(rand() * src.length)]!;
    if (coarse) {
      const x = p % l.w;
      const y = (p - x) / l.w;
      const cx = Math.min(coarse.l.w - 1, x >> 1);
      const cy = Math.min(coarse.l.h - 1, y >> 1);
      const j = cIndex![cy * coarse.l.w + cx]!;
      if (j >= 0) {
        const cq = coarse.nnf[j]!;
        const qx = (cq % coarse.l.w) * 2 + (x & 1);
        const qy = Math.floor(cq / coarse.l.w) * 2 + (y & 1);
        const fq = qy * l.w + qx;
        if (qx < l.w && qy < l.h && valid[fq]) q = fq;
      }
    }
    nnf[k] = q;
    d[k] = dist(l, p, q, Infinity);
  }
  for (let r = 0; r < rounds; r++) {
    match(l, tg, nnf, d, valid, src, rand, 3);
    vote(l, tg, nnf, d, sharp && r === rounds - 1);
    for (let k = 0; k < tg.length; k++) d[k] = dist(l, tg[k]!, nnf[k]!, Infinity);
  }
  return { l, tg, nnf };
}

// inpaint returns the picture with the pixels of mask (1 = fill) made up
// from the rest of it. onProgress is told how far it is, 0 … 1, between
// the levels, when it may let the page draw.
export async function inpaint(p: Pixels, mask: Uint8Array, onProgress?: (done: number) => Promise<void> | void): Promise<Uint8ClampedArray<ArrayBuffer>> {
  const { width: W, height: H, data } = p;
  const out = new Uint8ClampedArray(data);
  let [l, t, r, b] = [W, H, -1, -1];
  for (let i = 0; i < W * H; i++)
    if (mask[i]) {
      const x = i % W;
      const y = (i - x) / W;
      if (x < l) l = x;
      if (x > r) r = x;
      if (y < t) t = y;
      if (y > b) b = y;
    }
  if (r < 0) return out;
  // The box: the mask with room around it to take patches from.
  const m = Math.max(24, Math.round(Math.max(r - l, b - t) * 0.8));
  const x0 = Math.max(0, l - m);
  const y0 = Math.max(0, t - m);
  const w = Math.min(W, r + m + 1) - x0;
  const h = Math.min(H, b + m + 1) - y0;
  const base: Level = { w, h, c: new Float32Array(w * h * CH), hole: new Uint8Array(w * h) };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y + y0) * W + x + x0) * 4;
      const j = y * w + x;
      // A transparent pixel's color says nothing: as black, as canvases
      // keep it.
      const a = data[i + 3]!;
      for (let k = 0; k < 3; k++) base.c[j * CH + k] = a ? data[i + k]! : 0;
      base.c[j * CH + 3] = a;
      base.hole[j] = mask[(y + y0) * W + x + x0] ? 1 : 0;
    }
  // Coarser levels until the hole is a few patches across.
  const levels = [base];
  for (;;) {
    const last = levels[levels.length - 1]!;
    if (Math.min(last.w, last.h) < 6 * R) break;
    let hw = 0;
    let hh = 0;
    // How large the hole is at this level.
    let [hl, ht, hr, hb] = [last.w, last.h, -1, -1];
    for (let i = 0; i < last.w * last.h; i++)
      if (last.hole[i]) {
        const x = i % last.w;
        const y = (i - x) / last.w;
        hl = Math.min(hl, x);
        hr = Math.max(hr, x);
        ht = Math.min(ht, y);
        hb = Math.max(hb, y);
      }
    hw = hr - hl + 1;
    hh = hb - ht + 1;
    if (Math.max(hw, hh) <= 2 * R + 2) break;
    const next = down(last);
    // Too coarse a level has too few patches to take the picture's shape
    // from, and the start would be wrong for all the finer ones; too few
    // levels leave a large hole to stripes.
    if (Math.min(next.w, next.h) < 40 || sources(next).length < 2 * targets(next).length) break;
    levels.push(next);
  }
  const rand = rng(7);
  diffuse(levels[levels.length - 1]!);
  let coarse: ReturnType<typeof fillLevel> = null;
  for (let i = levels.length - 1; i >= 0; i--) {
    const lv = levels[i]!;
    if (i < levels.length - 1) {
      // The hole starts as the coarser level's fill, scaled up.
      const up = levels[i + 1]!;
      for (let y = 0; y < lv.h; y++)
        for (let x = 0; x < lv.w; x++) {
          const j = y * lv.w + x;
          if (!lv.hole[j]) continue;
          const k = Math.min(up.h - 1, y >> 1) * up.w + Math.min(up.w - 1, x >> 1);
          for (let c = 0; c < CH; c++) lv.c[j * CH + c] = up.c[k * CH + c]!;
        }
    }
    const rounds = i === 0 ? 6 : 8;
    coarse = fillLevel(lv, rand, coarse, rounds, i === 0) ?? coarse;
    if (!coarse || coarse.l !== lv) diffuse(lv);
    await onProgress?.((levels.length - i) / levels.length);
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const j = y * w + x;
      if (!base.hole[j]) continue;
      const i = ((y + y0) * W + x + x0) * 4;
      for (let k = 0; k < CH; k++) out[i + k] = base.c[j * CH + k]!;
    }
  return out;
}

// grow makes a mask wider by n pixels each way: a watermark's soft edge
// goes too.
export function grow(mask: Uint8Array, w: number, h: number, n: number): Uint8Array {
  let cur = mask;
  for (let s = 0; s < n; s++) {
    const next = new Uint8Array(cur);
    for (let i = 0; i < w * h; i++) {
      if (cur[i]) continue;
      const x = i % w;
      if ((x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) || (i >= w && cur[i - w]) || (i < w * (h - 1) && cur[i + w])) next[i] = 1;
    }
    cur = next;
  }
  return cur;
}
