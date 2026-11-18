// 创造拼图: pictures in the cells of a layout, which splits and joins as
// wanted, with marks and floating pictures over it as layers whose order
// changes. The collage is a model drawn on one canvas of its size; undo
// keeps the model's earlier states, the pictures stay loaded.
import { onFileDrop } from "mygo-runtime";
import { editIcons, icons, markIcons } from "./icons";
import { openCanvas } from "./imageedit";
import {
  backgrounds,
  bgCSS,
  canvas,
  copyCanvas,
  decode,
  decodeBlob,
  encodeCanvas,
  exportDialog,
  fillBackground,
  imagePath,
  mosaicBlock,
  pastedPicture,
  pickPictures,
  pixelated,
  roundRect,
  stamp,
} from "./imgutil";
import { colors, markPrefs, paintMarks, sizeOf, textFont, textLine, tools as markTools, type Mark, type Pt, type Rect, type Tool as MarkTool } from "./marks";
import { ImageEdit } from "./mygo";
import { esc, onLeave, showError, toast } from "./ui";

// A layout is a tree: a cell, or a split of a box in two along x (side by
// side) or y (one over the other).
interface Leaf {
  id: string;
  img: string; // a picture of pics, "" for none
  fx: number; // where the picture sits when larger than the cell, 0 … 1
  fy: number;
  zoom: number; // over just covering the cell, 1 … 5
}

interface Split {
  id: string;
  dir: "x" | "y";
  ratio: number; // the first part's share
  a: Node;
  b: Node;
}

type Node = Leaf | Split;

type Layer = { id: string; hidden?: boolean } & ({ kind: "mark"; mark: Mark } | { kind: "image"; img: string; x: number; y: number; w: number; h: number });

interface Collage {
  w: number;
  h: number;
  gap: number; // ‰ of the shorter side
  pad: number;
  radius: number;
  bg: string;
  root: Node;
  layers: Layer[]; // bottom first
}

const isSplit = (n: Node): n is Split => "dir" in n;

let seq = 0;
const uid = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;
const leaf = (): Leaf => ({ id: uid(), img: "", fx: 0.5, fy: 0.5, zoom: 1 });
const X = (ratio: number, a: Node, b: Node): Split => ({ id: uid(), dir: "x", ratio, a, b });
const Y = (ratio: number, a: Node, b: Node): Split => ({ id: uid(), dir: "y", ratio, a, b });
const row = (n: number): Node => (n <= 1 ? leaf() : X(1 / n, leaf(), row(n - 1)));
const col = (n: number): Node => (n <= 1 ? leaf() : Y(1 / n, leaf(), col(n - 1)));
const grid = (cols: number, rows: number): Node => (rows <= 1 ? row(cols) : Y(1 / rows, row(cols), grid(cols, rows - 1)));

const templates: [string, () => Node][] = [
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

const sizes: [string, number, number][] = [
  ["1:1", 2400, 2400],
  ["4:3", 2400, 1800],
  ["3:4", 1800, 2400],
  ["16:9", 2560, 1440],
  ["9:16", 1440, 2560],
  ["A4", 2480, 3508],
];

// The tools: moving and picking things, or drawing a mark.
type Tool = "move" | MarkTool;

// What stays while the toolbox shows other tools.
let state: Collage = { w: 2400, h: 2400, gap: 12, pad: 16, radius: 0, bg: "#ffffff", root: grid(2, 2), layers: [] };
const pics = new Map<string, HTMLCanvasElement>(); // the pictures, by id; kept for undo
let past: string[] = [];
let future: string[] = [];
let tool: Tool = "move";
let markColor = markPrefs().color;
let markSize = markPrefs().size;
let sel: { kind: "cell" | "layer"; id: string } | null = null;
let tab: "layout" | "layers" = "layout";

let page: HTMLElement | null = null;
let view: HTMLCanvasElement | null = null; // the collage, as the stage shows it
let k = 1; // stage pixels per collage pixel
let ox = 0;
let oy = 0;

// ---- The model ----

const snap = () => JSON.stringify(state);

// change records the state for undo, then changes it.
function change(fn: () => void) {
  past.push(snap());
  if (past.length > 100) past.shift();
  future = [];
  fn();
  render();
}

function undo() {
  const s = past.pop();
  if (!s) return;
  closeText(false);
  future.push(snap());
  state = JSON.parse(s);
  fixSel();
  render();
}

function redo() {
  const s = future.pop();
  if (!s) return;
  past.push(snap());
  state = JSON.parse(s);
  fixSel();
  render();
}

function fixSel() {
  if (sel?.kind === "cell" && !findLeaf(sel.id)) sel = null;
  if (sel?.kind === "layer" && !state.layers.some((l) => l.id === sel!.id)) sel = null;
}

function leaves(n: Node = state.root): Leaf[] {
  return isSplit(n) ? [...leaves(n.a), ...leaves(n.b)] : [n];
}

const findLeaf = (id: string) => leaves().find((l) => l.id === id) ?? null;

function parentOf(id: string, n: Node = state.root): Split | null {
  if (!isSplit(n)) return null;
  if (n.a.id === id || n.b.id === id) return n;
  return parentOf(id, n.a) ?? parentOf(id, n.b);
}

const unit = () => Math.min(state.w, state.h) / 1000;

// layout places the cells and the lines between them, in collage pixels.
function layout() {
  const cells = new Map<string, Rect>();
  const lines: { node: Split; r: Rect; box: Rect }[] = [];
  const gap = state.gap * unit();
  const pad = state.pad * unit();
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
  walk(state.root, { x: pad, y: pad, w: state.w - pad * 2, h: state.h - pad * 2 });
  return { cells, lines };
}

// cover is where a cell's picture goes: covering the cell, zoomed, moved.
function cover(l: Leaf, r: Rect, img: HTMLCanvasElement) {
  const s = Math.max(r.w / img.width, r.h / img.height) * l.zoom;
  const w = img.width * s;
  const h = img.height * s;
  return { x: r.x + (r.w - w) * l.fx, y: r.y + (r.h - h) * l.fy, w, h };
}

// ---- Drawing ----

let scratch: HTMLCanvasElement | null = null;

// paint draws the collage on a canvas of its size; the empty cells show a
// placeholder unless it is the finished picture.
function paint(c: HTMLCanvasElement, finished: boolean) {
  const { w, h } = state;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = c.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  fillBackground(ctx, w, h, state.bg);
  const { cells } = layout();
  const radius = state.radius * unit();
  for (const l of leaves()) {
    const r = cells.get(l.id)!;
    if (r.w < 1 || r.h < 1) continue;
    const img = pics.get(l.img);
    ctx.save();
    roundRect(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.clip();
    if (img) {
      const p = cover(l, r, img);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, p.x, p.y, p.w, p.h);
    } else if (!finished) {
      ctx.fillStyle = "rgba(128, 128, 128, 0.16)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      const s = Math.min(r.w, r.h) * 0.12;
      ctx.strokeStyle = "rgba(128, 128, 128, 0.6)";
      ctx.lineWidth = Math.max(2, s / 8);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(r.x + r.w / 2 - s / 2, r.y + r.h / 2);
      ctx.lineTo(r.x + r.w / 2 + s / 2, r.y + r.h / 2);
      ctx.moveTo(r.x + r.w / 2, r.y + r.h / 2 - s / 2);
      ctx.lineTo(r.x + r.w / 2, r.y + r.h / 2 + s / 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  // The layers, bottom first; marks one after another are painted
  // together, a mosaic showing what is under them.
  scratch ??= canvas(w, h);
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  let run: Mark[] = [];
  const flush = () => {
    if (!run.length) return;
    const marks = run;
    run = [];
    const sc = scratch!.getContext("2d")!;
    const size = Math.max(...marks.map((m) => (m.kind === "mosaic" ? m.size : 0)));
    paintMarks(sc, marks, 1, 0, 0, { x: 0, y: 0, w, h }, () => pixelated(c, mosaicBlock(size)), 1);
    ctx.drawImage(scratch!, 0, 0);
  };
  for (const l of state.layers) {
    if (l.hidden) continue;
    if (l.kind === "mark") {
      run.push(l.mark);
      continue;
    }
    flush();
    const img = pics.get(l.img);
    if (img) ctx.drawImage(img, l.x, l.y, l.w, l.h);
  }
  flush();
}

let frame = 0;
function render() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

function draw() {
  if (!shown()) return;
  const p = page!;
  const stage = p.querySelector<HTMLElement>(".cg-stage")!;
  view ??= canvas(state.w, state.h);
  view.className = "cg-view";
  if (!view.isConnected) stage.prepend(view);
  paint(view, false);
  k = Math.min((stage.clientWidth - 48) / state.w, (stage.clientHeight - 48) / state.h);
  k = Math.max(k, 0.02);
  ox = (stage.clientWidth - state.w * k) / 2;
  oy = (stage.clientHeight - state.h * k) / 2;
  view.style.transform = `translate(${ox}px, ${oy}px) scale(${k})`;
  drawOver();
  p.querySelector<HTMLButtonElement>('.cg-top [data-act="undo"]')!.disabled = !past.length;
  p.querySelector<HTMLButtonElement>('.cg-top [data-act="redo"]')!.disabled = !future.length;
  p.querySelector(".cg-size")!.textContent = `${state.w} × ${state.h}`;
  p.querySelectorAll<HTMLElement>(".cg-rail [data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === tool));
  stage.dataset.tool = tool;
  drawSide();
}

// drawOver draws, over the stage, what is selected, a picture's way to
// another cell, and a mark being drawn.
function drawOver() {
  const stage = page!.querySelector<HTMLElement>(".cg-stage")!;
  const over = page!.querySelector<HTMLCanvasElement>(".cg-over")!;
  const dpr = devicePixelRatio || 1;
  const W = Math.round(stage.clientWidth * dpr);
  const H = Math.round(stage.clientHeight * dpr);
  if (over.width !== W || over.height !== H) {
    over.width = W;
    over.height = H;
  }
  const ctx = over.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const { cells } = layout();
  const toS = (r: Rect) => ({ x: (ox + r.x * k) * dpr, y: (oy + r.y * k) * dpr, w: r.w * k * dpr, h: r.h * k * dpr });
  ctx.lineWidth = 2 * dpr;
  if (hoverLine) {
    const r = toS(hoverLine.r);
    ctx.fillStyle = "rgba(59, 130, 246, 0.55)";
    const t = 4 * dpr;
    if (hoverLine.node.dir === "x") ctx.fillRect(r.x + r.w / 2 - t / 2, r.y, t, r.h);
    else ctx.fillRect(r.x, r.y + r.h / 2 - t / 2, r.w, t);
  }
  const accent = getComputedStyle(page!).getPropertyValue("--accent").trim() || "#3b82f6";
  if (sel?.kind === "cell" && cells.has(sel.id)) {
    const r = toS(cells.get(sel.id)!);
    ctx.strokeStyle = accent;
    ctx.strokeRect(r.x + dpr, r.y + dpr, r.w - 2 * dpr, r.h - 2 * dpr);
  }
  if (swapTo && cells.has(swapTo)) {
    const r = toS(cells.get(swapTo)!);
    ctx.fillStyle = "rgba(59, 130, 246, 0.25)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.strokeStyle = accent;
    ctx.strokeRect(r.x + dpr, r.y + dpr, r.w - 2 * dpr, r.h - 2 * dpr);
    ctx.setLineDash([]);
  }
  const layer = sel?.kind === "layer" ? state.layers.find((l) => l.id === sel!.id) : null;
  if (layer) {
    const r = toS(boundsOf(layer));
    ctx.strokeStyle = accent;
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.strokeRect(r.x - 3 * dpr, r.y - 3 * dpr, r.w + 6 * dpr, r.h + 6 * dpr);
    ctx.setLineDash([]);
    if (layer.kind === "image") {
      const s = 10 * dpr;
      ctx.fillStyle = "#fff";
      ctx.fillRect(r.x + r.w - s / 2, r.y + r.h - s / 2, s, s);
      ctx.strokeRect(r.x + r.w - s / 2, r.y + r.h - s / 2, s, s);
    }
  }
  if (drawing) {
    const src = drawing.mosaic;
    paintMarksOn(ctx, drawing.mark, dpr, src);
  }
}

function paintMarksOn(ctx: CanvasRenderingContext2D, m: Mark, dpr: number, mosaic: HTMLCanvasElement | null) {
  // paintMarks clears its canvas: the mark goes on a canvas of its own.
  const tmp = canvas(ctx.canvas.width, ctx.canvas.height);
  paintMarks(tmp.getContext("2d")!, [m], k * dpr, -ox * dpr, -oy * dpr, { x: 0, y: 0, w: state.w, h: state.h }, () => mosaic ?? view!, 1);
  ctx.drawImage(tmp, 0, 0);
}

// ---- Layers ----

function markBounds(m: Mark): Rect {
  const pad = m.size / 2;
  if (m.kind === "text") {
    const ctx = (scratch ?? canvas(1, 1)).getContext("2d")!;
    ctx.font = textFont(m.size);
    const lines = m.text.split("\n");
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
    return { x: m.at.x, y: m.at.y, w, h: lines.length * m.size * textLine };
  }
  const pts = "pts" in m ? m.pts : [m.a, m.b];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

function boundsOf(l: Layer): Rect {
  return l.kind === "image" ? { x: l.x, y: l.y, w: l.w, h: l.h } : markBounds(l.mark);
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

// hits is whether a point is on a layer: on a picture or a text, near a
// line.
function hits(l: Layer, p: Pt) {
  const tol = 6 / k;
  const inside = (r: Rect, t = 0) => p.x >= r.x - t && p.x <= r.x + r.w + t && p.y >= r.y - t && p.y <= r.y + r.h + t;
  if (l.kind === "image") return inside(boundsOf(l));
  const m = l.mark;
  const near = m.size / 2 + tol;
  switch (m.kind) {
    case "text":
      return inside(markBounds(m), tol);
    case "pen":
    case "mosaic":
      return m.pts.length === 1 ? Math.hypot(p.x - m.pts[0]!.x, p.y - m.pts[0]!.y) <= near : m.pts.some((q, i) => i > 0 && segDist(p, m.pts[i - 1]!, q) <= near);
    case "arrow":
      return segDist(p, m.a, m.b) <= near;
    case "rect": {
      const x0 = Math.min(m.a.x, m.b.x);
      const x1 = Math.max(m.a.x, m.b.x);
      const y0 = Math.min(m.a.y, m.b.y);
      const y1 = Math.max(m.a.y, m.b.y);
      const c = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
      return c.some((q, i) => segDist(p, q, c[(i + 1) % 4]!) <= near);
    }
    case "ellipse": {
      const cx = (m.a.x + m.b.x) / 2;
      const cy = (m.a.y + m.b.y) / 2;
      const rx = Math.abs(m.b.x - m.a.x) / 2 || 1;
      const ry = Math.abs(m.b.y - m.a.y) / 2 || 1;
      const d = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= near;
    }
  }
}

function moved(m: Mark, dx: number, dy: number): Mark {
  const mv = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });
  if (m.kind === "text") return { ...m, at: mv(m.at) };
  if ("pts" in m) return { ...m, pts: m.pts.map(mv) };
  return { ...m, a: mv(m.a), b: mv(m.b) };
}

const layerNames: Record<string, string> = { rect: "矩形", ellipse: "椭圆", arrow: "箭头", pen: "画笔", mosaic: "马赛克", text: "文字" };

function layerName(l: Layer) {
  if (l.kind === "image") return "图片";
  return l.mark.kind === "text" ? `文字：${l.mark.text.split("\n")[0]!.slice(0, 12)}` : layerNames[l.mark.kind]!;
}

// order moves the selected layer: to the top or bottom, or a step.
function order(to: "top" | "up" | "down" | "bottom") {
  if (sel?.kind !== "layer") return;
  const i = state.layers.findIndex((l) => l.id === sel!.id);
  if (i < 0) return;
  const n = state.layers.length;
  const j = to === "top" ? n - 1 : to === "bottom" ? 0 : to === "up" ? Math.min(n - 1, i + 1) : Math.max(0, i - 1);
  if (i === j) return;
  change(() => {
    const [l] = state.layers.splice(i, 1);
    state.layers.splice(j, 0, l!);
  });
}

function removeSelected() {
  if (sel?.kind === "layer") {
    const id = sel.id;
    sel = null;
    change(() => (state.layers = state.layers.filter((l) => l.id !== id)));
  } else if (sel?.kind === "cell") {
    const l = findLeaf(sel.id);
    if (l?.img) change(() => Object.assign(l, { img: "", fx: 0.5, fy: 0.5, zoom: 1 }));
  }
}

// ---- Pictures ----

const maxSide = 4096; // pictures are kept at most this large

async function addPicture(c: HTMLCanvasElement) {
  const id = uid();
  pics.set(id, c);
  return id;
}

// place puts new pictures in the empty cells, from the one given; what
// does not fit floats over the collage as picture layers.
function place(ids: string[], first?: string) {
  if (!ids.length) return;
  change(() => {
    const all = leaves();
    const start = first ? all.find((l) => l.id === first) : null;
    const targets = [...(start ? [start] : []), ...all.filter((l) => !l.img && l !== start)];
    const rest = [...ids];
    for (const t of targets) {
      const id = rest.shift();
      if (!id) break;
      Object.assign(t, { img: id, fx: 0.5, fy: 0.5, zoom: 1 });
    }
    rest.forEach((id, i) => state.layers.push(floating(id, i)));
    if (rest.length) toast(`格子不够，${rest.length} 张放成了浮动图片，可以在「图层」里调整`);
  });
}

function floating(img: string, i = 0): Layer {
  const c = pics.get(img)!;
  const s = (Math.min(state.w, state.h) * 0.4) / Math.max(c.width, c.height);
  const w = c.width * s;
  const h = c.height * s;
  const off = (i % 6) * 0.04 * state.w;
  return { id: uid(), kind: "image", img, x: (state.w - w) / 2 + off, y: (state.h - h) / 2 + off, w, h };
}

async function loadMany(list: (() => Promise<HTMLCanvasElement>)[], first?: string) {
  const ids: string[] = [];
  for (const load of list) {
    try {
      ids.push(await addPicture(await load()));
    } catch (e) {
      showError(e);
    }
  }
  place(ids, first);
}

function pickInto(first?: string) {
  const loads: (() => Promise<HTMLCanvasElement>)[] = [];
  void pickPictures(true, async (e) => {
    const c = await decode(e.url, maxSide);
    loads.push(async () => c);
  })
    .then(() => loadMany(loads, first))
    .catch(showError);
}

function pickFloating() {
  void pickPictures(true, async (e) => {
    const id = await addPicture(await decode(e.url, maxSide));
    change(() => {
      const l = floating(id);
      state.layers.push(l);
      sel = { kind: "layer", id: l.id };
    });
  }).catch(showError);
}

onFileDrop(({ paths, x, y }) => {
  if (!shown()) return;
  const list = paths.filter((p) => imagePath.test(p));
  if (!list.length) return paths.length ? toast("不是能打开的图片") : undefined;
  const at = cellAt(toCollage({ clientX: x, clientY: y }));
  void loadMany(
    list.map((p) => async () => decode((await ImageEdit.openPath(p)).url, maxSide)),
    at ?? undefined,
  );
});

function shown() {
  return !!page?.isConnected && !!page.querySelector(".cg");
}

// ---- The page ----

export function renderCollage(p: HTMLElement) {
  page = p;
  view = null;
  p.innerHTML = `
    <div class="cg">
      <div class="ie-top cg-top">
        <button data-act="add" title="添加图片，依次放进空格子">添加图片</button>
        <span class="ie-sep"></span>
        <button data-act="undo" class="ie-ic" title="撤销 (Ctrl+Z)">${markIcons.undo}</button>
        <button data-act="redo" class="ie-ic" title="重做 (Ctrl+Y)">${editIcons.redo}</button>
        <span class="ie-name"><b>拼图</b><span class="muted cg-size"></span></span>
        <button data-act="clear" title="清空，重新开始">清空</button>
        <button data-act="edit" title="把拼好的图送到「编辑图片」继续裁剪、调色">送去编辑</button>
        <span class="ie-sep"></span>
        <button data-act="copy" title="复制图片 (Ctrl+C)">复制</button>
        <button data-act="export" class="primary" title="保存 (Ctrl+S)">保存</button>
      </div>
      <div class="ie-body">
        <nav class="ie-rail cg-rail">
          <button data-tool="move" title="选择、移动 (V)：点格子选中，拖动图片调整位置，拖到别的格子交换；拖分隔线调整大小">${editIcons.move}<span>选择</span></button>
          ${markTools.map(([t, n]) => `<button data-tool="${t}" title="${n}">${markIcons[t]}<span>${n}</span></button>`).join("")}
        </nav>
        <div class="ie-stage cg-stage">
          <canvas class="ie-over cg-over"></canvas>
        </div>
        <aside class="ie-side cg-side"></aside>
      </div>
    </div>`;
  const stage = p.querySelector<HTMLElement>(".cg-stage")!;
  p.querySelector(".cg-top")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]");
    if (b && !b.disabled) act(b.dataset.act!);
  });
  p.querySelector(".cg-rail")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tool]");
    if (!b) return;
    closeText(true);
    tool = b.dataset.tool as Tool;
    sideKey = "";
    render();
  });
  bindStage(stage);
  bindSide(p.querySelector<HTMLElement>(".cg-side")!);
  const ro = new ResizeObserver(() => render());
  ro.observe(stage);
  onLeave(() => ro.disconnect());
  const keys = (e: KeyboardEvent) => onKey(e);
  document.addEventListener("keydown", keys);
  onLeave(() => document.removeEventListener("keydown", keys));
  const paste = (e: ClipboardEvent) => {
    const file = pastedPicture(e);
    if (file) void loadMany([() => decodeBlob(file, maxSide)], sel?.kind === "cell" ? sel.id : undefined);
  };
  document.addEventListener("paste", paste);
  onLeave(() => document.removeEventListener("paste", paste));
  onLeave(() => {
    closeText(true);
    page = null;
  });
  sideKey = "";
  draw();
}

function finished() {
  closeText(true);
  const c = canvas(state.w, state.h);
  paint(c, true);
  return c;
}

function act(a: string) {
  switch (a) {
    case "add":
      return pickInto(sel?.kind === "cell" ? sel.id : undefined);
    case "undo":
      return undo();
    case "redo":
      return redo();
    case "clear":
      if (!leaves().some((l) => l.img) && !state.layers.length) return;
      sel = null;
      change(() => {
        for (const l of leaves()) Object.assign(l, { img: "", fx: 0.5, fy: 0.5, zoom: 1 });
        state.layers = [];
      });
      return toast("已清空，可以撤销", { label: "撤销", run: undo });
    case "edit":
      return openCanvas(finished(), `拼图 ${stamp()}.png`);
    case "copy":
      return void copyCanvas(finished()).catch(showError);
    case "export": {
      let c = finished();
      return exportDialog({
        dims: () => [c.width, c.height],
        encode: (format, quality) => encodeCanvas(c, format, quality),
        save: (data, format) => ImageEdit.saveFile(data, format, `拼图 ${stamp()}`),
        saved: () => (c = canvas(1, 1)),
      });
    }
  }
}

// ---- The stage ----

let drawing: { mark: Mark; mosaic: HTMLCanvasElement | null } | null = null;
let hoverLine: { node: Split; r: Rect; box: Rect } | null = null;
let swapTo: string | null = null;
let text: { el: HTMLTextAreaElement; at: Pt; size: number; color: string } | null = null;

function toCollage(e: { clientX: number; clientY: number }): Pt {
  const r = page!.querySelector<HTMLElement>(".cg-stage")!.getBoundingClientRect();
  return { x: (e.clientX - r.left - ox) / k, y: (e.clientY - r.top - oy) / k };
}

function cellAt(p: Pt) {
  for (const [id, r] of layout().cells) if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return id;
  return null;
}

// lineAt is the line between cells nearest a point, within a few pixels
// of the screen: where lines meet, the one the point is across from.
function lineAt(p: Pt) {
  const t = 5 / k;
  let best: ReturnType<typeof layout>["lines"][number] | null = null;
  let bestD = Infinity;
  for (const l of layout().lines) {
    const { r } = l;
    const along = l.node.dir === "x" ? p.y >= r.y && p.y <= r.y + r.h : p.x >= r.x && p.x <= r.x + r.w;
    if (!along) continue;
    const d = l.node.dir === "x" ? Math.abs(p.x - (r.x + r.w / 2)) - r.w / 2 : Math.abs(p.y - (r.y + r.h / 2)) - r.h / 2;
    if (d <= t && d < bestD) {
      best = l;
      bestD = d;
    }
  }
  return best;
}

function layerAt(p: Pt) {
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const l = state.layers[i]!;
    if (!l.hidden && hits(l, p)) return l;
  }
  return null;
}

type Drag =
  | { kind: "layer"; id: string; start: Pt; orig: Layer; before: string }
  | { kind: "resize"; id: string; start: Pt; orig: Layer; before: string }
  | { kind: "line"; node: Split; box: Rect; before: string }
  | { kind: "pan"; id: string; start: Pt; orig: Leaf; before: string; moved: boolean }
  | { kind: "mark" };

function bindStage(stage: HTMLElement) {
  let drag: Drag | null = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (text) {
      closeText(true);
      return render();
    }
    const p = toCollage(e);
    if (tool !== "move") {
      const size = sizeOf(tool, markSize) / k;
      if (tool === "text") {
        e.preventDefault();
        openText(e, p);
        return;
      }
      const mark: Mark = tool === "pen" || tool === "mosaic" ? { kind: tool, pts: [p], color: markColor, size } : { kind: tool, a: p, b: p, color: markColor, size };
      drawing = { mark, mosaic: tool === "mosaic" ? pixelated(view!, mosaicBlock(size)) : null };
      drag = { kind: "mark" };
    } else {
      const cur = sel?.kind === "layer" ? state.layers.find((l) => l.id === sel!.id) : null;
      const handle = cur?.kind === "image" && Math.hypot(p.x - (cur.x + cur.w), p.y - (cur.y + cur.h)) <= 9 / k;
      const layer = handle ? cur : layerAt(p);
      const line = layer ? null : lineAt(p);
      const cell = layer || line ? null : cellAt(p);
      if (layer) {
        sel = { kind: "layer", id: layer.id };
        tab = "layers";
        drag = { kind: handle ? "resize" : "layer", id: layer.id, start: p, orig: structuredClone(layer), before: snap() };
      } else if (line) {
        drag = { kind: "line", node: line.node, box: line.box, before: snap() };
      } else if (cell) {
        sel = { kind: "cell", id: cell };
        tab = "layout";
        drag = { kind: "pan", id: cell, start: p, orig: { ...findLeaf(cell)! }, before: snap(), moved: false };
      } else sel = null;
      sideKey = "";
    }
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {}
    render();
  });
  stage.addEventListener("pointermove", (e) => {
    const p = toCollage(e);
    if (!drag) {
      const l = tool === "move" && !layerAt(p) ? lineAt(p) : null;
      if (l?.node !== hoverLine?.node) {
        hoverLine = l;
        stage.style.cursor = l ? (l.node.dir === "x" ? "col-resize" : "row-resize") : "";
        drawOver();
      }
      return;
    }
    if (drag.kind === "mark" && drawing) {
      const m = drawing.mark;
      if ("pts" in m) {
        const last = m.pts[m.pts.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) * k >= 1.5) m.pts.push(p);
      } else if ("a" in m) {
        let b = p;
        if (e.shiftKey && m.kind !== "arrow") {
          const d = Math.max(Math.abs(p.x - m.a.x), Math.abs(p.y - m.a.y));
          b = { x: m.a.x + Math.sign(p.x - m.a.x) * d, y: m.a.y + Math.sign(p.y - m.a.y) * d };
        } else if (e.shiftKey) {
          const ang = Math.round(Math.atan2(p.y - m.a.y, p.x - m.a.x) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(p.x - m.a.x, p.y - m.a.y);
          b = { x: m.a.x + len * Math.cos(ang), y: m.a.y + len * Math.sin(ang) };
        }
        m.b = b;
      }
      return drawOver();
    }
    if (drag.kind === "layer" || drag.kind === "resize") {
      const i = state.layers.findIndex((l) => l.id === (drag as { id: string }).id);
      if (i < 0) return;
      const o = drag.orig;
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      if (drag.kind === "resize" && o.kind === "image") {
        // The corner follows the pointer, the picture keeps its shape.
        const w = Math.max(16, o.w + Math.max(dx, (dy * o.w) / o.h));
        state.layers[i] = { ...o, w, h: (w * o.h) / o.w };
      } else if (o.kind === "image") state.layers[i] = { ...o, x: o.x + dx, y: o.y + dy };
      else state.layers[i] = { ...o, mark: moved(o.mark, dx, dy) };
      return render();
    }
    if (drag.kind === "line") {
      const n = drag.node;
      const gap = state.gap * unit();
      const r = drag.box;
      const ratio = n.dir === "x" ? (p.x - r.x - gap / 2) / (r.w - gap) : (p.y - r.y - gap / 2) / (r.h - gap);
      n.ratio = Math.min(0.92, Math.max(0.08, ratio));
      return render();
    }
    if (drag.kind === "pan") {
      const l = findLeaf(drag.id);
      if (!l) return;
      const target = cellAt(p);
      drag.moved ||= Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * k > 4;
      // Out of its cell and over another, the picture goes there.
      swapTo = l.img && target && target !== drag.id ? target : null;
      const img = pics.get(l.img);
      if (swapTo || !img) {
        Object.assign(l, { fx: drag.orig.fx, fy: drag.orig.fy });
        return render();
      }
      const r = layout().cells.get(l.id)!;
      const c = cover({ ...l, fx: 0, fy: 0 }, r, img);
      const sx = r.w - c.w; // how far it can move: 0 or less
      const sy = r.h - c.h;
      l.fx = sx < 0 ? Math.min(1, Math.max(0, drag.orig.fx + (p.x - drag.start.x) / sx)) : 0.5;
      l.fy = sy < 0 ? Math.min(1, Math.max(0, drag.orig.fy + (p.y - drag.start.y) / sy)) : 0.5;
      return render();
    }
  });
  const end = () => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.kind === "mark") {
      const m = drawing?.mark;
      drawing = null;
      if (m && (!("a" in m) || Math.abs(m.b.x - m.a.x) * k >= 3 || Math.abs(m.b.y - m.a.y) * k >= 3)) change(() => state.layers.push({ id: uid(), kind: "mark", mark: m }));
      return render();
    }
    if (d.kind === "pan") {
      const l = findLeaf(d.id);
      if (swapTo && l) {
        const t = findLeaf(swapTo)!;
        const a = { img: l.img, fx: 0.5, fy: 0.5, zoom: 1 };
        const b = { img: t.img, fx: 0.5, fy: 0.5, zoom: 1 };
        Object.assign(l, b);
        Object.assign(t, a);
        sel = { kind: "cell", id: t.id };
        swapTo = null;
      } else if (l && !l.img && !d.moved) {
        // A click on an empty cell asks for its picture.
        return pickInto(l.id);
      }
    }
    // What the drag changed goes to undo as one step.
    if ("before" in d && d.before !== snap()) {
      past.push(d.before);
      future = [];
    }
    render();
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  stage.addEventListener(
    "wheel",
    (e) => {
      // The wheel zooms a cell's picture.
      const id = cellAt(toCollage(e));
      const l = id ? findLeaf(id) : null;
      if (!l?.img || tool !== "move") return;
      e.preventDefault();
      const zoom = Math.min(5, Math.max(1, l.zoom * Math.exp(-e.deltaY * 0.0015)));
      if (zoom === l.zoom) return;
      zoomCell(l, zoom);
    },
    { passive: false },
  );
  stage.addEventListener("dblclick", (e) => {
    // Double-clicking a text edits it again.
    const l = layerAt(toCollage(e));
    if (tool !== "move" || l?.kind !== "mark" || l.mark.kind !== "text") return;
    const m = l.mark;
    change(() => (state.layers = state.layers.filter((x) => x.id !== l.id)));
    markColor = m.color;
    const r = stage.getBoundingClientRect();
    openText({ clientX: r.left + ox + m.at.x * k, clientY: r.top + oy + m.at.y * k + (m.size * k * textLine) / 2 }, { x: m.at.x, y: m.at.y + (m.size * textLine) / 2 }, m);
  });
}

// zoomCell zooms a cell's picture, one undo step for a run of wheel turns.
let zoomStep = 0;
function zoomCell(l: Leaf, zoom: number) {
  const now = Date.now();
  if (now - zoomStep > 600) {
    past.push(snap());
    future = [];
  }
  zoomStep = now;
  l.zoom = zoom;
  render();
}

function openText(e: { clientX: number; clientY: number }, p: Pt, again?: Extract<Mark, { kind: "text" }>) {
  const stage = page!.querySelector<HTMLElement>(".cg-stage")!;
  const r = stage.getBoundingClientRect();
  const size = again ? again.size * k : sizeOf("text", markSize);
  const el = document.createElement("textarea");
  el.className = "ie-text";
  el.spellcheck = false;
  el.rows = 1;
  el.value = again?.text ?? "";
  stage.append(el);
  text = { el, at: { x: p.x, y: p.y - (size * textLine) / 2 / k }, size, color: again?.color ?? markColor };
  Object.assign(el.style, { left: `${e.clientX - r.left}px`, top: `${e.clientY - r.top - (size * textLine) / 2}px`, color: text.color, font: textFont(size), lineHeight: String(textLine) });
  const grow = () => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.style.width = "auto";
    el.style.width = `${Math.max(40, el.scrollWidth + 4)}px`;
  };
  el.addEventListener("input", grow);
  el.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" || (ev.key === "Enter" && ev.ctrlKey)) {
      ev.preventDefault();
      ev.stopPropagation();
      closeText(true);
      render();
    }
  });
  setTimeout(() => {
    el.focus();
    grow();
  });
}

function closeText(keep: boolean) {
  if (!text) return;
  const { el, at, size, color } = text;
  text = null;
  const value = el.value.replace(/\s+$/, "");
  el.remove();
  if (keep && value) change(() => state.layers.push({ id: uid(), kind: "mark", mark: { kind: "text", at, text: value, color, size: size / k } }));
}

// ---- The side panel ----

let sideKey = ""; // what the panel was made for; made again when it changes

function drawSide() {
  const side = page?.querySelector<HTMLElement>(".cg-side");
  if (!side) return;
  const key = `${tool === "move" ? tab : "mark"}|${sel?.kind}:${sel?.id}|${state.layers.length}`;
  if (key !== sideKey) {
    sideKey = key;
    side.innerHTML = sideHTML();
  }
  updateSide(side);
}

function sideHTML() {
  if (tool !== "move") {
    return `
      <h3>${esc(markTools.find(([t]) => t === tool)?.[1] ?? "")}</h3>
      <h3>粗细</h3>
      <div class="ie-chips ie-sizes">${[0, 1, 2].map((i) => `<button data-size="${i}">${["细", "中", "粗"][i]}</button>`).join("")}</div>
      <h3 class="ie-color-h">颜色</h3>
      <div class="ie-colors">${colors.map((c) => `<button data-color="${c}" title="${c}"><i style="background:${c}"></i></button>`).join("")}<label class="ie-custom" title="自定义颜色"><input type="color" /></label></div>
      <p class="muted ie-hint">画好的每一笔都是一个图层，可以在「选择」工具下点中拖动、删除，在「图层」里调整上下顺序。</p>`;
  }
  const tabs = `<div class="s-seg cg-tabs"><button data-tab="layout">布局</button><button data-tab="layers">图层 ${state.layers.length ? state.layers.length : ""}</button></div>`;
  if (tab === "layers") {
    const l = sel?.kind === "layer" ? state.layers.find((x) => x.id === sel!.id) : null;
    return `${tabs}
      <div class="cg-layers"></div>
      <div class="cg-order">
        <button data-order="top" title="置顶 (Ctrl+Shift+])">置顶</button>
        <button data-order="up" title="上移一层 (Ctrl+])">上移</button>
        <button data-order="down" title="下移一层 (Ctrl+[)">下移</button>
        <button data-order="bottom" title="置底 (Ctrl+Shift+[)">置底</button>
      </div>
      <div class="ie-row"><button data-do="float">＋ 浮动图片</button><button data-do="del-layer"${l ? "" : " disabled"}>删除</button></div>
      <p class="muted ie-hint">上面的盖住下面的；拼图格子总在最底下。点图层选中，拖动画布上的它移动，拖图片右下角改大小。</p>`;
  }
  const cell = sel?.kind === "cell" ? findLeaf(sel.id) : null;
  const ratio = state.w / state.h;
  const thumb = (make: () => Node) => {
    const tw = ratio >= 1 ? 46 : Math.round(46 * ratio);
    const th = ratio >= 1 ? Math.round(46 / ratio) : 46;
    const cells: string[] = [];
    const walk = (n: Node, r: Rect) => {
      if (!isSplit(n)) return cells.push(`<i style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"></i>`);
      const g = 2;
      if (n.dir === "x") {
        const aw = (r.w - g) * n.ratio;
        walk(n.a, { ...r, w: aw });
        walk(n.b, { ...r, x: r.x + aw + g, w: r.w - g - aw });
      } else {
        const ah = (r.h - g) * n.ratio;
        walk(n.a, { ...r, h: ah });
        walk(n.b, { ...r, y: r.y + ah + g, h: r.h - g - ah });
      }
    };
    walk(make(), { x: 0, y: 0, w: tw, h: th });
    return `<span style="width:${tw}px;height:${th}px">${cells.join("")}</span>`;
  };
  return `${tabs}
    ${
      cell
        ? `<h3>选中的格子</h3>
      <div class="ie-icons cg-cell">
        <button data-do="split-x" title="左右分成两格">${editIcons.splitX}<span>左右分</span></button>
        <button data-do="split-y" title="上下分成两格">${editIcons.splitY}<span>上下分</span></button>
        <button data-do="join" title="删掉这一格，旁边的格子占过来"${parentOf(cell.id) ? "" : " disabled"}>${editIcons.join}<span>删格子</span></button>
        <button data-do="pick" title="换一张图片">${icons.image}<span>换图</span></button>
      </div>
      ${
        cell.img
          ? `<label class="ie-slider"><span>放大<b data-v="zoom"></b></span><input type="range" min="100" max="500" step="1" data-cell="zoom" /></label>
        <div class="ie-row"><button data-do="fit-cell">还原位置</button><button data-do="clear-cell">清除图片</button></div>`
          : ""
      }`
        : `<p class="muted ie-hint cg-tip">点一个格子可以分割、删除它或换图片；拖动格子之间的线调整大小。</p>`
    }
    <h3>布局</h3>
    <div class="cg-templates">${templates.map(([n, make], i) => `<button data-tpl="${i}" title="${n}">${thumb(make)}</button>`).join("")}</div>
    <h3>画布</h3>
    <div class="ie-chips">${sizes.map(([n, w, h]) => `<button data-wh="${w}x${h}">${n}</button>`).join("")}</div>
    <div class="ie-wh"><label>宽<input type="number" min="200" max="8000" data-dim="w" /></label><label>高<input type="number" min="200" max="8000" data-dim="h" /></label></div>
    <label class="ie-slider"><span>间距<b data-v="gap"></b></span><input type="range" min="0" max="60" step="1" data-st="gap" /></label>
    <label class="ie-slider"><span>边距<b data-v="pad"></b></span><input type="range" min="0" max="80" step="1" data-st="pad" /></label>
    <label class="ie-slider"><span>圆角<b data-v="radius"></b></span><input type="range" min="0" max="80" step="1" data-st="radius" /></label>
    <h3>背景</h3>
    <div class="ie-bgs">${backgrounds.map(([bg, n]) => `<button data-bg="${bg}" title="${n}"><i style="background:${bgCSS(bg)}"></i></button>`).join("")}</div>`;
}

function updateSide(side: HTMLElement) {
  side.querySelectorAll<HTMLElement>(".cg-tabs [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  if (tool !== "move") {
    side.querySelectorAll<HTMLElement>("[data-size]").forEach((b) => b.classList.toggle("on", Number(b.dataset.size) === markSize));
    const noColor = tool === "mosaic";
    side.querySelector<HTMLElement>(".ie-colors")!.hidden = noColor;
    side.querySelector<HTMLElement>(".ie-color-h")!.hidden = noColor;
    side.querySelectorAll<HTMLElement>("[data-color]").forEach((b) => b.classList.toggle("on", b.dataset.color === markColor));
    const custom = side.querySelector<HTMLInputElement>(".ie-custom input")!;
    custom.parentElement!.classList.toggle("on", !colors.includes(markColor));
    if (!colors.includes(markColor)) custom.value = markColor;
    return;
  }
  if (tab === "layers") {
    const list = side.querySelector<HTMLElement>(".cg-layers")!;
    const rows = [...state.layers].reverse();
    const html = rows.length
      ? rows
          .map(
            (l) => `<div class="cg-layer${sel?.kind === "layer" && sel.id === l.id ? " on" : ""}${l.hidden ? " off" : ""}" data-layer="${l.id}" draggable="true">
              <span class="cg-layer-ic">${l.kind === "image" ? icons.image : markIcons[l.mark.kind]}</span>
              <span class="cg-layer-name">${esc(layerName(l))}</span>
              <button data-eye="${l.id}" title="${l.hidden ? "显示" : "隐藏"}">${l.hidden ? editIcons.eyeOff : editIcons.eye}</button>
            </div>`,
          )
          .join("") + `<div class="cg-layer cg-base"><span class="cg-layer-ic">${editIcons.grid}</span><span class="cg-layer-name">拼图格子</span></div>`
      : `<p class="muted ie-hint">还没有图层。用左边的标注工具画，或者加一张浮动图片。</p>`;
    if (list.innerHTML !== html) list.innerHTML = html;
    const has = sel?.kind === "layer";
    side.querySelectorAll<HTMLButtonElement>("[data-order]").forEach((b) => (b.disabled = !has));
    side.querySelector<HTMLButtonElement>('[data-do="del-layer"]')!.disabled = !has;
    return;
  }
  side.querySelectorAll<HTMLElement>("[data-wh]").forEach((b) => b.classList.toggle("on", b.dataset.wh === `${state.w}x${state.h}`));
  side.querySelectorAll<HTMLInputElement>("[data-dim]").forEach((i) => {
    if (document.activeElement !== i) i.value = String(i.dataset.dim === "w" ? state.w : state.h);
  });
  side.querySelectorAll<HTMLInputElement>("[data-st]").forEach((i) => {
    const key = i.dataset.st as "gap" | "pad" | "radius";
    if (document.activeElement !== i) i.value = String(state[key]);
    side.querySelector(`[data-v="${key}"]`)!.textContent = `${Math.round(state[key] * unit())} px`;
  });
  side.querySelectorAll<HTMLElement>("[data-bg]").forEach((b) => b.classList.toggle("on", b.dataset.bg === state.bg));
  const cell = sel?.kind === "cell" ? findLeaf(sel.id) : null;
  const zoom = side.querySelector<HTMLInputElement>('[data-cell="zoom"]');
  if (cell && zoom) {
    if (document.activeElement !== zoom) zoom.value = String(Math.round(cell.zoom * 100));
    side.querySelector('[data-v="zoom"]')!.textContent = `${Math.round(cell.zoom * 100)}%`;
  }
}

// applyTemplate swaps the layout, keeping the pictures in their order.
function applyTemplate(i: number) {
  change(() => {
    const old = leaves().filter((l) => l.img);
    const root = templates[i]![1]();
    const cells = leaves(root);
    old.forEach((l, j) => {
      if (cells[j]) Object.assign(cells[j]!, { img: l.img, fx: l.fx, fy: l.fy, zoom: l.zoom });
    });
    const extra = old.slice(cells.length);
    state.root = root;
    extra.forEach((l, j) => state.layers.push(floating(l.img, j)));
    if (extra.length) toast(`新布局只有 ${cells.length} 格，${extra.length} 张放成了浮动图片`);
    sel = null;
  });
}

function splitCell(dir: "x" | "y") {
  if (sel?.kind !== "cell") return;
  const id = sel.id;
  change(() => {
    const l = findLeaf(id)!;
    const s: Split = { id: uid(), dir, ratio: 0.5, a: { ...l }, b: leaf() };
    replace(id, s);
    sel = { kind: "cell", id: l.id };
  });
}

function joinCell() {
  if (sel?.kind !== "cell") return;
  const id = sel.id;
  const p = parentOf(id);
  if (!p) return;
  change(() => {
    const keep = p.a.id === id ? p.b : p.a;
    const gone = findLeaf(id)!;
    replace(p.id, keep);
    // Its picture goes to an empty cell, or floats.
    if (gone.img) {
      const empty = leaves().find((l) => !l.img);
      if (empty) Object.assign(empty, { img: gone.img, fx: 0.5, fy: 0.5, zoom: 1 });
      else state.layers.push(floating(gone.img));
    }
    sel = null;
  });
}

// replace puts a node where the node of an id is.
function replace(id: string, with_: Node) {
  if (state.root.id === id) {
    state.root = with_;
    return;
  }
  const p = parentOf(id)!;
  if (p.a.id === id) p.a = with_;
  else p.b = with_;
}

function bindSide(side: HTMLElement) {
  side.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || b.disabled) {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-layer]");
      if (row) {
        sel = { kind: "layer", id: row.dataset.layer! };
        sideKey = "";
        render();
      }
      return;
    }
    if (b.dataset.tab) {
      tab = b.dataset.tab as typeof tab;
      sideKey = "";
      return render();
    }
    if (b.dataset.tpl) return applyTemplate(Number(b.dataset.tpl));
    if (b.dataset.wh) {
      const [w, h] = b.dataset.wh.split("x").map(Number);
      return resizeCanvas(w!, h!);
    }
    if (b.dataset.bg) return change(() => (state.bg = b.dataset.bg!));
    if (b.dataset.size) {
      markSize = Number(b.dataset.size);
      return render();
    }
    if (b.dataset.color) {
      markColor = b.dataset.color;
      return render();
    }
    if (b.dataset.order) return order(b.dataset.order as "top");
    if (b.dataset.eye) {
      const id = b.dataset.eye;
      return change(() => {
        const l = state.layers.find((x) => x.id === id);
        if (l) l.hidden = !l.hidden;
      });
    }
    const cell = sel?.kind === "cell" ? findLeaf(sel.id) : null;
    switch (b.dataset.do) {
      case "split-x":
        return splitCell("x");
      case "split-y":
        return splitCell("y");
      case "join":
        return joinCell();
      case "pick":
        return cell && pickInto(cell.id);
      case "fit-cell":
        return cell && change(() => Object.assign(cell, { fx: 0.5, fy: 0.5, zoom: 1 }));
      case "clear-cell":
        return removeSelected();
      case "float":
        return pickFloating();
      case "del-layer":
        return removeSelected();
    }
  });
  let before = "";
  side.addEventListener("pointerdown", () => (before = snap()));
  side.addEventListener("input", (e) => {
    const i = e.target as HTMLInputElement;
    if (i.dataset.st) {
      state[i.dataset.st as "gap"] = Number(i.value);
      return render();
    }
    if (i.dataset.cell) {
      const cell = sel?.kind === "cell" ? findLeaf(sel.id) : null;
      if (cell) cell.zoom = Number(i.value) / 100;
      return render();
    }
    if (i.type === "color" && i.closest(".ie-custom")) {
      markColor = i.value;
      return render();
    }
  });
  // A slider's drag is one undo step.
  side.addEventListener("change", (e) => {
    const i = e.target as HTMLInputElement;
    if (i.dataset.dim) {
      const v = Math.round(Number(i.value));
      if (!(v >= 200 && v <= 8000)) return render();
      return resizeCanvas(i.dataset.dim === "w" ? v : state.w, i.dataset.dim === "h" ? v : state.h);
    }
    if ((i.dataset.st || i.dataset.cell) && before && before !== snap()) {
      past.push(before);
      future = [];
      before = "";
      render();
    }
  });
  // The layers' order by dragging them in the list.
  let dragged = "";
  side.addEventListener("dragstart", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-layer]");
    if (!row) return;
    dragged = row.dataset.layer!;
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", dragged);
  });
  side.addEventListener("dragover", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-layer]");
    if (!dragged || !row) return;
    e.preventDefault();
    side.querySelectorAll(".cg-layer").forEach((r) => r.classList.remove("drop-above", "drop-below"));
    const r = row.getBoundingClientRect();
    row.classList.add(e.clientY < r.top + r.height / 2 ? "drop-above" : "drop-below");
  });
  side.addEventListener("drop", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-layer]");
    if (!dragged || !row) return;
    e.preventDefault();
    const above = row.classList.contains("drop-above");
    const from = state.layers.findIndex((l) => l.id === dragged);
    const target = row.dataset.layer!;
    dragged = "";
    if (from < 0 || target === state.layers[from]!.id) return render();
    change(() => {
      const [l] = state.layers.splice(from, 1);
      // The list is top first: above a row is after it in the layers.
      const t = state.layers.findIndex((x) => x.id === target);
      state.layers.splice(above ? t + 1 : t, 0, l!);
    });
  });
  side.addEventListener("dragend", () => {
    dragged = "";
    side.querySelectorAll(".cg-layer").forEach((r) => r.classList.remove("drop-above", "drop-below"));
  });
}

// resizeCanvas changes the collage's size: the floating layers keep their
// places relative to it.
function resizeCanvas(w: number, h: number) {
  if (w === state.w && h === state.h) return;
  const kx = w / state.w;
  const ky = h / state.h;
  change(() => {
    for (const l of state.layers) {
      if (l.kind === "image") {
        const s = Math.min(kx, ky);
        Object.assign(l, { x: l.x * kx, y: l.y * ky, w: l.w * s, h: l.h * s });
      } else {
        const m = l.mark;
        const sc = (p: Pt) => ({ x: p.x * kx, y: p.y * ky });
        l.mark = m.kind === "text" ? { ...m, at: sc(m.at) } : "pts" in m ? { ...m, pts: m.pts.map(sc) } : { ...m, a: sc(m.a), b: sc(m.b) };
      }
    }
    state.w = w;
    state.h = h;
  });
}

// ---- Keys ----

function onKey(e: KeyboardEvent) {
  if (!shown() || document.querySelector("dialog[open]")) return;
  if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return;
  const key = e.key.toLowerCase();
  if (e.ctrlKey && key === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (e.ctrlKey && (key === "y" || (key === "z" && e.shiftKey))) {
    e.preventDefault();
    redo();
  } else if (e.ctrlKey && key === "s") {
    e.preventDefault();
    act("export");
  } else if (e.ctrlKey && key === "c") {
    if (getSelection()?.toString()) return;
    e.preventDefault();
    act("copy");
  } else if (e.ctrlKey && (e.key === "]" || e.key === "}")) {
    e.preventDefault();
    order(e.shiftKey ? "top" : "up");
  } else if (e.ctrlKey && (e.key === "[" || e.key === "{")) {
    e.preventDefault();
    order(e.shiftKey ? "bottom" : "down");
  } else if (e.ctrlKey) return;
  else if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    removeSelected();
  } else if (e.key === "Escape") {
    sel = null;
    tool = "move";
    sideKey = "";
    render();
  } else if (key === "v") {
    tool = "move";
    sideKey = "";
    render();
  } else if (e.key.startsWith("Arrow") && sel?.kind === "layer") {
    // Arrows move the layer a pixel of the screen, with Shift ten.
    e.preventDefault();
    const n = (e.shiftKey ? 10 : 1) / k;
    const dx = e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0;
    const dy = e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0;
    const id = sel.id;
    change(() => {
      const i = state.layers.findIndex((l) => l.id === id);
      const l = state.layers[i]!;
      state.layers[i] = l.kind === "image" ? { ...l, x: l.x + dx, y: l.y + dy } : { ...l, mark: moved(l.mark, dx, dy) };
    });
  }
}

