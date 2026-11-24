// 图片编辑: a picture, opened from a file, pasted, dropped on the window, or
// sent from a screenshot, a pinned picture or the clipboard history, is
// cropped, turned, resized, adjusted, drawn on and framed, then saved or
// copied. The page does all of it on canvases; Go opens and writes files.
//
// An edit is a list of operations on the picture as opened: undo drops the
// last one and plays the rest again, so that nothing is kept per step but
// the operation itself.
import { onFileDrop } from "mygo-runtime";
import { editIcons, icons, markIcons } from "./icons";
import { ImageEdit, Settings, Shot, events, type EditImage } from "./mygo";
import { dragMark, newMark, paintMarks, pen, sizeOf, slip, styleTextBox, textBox, textBounds, textLine, tools as markTools, type Mark, type Pt, type Rect, type Tool as MarkTool } from "./marks";
import { backgrounds, base64, bgCSS, canvas, copyCanvas, decode, decodeBlob, encodeCanvas, exportDialog, fillBackground, imagePath, maxPixels, mosaicBlock, pastedPicture, penEvent, penHTML, pixelated, roundRect, showPen, stamp } from "./imgutil";
import { renderCollage } from "./collage";
import { borderColor, cutout, opaqueBox, type Pixels } from "./cutout";
import { fitRatio as fitBox, resizeBox } from "./geom";
import { grow, inpaint } from "./inpaint";
import { renderMerge } from "./merge";
import { esc, leave, onLeave, openDialog, showError, toast } from "./ui";

// Adjust is the colors' adjustment: percents, degrees and pixels, as the
// CSS filters take them; temperature and sharpening go through an SVG
// filter of the page.
interface Adjust {
  brightness: number;
  contrast: number;
  saturate: number;
  hue: number;
  temp: number; // -100 cold … 100 warm
  sharpen: number; // 0 … 100
  blur: number;
  grayscale: number;
  sepia: number;
  invert: number;
}

const plain: Adjust = { brightness: 100, contrast: 100, saturate: 100, hue: 0, temp: 0, sharpen: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0 };

// Frame puts the picture on a background, with rounded corners and a
// shadow, as screenshots are shown off. Pad and radius are percents of the
// picture's shorter side, shadow 0 … 100.
interface Frame {
  pad: number;
  radius: number;
  shadow: number;
  bg: string; // transparent, a color, or "a,b" for a gradient
}

const noFrame: Frame = { pad: 0, radius: 0, shadow: 0, bg: "transparent" };

type Op =
  | { kind: "crop"; r: Rect }
  | { kind: "rotate"; turn: 1 | -1 }
  | { kind: "flip"; h: boolean }
  | { kind: "resize"; w: number; h: number }
  | { kind: "adjust"; a: Adjust }
  // A text edited again (replaces, the index of its mark) is painted
  // here instead.
  | { kind: "mark"; mark: Mark; replaces?: number }
  | { kind: "frame"; f: Frame }
  // 去背景's result: what it made of the picture before it, which a replay
  // gives again the same.
  | { kind: "cutout"; out: HTMLCanvasElement }
  // 打码: a box, or a brush's stroke, made coarse or blurred.
  | { kind: "censor"; style: CensorStyle; strength: number; shape: CensorShape }
  // 去水印's result, as 去背景's.
  | { kind: "inpaint"; out: HTMLCanvasElement };

type CensorStyle = "mosaic" | "blur";
type CensorShape = { box: Rect } | { pts: Pt[]; size: number };

interface Doc {
  name: string;
  path: string; // the file it came from, "" for none
  size: number;
  orig: HTMLCanvasElement;
  cur: HTMLCanvasElement; // orig with ops done
  ops: Op[];
  redo: Op[];
  saved: number; // how many ops the last save had
}

type Mode = "crop" | "cutout" | "watermark" | "censor" | "adjust" | "resize" | "mark" | "frame" | "pick";

const modes: [Mode, string][] = [
  ["crop", "裁剪旋转"],
  ["cutout", "去背景"],
  ["watermark", "去水印"],
  ["censor", "打码"],
  ["adjust", "调色"],
  ["mark", "标注"],
  ["frame", "边框"],
  ["resize", "尺寸"],
  ["pick", "取色"],
];

// What stays while the toolbox shows other tools: the picture, its edits,
// and what the panels were set to.
let doc: Doc | null = null;
let mode: Mode = loadMode();
let adjust: Adjust = { ...plain }; // not applied yet
let frame: Frame = { ...noFrame }; // not applied yet
let crop: Rect | null = null; // the crop box being set, in the picture's pixels
// The crop box's ratio as its button has it: a width / height, 0 for
// free, -1 for the picture's own.
let ratioPick = "0";
let markTool: MarkTool = "rect";
let picks: string[] = loadPicks();
let z = 1; // the stage's pixels per picture pixel
let tx = 0; // where the picture's top left is on the stage
let ty = 0;
let fitted = true; // the zoom follows the stage's size until changed

let page: HTMLElement | null = null; // the tool's page, while it shows

function loadMode(): Mode {
  try {
    const m = localStorage.getItem("image-mode") as Mode;
    if (modes.some(([id]) => id === m)) return m;
  } catch {}
  return "mark";
}

function loadPicks(): string[] {
  try {
    const p = JSON.parse(localStorage.getItem("image-picks") || "[]");
    return Array.isArray(p) ? p.filter((c) => /^#[0-9a-f]{6}$/.test(c)).slice(0, 12) : [];
  } catch {
    return [];
  }
}

// ---- Operations on canvases ----

function copyOf(src: HTMLCanvasElement) {
  const c = canvas(src.width, src.height);
  c.getContext("2d")!.drawImage(src, 0, 0);
  return c;
}

const isPlain = (a: Adjust) => (Object.keys(plain) as (keyof Adjust)[]).every((k) => a[k] === plain[k]);
// A shadow without room around the picture does not show.
const isNoFrame = (f: Frame) => !f.pad && !f.radius;

// fx is the SVG filter for a temperature and a sharpening, made once each:
// the page's CSS and the canvas both refer to it by id.
function fx(temp: number, sharpen: number) {
  const id = `ie-fx-${temp}-${sharpen}`;
  if (document.getElementById(id)) return id;
  let svg: Element | null = document.getElementById("ie-fx-defs");
  if (!svg) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.id = "ie-fx-defs";
    el.setAttribute("width", "0");
    el.setAttribute("height", "0");
    el.style.position = "absolute";
    document.body.append(el);
    svg = el;
  }
  const t = temp / 100;
  const r = 1 + 0.18 * t;
  const g = 1 + 0.04 * t;
  const b = 1 - 0.18 * t;
  const a = (sharpen / 100) * 1.2;
  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.id = id;
  filter.setAttribute("color-interpolation-filters", "sRGB");
  filter.setAttribute("x", "0");
  filter.setAttribute("y", "0");
  filter.setAttribute("width", "1");
  filter.setAttribute("height", "1");
  filter.innerHTML =
    (temp ? `<feColorMatrix type="matrix" values="${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0"/>` : "") +
    (sharpen ? `<feConvolveMatrix order="3" preserveAlpha="true" edgeMode="duplicate" kernelMatrix="0 ${-a} 0 ${-a} ${1 + 4 * a} ${-a} 0 ${-a} 0"/>` : "");
  svg.append(filter);
  return id;
}

function filterOf(a: Adjust) {
  const f: string[] = [];
  if (a.brightness !== 100) f.push(`brightness(${a.brightness}%)`);
  if (a.contrast !== 100) f.push(`contrast(${a.contrast}%)`);
  if (a.saturate !== 100) f.push(`saturate(${a.saturate}%)`);
  if (a.hue) f.push(`hue-rotate(${a.hue}deg)`);
  if (a.grayscale) f.push(`grayscale(${a.grayscale}%)`);
  if (a.sepia) f.push(`sepia(${a.sepia}%)`);
  if (a.invert) f.push(`invert(${a.invert}%)`);
  if (a.temp || a.sharpen) f.push(`url(#${fx(a.temp, a.sharpen)})`);
  if (a.blur) f.push(`blur(${a.blur}px)`);
  return f.join(" ") || "none";
}

function framePad(w: number, h: number, f: Frame) {
  return Math.round((Math.min(w, h) * f.pad) / 100);
}

// apply does an operation to a picture: it returns a new canvas, or the
// same one drawn on.
function apply(c: HTMLCanvasElement, op: Op): HTMLCanvasElement {
  switch (op.kind) {
    case "crop": {
      const out = canvas(op.r.w, op.r.h);
      out.getContext("2d")!.drawImage(c, -op.r.x, -op.r.y);
      return out;
    }
    case "rotate": {
      const out = canvas(c.height, c.width);
      const ctx = out.getContext("2d")!;
      ctx.translate(op.turn > 0 ? out.width : 0, op.turn > 0 ? 0 : out.height);
      ctx.rotate((op.turn * Math.PI) / 2);
      ctx.drawImage(c, 0, 0);
      return out;
    }
    case "flip": {
      const out = canvas(c.width, c.height);
      const ctx = out.getContext("2d")!;
      if (op.h) ctx.setTransform(-1, 0, 0, 1, c.width, 0);
      else ctx.setTransform(1, 0, 0, -1, 0, c.height);
      ctx.drawImage(c, 0, 0);
      return out;
    }
    case "resize": {
      // Halving step by step first: one big step skips pixels.
      let src = c;
      while (src.width / 2 >= op.w && src.height / 2 >= op.h) {
        const half = canvas(src.width / 2, src.height / 2);
        const h = half.getContext("2d")!;
        h.imageSmoothingQuality = "high";
        h.drawImage(src, 0, 0, half.width, half.height);
        src = half;
      }
      const out = canvas(op.w, op.h);
      const ctx = out.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, 0, 0, out.width, out.height);
      return out;
    }
    case "adjust": {
      const out = canvas(c.width, c.height);
      const ctx = out.getContext("2d")!;
      // A blur takes in the transparent outside at the edges: the picture
      // under it keeps them whole.
      if (op.a.blur) ctx.drawImage(c, 0, 0);
      ctx.filter = filterOf(op.a);
      ctx.drawImage(c, 0, 0);
      return out;
    }
    case "mark": {
      const layer = canvas(c.width, c.height);
      const m = op.mark;
      paintMarks(layer.getContext("2d")!, [m], 1, 0, 0, { x: 0, y: 0, w: c.width, h: c.height }, () => pixelated(c, mosaicBlock(m.size)), 1);
      c.getContext("2d")!.drawImage(layer, 0, 0);
      return c;
    }
    case "frame":
      return framed(c, op.f);
    case "cutout":
    case "inpaint":
      return copyOf(op.out);
    case "censor": {
      const m = canvas(c.width, c.height);
      const mc = m.getContext("2d")!;
      censorPath(mc, op.shape);
      mc.globalCompositeOperation = "source-in";
      mc.drawImage(censorEffect(c, op.style, op.strength), 0, 0);
      c.getContext("2d")!.drawImage(m, 0, 0);
      return c;
    }
  }
}

function framed(c: HTMLCanvasElement, f: Frame) {
  const pad = framePad(c.width, c.height, f);
  const radius = Math.round((Math.min(c.width, c.height) * f.radius) / 100);
  const out = canvas(c.width + pad * 2, c.height + pad * 2);
  const ctx = out.getContext("2d")!;
  fillBackground(ctx, out.width, out.height, f.bg);
  if (f.shadow && pad) {
    const blur = (f.shadow / 100) * Math.max(pad * 0.9, 8);
    ctx.save();
    ctx.shadowColor = `rgba(0, 0, 0, ${0.18 + f.shadow * 0.0025})`;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetY = blur * 0.3;
    ctx.fillStyle = "#000";
    roundRect(ctx, pad, pad, c.width, c.height, radius);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  roundRect(ctx, pad, pad, c.width, c.height, radius);
  ctx.clip();
  // Under a transparent picture the shadow's black would show.
  if (f.shadow && pad) {
    ctx.clearRect(pad, pad, c.width, c.height);
    fillBackground(ctx, out.width, out.height, f.bg);
  }
  ctx.drawImage(c, pad, pad);
  ctx.restore();
  return out;
}

// replay does the ops again from the original, but those replaced, and
// the one being edited.
function replay(d: Doc, editing?: number) {
  const skip = new Set(d.ops.map((op) => (op.kind === "mark" ? op.replaces : undefined)));
  skip.add(editing);
  let c = copyOf(d.orig);
  d.ops.forEach((op, i) => {
    if (!skip.has(i)) c = apply(c, op);
  });
  d.cur = c;
  pickData = null;
}

function commit(op: Op) {
  if (!doc) return;
  if (op.kind === "mark" && op.replaces !== undefined) {
    doc.ops.push(op);
    doc.redo = [];
    return replay(doc);
  }
  const c = apply(doc.cur === doc.orig ? copyOf(doc.cur) : doc.cur, op);
  doc.ops.push(op);
  doc.redo = [];
  doc.cur = c;
  pickData = null;
  if (op.kind !== "mark") crop = null;
}

// commitPending applies what a panel shows but has not applied: the crop
// box, the colors, the frame. What shows is what is kept.
function commitPending() {
  if (!doc) return;
  if (crop && (crop.x || crop.y || crop.w !== doc.cur.width || crop.h !== doc.cur.height)) commit({ kind: "crop", r: { ...crop } });
  crop = null;
  if (!isPlain(adjust)) commit({ kind: "adjust", a: { ...adjust } });
  adjust = { ...plain };
  if (!isNoFrame(frame)) commit({ kind: "frame", f: { ...frame } });
  frame = { ...frame, pad: 0, radius: 0, shadow: 0 };
  if (cutChanged()) commit({ kind: "cutout", out: copyOf(cut!.out) });
  cut = null;
  closeText(true);
}

const pending = () => !!doc && (!isPlain(adjust) || !isNoFrame(frame) || cutChanged() || (!!crop && (crop.x > 0 || crop.y > 0 || crop.w !== doc.cur.width || crop.h !== doc.cur.height)));
const dirty = () => !!doc && (doc.ops.length !== doc.saved || pending());

// ---- Opening ----

// confirmDiscard asks before an unsaved edit is thrown away.
function confirmDiscard(): Promise<boolean> {
  if (!dirty()) return Promise.resolve(true);
  return new Promise((ok) => {
    const dlg = openDialog(`
      <h2>放弃修改？</h2>
      <p>「${esc(doc!.name)}」的修改还没有保存。</p>
      <div class="l-buttons"><button type="button" data-close>取消</button><button type="button" class="primary" data-ok>放弃修改</button></div>`);
    let yes = false;
    dlg.querySelector("[data-ok]")!.addEventListener("click", () => {
      yes = true;
      dlg.close();
    });
    dlg.addEventListener("close", () => ok(yes));
  });
}

async function openPicture(src: Promise<{ c: HTMLCanvasElement; name: string; path: string; size: number } | null>) {
  try {
    const got = await src;
    if (!got) return;
    if (!(await confirmDiscard())) return;
    doc = { name: got.name, path: got.path, size: got.size, orig: got.c, cur: copyOf(got.c), ops: [], redo: [], saved: 0 };
    adjust = { ...plain };
    frame = { ...noFrame };
    crop = null;
    pickData = null;
    fitted = true;
    if (/\.gif$/i.test(got.name)) toast("GIF 只取第一帧");
    if (mode === "crop") crop = full();
    // A picture opens as it is, even on 去背景's panel.
    cut = null;
    wm = null;
    if (mode === "cutout") startCut(false);
    draw();
  } catch (e) {
    showError(e);
  }
}

const fromEdit = async (e: EditImage | null | undefined) => (e ? { c: await decode(e.url), name: e.name, path: e.path, size: e.size } : null);

function openFile() {
  void openPicture(ImageEdit.open().then(fromEdit));
}

function openBlob(file: Blob, name: string) {
  void openPicture(decodeBlob(file).then((c) => ({ c, name, path: "", size: file.size })));
}

// openCanvas opens a picture another view made, as a collage, to edit.
export function openCanvas(c: HTMLCanvasElement, name: string) {
  switchView("edit");
  void openPicture(Promise.resolve({ c, name, path: "", size: 0 }));
}

// A picture sent from a screenshot, a pinned picture or the clipboard
// history: the editor shows, whatever view was on.
function takeSent() {
  void ImageEdit.take().then((e) => {
    if (!e) return;
    switchView("edit");
    return openPicture(fromEdit(e));
  }, showError);
}

events.imageEditOpened.on(() => {
  if (host?.isConnected) takeSent();
});

// Pictures dropped on the window while the editor shows: the first opens.
onFileDrop(({ paths }) => {
  if (!shown()) return;
  const p = paths.find((p) => imagePath.test(p));
  if (!p) return paths.length ? toast("不是能打开的图片") : undefined;
  void openPicture(ImageEdit.openPath(p).then(fromEdit));
});

function shown() {
  return !!page?.isConnected && !!page.querySelector(".ie");
}

async function encode(format: string, quality: number): Promise<Blob> {
  commitPending();
  return encodeCanvas(doc!.cur, format, quality);
}

async function copyPicture() {
  if (!doc) return;
  try {
    commitPending();
    await copyCanvas(doc.cur);
    draw();
  } catch (e) {
    showError(e);
  }
}

function showExport() {
  if (!doc) return;
  commitPending();
  draw();
  const d = doc;
  exportDialog({
    path: d.path,
    size: d.size,
    dims: () => [d.cur.width, d.cur.height],
    encode,
    save: (data, format) => ImageEdit.save(data, format, d.name, d.path),
    overwrite: d.path ? (data, format) => ImageEdit.overwrite(d.path, data, format) : undefined,
    saved: () => {
      d.saved = d.ops.length;
      draw();
    },
  });
}

// ---- The page: its three views ----

type View = "edit" | "collage" | "merge";

const views: [View, string, string][] = [
  ["edit", "编辑图片", "裁剪、调色、标注、加边框"],
  ["collage", "创造拼图", "几张图拼成一张，自定义分割，加标注"],
  ["merge", "合并文档", "多张图按顺序合成 PDF、PPT 或长图"],
];

let view: View = (() => {
  try {
    const v = localStorage.getItem("image-view") as View;
    if (views.some(([id]) => id === v)) return v;
  } catch {}
  return "edit";
})();

let host: HTMLElement | null = null; // the views' box, while the tool shows

export const imageTool = {
  id: "image",
  name: "图片编辑",
  icon: icons.image,
  render(p: HTMLElement) {
    p.innerHTML = `
      <div class="iv">
        <div class="iv-tabs">${views.map(([v, n, tip]) => `<button data-view="${v}" title="${tip}">${n}</button>`).join("")}</div>
        <div class="iv-body"></div>
      </div>`;
    host = p.querySelector<HTMLElement>(".iv-body")!;
    p.querySelector(".iv-tabs")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-view]");
      if (b) switchView(b.dataset.view as View);
    });
    showView();
    takeSent();
  },
};

function showView() {
  if (!host) return;
  host.parentElement!.querySelectorAll<HTMLElement>(".iv-tabs [data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  if (view === "collage") renderCollage(host);
  else if (view === "merge") renderMerge(host);
  else renderEdit(host);
}

// switchView shows another view: the last one's listeners go, what it
// holds stays for when it comes back.
function switchView(v: View) {
  if (v === view && host?.isConnected) return;
  view = v;
  try {
    localStorage.setItem("image-view", v);
  } catch {}
  if (!host?.isConnected) return;
  const h = host;
  leave();
  host = h;
  showView();
}

function renderEdit(p: HTMLElement) {
  page = p;
  p.innerHTML = `
    <div class="ie">
      <div class="ie-top">
        <button data-act="open" title="打开图片 (Ctrl+O)">打开</button>
        <span class="ie-sep"></span>
        <button data-act="undo" class="ie-ic" title="撤销 (Ctrl+Z)">${markIcons.undo}</button>
        <button data-act="redo" class="ie-ic" title="重做 (Ctrl+Y)">${editIcons.redo}</button>
        <span class="ie-name"></span>
        <span class="ie-zoom">
          <button data-act="out" class="ie-ic" title="缩小 (-)">−</button>
          <button data-act="actual" class="ie-z" title="原始大小 (1)"></button>
          <button data-act="in" class="ie-ic" title="放大 (+)">+</button>
          <button data-act="fit" title="适应窗口 (0)">适应</button>
        </span>
        <span class="ie-sep"></span>
        <button data-act="copy" title="复制图片 (Ctrl+C)">复制</button>
        <button data-act="export" class="primary" title="保存 (Ctrl+S)">保存</button>
        <button data-act="close" class="ie-ic" title="关闭图片">✕</button>
      </div>
      <div class="ie-body">
        <nav class="ie-rail">${modes.map(([m, n]) => `<button data-mode="${m}" title="${n}">${editIcons[m]}<span>${n}</span></button>`).join("")}</nav>
        <div class="ie-stage">
          <canvas class="ie-over"></canvas>
          <div class="ie-crop" hidden>${["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => `<i data-h="${h}"></i>`).join("")}<span class="ie-crop-size"></span></div>
          <div class="ie-empty">
            ${icons.image}
            <p><b>把图片拖进来</b>，或者</p>
            <div class="ie-empty-acts">
              <button data-act="open" class="primary">打开图片</button>
              <button data-act="shot">截图编辑</button>
            </div>
            <p class="muted">也可以按 Ctrl+V 粘贴剪贴板里的图片；截图工具栏、贴图的右键菜单和剪贴板历史里的「编辑」也会在这里打开。</p>
          </div>
          <div class="ie-pick-tip" hidden></div>
        </div>
        <aside class="ie-side"></aside>
      </div>
    </div>`;
  const stage = p.querySelector<HTMLElement>(".ie-stage")!;
  p.querySelector(".ie-top")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]");
    if (b && !b.disabled) act(b.dataset.act!);
  });
  p.querySelector(".ie-empty")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (b) act(b.dataset.act!);
  });
  p.querySelector(".ie-rail")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-mode]");
    if (b) setMode(b.dataset.mode as Mode);
  });
  bindStage(stage);
  bindSide(p.querySelector<HTMLElement>(".ie-side")!);
  const ro = new ResizeObserver(() => draw());
  ro.observe(stage);
  onLeave(() => ro.disconnect());
  const keys = (e: KeyboardEvent) => onKey(e);
  const keyUp = (e: KeyboardEvent) => {
    if (e.code === "Space") setSpace(false);
  };
  document.addEventListener("keydown", keys);
  document.addEventListener("keyup", keyUp);
  onLeave(() => document.removeEventListener("keydown", keys));
  onLeave(() => document.removeEventListener("keyup", keyUp));
  // A picture pasted anywhere but a text box opens.
  const paste = (e: ClipboardEvent) => {
    const file = pastedPicture(e);
    if (file) openBlob(file, `粘贴的图片 ${stamp()}.png`);
  };
  document.addEventListener("paste", paste);
  onLeave(() => document.removeEventListener("paste", paste));
  onLeave(() => {
    closeText(true);
    page = null;
  });
  if (mode === "crop" && doc && !crop) crop = full();
  if (mode === "cutout" && doc && !cut) startCut(false);
  draw();
}

const ratioOf = () => (ratioPick === "-1" && doc ? doc.cur.width / doc.cur.height : Number(ratioPick));

const full = (): Rect => ({ x: 0, y: 0, w: doc!.cur.width, h: doc!.cur.height });

function act(a: string) {
  switch (a) {
    case "open":
      return openFile();
    case "shot":
      return void Shot.start("edit");
    case "undo":
      return undo();
    case "redo":
      return redo();
    case "in":
      return zoomBy(1.25);
    case "out":
      return zoomBy(0.8);
    case "actual":
      return zoomTo(1);
    case "fit":
      fitted = true;
      fit();
      return draw();
    case "copy":
      return void copyPicture();
    case "export":
      return showExport();
    case "close":
      return void confirmDiscard().then((yes) => {
        if (!yes) return;
        doc = null;
        crop = null;
        cut = null;
        pickData = null;
        adjust = { ...plain };
        frame = { ...noFrame };
        draw();
      });
  }
}

function undo() {
  if (!doc) return;
  closeText(false);
  // What a panel shows unapplied goes first.
  if (pending()) {
    adjust = { ...plain };
    frame = { ...frame, pad: 0, radius: 0, shadow: 0 };
    crop = mode === "crop" ? full() : null;
    if (cut) resetCut(false);
    return draw();
  }
  const op = doc.ops.pop();
  if (!op) return;
  doc.redo.push(op);
  replay(doc);
  if (mode === "crop") crop = full();
  if (mode === "cutout") startCut(false);
  draw();
}

function redo() {
  if (!doc) return;
  const op = doc.redo.pop();
  if (!op) return;
  commitPending();
  const rest = doc.redo;
  commit(op);
  doc.redo = rest;
  if (mode === "crop") crop = full();
  if (mode === "cutout") startCut(false);
  draw();
}

function setMode(m: Mode) {
  if (m === mode) return;
  commitPending();
  mode = m;
  try {
    localStorage.setItem("image-mode", m);
  } catch {}
  if (m === "crop" && doc) crop = full();
  if (m === "cutout" && doc) startCut();
  if (m === "watermark" && doc) startWatermark();
  if (m === "resize") resizeTo = null;
  draw();
}

// ---- Zoom ----

function stageBox() {
  return page?.querySelector<HTMLElement>(".ie-stage") ?? null;
}

// shownSize is the size of what the stage shows: the picture, framed when
// the frame panel shows one.
function shownSize() {
  if (!doc) return { w: 1, h: 1 };
  const pad = mode === "frame" && !isNoFrame(frame) ? framePad(doc.cur.width, doc.cur.height, frame) : 0;
  return { w: doc.cur.width + pad * 2, h: doc.cur.height + pad * 2 };
}

function fit() {
  const s = stageBox();
  if (!s || !doc) return;
  const { w, h } = shownSize();
  const m = 32;
  z = Math.min((s.clientWidth - m * 2) / w, (s.clientHeight - m * 2) / h, 1);
  z = Math.max(z, 0.01);
  tx = (s.clientWidth - w * z) / 2;
  ty = (s.clientHeight - h * z) / 2;
}

function zoomTo(nz: number, at?: Pt) {
  const s = stageBox();
  if (!s || !doc) return;
  nz = Math.min(Math.max(nz, 0.02), 32);
  const p = at ?? { x: s.clientWidth / 2, y: s.clientHeight / 2 };
  tx = p.x - ((p.x - tx) * nz) / z;
  ty = p.y - ((p.y - ty) * nz) / z;
  z = nz;
  fitted = false;
  draw();
}

const zoomBy = (k: number, at?: Pt) => zoomTo(z * k, at);

// ---- Drawing the page ----

let shownCanvas: HTMLCanvasElement | null = null; // what the stage shows
let framedCache: { src: HTMLCanvasElement; key: string; c: HTMLCanvasElement } | null = null;

function draw() {
  if (!shown()) return;
  const p = page!;
  const s = p.querySelector<HTMLElement>(".ie-stage")!;
  // 去背景 goes on after what applied it (应用, Enter, 保存, 复制), from the
  // picture as it is then.
  if (mode === "cutout" && doc && !cut) return startCut(false);
  if (mode === "watermark" && doc && (!wm || wm.sel.width !== doc.cur.width || wm.sel.height !== doc.cur.height)) startWatermark();
  if (fitted) fit();
  p.querySelector<HTMLElement>(".ie")!.classList.toggle("ie-has", !!doc);
  p.querySelector<HTMLElement>(".ie-empty")!.hidden = !!doc;
  p.querySelectorAll<HTMLButtonElement>(".ie-top [data-act]").forEach((b) => {
    if (b.dataset.act !== "open") b.disabled = !doc;
  });
  p.querySelector<HTMLButtonElement>('[data-act="undo"]')!.disabled = !doc || (!doc.ops.length && !pending());
  p.querySelector<HTMLButtonElement>('[data-act="redo"]')!.disabled = !doc || !doc.redo.length;
  p.querySelectorAll<HTMLElement>(".ie-rail [data-mode]").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === mode);
    (b as HTMLButtonElement).disabled = !doc;
  });
  const name = p.querySelector<HTMLElement>(".ie-name")!;
  name.innerHTML = doc
    ? `<b title="${esc(doc.path || doc.name)}">${dirty() ? "• " : ""}${esc(doc.name)}</b><span class="muted">${doc.cur.width} × ${doc.cur.height}</span>`
    : `<span class="muted">没有打开图片</span>`;
  p.querySelector(".ie-z")!.textContent = `${Math.round(z * 100)}%`;
  s.dataset.mode = mode;
  s.dataset.tool = mode === "mark" ? markTool : "";
  // What shows: the picture, or its framed preview.
  let show: HTMLCanvasElement | null = null;
  if (doc) {
    show = doc.cur;
    if (mode === "cutout" && cut) show = cut.out;
    else if (mode === "frame" && !isNoFrame(frame)) {
      const key = JSON.stringify(frame);
      if (!framedCache || framedCache.src !== doc.cur || framedCache.key !== key) framedCache = { src: doc.cur, key, c: framed(doc.cur, frame) };
      show = framedCache.c;
    } else framedCache = null;
  }
  if (show !== shownCanvas || (show && !show.isConnected)) {
    shownCanvas?.remove();
    shownCanvas = show;
    if (show) {
      show.classList.add("ie-view");
      s.prepend(show);
    }
  }
  if (show) {
    show.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
    show.style.filter = mode === "adjust" && !isPlain(adjust) ? filterOf(adjust) : "";
    show.style.imageRendering = z >= 3 ? "pixelated" : "";
    show.style.setProperty("--ie-check", `${12 / z}px`);
  }
  drawCrop();
  drawOver();
  drawSide();
}

function drawCrop() {
  const box = page!.querySelector<HTMLElement>(".ie-crop")!;
  box.hidden = !(doc && mode === "crop" && crop);
  if (box.hidden || !crop) return;
  Object.assign(box.style, { left: `${tx + crop.x * z}px`, top: `${ty + crop.y * z}px`, width: `${crop.w * z}px`, height: `${crop.h * z}px` });
  box.querySelector(".ie-crop-size")!.textContent = `${Math.round(crop.w)} × ${Math.round(crop.h)}`;
}

// drawOver paints, on the canvas over the stage, what is being drawn: a
// mark, a box or a stroke of 打码, 去水印's selection, and the brush.
function drawOver() {
  const s = stageBox();
  const over = page!.querySelector<HTMLCanvasElement>(".ie-over")!;
  const dpr = devicePixelRatio || 1;
  const w = Math.round(s!.clientWidth * dpr);
  const h = Math.round(s!.clientHeight * dpr);
  if (over.width !== w || over.height !== h) {
    over.width = w;
    over.height = h;
  }
  const ctx = over.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  placeText();
  if (!doc) return;
  // From the picture's pixels to the canvas's.
  const toOver = () => ctx.setTransform(z * dpr, 0, 0, z * dpr, tx * dpr, ty * dpr);
  if (mode === "watermark" && wm) {
    toOver();
    ctx.globalAlpha = 0.5;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(wm.sel, 0, 0);
    ctx.globalAlpha = 1;
    if (boxDraft) {
      ctx.fillStyle = "rgba(239, 68, 68, 0.35)";
      ctx.fillRect(boxDraft.x, boxDraft.y, boxDraft.w, boxDraft.h);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  if (mode === "censor" && censorDraft) {
    // What the box or stroke will be, coarse or blurred already.
    const tmp = canvas(w, h);
    const t = tmp.getContext("2d")!;
    t.setTransform(z * dpr, 0, 0, z * dpr, tx * dpr, ty * dpr);
    censorPath(t, censorDraft.shape);
    t.globalCompositeOperation = "source-in";
    t.drawImage(censorDraft.fx, 0, 0);
    ctx.drawImage(tmp, 0, 0);
    if ("box" in censorDraft.shape) {
      const r = censorDraft.shape.box;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.lineWidth = dpr;
      ctx.strokeRect((tx + r.x * z) * dpr, (ty + r.y * z) * dpr, r.w * z * dpr, r.h * z * dpr);
      ctx.setLineDash([]);
    }
  }
  if (drawing) {
    const src = drawing.mosaic;
    paintMarks(ctx, [drawing.mark], z * dpr, -tx * dpr, -ty * dpr, full(), () => src ?? doc!.cur, 1);
  }
  // The brush's size where it would paint.
  const brush =
    mode === "cutout" && cut && cut.tool !== "seed"
      ? cutBrushes[cut.brush]!
      : mode === "watermark" && wm && wm.tool !== "box"
        ? cutBrushes[wm.brush]!
        : mode === "censor" && censorPrefs.shape === "brush"
          ? cutBrushes[censorPrefs.brush]!
          : 0;
  if (brush && brushAt) {
    ctx.beginPath();
    ctx.arc((tx + brushAt.x * z) * dpr, (ty + brushAt.y * z) * dpr, (brush / 2) * dpr, 0, 2 * Math.PI);
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.stroke();
    ctx.lineWidth = 0.75 * dpr;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }
}

// ---- The stage: panning, cropping, drawing, picking ----

let drawing: { mark: Mark; mosaic: HTMLCanvasElement | null } | null = null;
let space = false;
let pickData: ImageData | null = null;
// The text being typed: at and size in the picture's pixels; again, the
// index of the mark it edits.
let text: { el: HTMLTextAreaElement; at: Pt; size: number; color: string; again?: number } | null = null;

function setSpace(on: boolean) {
  space = on;
  stageBox()?.classList.toggle("ie-panning", on);
}

function toPicture(e: { clientX: number; clientY: number }): Pt {
  const r = stageBox()!.getBoundingClientRect();
  return { x: (e.clientX - r.left - tx) / z, y: (e.clientY - r.top - ty) / z };
}

function toStage(e: { clientX: number; clientY: number }): Pt {
  const r = stageBox()!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

const fitRatio = (r: number) => fitBox(doc!.cur.width, doc!.cur.height, r);

// resizeCrop moves a handle of the crop box to a point, keeping the ratio
// when there is one, within the picture.
const resizeCrop = (o: Rect, h: string, p: Pt) => resizeBox(o, h, p, doc!.cur.width, doc!.cur.height, ratioOf());

function bindStage(stage: HTMLElement) {
  let drag: { kind: "pan" | "move" | "resize" | "new"; h?: string; start: Pt; at: Pt; tx: number; ty: number; orig: Rect | null } | null = null;
  stage.addEventListener("wheel", (e) => {
    if (!doc) return;
    e.preventDefault();
    zoomBy(Math.exp(-e.deltaY * 0.0015), toStage(e));
  }, { passive: false });
  stage.addEventListener("pointerdown", (e) => {
    if (!doc || (e.button !== 0 && e.button !== 1)) return;
    if (text) {
      // A click elsewhere ends the text.
      closeText(true);
      return draw();
    }
    const p = toPicture(e);
    const at = toStage(e);
    const panning = e.button === 1 || space || mode === "adjust" || mode === "resize" || mode === "frame";
    if (panning) drag = { kind: "pan", start: p, at, tx, ty, orig: null };
    else if (mode === "crop" && crop) {
      const h = (e.target as HTMLElement).dataset.h;
      const inside = p.x >= crop.x && p.x <= crop.x + crop.w && p.y >= crop.y && p.y <= crop.y + crop.h;
      drag = { kind: h ? "resize" : inside ? "move" : "new", h, start: p, at, tx, ty, orig: { ...crop } };
    } else if (mode === "mark") {
      if (markTool === "text") {
        e.preventDefault();
        openText(p);
        return;
      }
      const size = sizeOf(markTool, pen.size) / z;
      drawing = { mark: newMark(markTool, p, size), mosaic: markTool === "mosaic" ? pixelated(doc.cur, mosaicBlock(size)) : null };
      drag = { kind: "new", start: p, at, tx, ty, orig: null };
    } else if (mode === "pick") {
      pickAt(p, true);
      return;
    } else if (mode === "cutout" && cut) {
      if (cut.tool === "seed") {
        if (p.x >= 0 && p.y >= 0 && p.x < doc.cur.width && p.y < doc.cur.height) {
          cut.seeds.push({ x: p.x, y: p.y });
          recut();
        }
        return;
      }
      cutStroke(p, p);
      drag = { kind: "new", start: p, at, tx, ty, orig: null };
    } else if (mode === "watermark" && wm && !wm.busy) {
      if (wm.tool === "box") boxDraft = { x: p.x, y: p.y, w: 0, h: 0 };
      else selStroke(p, p);
      drag = { kind: "new", start: p, at, tx, ty, orig: null };
    } else if (mode === "censor") {
      const shape: CensorShape = censorPrefs.shape === "box" ? { box: { x: p.x, y: p.y, w: 0, h: 0 } } : { pts: [p], size: cutBrushes[censorPrefs.brush]! / z };
      censorDraft = { shape, fx: censorEffect(doc.cur, censorPrefs.style, censorPrefs.strength) };
      drag = { kind: "new", start: p, at, tx, ty, orig: null };
    } else return;
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {}
    drawOver();
  });
  stage.addEventListener("pointermove", (e) => {
    if (mode === "pick" && doc && !drag) pickAt(toPicture(e), false);
    if (mode === "cutout" || mode === "watermark" || mode === "censor") {
      brushAt = toPicture(e);
      if (!drag) drawOver();
    }
    if (!drag || !doc) return;
    const p = toPicture(e);
    if (drag.kind === "pan") {
      const at = toStage(e);
      tx = drag.tx + at.x - drag.at.x;
      ty = drag.ty + at.y - drag.at.y;
      fitted = false;
      return draw();
    }
    if (drawing) {
      dragMark(drawing.mark, p, e.shiftKey, 1.5 / z);
      return drawOver();
    }
    if (mode === "cutout" && cut && drag.kind === "new") {
      cutStroke(drag.start, p);
      drag.start = p;
      return draw();
    }
    if (mode === "watermark" && wm && drag.kind === "new") {
      if (boxDraft) boxDraft = boxOf(drag.start, p);
      else {
        selStroke(drag.start, p);
        drag.start = p;
      }
      return drawOver();
    }
    if (mode === "censor" && censorDraft && drag.kind === "new") {
      const sh = censorDraft.shape;
      if ("box" in sh) sh.box = boxOf(drag.start, p);
      else dragMark({ kind: "pen", pts: sh.pts, color: "", size: sh.size }, p, false, 1.5 / z);
      return drawOver();
    }
    if (mode !== "crop" || !drag.orig) return;
    const W = doc.cur.width;
    const H = doc.cur.height;
    const o = drag.orig;
    if (drag.kind === "move") {
      crop = { x: Math.round(clamp(o.x + p.x - drag.start.x, 0, W - o.w)), y: Math.round(clamp(o.y + p.y - drag.start.y, 0, H - o.h)), w: o.w, h: o.h };
    } else if (drag.kind === "resize") {
      crop = resizeCrop(o, drag.h!, p);
    } else {
      // A new box from where the drag started, as the se handle of a box
      // of nothing there.
      const s = { x: clamp(drag.start.x, 0, W), y: clamp(drag.start.y, 0, H) };
      crop = resizeCrop({ x: s.x, y: s.y, w: 0, h: 0 }, (p.y < s.y ? "n" : "s") + (p.x < s.x ? "w" : "e"), p);
    }
    draw();
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    if (drawing && doc) {
      const m = drawing.mark;
      drawing = null;
      if (!slip(m, 3 / z)) commit({ kind: "mark", mark: m });
    }
    if (mode === "crop" && crop && (crop.w < 2 || crop.h < 2)) crop = full();
    if (boxDraft && wm) {
      const r = boxDraft;
      boxDraft = null;
      if (r.w * z >= 3 && r.h * z >= 3) {
        const ctx = wm.sel.getContext("2d")!;
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        wm.any = true;
      }
    }
    if (censorDraft && doc) {
      const sh = censorDraft.shape;
      censorDraft = null;
      if (!("box" in sh) || (sh.box.w * z >= 3 && sh.box.h * z >= 3)) commit({ kind: "censor", style: censorPrefs.style, strength: censorPrefs.strength, shape: sh });
    }
    draw();
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  stage.addEventListener("dblclick", (e) => {
    if (mode === "crop" && crop && (e.target as HTMLElement).closest(".ie-crop")) applyCrop();
  });
  stage.addEventListener("pointerleave", () => {
    if (mode === "pick") page?.querySelector<HTMLElement>(".ie-pick-tip")?.setAttribute("hidden", "");
    if (brushAt) {
      brushAt = null;
      drawOver();
    }
  });
}

function applyCrop() {
  commitPending();
  if (mode === "crop") crop = full();
  draw();
}

// ---- 去背景 ----

// cut is 去背景 while its panel shows: the picture it started from, its
// pixels, what is taken away by color (auto), the strokes that bring back
// (restore) or take away (erase), and the result (out).
let cut: {
  src: HTMLCanvasElement;
  px: Pixels;
  auto: HTMLCanvasElement;
  restore: HTMLCanvasElement;
  erase: HTMLCanvasElement;
  out: HTMLCanvasElement;
  border: boolean;
  seeds: Pt[];
  tol: number; // 1 … 100 on the slider
  tool: "seed" | "erase" | "restore";
  brush: number; // an index of cutBrushes
  strokes: boolean; // something was painted
  removed: boolean; // the colors took something away
} | null = null;
let brushAt: Pt | null = null;

// The brushes' sizes, in the stage's pixels.
const cutBrushes = [12, 28, 56];

// The slider's 1 … 100 as a color distance: finer at the low end.
const tolOf = (v: number) => Math.round(2 + (v / 100) ** 1.6 * 160);

const cutChanged = () => !!cut && (cut.removed || cut.strokes);

// startCut opens 去背景 on the picture as it is now: with border, the
// edges' color goes at once, as when the panel is picked; on a picture
// just opened, after an undo or an apply, nothing goes until asked.
function startCut(border = true) {
  if (!doc) return;
  const src = doc.cur;
  const px = src.getContext("2d")!.getImageData(0, 0, src.width, src.height);
  const mk = () => canvas(src.width, src.height);
  cut = { src, px, auto: mk(), restore: mk(), erase: mk(), out: mk(), border, seeds: [], tol: 30, tool: "seed", brush: 1, strokes: false, removed: false };
  recut();
}

// resetCut goes back to the picture as it was, keeping the panel's
// settings; with border, it takes the edges' color away again.
function resetCut(border: boolean) {
  if (!cut) return;
  cut.seeds = [];
  cut.border = border;
  cut.strokes = false;
  for (const c of [cut.restore, cut.erase]) c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
  recut();
}

// recut takes the background away by color again, after the tolerance,
// the edges' box or the points clicked changed.
function recut() {
  if (!cut) return;
  const c = cut;
  const data = c.border || c.seeds.length ? cutout(c.px, { border: c.border, seeds: c.seeds, tol: tolOf(c.tol) }) : new Uint8ClampedArray(c.px.data);
  c.removed = false;
  for (let i = 3; i < data.length; i += 4)
    if (data[i]! !== c.px.data[i]!) {
      c.removed = true;
      break;
    }
  c.auto.getContext("2d")!.putImageData(new ImageData(data, c.px.width, c.px.height), 0, 0);
  compose();
  draw();
}

// compose is the result: what the colors left, with what the restore
// strokes bring back of the picture, less what the erase strokes take.
function compose() {
  if (!cut) return;
  const { src, auto, restore, erase, out } = cut;
  const ctx = out.getContext("2d")!;
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(auto, 0, 0);
  if (cut.strokes) {
    const back = canvas(src.width, src.height);
    const b = back.getContext("2d")!;
    b.drawImage(src, 0, 0);
    b.globalCompositeOperation = "destination-in";
    b.drawImage(restore, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(back, 0, 0);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(erase, 0, 0);
  }
  ctx.globalCompositeOperation = "source-over";
}

// cutStroke paints a stroke of the erase or restore brush from a to b, in
// the picture's pixels, and takes it off the other one.
function cutStroke(a: Pt, b: Pt) {
  if (!cut || cut.tool === "seed") return;
  const on = cut.tool === "erase" ? cut.erase : cut.restore;
  const off = cut.tool === "erase" ? cut.restore : cut.erase;
  const size = cutBrushes[cut.brush]! / z;
  for (const [c, op] of [
    [on, "source-over"],
    [off, "destination-out"],
  ] as const) {
    const ctx = c.getContext("2d")!;
    ctx.globalCompositeOperation = op;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = size;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x + (a.x === b.x && a.y === b.y ? 0.01 : 0), b.y);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }
  cut.strokes = true;
  compose();
}

// asPet makes the picture, as it shows, a look of the floating ball: what
// is transparent around it cut off, at most 512 on a side.
async function asPet() {
  if (!doc) return;
  commitPending();
  let c = doc.cur;
  const box = opaqueBox(c.getContext("2d")!.getImageData(0, 0, c.width, c.height));
  if (!box) return toast("整张图都是透明的");
  const pad = Math.round(Math.max(box.w, box.h) * 0.02);
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const w = Math.min(c.width, box.x + box.w + pad) - x;
  const h = Math.min(c.height, box.y + box.h + pad) - y;
  const k = Math.min(1, 512 / Math.max(w, h));
  const small = canvas(w * k, h * k);
  const s = small.getContext("2d")!;
  s.imageSmoothingQuality = "high";
  s.drawImage(c, x, y, w, h, 0, 0, small.width, small.height);
  c = small;
  try {
    await Settings.addPetImage(await base64(await encodeCanvas(c, "png", 100)));
    toast("已设为悬浮球的形象，可以在「设置 → 悬浮球」里换回来");
  } catch (e) {
    showError(e);
  }
  draw();
}

// ---- 打码 ----

// What 打码 does, kept for next time: mosaic or blur, by brush or box, how
// strong, which brush.
const censorPrefs: { style: CensorStyle; shape: "brush" | "box"; strength: number; brush: number } = (() => {
  const def = { style: "mosaic" as CensorStyle, shape: "box" as "brush" | "box", strength: 50, brush: 1 };
  try {
    const p = JSON.parse(localStorage.getItem("image-censor") || "{}");
    return {
      style: p.style === "blur" ? "blur" : "mosaic",
      shape: p.shape === "brush" ? "brush" : "box",
      strength: p.strength >= 1 && p.strength <= 100 ? p.strength : def.strength,
      brush: [0, 1, 2].includes(p.brush) ? p.brush : def.brush,
    };
  } catch {
    return def;
  }
})();

function saveCensor() {
  try {
    localStorage.setItem("image-censor", JSON.stringify(censorPrefs));
  } catch {}
}

// A box or stroke of 打码 being drawn, and the picture made coarse or
// blurred that shows through it.
let censorDraft: { shape: CensorShape; fx: HTMLCanvasElement } | null = null;

const boxOf = (a: Pt, b: Pt): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });

// censorEffect is the whole picture made coarse or blurred, as strong as
// asked (1 … 100), in steps of its shorter side.
function censorEffect(c: HTMLCanvasElement, style: CensorStyle, strength: number) {
  const unit = Math.min(c.width, c.height);
  if (style === "mosaic") return pixelated(c, Math.max(3, Math.round(unit * (0.006 + (strength / 100) * 0.05))));
  const out = canvas(c.width, c.height);
  const ctx = out.getContext("2d")!;
  ctx.drawImage(c, 0, 0);
  ctx.filter = `blur(${Math.max(2, unit * (0.003 + (strength / 100) * 0.03)).toFixed(1)}px)`;
  ctx.drawImage(c, 0, 0);
  return out;
}

// censorPath fills a box, or strokes a brush's line, in the picture's
// pixels.
function censorPath(ctx: CanvasRenderingContext2D, sh: CensorShape) {
  ctx.fillStyle = ctx.strokeStyle = "#000";
  if ("box" in sh) return ctx.fillRect(sh.box.x, sh.box.y, sh.box.w, sh.box.h);
  ctx.lineWidth = sh.size;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.beginPath();
  const [p0, ...rest] = sh.pts;
  ctx.moveTo(p0!.x, p0!.y);
  if (!rest.length) ctx.lineTo(p0!.x + 0.01, p0!.y);
  for (const q of rest) ctx.lineTo(q.x, q.y);
  ctx.stroke();
}

// ---- 去水印 ----

// wm is 去水印 while its panel shows: what is painted over the watermark,
// in red on a canvas of the picture's size.
let wm: { sel: HTMLCanvasElement; tool: "brush" | "box" | "erase"; brush: number; busy: boolean; any: boolean } | null = null;
let boxDraft: Rect | null = null;

function startWatermark() {
  if (!doc) return;
  const tool = wm?.tool ?? "brush";
  const brush = wm?.brush ?? 1;
  wm = { sel: canvas(doc.cur.width, doc.cur.height), tool, brush, busy: false, any: false };
}

// selStroke paints the selection, or erases it, from a to b.
function selStroke(a: Pt, b: Pt) {
  if (!wm) return;
  const ctx = wm.sel.getContext("2d")!;
  ctx.globalCompositeOperation = wm.tool === "erase" ? "destination-out" : "source-over";
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = cutBrushes[wm.brush]! / z;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x + (a.x === b.x && a.y === b.y ? 0.01 : 0), b.y);
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
  if (wm.tool !== "erase") wm.any = true;
}

// removeWatermark fills what is selected from the picture around it.
async function removeWatermark() {
  if (!doc || !wm || wm.busy) return;
  const d = doc;
  const w = wm;
  const sel = w.sel.getContext("2d")!.getImageData(0, 0, w.sel.width, w.sel.height).data;
  const mask = new Uint8Array(w.sel.width * w.sel.height);
  let n = 0;
  for (let i = 0; i < mask.length; i++)
    if (sel[i * 4 + 3]! > 20) {
      mask[i] = 1;
      n++;
    }
  if (!n) return toast("先用画笔涂出水印，或者框选它");
  w.busy = true;
  draw();
  const src = d.cur;
  const px = src.getContext("2d")!.getImageData(0, 0, src.width, src.height);
  try {
    // A watermark's soft edge goes too.
    const out = await inpaint(px, grow(mask, px.width, px.height, 2), async (f) => {
      const b = page?.querySelector<HTMLButtonElement>('[data-do="wm-go"]');
      if (b) b.textContent = `去除中 ${Math.round(f * 100)}%`;
      await new Promise((r) => setTimeout(r));
    });
    if (doc !== d || d.cur !== src) return; // the picture changed meanwhile
    const c = canvas(src.width, src.height);
    c.getContext("2d")!.putImageData(new ImageData(out, src.width, src.height), 0, 0);
    commit({ kind: "inpaint", out: c });
    startWatermark();
  } catch (e) {
    showError(e);
  } finally {
    w.busy = false;
    draw();
  }
}

// ---- Text, typed in a box over the stage ----

// openText opens a text box at a point of the picture: on a text that
// can be edited again, that one.
function openText(p: Pt) {
  if (!doc) return;
  const again = textAt(p);
  const m = again === undefined ? null : (doc.ops[again] as Extract<Op, { kind: "mark" }>).mark as Extract<Mark, { kind: "text" }>;
  const size = m?.size ?? sizeOf("text", pen.size) / z;
  const el = textBox(
    stageBox()!,
    "ie-text",
    () => {
      closeText(true);
      draw();
    },
    m?.text,
    (dx, dy) => {
      if (!text) return;
      text.at = { x: text.at.x + dx / z, y: text.at.y + dy / z };
      placeText();
    },
  );
  text = { el, at: m ? { ...m.at } : { x: p.x, y: p.y - (size * textLine) / 2 }, size, color: m?.color ?? pen.color, again };
  if (m) {
    replay(doc, again);
    draw();
  }
  placeText();
}

// textAt is the index of the topmost text mark at a point that can be
// edited again: one after what changed the picture's shape or was kept
// as a picture (去背景, 去水印).
function textAt(p: Pt) {
  if (!doc) return;
  const replaced = new Set(doc.ops.map((op) => (op.kind === "mark" ? op.replaces : undefined)));
  for (let i = doc.ops.length - 1; i >= 0; i--) {
    const op = doc.ops[i]!;
    if (op.kind !== "mark" && op.kind !== "adjust" && op.kind !== "censor") return;
    if (op.kind !== "mark" || op.mark.kind !== "text" || replaced.has(i)) continue;
    const b = textBounds(op.mark);
    const pad = 4 / z;
    if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) return i;
  }
}

// placeText puts the text box over its place in the picture, as zoomed.
function placeText() {
  if (text) styleTextBox(text.el, tx + text.at.x * z, ty + text.at.y * z, text.color, text.size * z);
}

// penToText gives the text being typed what the pen panel changed.
function penToText(what: "size" | "color" | null, click: boolean) {
  if (!text || !what) return;
  if (what === "color") text.color = pen.color;
  else text.size = sizeOf("text", pen.size) / z;
  placeText();
  // The color picker stays open while it gives colors.
  if (click) text.el.focus();
}

function closeText(keep: boolean) {
  if (!text) return;
  const { el, at, size, color, again } = text;
  text = null;
  const value = el.value.replace(/\s+$/, "");
  el.remove();
  if (!doc) return;
  const old = again === undefined ? null : (doc.ops[again] as Extract<Op, { kind: "mark" }>).mark as Extract<Mark, { kind: "text" }>;
  const same = old && old.text === value && old.color === color && old.size === size && old.at.x === at.x && old.at.y === at.y;
  // Emptied, an edited text goes: it is replaced by nothing to paint.
  if (keep && !same && (value || old)) commit({ kind: "mark", mark: { kind: "text", at, text: value, color, size }, replaces: again });
  else if (old) replay(doc);
}

// ---- Picking a color ----

function pickAt(p: Pt, keep: boolean) {
  if (!doc) return;
  const tip = page?.querySelector<HTMLElement>(".ie-pick-tip");
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= doc.cur.width || y >= doc.cur.height) {
    tip?.setAttribute("hidden", "");
    return;
  }
  if (!pickData) pickData = doc.cur.getContext("2d")!.getImageData(0, 0, doc.cur.width, doc.cur.height);
  const i = (y * pickData.width + x) * 4;
  const [r, g, b, a] = [pickData.data[i]!, pickData.data[i + 1]!, pickData.data[i + 2]!, pickData.data[i + 3]!];
  const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  hovered = { hex, rgb: `${r}, ${g}, ${b}`, a };
  if (tip) {
    tip.hidden = false;
    tip.innerHTML = `<i style="background:${hex}"></i><b>${hex}</b><span class="muted">${x}, ${y}</span>`;
  }
  if (keep) {
    picks = [hex, ...picks.filter((c) => c !== hex)].slice(0, 12);
    try {
      localStorage.setItem("image-picks", JSON.stringify(picks));
    } catch {}
    void navigator.clipboard.writeText(hex).then(
      () => toast(`已复制 ${hex}`),
      () => toast(hex),
    );
  }
  drawSide();
}

let hovered: { hex: string; rgb: string; a: number } | null = null;

// ---- The side panel ----

let resizeTo: { w: number; h: number; lock: boolean } | null = null;
let recutTimer = 0;

const sliders: [keyof Adjust, string, number, number, string][] = [
  ["brightness", "亮度", 0, 200, "%"],
  ["contrast", "对比度", 0, 200, "%"],
  ["saturate", "饱和度", 0, 200, "%"],
  ["temp", "色温", -100, 100, ""],
  ["hue", "色相", -180, 180, "°"],
  ["sharpen", "锐化", 0, 100, ""],
  ["blur", "模糊", 0, 20, "px"],
];

const presets: [string, Partial<Adjust>][] = [
  ["原图", {}],
  ["鲜艳", { saturate: 140, contrast: 110 }],
  ["黑白", { grayscale: 100, contrast: 110 }],
  ["复古", { sepia: 55, contrast: 95, saturate: 85, brightness: 105 }],
  ["暖阳", { temp: 45, saturate: 110, brightness: 103 }],
  ["清冷", { temp: -45, saturate: 90, brightness: 104 }],
  ["褪色", { contrast: 80, saturate: 70, brightness: 110 }],
  ["反色", { invert: 100 }],
];

let sideMode: Mode | null = null;
let sideDoc: Doc | null = null;
let thumbs: { src: HTMLCanvasElement; ops: number; urls: string[] } | null = null;

function drawSide() {
  const side = page?.querySelector<HTMLElement>(".ie-side");
  if (!side) return;
  side.hidden = !doc;
  if (!doc) {
    sideMode = null;
    return;
  }
  // The panel is made again when the mode or the picture changes, and
  // only updated otherwise, so that a slider being dragged stays.
  if (sideMode !== mode || sideDoc !== doc || !side.firstElementChild) {
    sideMode = mode;
    sideDoc = doc;
    side.innerHTML = sideHTML();
  }
  updateSide(side);
}

function sideHTML() {
  const d = doc!;
  switch (mode) {
    case "crop":
      return `
        <h3>裁剪</h3>
        <div class="ie-chips ie-ratios">${[
          [0, "自由"],
          [-1, "原比例"],
          [1, "1:1"],
          [4 / 3, "4:3"],
          [3 / 4, "3:4"],
          [16 / 9, "16:9"],
          [9 / 16, "9:16"],
          [3 / 2, "3:2"],
        ]
          .map(([r, n]) => `<button data-ratio="${r}">${n}</button>`)
          .join("")}</div>
        <div class="ie-wh"><label>宽<input type="number" min="1" data-crop="w" /></label><label>高<input type="number" min="1" data-crop="h" /></label></div>
        <div class="ie-row"><button data-do="crop-reset">重置</button><button class="primary" data-do="crop">裁剪</button></div>
        <p class="muted ie-hint">拖动框的边角调整，拖动框内移动；双击或回车裁剪。</p>
        <h3>旋转翻转</h3>
        <div class="ie-icons">
          <button data-do="rot-l" title="向左转 90°">${editIcons.rotateLeft}<span>左转</span></button>
          <button data-do="rot-r" title="向右转 90°">${editIcons.rotateRight}<span>右转</span></button>
          <button data-do="flip-h" title="水平翻转">${editIcons.flipH}<span>水平</span></button>
          <button data-do="flip-v" title="垂直翻转">${editIcons.flipV}<span>垂直</span></button>
        </div>`;
    case "adjust":
      return `
        <h3>滤镜</h3>
        <div class="ie-presets">${presets.map(([n], i) => `<button data-preset="${i}"><img alt="" /><span>${n}</span></button>`).join("")}</div>
        <h3>调整<button class="ie-link" data-do="adj-reset">重置</button></h3>
        ${sliders
          .map(
            ([k, n, lo, hi, unit]) =>
              `<label class="ie-slider"><span>${n}<b data-v="${k}"></b></span><input type="range" min="${lo}" max="${hi}" step="1" data-adj="${k}" data-unit="${unit}" /></label>`,
          )
          .join("")}
        <div class="ie-row"><button class="primary" data-do="adj-apply">应用</button></div>
        <p class="muted ie-hint">换到别的面板或保存时会自动应用。</p>`;
    case "resize":
      return `
        <h3>调整尺寸</h3>
        <p class="muted ie-hint">现在 ${d.cur.width} × ${d.cur.height}</p>
        <div class="ie-wh"><label>宽<input type="number" min="1" max="30000" data-rs="w" /></label><label>高<input type="number" min="1" max="30000" data-rs="h" /></label></div>
        <label class="ie-check"><input type="checkbox" data-rs="lock" />保持比例</label>
        <div class="ie-chips">${[25, 50, 75, 150, 200].map((p) => `<button data-pct="${p}">${p}%</button>`).join("")}</div>
        <div class="ie-chips">${[3840, 1920, 1280, 800].map((w) => `<button data-long="${w}" title="长边 ${w}">${w}</button>`).join("")}</div>
        <div class="ie-row"><button class="primary" data-do="resize">应用</button></div>`;
    case "mark":
      return `
        <h3>标注</h3>
        <div class="ie-icons ie-marks">${markTools.map(([t, n]) => `<button data-mark="${t}" title="${n}">${markIcons[t]}<span>${n}</span></button>`).join("")}</div>
        ${penHTML()}
        <p class="muted ie-hint">按住 Shift 画正方形、圆或 45° 箭头；文字回车换行，拖虚线框移动，输入时可改颜色和粗细，Esc 或点别处完成；用文字工具点已有的文字可重新编辑（裁剪旋转等之后的）。粗细按屏幕上看到的算，放大后画得更细。</p>`;
    case "frame":
      return `
        <h3>背景</h3>
        <div class="ie-bgs">${backgrounds.map(([bg, n]) => `<button data-bg="${bg}" title="${n}"><i style="background:${bgCSS(bg)}"></i></button>`).join("")}</div>
        <label class="ie-slider"><span>边距<b data-v="pad"></b></span><input type="range" min="0" max="30" step="1" data-fr="pad" /></label>
        <label class="ie-slider"><span>圆角<b data-v="radius"></b></span><input type="range" min="0" max="20" step="1" data-fr="radius" /></label>
        <label class="ie-slider"><span>阴影<b data-v="shadow"></b></span><input type="range" min="0" max="100" step="1" data-fr="shadow" /></label>
        <div class="ie-row"><button data-do="fr-reset">去掉</button><button class="primary" data-do="fr-apply">应用</button></div>
        <p class="muted ie-hint">给截图加上背景、圆角和阴影，发出去更好看。边距和圆角按图片短边的百分比算。</p>`;
    case "cutout":
      return `
        <h3>去背景</h3>
        <label class="ie-check"><input type="checkbox" data-cut="border" />从四周去掉背景色<i class="ie-cut-bg" title="四周最多的颜色"></i></label>
        <label class="ie-slider"><span>容差<b data-v="tol"></b></span><input type="range" min="1" max="100" step="1" data-cut="tol" /></label>
        <h3>工具</h3>
        <div class="ie-icons ie-cut-tools">
          <button data-cuttool="seed" title="点一下：去掉和这里颜色相近、连在一起的一片">${editIcons.wand}<span>点选去除</span></button>
          <button data-cuttool="erase" title="涂抹的地方变透明">${editIcons.eraser}<span>擦除</span></button>
          <button data-cuttool="restore" title="涂抹的地方恢复成原图">${markIcons.pen}<span>恢复</span></button>
        </div>
        <div class="ie-chips ie-sizes ie-cut-sizes">${["细", "中", "粗"].map((n, i) => `<button data-cutsize="${i}">${n}</button>`).join("")}</div>
        <div class="ie-row"><button data-do="cut-reset">重来</button><button class="primary" data-do="cut-apply">应用</button></div>
        <p class="muted ie-hint">适合纯色背景的图（插画、AI 生成的图）：从四周往里去掉和边缘颜色相近的背景，被轮廓围住的同色部分（白裙子、浅色头发）会保留。没去干净的空隙用「点选去除」点一下，去多了用「恢复」涂回来；灰白格子是透明的地方。</p>
        <h3>悬浮球形象</h3>
        <div class="ie-row ie-row-start"><button data-do="as-pet">设为桌宠形象</button></div>
        <p class="muted ie-hint">四周透明的部分会裁掉。悬浮球最大 160 像素，先在「裁剪旋转」里裁出头和肩会更清楚。</p>`;
    case "watermark":
      return `
        <h3>去水印</h3>
        <div class="ie-icons ie-cut-tools">
          <button data-wmtool="brush" title="涂在水印上">${markIcons.pen}<span>涂抹</span></button>
          <button data-wmtool="box" title="框住水印">${markIcons.rect}<span>框选</span></button>
          <button data-wmtool="erase" title="涂多了擦掉">${editIcons.eraser}<span>擦掉</span></button>
        </div>
        <div class="ie-chips ie-sizes ie-wm-sizes">${["细", "中", "粗"].map((n, i) => `<button data-wmsize="${i}">${n}</button>`).join("")}</div>
        <div class="ie-row"><button data-do="wm-clear">清空</button><button class="primary" data-do="wm-go">去除</button></div>
        <p class="muted ie-hint">把水印涂红（盖住就行，边缘多涂一点），点「去除」：用周围的画面把那块补上。适合角落的 logo、文字这类不太大的水印；铺满整张的半透明水印补不好。一次没去干净可以再涂再去，不满意就撤销。</p>`;
    case "censor":
      return `
        <h3>打码</h3>
        <div class="s-seg ie-seg" data-cs="style"><button data-v="mosaic">马赛克</button><button data-v="blur">模糊</button></div>
        <div class="s-seg ie-seg" data-cs="shape"><button data-v="box">框选</button><button data-v="brush">涂抹</button></div>
        <div class="ie-chips ie-sizes ie-cs-sizes">${["细", "中", "粗"].map((n, i) => `<button data-cssize="${i}">${n}</button>`).join("")}</div>
        <label class="ie-slider"><span>强度<b data-v="strength"></b></span><input type="range" min="1" max="100" step="1" data-cs="strength" /></label>
        <p class="muted ie-hint">框住或涂过的地方马上打上码，每一下都能撤销。强度按图片短边算，大图小图看起来一样粗。</p>`;
    case "pick":
      return `
        <h3>取色</h3>
        <div class="ie-pick"><i></i><div><b></b><span class="muted"></span></div></div>
        <p class="muted ie-hint">在图片上移动查看颜色，点一下复制色值。</p>
        <h3>最近取的</h3>
        <div class="ie-picks"></div>`;
  }
}

function updateSide(side: HTMLElement) {
  const d = doc!;
  if (mode === "crop") {
    const r = crop ?? full();
    side.querySelectorAll<HTMLElement>("[data-ratio]").forEach((b) => b.classList.toggle("on", b.dataset.ratio === ratioPick));
    side.querySelectorAll<HTMLInputElement>("[data-crop]").forEach((i) => {
      if (document.activeElement !== i) i.value = String(i.dataset.crop === "w" ? r.w : r.h);
    });
  } else if (mode === "adjust") {
    side.querySelectorAll<HTMLInputElement>("[data-adj]").forEach((i) => {
      const k = i.dataset.adj as keyof Adjust;
      if (document.activeElement !== i) i.value = String(adjust[k]);
      side.querySelector(`[data-v="${k}"]`)!.textContent = `${adjust[k] > 0 && (k === "temp" || k === "hue") ? "+" : ""}${adjust[k]}${i.dataset.unit}`;
    });
    // The presets' little previews, made once per picture.
    if (thumbs?.src !== d.cur || thumbs.ops !== d.ops.length) {
      const small = canvas(...thumbSize(d.cur));
      small.getContext("2d")!.drawImage(d.cur, 0, 0, small.width, small.height);
      thumbs = {
        src: d.cur,
        ops: d.ops.length,
        urls: presets.map(([, a]) => {
          const c = apply(copyOf(small), { kind: "adjust", a: { ...plain, ...a } });
          return c.toDataURL("image/jpeg", 0.8);
        }),
      };
    }
    side.querySelectorAll<HTMLElement>("[data-preset]").forEach((b) => {
      const i = Number(b.dataset.preset);
      const img = b.querySelector("img")!;
      if (img.getAttribute("src") !== thumbs!.urls[i]) img.src = thumbs!.urls[i]!;
      const a = { ...plain, ...presets[i]![1] };
      b.classList.toggle("on", (Object.keys(plain) as (keyof Adjust)[]).every((k) => a[k] === adjust[k]));
    });
  } else if (mode === "resize") {
    resizeTo ??= { w: d.cur.width, h: d.cur.height, lock: true };
    side.querySelectorAll<HTMLInputElement>("[data-rs]").forEach((i) => {
      if (i.dataset.rs === "lock") i.checked = resizeTo!.lock;
      else if (document.activeElement !== i) i.value = String(i.dataset.rs === "w" ? resizeTo!.w : resizeTo!.h);
    });
  } else if (mode === "mark") {
    side.querySelectorAll<HTMLElement>("[data-mark]").forEach((b) => b.classList.toggle("on", b.dataset.mark === markTool));
    showPen(side, markTool);
  } else if (mode === "frame") {
    side.querySelectorAll<HTMLElement>("[data-bg]").forEach((b) => b.classList.toggle("on", b.dataset.bg === frame.bg));
    side.querySelectorAll<HTMLInputElement>("[data-fr]").forEach((i) => {
      const k = i.dataset.fr as "pad" | "radius" | "shadow";
      if (document.activeElement !== i) i.value = String(frame[k]);
      side.querySelector(`[data-v="${k}"]`)!.textContent = k === "shadow" ? String(frame[k]) : `${frame[k]}%`;
    });
  } else if (mode === "cutout" && cut) {
    const c = cut;
    const border = side.querySelector<HTMLInputElement>('[data-cut="border"]')!;
    border.checked = c.border;
    const [r, g, b] = borderColor(c.px);
    side.querySelector<HTMLElement>(".ie-cut-bg")!.style.background = `rgb(${r}, ${g}, ${b})`;
    const tol = side.querySelector<HTMLInputElement>('[data-cut="tol"]')!;
    if (document.activeElement !== tol) tol.value = String(c.tol);
    side.querySelector('[data-v="tol"]')!.textContent = String(c.tol);
    side.querySelectorAll<HTMLElement>("[data-cuttool]").forEach((b) => b.classList.toggle("on", b.dataset.cuttool === c.tool));
    side.querySelector<HTMLElement>(".ie-cut-sizes")!.hidden = c.tool === "seed";
    side.querySelectorAll<HTMLElement>("[data-cutsize]").forEach((b) => b.classList.toggle("on", Number(b.dataset.cutsize) === c.brush));
  } else if (mode === "watermark" && wm) {
    const w = wm;
    side.querySelectorAll<HTMLElement>("[data-wmtool]").forEach((b) => b.classList.toggle("on", b.dataset.wmtool === w.tool));
    side.querySelector<HTMLElement>(".ie-wm-sizes")!.hidden = w.tool === "box";
    side.querySelectorAll<HTMLElement>("[data-wmsize]").forEach((b) => b.classList.toggle("on", Number(b.dataset.wmsize) === w.brush));
    const go = side.querySelector<HTMLButtonElement>('[data-do="wm-go"]')!;
    go.disabled = w.busy || !w.any;
    if (!w.busy) go.textContent = "去除";
    side.querySelector<HTMLButtonElement>('[data-do="wm-clear"]')!.disabled = w.busy || !w.any;
  } else if (mode === "censor") {
    side.querySelectorAll<HTMLElement>("[data-cs] [data-v]").forEach((b) => b.classList.toggle("on", censorPrefs[b.closest<HTMLElement>("[data-cs]")!.dataset.cs as "style" | "shape"] === b.dataset.v));
    side.querySelector<HTMLElement>(".ie-cs-sizes")!.hidden = censorPrefs.shape !== "brush";
    side.querySelectorAll<HTMLElement>("[data-cssize]").forEach((b) => b.classList.toggle("on", Number(b.dataset.cssize) === censorPrefs.brush));
    const r = side.querySelector<HTMLInputElement>('input[data-cs="strength"]')!;
    if (document.activeElement !== r) r.value = String(censorPrefs.strength);
    side.querySelector('[data-v="strength"]')!.textContent = String(censorPrefs.strength);
  } else if (mode === "pick") {
    const box = side.querySelector<HTMLElement>(".ie-pick")!;
    box.querySelector("i")!.style.background = hovered?.hex ?? "transparent";
    box.querySelector("b")!.textContent = hovered?.hex ?? "—";
    box.querySelector("span")!.textContent = hovered ? `rgb(${hovered.rgb})${hovered.a < 255 ? ` · 不透明度 ${Math.round((hovered.a / 255) * 100)}%` : ""}` : "把鼠标移到图片上";
    const list = side.querySelector<HTMLElement>(".ie-picks")!;
    const html = picks.length ? picks.map((c) => `<button data-copy="${c}" title="复制 ${c}"><i style="background:${c}"></i>${c}</button>`).join("") : `<span class="muted">还没有</span>`;
    if (list.innerHTML !== html) list.innerHTML = html;
  }
}

function thumbSize(c: HTMLCanvasElement): [number, number] {
  const k = 120 / Math.max(c.width, c.height);
  return [Math.max(1, c.width * Math.min(k, 1)), Math.max(1, c.height * Math.min(k, 1))];
}

function bindSide(side: HTMLElement) {
  side.addEventListener("click", (e) => {
    if (!doc) return;
    const pe = penEvent(e);
    if (pe) {
      penToText(pe, true);
      return draw();
    }
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>("button");
    if (!b) return;
    const d = doc;
    if (b.dataset.ratio !== undefined) {
      ratioPick = b.dataset.ratio;
      crop = ratioOf() ? fitRatio(ratioOf()) : full();
      return draw();
    }
    if (b.dataset.preset !== undefined) {
      adjust = { ...plain, ...presets[Number(b.dataset.preset)]![1] };
      return draw();
    }
    if (b.dataset.pct) {
      const k = Number(b.dataset.pct) / 100;
      resizeTo = { w: Math.max(1, Math.round(d.cur.width * k)), h: Math.max(1, Math.round(d.cur.height * k)), lock: resizeTo?.lock ?? true };
      return draw();
    }
    if (b.dataset.long) {
      const k = Number(b.dataset.long) / Math.max(d.cur.width, d.cur.height);
      resizeTo = { w: Math.max(1, Math.round(d.cur.width * k)), h: Math.max(1, Math.round(d.cur.height * k)), lock: resizeTo?.lock ?? true };
      return draw();
    }
    if (b.dataset.mark) {
      closeText(true);
      markTool = b.dataset.mark as MarkTool;
      return draw();
    }
    if (b.dataset.bg) {
      frame = { ...frame, bg: b.dataset.bg };
      // A background alone shows nothing: it comes with some room.
      if (!frame.pad && b.dataset.bg !== "transparent") frame.pad = 8;
      return draw();
    }
    if (b.dataset.wmtool && wm) {
      wm.tool = b.dataset.wmtool as typeof wm.tool;
      return draw();
    }
    if (b.dataset.wmsize && wm) {
      wm.brush = Number(b.dataset.wmsize);
      return draw();
    }
    const cs = b.closest<HTMLElement>("[data-cs]")?.dataset.cs;
    if (cs && b.dataset.v) {
      (censorPrefs as Record<string, unknown>)[cs] = b.dataset.v;
      saveCensor();
      return draw();
    }
    if (b.dataset.cssize) {
      censorPrefs.brush = Number(b.dataset.cssize);
      saveCensor();
      return draw();
    }
    if (b.dataset.cuttool && cut) {
      cut.tool = b.dataset.cuttool as typeof cut.tool;
      return draw();
    }
    if (b.dataset.cutsize && cut) {
      cut.brush = Number(b.dataset.cutsize);
      return draw();
    }
    if (b.dataset.copy) {
      const c = b.dataset.copy;
      return void navigator.clipboard.writeText(c).then(() => toast(`已复制 ${c}`), () => toast(c));
    }
    switch (b.dataset.do) {
      case "crop":
        return applyCrop();
      case "crop-reset":
        ratioPick = "0";
        crop = full();
        return draw();
      case "rot-l":
      case "rot-r":
      case "flip-h":
      case "flip-v": {
        commitPending();
        const op: Op = b.dataset.do === "rot-l" ? { kind: "rotate", turn: -1 } : b.dataset.do === "rot-r" ? { kind: "rotate", turn: 1 } : { kind: "flip", h: b.dataset.do === "flip-h" };
        commit(op);
        crop = ratioOf() ? fitRatio(ratioOf()) : full();
        return draw();
      }
      case "adj-reset":
        adjust = { ...plain };
        return draw();
      case "adj-apply":
        commitPending();
        return draw();
      case "resize": {
        const r = resizeTo;
        if (!r || r.w < 1 || r.h < 1) return;
        if (r.w * r.h > maxPixels) return toast("太大了，最多 1.2 亿像素");
        if (r.w === d.cur.width && r.h === d.cur.height) return;
        commitPending();
        commit({ kind: "resize", w: r.w, h: r.h });
        resizeTo = null;
        sideMode = null; // the size it says
        return draw();
      }
      case "cut-reset":
        return resetCut(true);
      case "cut-apply":
        commitPending();
        return draw();
      case "as-pet":
        return void asPet();
      case "wm-go":
        return void removeWatermark();
      case "wm-clear":
        startWatermark();
        return draw();
      case "fr-reset":
        frame = { ...noFrame };
        return draw();
      case "fr-apply":
        commitPending();
        return draw();
    }
  });
  side.addEventListener("input", (e) => {
    if (!doc) return;
    const pe = penEvent(e);
    if (pe) {
      penToText(pe, false);
      return draw();
    }
    const i = e.target as HTMLInputElement;
    const d = doc;
    if (i.dataset.adj) {
      adjust = { ...adjust, [i.dataset.adj]: Number(i.value) };
      return draw();
    }
    if (i.dataset.cs === "strength") {
      censorPrefs.strength = Number(i.value);
      saveCensor();
      return draw();
    }
    if (i.dataset.cut && cut) {
      if (i.dataset.cut === "border") {
        cut.border = i.checked;
        return recut();
      }
      cut.tol = Number(i.value);
      side.querySelector('[data-v="tol"]')!.textContent = i.value;
      // Taking the background away again takes a moment on a large picture.
      clearTimeout(recutTimer);
      recutTimer = window.setTimeout(recut, cut.px.width * cut.px.height > 4e6 ? 250 : 40);
      return;
    }
    if (i.dataset.fr) {
      frame = { ...frame, [i.dataset.fr]: Number(i.value) };
      return draw();
    }
    if (i.dataset.crop && crop) {
      const W = d.cur.width;
      const H = d.cur.height;
      const v = Math.round(Number(i.value));
      if (!(v >= 1)) return;
      const ratio = ratioOf();
      let w = i.dataset.crop === "w" ? Math.min(v, W) : crop.w;
      let h = i.dataset.crop === "h" ? Math.min(v, H) : crop.h;
      if (ratio) {
        if (i.dataset.crop === "w") h = Math.round(w / ratio);
        else w = Math.round(h * ratio);
        const k = Math.min(1, W / w, H / h);
        w = Math.round(w * k);
        h = Math.round(h * k);
      }
      const cx = crop.x + crop.w / 2;
      const cy = crop.y + crop.h / 2;
      crop = { x: Math.round(clamp(cx - w / 2, 0, W - w)), y: Math.round(clamp(cy - h / 2, 0, H - h)), w, h };
      return draw();
    }
    if (i.dataset.rs && resizeTo) {
      if (i.dataset.rs === "lock") resizeTo.lock = i.checked;
      else {
        const v = Math.round(Number(i.value));
        if (!(v >= 1)) return;
        const k = d.cur.width / d.cur.height;
        if (i.dataset.rs === "w") resizeTo = { ...resizeTo, w: v, h: resizeTo.lock ? Math.max(1, Math.round(v / k)) : resizeTo.h };
        else resizeTo = { ...resizeTo, h: v, w: resizeTo.lock ? Math.max(1, Math.round(v * k)) : resizeTo.w };
      }
      return draw();
    }
  });
  // The number boxes show what they hold once left.
  side.addEventListener("focusout", () => setTimeout(draw));
}

// ---- Keys ----

function onKey(e: KeyboardEvent) {
  if (!shown() || document.querySelector("dialog[open]")) return;
  const t = e.target as HTMLElement;
  const typing = t.closest?.("input, textarea, select, [contenteditable]");
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === "o") {
    e.preventDefault();
    return openFile();
  }
  if (typing || !doc) return;
  if (e.ctrlKey && k === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (e.ctrlKey && (k === "y" || (k === "z" && e.shiftKey))) {
    e.preventDefault();
    redo();
  } else if (e.ctrlKey && k === "s") {
    e.preventDefault();
    showExport();
  } else if (e.ctrlKey && k === "c") {
    if (getSelection()?.toString()) return;
    e.preventDefault();
    void copyPicture();
  } else if (e.ctrlKey) return;
  else if (e.code === "Space") {
    e.preventDefault();
    setSpace(true);
  } else if (e.key === "Enter") {
    if (mode === "crop") applyCrop();
    else if (mode === "watermark") void removeWatermark();
    else if (mode === "adjust" || mode === "frame" || mode === "cutout") {
      commitPending();
      draw();
    }
  } else if (e.key === "Escape") {
    if (mode === "crop") {
      crop = full();
      draw();
    }
  } else if (k === "0") act("fit");
  else if (k === "1") act("actual");
  else if (k === "=" || k === "+") act("in");
  else if (k === "-") act("out");
}
