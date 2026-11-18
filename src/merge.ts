// 合并文档: pictures in an order the user sets, made into one PDF or
// PowerPoint file, a picture a page, or into one long picture. Only small
// previews stay loaded; each picture is read again when exported, one
// after the other.
import { onFileDrop } from "mygo-runtime";
import { editIcons, icons } from "./icons";
import { base64, canvas, decode, decodeBlob, encodeCanvas, formatTips, imagePath, pastedPicture, pickPictures, savedToast, stamp } from "./imgutil";
import { longLayout } from "./geom";
import { ImageEdit, type EditImage } from "./mygo";
import { esc, onLeave, showError, toast } from "./ui";

interface Page {
  id: string;
  name: string;
  path: string; // the file, read again on export; "" for a pasted one
  blob: Blob | null; // a pasted picture
  w: number;
  h: number;
  thumb: string;
  rot: number; // 0, 90, 180 or 270, clockwise
}

interface Options {
  kind: "pdf" | "pptx" | "image";
  page: "fit" | "a4" | "a4l" | "wide";
  margin: number; // 0 none, 1 small, 2 large
  format: "jpeg" | "png" | "webp";
  quality: number;
  max: number; // the pictures' longer side at most, 0 for as they are
}

const kinds: [Options["kind"], string, string][] = [
  ["pdf", "PDF", "一张图一页"],
  ["pptx", "PPT", "一张图一页幻灯片，PowerPoint 和 WPS 都能打开"],
  ["image", "长图", "从上到下拼成一张图片"],
];

const pageSizes: [Options["page"], string][] = [
  ["fit", "跟图片一样"],
  ["a4", "A4 纵向"],
  ["a4l", "A4 横向"],
  ["wide", "16:9"],
];

const maxSides: [number, string][] = [
  [0, "原图"],
  [3000, "3000"],
  [2000, "2000"],
  [1200, "1200"],
];

let pages: Page[] = [];
let opts: Options = loadOptions();
let busy = "";
let page: HTMLElement | null = null;
let seq = 0;

function loadOptions(): Options {
  const def: Options = { kind: "pdf", page: "fit", margin: 0, format: "jpeg", quality: 85, max: 0 };
  try {
    const o = { ...def, ...JSON.parse(localStorage.getItem("merge-opts") || "{}") };
    return kinds.some(([k]) => k === o.kind) && ["jpeg", "png", "webp"].includes(o.format) ? o : def;
  } catch {
    return def;
  }
}

function saveOptions() {
  try {
    localStorage.setItem("merge-opts", JSON.stringify(opts));
  } catch {}
}

// The pictures of a PDF or a PowerPoint file are JPG or PNG.
const formatOK = (f: string) => opts.kind === "image" || f !== "webp";

// ---- Adding ----

async function preview(c: HTMLCanvasElement) {
  const k = Math.min(1, 320 / Math.max(c.width, c.height));
  const t = canvas(c.width * k, c.height * k);
  const ctx = t.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, t.width, t.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", 0.82);
}

async function add(load: () => Promise<{ c: HTMLCanvasElement; name: string; path: string; blob: Blob | null }>) {
  const { c, name, path, blob } = await load();
  pages.push({ id: `p${++seq}`, name, path, blob, w: c.width, h: c.height, thumb: await preview(c), rot: 0 });
  c.width = c.height = 0;
  draw();
}

const fromFile = (e: EditImage) => async () => ({ c: await decode(e.url), name: e.name, path: e.path, blob: null });

async function addAll(loads: (() => Promise<{ c: HTMLCanvasElement; name: string; path: string; blob: Blob | null }>)[]) {
  for (const load of loads) {
    busy = `正在读取 ${loads.indexOf(load) + 1}/${loads.length}…`;
    draw();
    try {
      await add(load);
    } catch (e) {
      showError(e);
    }
  }
  busy = "";
  draw();
}

function pickMore() {
  void pickPictures(true, async (e) => {
    busy = "正在读取…";
    await add(fromFile(e)).catch(showError);
  })
    .catch(showError)
    .finally(() => {
      busy = "";
      draw();
    });
}

onFileDrop(({ paths }) => {
  if (!shown()) return;
  const list = paths.filter((p) => imagePath.test(p));
  if (!list.length) return paths.length ? toast("不是能打开的图片") : undefined;
  void addAll(list.map((p) => async () => fromFile(await ImageEdit.openPath(p))()));
});

function shown() {
  return !!page?.isConnected && !!page.querySelector(".mg");
}

// ---- Exporting ----

// pictureOf reads a page's picture again, turned and made smaller as set.
async function pictureOf(p: Page) {
  let c = p.blob ? await decodeBlob(p.blob, opts.max) : await decode((await ImageEdit.openPath(p.path)).url, opts.max);
  if (p.rot) {
    const t = p.rot === 90 || p.rot === 270 ? canvas(c.height, c.width) : canvas(c.width, c.height);
    const ctx = t.getContext("2d")!;
    ctx.translate(t.width / 2, t.height / 2);
    ctx.rotate((p.rot * Math.PI) / 180);
    ctx.drawImage(c, -c.width / 2, -c.height / 2);
    c.width = c.height = 0;
    c = t;
  }
  return c;
}

async function exportAll() {
  if (!pages.length || busy) return;
  const name = `合并文档 ${stamp()}`;
  if (opts.kind === "image") return exportLong(name);
  const job = await ImageEdit.docBegin({ kind: opts.kind, page: opts.page, margin: opts.margin, name });
  if (!job) return;
  try {
    for (const [i, p] of pages.entries()) {
      busy = `正在导出 ${i + 1}/${pages.length}…`;
      draw();
      const c = await pictureOf(p);
      // A PDF page under a transparent picture is white anyway.
      const blob = await encodeCanvas(c, opts.format === "png" ? "png" : "jpeg", opts.quality);
      c.width = c.height = 0;
      await ImageEdit.docAdd(job, await base64(blob), opts.format === "png" ? "png" : "jpeg");
    }
    busy = "正在写文件…";
    draw();
    savedToast(await ImageEdit.docFinish(job));
  } catch (e) {
    void ImageEdit.docCancel(job);
    showError(e);
  } finally {
    busy = "";
    draw();
  }
}

async function exportLong(name: string) {
  try {
    // The widest picture sets the width; the others are scaled to it.
    const dims = pages.map((p) => (p.rot === 90 || p.rot === 270 ? [p.h, p.w] : [p.w, p.h]) as [number, number]);
    const { width, gap, heights, height, shrunk } = longLayout(dims, opts.max, opts.margin);
    if (shrunk) toast(`太长了，宽度缩到 ${width} 像素`);
    const out = canvas(width, height);
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    let y = gap;
    for (const [i, p] of pages.entries()) {
      busy = `正在拼接 ${i + 1}/${pages.length}…`;
      draw();
      const c = await pictureOf(p);
      const h = heights[i]!;
      ctx.drawImage(c, gap, y, width - 2 * gap, h);
      c.width = c.height = 0;
      y += h + gap;
    }
    busy = "正在保存…";
    draw();
    const blob = await encodeCanvas(out, opts.format, opts.quality);
    out.width = out.height = 0;
    const path = await ImageEdit.saveFile(await base64(blob), opts.format, name);
    if (path) savedToast(path);
  } catch (e) {
    showError(e);
  } finally {
    busy = "";
    draw();
  }
}

// ---- The page ----

export function renderMerge(p: HTMLElement) {
  page = p;
  p.innerHTML = `
    <div class="mg">
      <div class="ie-top mg-top">
        <button data-act="add" class="primary" title="可以一次选多张">添加图片</button>
        <span class="ie-sep"></span>
        <button data-act="sort" title="按文件名排序">按名称排序</button>
        <button data-act="reverse" title="倒过来">倒序</button>
        <span class="ie-name"><span class="muted mg-count"></span></span>
        <button data-act="clear">清空</button>
      </div>
      <div class="ie-body">
        <div class="mg-list">
          <div class="mg-grid"></div>
          <div class="ie-empty mg-empty">
            ${icons.image}
            <p><b>把图片拖进来</b>，或者</p>
            <div class="ie-empty-acts"><button data-act="add" class="primary">添加图片</button></div>
            <p class="muted">可以一次加很多张，拖动卡片调整顺序；也可以 Ctrl+V 粘贴。导出成 PDF、PPT（一张图一页）或一张长图。</p>
          </div>
        </div>
        <aside class="ie-side mg-side">
          <h3>导出为</h3>
          <div class="s-seg mg-seg" data-o="kind">${kinds.map(([v, n, t]) => `<button data-v="${v}" title="${t}">${n}</button>`).join("")}</div>
          <p class="muted ie-hint mg-kind-tip"></p>
          <div class="mg-docopts">
            <h3>页面大小</h3>
            <div class="ie-chips" data-o="page">${pageSizes.map(([v, n]) => `<button data-v="${v}">${n}</button>`).join("")}</div>
          </div>
          <h3>边距</h3>
          <div class="ie-chips" data-o="margin">${["无", "小", "大"].map((n, i) => `<button data-v="${i}">${n}</button>`).join("")}</div>
          <h3>图片格式</h3>
          <div class="s-seg mg-seg" data-o="format"><button data-v="jpeg">JPG</button><button data-v="png">PNG</button><button data-v="webp">WebP</button></div>
          <p class="muted ie-hint mg-fmt-tip"></p>
          <label class="ie-slider mg-q"><span>质量<b></b></span><input type="range" min="10" max="100" step="1" /></label>
          <h3>图片最长边</h3>
          <div class="ie-chips" data-o="max">${maxSides.map(([v, n]) => `<button data-v="${v}">${n}</button>`).join("")}</div>
          <p class="muted ie-hint">缩小图片和降低质量可以让文件小很多，文字截图建议用 PNG。</p>
          <div class="ie-row"><button class="primary mg-go">导出</button></div>
        </aside>
      </div>
    </div>`;
  p.querySelector(".mg-top")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]");
    if (b && !b.disabled) act(b.dataset.act!);
  });
  p.querySelector(".mg-empty")!.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest('[data-act="add"]')) pickMore();
  });
  const side = p.querySelector<HTMLElement>(".mg-side")!;
  side.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || b.disabled) return;
    if (b.classList.contains("mg-go")) return void exportAll();
    const o = b.closest<HTMLElement>("[data-o]")?.dataset.o as keyof Options | undefined;
    if (!o) return;
    const v = b.dataset.v!;
    (opts as unknown as Record<string, unknown>)[o] = o === "margin" || o === "max" ? Number(v) : v;
    if (!formatOK(opts.format)) opts.format = "jpeg";
    saveOptions();
    draw();
  });
  side.querySelector<HTMLInputElement>(".mg-q input")!.addEventListener("input", (e) => {
    opts.quality = Number((e.target as HTMLInputElement).value);
    saveOptions();
    draw();
  });
  bindGrid(p.querySelector<HTMLElement>(".mg-grid")!);
  const paste = (e: ClipboardEvent) => {
    const file = pastedPicture(e);
    if (file) void addAll([async () => ({ c: await decodeBlob(file), name: `粘贴的图片 ${stamp()}.png`, path: "", blob: file })]);
  };
  document.addEventListener("paste", paste);
  onLeave(() => document.removeEventListener("paste", paste));
  onLeave(() => (page = null));
  draw();
}

function act(a: string) {
  if (busy && a !== "add") return;
  switch (a) {
    case "add":
      return pickMore();
    case "sort":
      pages.sort((x, y) => x.name.localeCompare(y.name, "zh-Hans-CN", { numeric: true }));
      return draw();
    case "reverse":
      pages.reverse();
      return draw();
    case "clear": {
      if (!pages.length) return;
      const was = pages;
      pages = [];
      draw();
      return toast(`已清空 ${was.length} 张`, {
        label: "撤销",
        run: () => {
          pages = was;
          draw();
        },
      });
    }
  }
}

function draw() {
  if (!shown()) return;
  const p = page!;
  const grid = p.querySelector<HTMLElement>(".mg-grid")!;
  p.querySelector<HTMLElement>(".mg-empty")!.hidden = pages.length > 0;
  grid.hidden = !pages.length;
  const html = pages
    .map(
      (pg, i) => `
      <div class="mg-card" draggable="true" data-id="${pg.id}">
        <div class="mg-thumb"><img src="${pg.thumb}" alt="" draggable="false" style="transform: rotate(${pg.rot}deg)${pg.rot % 180 ? ` scale(${Math.min(pg.w, pg.h) / Math.max(pg.w, pg.h)})` : ""}" /></div>
        <div class="mg-meta"><b>${i + 1}</b><span title="${esc(pg.path || pg.name)}">${esc(pg.name)}</span></div>
        <div class="mg-acts">
          <button data-do="rot" title="向右转 90°">${editIcons.rotateRight}</button>
          <button data-do="del" title="移除">✕</button>
        </div>
      </div>`,
    )
    .join("");
  if (grid.dataset.html !== html) {
    grid.innerHTML = html;
    grid.dataset.html = html;
  }
  const total = pages.length;
  p.querySelector(".mg-count")!.textContent = busy || (total ? `${total} 张 · 拖动卡片调整顺序` : "");
  p.querySelectorAll<HTMLButtonElement>('.mg-top [data-act]:not([data-act="add"])').forEach((b) => (b.disabled = !total || !!busy));
  const side = p.querySelector<HTMLElement>(".mg-side")!;
  side.querySelectorAll<HTMLElement>("[data-o]").forEach((g) => {
    const o = g.dataset.o as keyof Options;
    g.querySelectorAll<HTMLButtonElement>("[data-v]").forEach((b) => {
      b.classList.toggle("on", String(opts[o]) === b.dataset.v);
      if (o === "format") {
        b.disabled = !formatOK(b.dataset.v!);
        b.title = b.disabled ? "PDF 和 PPT 里的图片只能是 JPG 或 PNG" : "";
      }
    });
  });
  side.querySelector<HTMLElement>(".mg-docopts")!.hidden = opts.kind === "image";
  side.querySelector(".mg-kind-tip")!.textContent = kinds.find(([k]) => k === opts.kind)![2] + (opts.kind === "pptx" && opts.page === "fit" ? "；幻灯片按第一张图的比例" : "");
  side.querySelector(".mg-fmt-tip")!.textContent = formatTips[opts.format]!;
  const q = side.querySelector<HTMLElement>(".mg-q")!;
  q.hidden = opts.format === "png";
  q.querySelector("b")!.textContent = String(opts.quality);
  const range = q.querySelector<HTMLInputElement>("input")!;
  if (document.activeElement !== range) range.value = String(opts.quality);
  const go = side.querySelector<HTMLButtonElement>(".mg-go")!;
  go.disabled = !total || !!busy;
  go.textContent = busy || (total ? `导出 ${total} 张` : "导出");
}

// bindGrid lets the cards be turned, removed and dragged into order.
function bindGrid(grid: HTMLElement) {
  grid.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-do]");
    const id = (e.target as HTMLElement).closest<HTMLElement>(".mg-card")?.dataset.id;
    if (!b || !id || busy) return;
    const i = pages.findIndex((p) => p.id === id);
    if (i < 0) return;
    if (b.dataset.do === "rot") pages[i]!.rot = (pages[i]!.rot + 90) % 360;
    else {
      const [gone] = pages.splice(i, 1);
      toast(`已移除 ${gone!.name}`, {
        label: "撤销",
        run: () => {
          pages.splice(Math.min(i, pages.length), 0, gone!);
          draw();
        },
      });
    }
    draw();
  });
  let dragged = "";
  const clear = () => grid.querySelectorAll(".mg-card").forEach((c) => c.classList.remove("drop-before", "drop-after", "dragging"));
  grid.addEventListener("dragstart", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".mg-card");
    if (!card || busy) return e.preventDefault();
    dragged = card.dataset.id!;
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", dragged);
    requestAnimationFrame(() => card.classList.add("dragging"));
  });
  grid.addEventListener("dragover", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".mg-card");
    if (!dragged || !card) return;
    e.preventDefault();
    const r = card.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    if (card.classList.contains(after ? "drop-after" : "drop-before")) return;
    grid.querySelectorAll(".mg-card").forEach((c) => c.classList.remove("drop-before", "drop-after"));
    card.classList.add(after ? "drop-after" : "drop-before");
  });
  grid.addEventListener("drop", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".mg-card");
    if (!dragged || !card) return;
    e.preventDefault();
    const after = card.classList.contains("drop-after");
    const from = pages.findIndex((p) => p.id === dragged);
    const target = card.dataset.id!;
    dragged = "";
    clear();
    if (from < 0 || target === pages[from]!.id) return;
    const [moved] = pages.splice(from, 1);
    const t = pages.findIndex((p) => p.id === target);
    pages.splice(after ? t + 1 : t, 0, moved!);
    draw();
  });
  grid.addEventListener("dragend", () => {
    dragged = "";
    clear();
  });
}
