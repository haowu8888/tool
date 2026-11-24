// What the image tool's three views (编辑图片, 创造拼图, 合并文档) share:
// canvases, loading pictures, backgrounds, and the save dialog.
import { colors, pen, setPen, sizes, type Tool } from "./marks";
import { ImageEdit, type EditImage } from "./mygo";
import { openDialog, showError, toast } from "./ui";

// The largest picture opened, in pixels: past it canvases fail.
export const maxPixels = 120e6;

export const imagePath = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i;

export function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// decode draws a picture at a URL on a canvas, at most maxSide on its
// longer side when given.
export async function decode(url: string, maxSide = 0) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  try {
    await img.decode();
  } catch {
    throw new Error("读不出这张图片");
  }
  // An SVG without a size of its own is drawn at 1024 wide.
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (!w || !h) [w, h] = [1024, 768];
  if (w * h > maxPixels) throw new Error(`图片太大（${w}×${h}），最多 1.2 亿像素`);
  const k = maxSide ? Math.min(1, maxSide / Math.max(w, h)) : 1;
  const c = canvas(w * k, h * k);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// decodeBlob is decode for a pasted picture.
export async function decodeBlob(b: Blob, maxSide = 0) {
  const url = URL.createObjectURL(b);
  try {
    return await decode(url, maxSide);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// pickPictures asks for pictures and loads each, one after the other: Go
// serves only so many at once.
export async function pickPictures(multiple: boolean, each: (e: EditImage) => Promise<void>) {
  const list = (await ImageEdit.pick(multiple)) ?? [];
  for (const e of list) await each(e);
  return list.length;
}

// pastedPicture is the picture of a paste, unless pasted in a text box.
export function pastedPicture(e: ClipboardEvent) {
  if ((e.target as HTMLElement).closest?.("textarea, input")) return null;
  const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
  if (file) e.preventDefault();
  return file ?? null;
}

export function base64(blob: Blob) {
  return new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => fail(new Error("图片导出失败"));
    r.readAsDataURL(blob);
  });
}

export function sizeText(n: number) {
  return n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(n >= 10 << 20 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// encodeCanvas exports a canvas: JPG has no transparency, so what is
// transparent turns white, not black.
export async function encodeCanvas(c: HTMLCanvasElement, format: string, quality: number): Promise<Blob> {
  if (format === "jpeg") {
    const flat = canvas(c.width, c.height);
    const ctx = flat.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(c, 0, 0);
    c = flat;
  }
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, `image/${format}`, quality / 100));
  if (!blob) throw new Error("图片导出失败");
  return blob;
}

// pixelated is a picture made of coarse blocks, which the mosaic brush
// shows.
export function pixelated(src: HTMLCanvasElement, block: number) {
  const small = canvas(src.width / block, src.height / block);
  const s = small.getContext("2d")!;
  s.imageSmoothingQuality = "high";
  s.drawImage(src, 0, 0, small.width, small.height);
  const c = canvas(src.width, src.height);
  const p = c.getContext("2d")!;
  p.imageSmoothingEnabled = false;
  p.drawImage(small, 0, 0, small.width * block, small.height * block);
  return c;
}

export const mosaicBlock = (size: number) => Math.max(3, Math.round(size * 0.4));

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

// The backgrounds of 边框 and of collages: transparent, a color, or "a,b"
// for a gradient.
export const backgrounds: [string, string][] = [
  ["transparent", "透明"],
  ["#ffffff", "白色"],
  ["#eef0f3", "浅灰"],
  ["#1f2329", "深色"],
  ["#a1c4fd,#c2e9fb", "晴空"],
  ["#fbc2eb,#a6c1ee", "暮光"],
  ["#f6d365,#fda085", "暖橙"],
  ["#84fab0,#8fd3f4", "薄荷"],
  ["#30cfd0,#330867", "深海"],
  ["#434343,#000000", "夜色"],
];

export const bgCSS = (bg: string) => (bg === "transparent" ? "" : bg.includes(",") ? `linear-gradient(135deg, ${bg})` : bg);

export function fillBackground(ctx: CanvasRenderingContext2D, w: number, h: number, bg: string) {
  if (bg === "transparent") return;
  const [a, b] = bg.split(",");
  if (b) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, a!);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
  } else ctx.fillStyle = a!;
  ctx.fillRect(0, 0, w, h);
}

// ---- The save dialog ----

const formats: [string, string][] = [
  ["png", "PNG"],
  ["jpeg", "JPG"],
  ["webp", "WebP"],
];

// formatOf is the format a file keeps when written over: its own.
export function formatOf(path: string) {
  const ext = path.toLowerCase().match(/\.(\w+)$/)?.[1] ?? "";
  return ext === "jpg" || ext === "jpeg" ? "jpeg" : ext === "webp" ? "webp" : ext === "png" ? "png" : "";
}

export const formatTips: Record<string, string> = {
  png: "无损，保留透明；照片会比较大。",
  jpeg: "适合照片，体积小；透明的地方变成白色。",
  webp: "比 JPG 更小，保留透明；有些老软件打不开。",
};

let quality = (() => {
  try {
    const q = Number(JSON.parse(localStorage.getItem("image-export") || "{}").quality);
    return q >= 10 && q <= 100 ? q : 90;
  } catch {
    return 90;
  }
})();

// ExportTarget is what the save dialog saves.
export interface ExportTarget {
  path?: string; // the file it came from, which 覆盖原图 writes over
  size?: number; // the original's bytes
  dims(): [number, number];
  encode(format: string, quality: number): Promise<Blob>;
  save(data: string, format: string): Promise<string>; // the file, "" when canceled
  overwrite?(data: string, format: string): Promise<void>;
  saved?(): void;
}

// exportDialog asks in which format and quality to save a picture, and
// tells how large the file comes out.
export function exportDialog(t: ExportTarget) {
  let format = formatOf(t.path ?? "") || "png";
  const dlg = openDialog(`
    <h2>保存图片</h2>
    <div class="ie-ex">
      <div class="ie-ex-row"><span>格式</span><div class="s-seg ie-ex-fmt">${formats.map(([f, n]) => `<button type="button" data-f="${f}">${n}</button>`).join("")}</div></div>
      <div class="ie-ex-row ie-ex-q"><span>质量</span><input type="range" min="10" max="100" step="1" /><b></b></div>
      <div class="ie-ex-row"><span>大小</span><span class="ie-ex-size muted"></span></div>
      <p class="ie-ex-tip muted"></p>
    </div>
    <div class="l-buttons">
      <button type="button" class="ie-ex-over"${t.path && t.overwrite ? "" : " hidden"}>覆盖原图</button>
      <button type="button" class="primary ie-ex-save">另存为…</button>
    </div>`);
  dlg.classList.add("ie-ex-dialog");
  const range = dlg.querySelector<HTMLInputElement>(".ie-ex-q input")!;
  const over = dlg.querySelector<HTMLButtonElement>(".ie-ex-over")!;
  const sizeEl = dlg.querySelector<HTMLElement>(".ie-ex-size")!;
  range.value = String(quality);
  let blob: Blob | null = null;
  let seq = 0;
  // The file's size, in the chosen format, a moment after the last change.
  let timer = 0;
  const measure = () => {
    blob = null;
    sizeEl.textContent = "计算中…";
    clearTimeout(timer);
    const n = ++seq;
    timer = window.setTimeout(async () => {
      try {
        const b = await t.encode(format, quality);
        if (n !== seq) return;
        blob = b;
        const [w, h] = t.dims();
        sizeEl.textContent = `${sizeText(b.size)} · ${w} × ${h}${t.size ? `（原图 ${sizeText(t.size)}）` : ""}`;
      } catch (e) {
        if (n === seq) sizeEl.textContent = e instanceof Error ? e.message : String(e);
      }
    }, 250);
  };
  const render = () => {
    dlg.querySelectorAll<HTMLElement>(".ie-ex-fmt button").forEach((b) => b.classList.toggle("on", b.dataset.f === format));
    dlg.querySelector<HTMLElement>(".ie-ex-q")!.hidden = format === "png";
    dlg.querySelector(".ie-ex-q b")!.textContent = String(quality);
    const own = formatOf(t.path ?? "");
    over.disabled = !own || own !== format;
    over.title = !own ? "" : own === format ? `写回 ${t.path}` : `原图是 ${own === "jpeg" ? "JPG" : own.toUpperCase()}，换成同样的格式才能覆盖`;
    dlg.querySelector(".ie-ex-tip")!.textContent = formatTips[format]!;
    measure();
  };
  dlg.querySelector(".ie-ex-fmt")!.addEventListener("click", (e) => {
    const f = (e.target as HTMLElement).closest<HTMLElement>("[data-f]")?.dataset.f;
    if (!f) return;
    format = f;
    render();
  });
  range.addEventListener("input", () => {
    quality = Number(range.value);
    try {
      localStorage.setItem("image-export", JSON.stringify({ quality }));
    } catch {}
    render();
  });
  const write = async (to: (data: string) => Promise<string | void>, b: HTMLButtonElement) => {
    b.disabled = true;
    try {
      const data = await base64(blob ?? (await t.encode(format, quality)));
      const path = await to(data);
      if (path === "") return; // canceled
      dlg.close();
      const where = path || t.path || "";
      savedToast(where);
      t.saved?.();
    } catch (e) {
      showError(e);
    } finally {
      b.disabled = false;
    }
  };
  dlg.querySelector<HTMLButtonElement>(".ie-ex-save")!.addEventListener("click", (e) => void write((data) => t.save(data, format), e.currentTarget as HTMLButtonElement));
  over.addEventListener("click", () => t.overwrite && void write((data) => t.overwrite!(data, format), over));
  dlg.addEventListener("close", () => {
    seq++;
    clearTimeout(timer);
  });
  render();
}

export function savedToast(path: string) {
  toast(`已保存 ${path.replace(/^.*[\\/]/, "")}`, { label: "打开所在位置", run: () => void ImageEdit.reveal(path) });
}

// copyCanvas copies a picture.
export async function copyCanvas(c: HTMLCanvasElement) {
  await ImageEdit.copy(await base64(await encodeCanvas(c, "png", 100)));
  toast("已复制图片");
}


// ---- The pen's panel, of 编辑图片's 标注 and of 创造拼图 ----

export function penHTML() {
  return `
    <h3>粗细</h3>
    <div class="ie-chips ie-sizes">${[0, 1, 2].map((i) => `<button data-size="${i}">${["细", "中", "粗"][i]}</button>`).join("")}</div>
    <h3 class="ie-color-h">颜色</h3>
    <div class="ie-colors">${colors.map((c) => `<button data-color="${c}" title="${c}"><i style="background:${c}"></i></button>`).join("")}<label class="ie-custom" title="自定义颜色"><input type="color" /></label></div>`;
}

// showPen marks the pen's size and color in its panel, for a tool.
export function showPen(box: HTMLElement, tool: Tool) {
  box.querySelectorAll<HTMLElement>("[data-size]").forEach((b) => {
    const i = Number(b.dataset.size);
    b.classList.toggle("on", i === pen.size);
    b.title = tool === "text" ? `${sizes.text[i]} 号字` : "";
  });
  const noColor = tool === "mosaic";
  box.querySelector<HTMLElement>(".ie-colors")!.hidden = noColor;
  box.querySelector<HTMLElement>(".ie-color-h")!.hidden = noColor;
  box.querySelectorAll<HTMLElement>("[data-color]").forEach((b) => b.classList.toggle("on", b.dataset.color === pen.color));
  const custom = box.querySelector<HTMLInputElement>(".ie-custom input")!;
  custom.parentElement!.classList.toggle("on", !colors.includes(pen.color));
  if (!colors.includes(pen.color)) custom.value = pen.color;
}

// penEvent changes the pen on a click or input in its panel, and tells
// what it changed, if it did.
export function penEvent(e: Event): "size" | "color" | null {
  const t = e.target as HTMLElement;
  if (e.type === "input") {
    if (!(t instanceof HTMLInputElement) || t.type !== "color" || !t.closest(".ie-custom")) return null;
    setPen({ color: t.value });
    return "color";
  }
  const b = t.closest<HTMLElement>("[data-size], [data-color]");
  if (!b) return null;
  if (b.dataset.size) {
    setPen({ size: Number(b.dataset.size) });
    return "size";
  }
  setPen({ color: b.dataset.color! });
  return "color";
}
