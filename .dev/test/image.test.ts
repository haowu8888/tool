// bun test .dev/test/image.test.ts
// The image tool's arithmetic: 创造拼图's layout tree, the crop box, 合并文档's
// long picture, and drawing marks.
import { expect, test } from "bun:test";
import { fitRatio, longLayout, maxLong, resizeBox } from "../../src/geom";
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
