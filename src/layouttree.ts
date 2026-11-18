// 创造拼图's layout: a tree whose nodes are a cell, or a split of a box in
// two along x (side by side) or y (one over the other). Kept apart from the
// page so that it is tested on its own (.dev/test/image.test.ts).
import type { Rect } from "./marks";

export interface Leaf {
  id: string;
  img: string; // a picture's id, "" for none
  fx: number; // where the picture sits when larger than the cell, 0 … 1
  fy: number;
  zoom: number; // over just covering the cell, 1 … 5
}

export interface Split {
  id: string;
  dir: "x" | "y";
  ratio: number; // the first part's share
  a: Node;
  b: Node;
}

export type Node = Leaf | Split;

export const isSplit = (n: Node): n is Split => "dir" in n;

let seq = 0;
export const uid = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;
export const leaf = (): Leaf => ({ id: uid(), img: "", fx: 0.5, fy: 0.5, zoom: 1 });
const X = (ratio: number, a: Node, b: Node): Split => ({ id: uid(), dir: "x", ratio, a, b });
const Y = (ratio: number, a: Node, b: Node): Split => ({ id: uid(), dir: "y", ratio, a, b });
const row = (n: number): Node => (n <= 1 ? leaf() : X(1 / n, leaf(), row(n - 1)));
const col = (n: number): Node => (n <= 1 ? leaf() : Y(1 / n, leaf(), col(n - 1)));
const grid = (cols: number, rows: number): Node => (rows <= 1 ? row(cols) : Y(1 / rows, row(cols), grid(cols, rows - 1)));

export const templates: [string, () => Node][] = [
  ["单张", () => leaf()],
  ["左右", () => row(2)],
  ["上下", () => col(2)],
  ["三列", () => row(3)],
  ["三行", () => col(3)],
  ["四宫格", () => grid(2, 2)],
  ["左一右二", () => X(0.5, leaf(), col(2))],
  ["上一下二", () => Y(0.5, leaf(), row(2))],
  ["上二下一", () => Y(0.5, row(2), leaf())],
  ["左一右三", () => X(0.6, leaf(), col(3))],
  ["上一下三", () => Y(0.62, leaf(), row(3))],
  ["六宫格", () => grid(3, 2)],
  ["竖六格", () => grid(2, 3)],
  ["九宫格", () => grid(3, 3)],
  ["一大四小", () => Y(0.62, leaf(), row(4))],
];

// leaves are the cells, left to right and top to bottom as the tree has
// them.
export function leaves(n: Node): Leaf[] {
  return isSplit(n) ? [...leaves(n.a), ...leaves(n.b)] : [n];
}

export const findLeaf = (root: Node, id: string) => leaves(root).find((l) => l.id === id) ?? null;

export function parentOf(root: Node, id: string): Split | null {
  if (!isSplit(root)) return null;
  if (root.a.id === id || root.b.id === id) return root;
  return parentOf(root.a, id) ?? parentOf(root.b, id);
}

// A line between two parts of a split: where it is, and the split's box.
export interface Line {
  node: Split;
  r: Rect;
  box: Rect;
}

// layout places the cells in a box, gap apart, and the lines between them.
export function layout(root: Node, box: Rect, gap: number) {
  const cells = new Map<string, Rect>();
  const lines: Line[] = [];
  const walk = (n: Node, r: Rect) => {
    if (!isSplit(n)) {
      cells.set(n.id, r);
      return;
    }
    if (n.dir === "x") {
      const aw = (r.w - gap) * n.ratio;
      walk(n.a, { x: r.x, y: r.y, w: aw, h: r.h });
      walk(n.b, { x: r.x + aw + gap, y: r.y, w: r.w - gap - aw, h: r.h });
      lines.push({ node: n, r: { x: r.x + aw, y: r.y, w: gap, h: r.h }, box: r });
    } else {
      const ah = (r.h - gap) * n.ratio;
      walk(n.a, { x: r.x, y: r.y, w: r.w, h: ah });
      walk(n.b, { x: r.x, y: r.y + ah + gap, w: r.w, h: r.h - gap - ah });
      lines.push({ node: n, r: { x: r.x, y: r.y + ah, w: r.w, h: gap }, box: r });
    }
  };
  walk(root, box);
  return { cells, lines };
}

// cover is where a cell's picture of iw × ih goes: covering the cell,
// zoomed, moved.
export function cover(l: Leaf, r: Rect, iw: number, ih: number): Rect {
  const s = Math.max(r.w / iw, r.h / ih) * l.zoom;
  const w = iw * s;
  const h = ih * s;
  return { x: r.x + (r.w - w) * l.fx, y: r.y + (r.h - h) * l.fy, w, h };
}

// replaceNode puts a node where the node of an id is; it returns the root.
export function replaceNode(root: Node, id: string, with_: Node): Node {
  if (root.id === id) return with_;
  const p = parentOf(root, id);
  if (p?.a.id === id) p.a = with_;
  else if (p) p.b = with_;
  return root;
}

// splitLeaf splits a cell in two along dir: the cell keeps its id and its
// picture in the first part. It returns the root.
export function splitLeaf(root: Node, id: string, dir: "x" | "y"): Node {
  const l = findLeaf(root, id);
  if (!l) return root;
  return replaceNode(root, id, { id: uid(), dir, ratio: 0.5, a: { ...l }, b: leaf() });
}

// joinLeaf takes a cell away, the other part of its split growing over
// it; the cell's picture goes to the first empty cell. It returns the
// root, and the picture that found no cell, "" for none; null when the
// cell is the only one.
export function joinLeaf(root: Node, id: string): { root: Node; left: string } | null {
  const p = parentOf(root, id);
  const gone = findLeaf(root, id);
  if (!p || !gone) return null;
  root = replaceNode(root, p.id, p.a.id === id ? p.b : p.a);
  if (!gone.img) return { root, left: "" };
  const empty = leaves(root).find((l) => !l.img);
  if (!empty) return { root, left: gone.img };
  Object.assign(empty, { img: gone.img, fx: 0.5, fy: 0.5, zoom: 1 });
  return { root, left: "" };
}

// moveInto puts the pictures of a layout into the cells of another, in
// order, as they sat; it returns those that found no cell.
export function moveInto(from: Node, to: Node): string[] {
  const old = leaves(from).filter((l) => l.img);
  const cells = leaves(to);
  old.forEach((l, i) => {
    if (cells[i]) Object.assign(cells[i]!, { img: l.img, fx: l.fx, fy: l.fy, zoom: l.zoom });
  });
  return old.slice(cells.length).map((l) => l.img);
}
