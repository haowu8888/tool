// bun test .dev/test/image.test.ts
// The image tool's arithmetic: 创造拼图's layout tree, the crop box, 合并文档's
// long picture, drawing marks, and 去背景.
import { expect, test } from "bun:test";
import { borderColor, cutout, opaqueBox, type Pixels } from "../../src/cutout";
import { fitRatio, longLayout, maxLong, resizeBox } from "../../src/geom";
import { grow, inpaint } from "../../src/inpaint";
import { cover, findLeaf, joinLeaf, layout, leaves, moveInto, parentOf, splitLeaf, templates, type Leaf, type Node } from "../../src/layouttree";
import { dragMark, newMark, slip, type Mark } from "../../src/marks";

const tpl = (name: string) => templates.find(([n]) => n === name)![1]();
const box = { x: 0, y: 0, w: 1010, h: 1010 };

test("every template has the cells its name says", () => {
  const want: Record<string, number> = { 单张: 1, 左右: 2, 上下: 2, 三列: 3, 三行: 3, 四宫格: 4, 左一右二: 3, 上一下二: 3, 上二下一: 3, 左一右三: 4, 上一下三: 4, 六宫格: 6, 竖六格: 6, 九宫格: 9, 一大四小: 5 };
  for (const [name, make] of templates) expect([name, leaves(make()).length]).toEqual([name, want[name]!]);
});

test("cells fill the box, gap apart, and do not overlap", () => {
  for (const [name, make] of templates) {
    const { cells, lines } = layout(make(), box, 10);
    const rects = [...cells.values()];
    const area = rects.reduce((s, r) => s + r.w * r.h, 0);
    const gaps = lines.reduce((s, l) => s + l.r.w * l.r.h, 0);
    expect([name, Math.round(area + gaps)]).toEqual([name, 1010 * 1010]);
    for (const [i, a] of rects.entries())
      for (const b of rects.slice(i + 1)) {
        const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01;
        expect([name, overlap]).toEqual([name, false]);
      }
  }
  // 四宫格 at a gap of 10: four cells of 500.
  const { cells, lines } = layout(tpl("四宫格"), box, 10);
  expect([...cells.values()].map((r) => [r.x, r.y, r.w, r.h])).toEqual([
    [0, 0, 500, 500],
    [510, 0, 500, 500],
    [0, 510, 500, 500],
    [510, 510, 500, 500],
  ]);
  expect(lines.length).toBe(3);
});

test("splitting keeps the cell and its picture in the first part", () => {
  let root: Node = tpl("左右");
  const first = leaves(root)[0]!;
  first.img = "p1";
  root = splitLeaf(root, first.id, "y");
  const cells = leaves(root);
  expect(cells.length).toBe(3);
  expect(cells[0]!.id).toBe(first.id);
  expect(cells[0]!.img).toBe("p1");
  expect(cells[1]!.img).toBe("");
  expect(parentOf(root, first.id)!.dir).toBe("y");
  // The only cell splits too.
  const one = tpl("单张");
  expect(leaves(splitLeaf(one, one.id, "x")).length).toBe(2);
});

test("joining gives the cell's room to its neighbor and its picture to an empty cell", () => {
  let root: Node = tpl("左一右二");
  const [big, top, bottom] = leaves(root) as [Leaf, Leaf, Leaf];
  big.img = "a";
  top.img = "b";
  const r = joinLeaf(root, top.id)!;
  root = r.root;
  expect(r.left).toBe("");
  expect(leaves(root).map((l) => l.img)).toEqual(["a", "b"]); // b moved to the empty bottom cell
  expect(findLeaf(root, bottom.id)!.img).toBe("b");
  // No empty cell: the picture is left over.
  const r2 = joinLeaf(root, bottom.id)!;
  expect(r2.left).toBe("b");
  expect(leaves(r2.root).length).toBe(1);
  // The last cell cannot go.
  expect(joinLeaf(r2.root, big.id)).toBeNull();
});

test("a new layout takes the pictures in order, and gives back the rest", () => {
  const from = tpl("四宫格");
  leaves(from).forEach((l, i) => (l.img = `p${i}`));
  leaves(from)[1]!.img = ""; // an empty cell is skipped
  const to = tpl("左右");
  expect(moveInto(from, to)).toEqual(["p3"]);
  expect(leaves(to).map((l) => l.img)).toEqual(["p0", "p2"]);
});

test("a picture covers its cell, moved and zoomed within it", () => {
  const l: Leaf = { id: "x", img: "p", fx: 0.5, fy: 0.5, zoom: 1 };
  const cell = { x: 100, y: 100, w: 200, h: 200 };
  // A 400×200 picture in a square cell: as high as the cell, centered.
  expect(cover(l, cell, 400, 200)).toEqual({ x: 0, y: 100, w: 400, h: 200 });
  expect(cover({ ...l, fx: 0 }, cell, 400, 200).x).toBe(100); // its left edge at the cell's
  expect(cover({ ...l, fx: 1 }, cell, 400, 200).x).toBe(-100); // its right edge at the cell's
  expect(cover({ ...l, zoom: 2 }, cell, 400, 200)).toEqual({ x: -200, y: 0, w: 800, h: 400 });
});

test("the crop box keeps its ratio within the picture", () => {
  expect(fitRatio(1600, 900, 1)).toEqual({ x: 350, y: 0, w: 900, h: 900 });
  expect(fitRatio(900, 1600, 16 / 9)).toEqual({ x: 0, y: 547, w: 900, h: 506 });
  const o = { x: 100, y: 100, w: 400, h: 300 };
  // Free: the corner follows, within the picture.
  expect(resizeBox(o, "se", { x: 2000, y: 450 }, 1000, 800, 0)).toEqual({ x: 100, y: 100, w: 900, h: 350 });
  expect(resizeBox(o, "nw", { x: -50, y: -50 }, 1000, 800, 0)).toEqual({ x: 0, y: 0, w: 500, h: 400 });
  // 1:1 from the se corner: as far as the picture allows, the nw corner stays.
  for (const p of [
    { x: 700, y: 450 },
    { x: 5000, y: 5000 },
    { x: 120, y: 900 },
  ]) {
    const r = resizeBox(o, "se", p, 1000, 800, 1);
    expect(Math.abs(r.w - r.h)).toBeLessThanOrEqual(1);
    expect([r.x, r.y]).toEqual([100, 100]);
    expect(r.x + r.w).toBeLessThanOrEqual(1000);
    expect(r.y + r.h).toBeLessThanOrEqual(800);
  }
  // An edge at 16:9: the other side follows around the center.
  const e = resizeBox({ x: 200, y: 200, w: 320, h: 180 }, "e", { x: 680, y: 0 }, 1000, 800, 16 / 9);
  expect(e).toEqual({ x: 200, y: 155, w: 480, h: 270 });
});

test("the long picture is as wide as the widest, with its margin", () => {
  const dims: [number, number][] = [
    [800, 600],
    [600, 900],
    [1200, 500],
  ];
  const a = longLayout(dims, 0, 0);
  expect([a.width, a.gap, a.heights, a.height, a.shrunk]).toEqual([1200, 0, [900, 1800, 500], 3200, false]);
  const b = longLayout(dims, 1000, 1); // at most 1000 wide, 2% margin
  expect(b.width).toBe(1000);
  expect(b.gap).toBe(20);
  expect(b.heights).toEqual([720, 1440, 400]);
  expect(b.height).toBe(720 + 1440 + 400 + 4 * 20);
});

test("too long a picture is made narrower to fit a canvas", () => {
  const dims = Array.from({ length: 60 }, () => [1000, 3000] as [number, number]);
  const r = longLayout(dims, 0, 2);
  expect(r.shrunk).toBe(true);
  expect(r.height).toBeLessThanOrEqual(maxLong);
  expect(r.width).toBeGreaterThan(100);
});

test("marks follow the pointer, with Shift squared or at 45°", () => {
  const rect = newMark("rect", { x: 0, y: 0 }, 4) as Extract<Mark, { kind: "rect" }>;
  dragMark(rect, { x: 30, y: 10 }, true, 1);
  expect(rect.b).toEqual({ x: 30, y: 30 });
  const arrow = newMark("arrow", { x: 0, y: 0 }, 4) as Extract<Mark, { kind: "arrow" }>;
  dragMark(arrow, { x: 100, y: 10 }, true, 1);
  expect(arrow.b.y).toBeCloseTo(0, 6);
  dragMark(arrow, { x: 50, y: 60 }, true, 1);
  expect(arrow.b.x).toBeCloseTo(arrow.b.y, 6);
  // A stroke takes a point only once the pointer went the step.
  const pen = newMark("pen", { x: 0, y: 0 }, 2) as Extract<Mark, { kind: "pen" }>;
  dragMark(pen, { x: 1, y: 0 }, false, 1.5);
  dragMark(pen, { x: 2, y: 0 }, false, 1.5);
  expect(pen.pts.length).toBe(2);
  // A shape under 3 on both sides is a slip; a stroke never is.
  expect(slip(newMark("ellipse", { x: 0, y: 0 }, 2), 3)).toBe(true);
  expect(slip(rect, 3)).toBe(false);
  expect(slip(pen, 3)).toBe(false);
});

// A 40×40 white picture with a red ring, white inside it, and a gray dot
// on the white outside.
function ringPicture(): Pixels {
  const w = 40;
  const h = 40;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const set = (x: number, y: number, c: [number, number, number]) => data.set([...c, 255], (y * w + x) * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - 20, y - 20);
      if (d >= 8 && d <= 12) set(x, y, [220, 30, 30]);
    }
  set(3, 3, [190, 190, 190]);
  return { data, width: w, height: h };
}

const alphaAt = (p: Pixels, d: Uint8ClampedArray, x: number, y: number) => d[(y * p.width + x) * 4 + 3];

test("the background goes from the edges in; what the outline closes in stays", () => {
  const p = ringPicture();
  expect(borderColor(p)).toEqual([255, 255, 255]);
  const out = cutout(p, { border: true, seeds: [], tol: 20 });
  expect(alphaAt(p, out, 0, 0)).toBe(0); // the white outside
  expect(alphaAt(p, out, 20, 20)).toBe(255); // the white inside the ring
  expect(alphaAt(p, out, 30, 20)).toBe(255); // the ring
  expect(alphaAt(p, out, 3, 3)).toBeGreaterThan(200); // gray, far from white at 20: kept, its edge a little soft
  // A larger tolerance takes the gray dot too.
  expect(alphaAt(p, cutout(p, { border: true, seeds: [], tol: 80 }), 3, 3)).toBe(0);
  // A click inside takes the inside away, the ring stays.
  const seeded = cutout(p, { border: true, seeds: [{ x: 20, y: 20 }], tol: 20 });
  expect(alphaAt(p, seeded, 20, 20)).toBe(0);
  expect(alphaAt(p, seeded, 30, 20)).toBe(255);
  // Nothing asked for, nothing taken.
  expect([...cutout(p, { border: false, seeds: [], tol: 20 })]).toEqual([...p.data]);
});

test("the edge is soft, without the background's color in it", () => {
  // A white picture with a vertical band from white to red.
  const w = 30;
  const h = 4;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++)
    for (let x = 10; x < 20; x++) {
      const k = (x - 9) / 10; // 0.1 … 1
      data.set([255, Math.round(255 - 225 * k), Math.round(255 - 225 * k), 255], (y * w + x) * 4);
    }
  const p = { data, width: w, height: h };
  const out = cutout(p, { border: true, seeds: [], tol: 10 });
  // The first pixel past the tolerance is part transparent, and redder
  // than it looked over white.
  const firstKept = [...Array(10).keys()].map((k) => (1 * w + 10 + k) * 4).find((j) => out[j + 3]! > 0)!;
  expect(out[firstKept + 3]!).toBeLessThan(255);
  expect(out[firstKept + 1]!).toBeLessThan(data[firstKept + 1]!);
  // Deep in the band it is whole.
  expect(out[(1 * w + 19) * 4 + 3]).toBe(255);
});

test("the opaque box is what is left", () => {
  const p = ringPicture();
  const out = cutout(p, { border: true, seeds: [], tol: 80 });
  expect(opaqueBox({ data: out, width: 40, height: 40 })).toEqual({ x: 8, y: 8, w: 25, h: 25 });
  expect(opaqueBox({ data: new Uint8ClampedArray(16), width: 2, height: 2 })).toBeNull();
});

test("a thin frame around the picture goes with the background", () => {
  // The ring picture inside a dark frame 1 pixel wide.
  const p = ringPicture();
  for (let i = 0; i < 40; i++)
    for (const [x, y] of [
      [i, 0],
      [i, 39],
      [0, i],
      [39, i],
    ] as const)
      p.data.set([20, 20, 25, 255], (y * 40 + x) * 4);
  expect(borderColor(p)).toEqual([255, 255, 255]); // the background, not the frame
  const out = cutout(p, { border: true, seeds: [], tol: 20 });
  expect(alphaAt(p, out, 0, 0)).toBe(0); // the frame
  expect(alphaAt(p, out, 5, 20)).toBe(0); // the white inside the frame
  expect(alphaAt(p, out, 20, 20)).toBe(255); // inside the ring
  expect(alphaAt(p, out, 30, 20)).toBe(255);
});

// A picture of w × h by a function of x and y, and a mask of a box in it.
function made(w: number, h: number, f: (x: number, y: number) => [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...f(x, y), 255], (y * w + x) * 4);
  return { data, width: w, height: h };
}
function boxMask(w: number, h: number, x0: number, y0: number, bw: number, bh: number) {
  const m = new Uint8Array(w * h);
  for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) m[y * w + x] = 1;
  return m;
}
// The mean difference, in the mask, between a fill and the truth.
function err(a: Uint8ClampedArray, truth: Pixels, m: Uint8Array) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < m.length; i++)
    if (m[i]) {
      for (let k = 0; k < 3; k++) s += Math.abs(a[i * 4 + k]! - truth.data[i * 4 + k]!);
      n += 3;
    }
  return s / n;
}
// The truth with a "watermark" painted over the mask.
function marked(p: Pixels, m: Uint8Array): Pixels {
  const data = new Uint8ClampedArray(p.data);
  for (let i = 0; i < m.length; i++) if (m[i]) data.set([255, 0, 255, 255], i * 4);
  return { data, width: p.width, height: p.height };
}

test("a flat color and a gradient fill in as they were", async () => {
  const flat = made(60, 40, () => [40, 120, 200]);
  const m = boxMask(60, 40, 20, 12, 18, 10);
  expect(err(await inpaint(marked(flat, m), m), flat, m)).toBeLessThan(1);
  const grad = made(80, 50, (x) => [x * 3, 100, 255 - x * 3]);
  const m2 = boxMask(80, 50, 30, 15, 16, 14);
  expect(err(await inpaint(marked(grad, m2), m2), grad, m2)).toBeLessThan(12);
});

test("stripes go on through the hole", async () => {
  const stripes = made(96, 64, (x) => (x % 8 < 4 ? [20, 20, 20] : [230, 230, 230]));
  const m = boxMask(96, 64, 40, 24, 14, 14);
  const out = await inpaint(marked(stripes, m), m);
  // Each filled row is stripes again: dark and light alternating, not a
  // gray average.
  let gray = 0;
  for (let i = 0; i < m.length; i++) if (m[i] && out[i * 4]! > 70 && out[i * 4]! < 180) gray++;
  expect(gray / (14 * 14)).toBeLessThan(0.25);
  expect(err(out, stripes, m)).toBeLessThan(60);
  // The rest of the picture is untouched.
  for (let i = 0; i < m.length; i++) if (!m[i]) expect(out[i * 4]).toBe(stripes.data[i * 4]!);
});

test("a mask grows by its edge", () => {
  const m = boxMask(10, 10, 4, 4, 2, 2);
  expect(grow(m, 10, 10, 1).reduce((s, v) => s + v, 0)).toBe(4 + 8);
  expect(grow(m, 10, 10, 0)).toEqual(m);
});

test("a transparent background fills in transparent", async () => {
  // Left half opaque red, right half transparent; a hole on the right.
  const p = made(60, 40, (x) => (x < 30 ? [200, 30, 30] : [0, 0, 0]));
  for (let i = 0; i < 60 * 40; i++) if (i % 60 >= 30) p.data[i * 4 + 3] = 0;
  const m = boxMask(60, 40, 40, 14, 12, 12);
  const out = await inpaint(marked(p, m), m);
  let opaque = 0;
  for (let i = 0; i < m.length; i++) if (m[i] && out[i * 4 + 3]! > 40) opaque++;
  expect(opaque).toBe(0);
});
