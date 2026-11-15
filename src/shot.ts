// Screenshots: the tool's page in the toolbox, the window over every
// display that shows its screenshot to select from (?shot=<display>), and
// the picture pinned on top of the other windows (?pin=<id>), where its
// text is recognized and translated.
import { icons, markIcons } from "./icons";
import { Shot, events, type OCRResult, type ScrollShotState, type ShotFrame, type ShotRect, type Translation } from "./mygo";
import { kbd, onSettings, save, settings, shortcutKeys } from "./settings";
import { errorText, esc, onLeave, showError } from "./ui";

// ---- The tool's page ----

export const shotTool = {
  id: "shot",
  name: "截图翻译",
  icon: icons.shot,
  render(p: HTMLElement) {
    const key = (id: string) => `<span class="sh-key">${shortcutKeys(id) ? kbd(shortcutKeys(id)) : `<span class="muted">未设快捷键</span>`}</span>`;
    p.innerHTML = `
      <h1>截图翻译</h1>
      <p class="muted">框选屏幕上的一块：复制、保存、贴在屏幕上，或者识别其中的文字、翻译后盖在原文上。</p>
      <div class="sh-start">
        <button class="sh-go" data-mode="">${icons.shot}<b>截图</b>${key("shot")}</button>
        <button class="sh-go" data-mode="translate"><span class="sh-glyph">译</span><b>截图翻译</b>${key("shotTranslate")}</button>
        <button class="sh-go" data-mode="ocr"><span class="sh-glyph">文</span><b>识别文字</b><span class="muted">框选后直接识别</span></button>
      </div>
      <section class="s-group">
        <h2>翻译</h2>
        <div class="s-card">
          <div class="s-row"><span>翻译成<small class="muted">自动：中文译成英文，其他语言译成中文</small></span>
            <div class="s-seg sh-to">${[
              ["auto", "自动"],
              ["zh", "中文"],
              ["en", "英文"],
            ]
              .map(([v, n]) => `<button data-to="${v}">${n}</button>`)
              .join("")}</div>
          </div>
          <div class="s-row"><span>翻译引擎<small class="muted sh-engine-tip"></small></span>
            <div class="s-seg sh-engine">${[
              ["auto", "自动"],
              ["google", "谷歌"],
              ["bing", "必应"],
              ["ai", "AI"],
            ]
              .map(([v, n]) => `<button data-engine="${v}">${n}</button>`)
              .join("")}</div>
          </div>
        </div>
      </section>
      <ul class="tips muted">
        <li>选区：拖动框选，拖边角调整、拖中间移动；Enter 或双击复制，Ctrl+S 保存，Esc 或右键取消。</li>
        <li>标注：工具栏里的矩形、椭圆、箭头、画笔、马赛克、文字，下面一排选粗细和颜色；Shift 画正方形、圆、45° 的线，Ctrl+Z 撤销。</li>
        <li>长截图：框住要滚动的内容（比如网页正文）点 ${markIcons.long.replace("<svg", '<svg class="sh-inline"')}，然后在框里往下滚动鼠标滚轮，或点「自动滚动」，右边实时显示拼好的图。</li>
        <li>贴图：拖动移动，滚轮缩放，双击或 Esc 关闭，右键有菜单；鼠标移上去显示识字、翻译按钮。</li>
        <li>识别文字用 Windows 自带的 OCR，不联网；翻译按行译好盖在原图上，贴图下方可以切换原文 / 译文、复制文字。</li>
      </ul>
      <p><button class="sh-close-pins">关闭全部贴图</button></p>`;
    p.querySelectorAll<HTMLElement>(".sh-go").forEach((b) => b.addEventListener("click", () => void Shot.start(b.dataset.mode!).catch(showError)));
    p.querySelector(".sh-close-pins")!.addEventListener("click", () => void Shot.closeAllPins());
    // 「去设置」opens 设置 at its AI 翻译.
    p.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).closest(".sh-ai-go")) return;
      document.querySelector<HTMLElement>('.nav-item[data-id="settings"]')?.click();
      document.querySelector("#s-tr-ai")?.scrollIntoView({ block: "start" });
    });
    p.querySelectorAll<HTMLElement>(".sh-to button").forEach((b) => b.addEventListener("click", () => void save((s) => (s.shot.to = b.dataset.to!))));
    p.querySelectorAll<HTMLElement>(".sh-engine button").forEach((b) => b.addEventListener("click", () => void save((s) => (s.shot.engine = b.dataset.engine!))));
    const render = () => {
      if (!p.querySelector(".sh-to")) return;
      p.querySelectorAll<HTMLElement>(".sh-to button").forEach((b) => b.classList.toggle("on", b.dataset.to === (settings.shot.to || "auto")));
      const engine = settings.shot.engine || "auto";
      p.querySelectorAll<HTMLElement>(".sh-engine button").forEach((b) => b.classList.toggle("on", b.dataset.engine === engine));
      const ai = settings.shot.ai;
      p.querySelector(".sh-engine-tip")!.innerHTML = {
        auto: "免费的谷歌翻译，连不上时换必应，一般一两秒",
        google: "免费的谷歌翻译，要能访问 Google",
        bing: "免费的必应翻译，国内也能用",
        ai:
          ai.baseUrl && ai.model
            ? `用「设置 → AI 翻译」的接口（${esc(ai.model)}），会结合上下文、更通顺，但要看接口快慢 <button class="sh-ai-go">去设置</button>`
            : `还没配置：在「设置 → AI 翻译」里填好接口地址、密钥和模型 <button class="sh-ai-go">去设置</button>`,
      }[engine]!;
    };
    onLeave(onSettings(render));
    render();
  },
};

// ---- The selection window ----

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Pt {
  x: number;
  y: number;
}

const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

// What can be drawn on a selection, as WeChat's screenshots do.
type Tool = "rect" | "ellipse" | "arrow" | "pen" | "mosaic" | "text";

type Mark =
  | { kind: "rect" | "ellipse" | "arrow"; a: Pt; b: Pt; color: string; size: number }
  | { kind: "pen" | "mosaic"; pts: Pt[]; color: string; size: number }
  | { kind: "text"; at: Pt; text: string; color: string; size: number };

const tools: [Tool, string][] = [
  ["rect", "矩形"],
  ["ellipse", "椭圆"],
  ["arrow", "箭头"],
  ["pen", "画笔"],
  ["mosaic", "马赛克"],
  ["text", "文字"],
];
const colors = ["#f5222d", "#faad14", "#52c41a", "#1677ff", "#ffffff", "#000000"];
// Each tool's three sizes, in the page's pixels: a line's width, the
// mosaic brush's, the text's.
const sizes: Record<Tool, number[]> = {
  rect: [2, 4, 7],
  ellipse: [2, 4, 7],
  arrow: [2, 4, 7],
  pen: [2, 4, 7],
  mosaic: [12, 22, 36],
  text: [16, 22, 32],
};
const textFont = (size: number) => `${size}px "Microsoft YaHei", system-ui, sans-serif`;
const textLine = 1.3;
const sizeOf = (t: Tool, i: number) => sizes[t][i] ?? sizes[t][1]!;

// The color and size picked last, for the next screenshot.
const markPrefs = (): { color: string; size: number } => {
  try {
    const p = JSON.parse(localStorage.getItem("shot-mark") || "{}");
    return { color: colors.includes(p.color) ? p.color : colors[0]!, size: [0, 1, 2].includes(p.size) ? p.size : 1 };
  } catch {
    return { color: colors[0]!, size: 1 };
  }
};

// paintMarks draws marks on a canvas whose pixel (0, 0) is the page's
// pixel (ox, oy) / k, only within clip. Mosaic goes under the rest: it
// shows the screenshot's own pixels, made coarse.
function paintMarks(ctx: CanvasRenderingContext2D, marks: Mark[], k: number, ox: number, oy: number, clip: Rect, mosaic: () => HTMLCanvasElement) {
  const c = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(clip.x * k - ox, clip.y * k - oy, clip.w * k, clip.h * k);
  ctx.clip();
  const brush = marks.filter((m) => m.kind === "mosaic");
  if (brush.length) {
    const mask = document.createElement("canvas");
    mask.width = c.width;
    mask.height = c.height;
    const m = mask.getContext("2d")!;
    m.setTransform(k, 0, 0, k, -ox, -oy);
    m.lineCap = m.lineJoin = "round";
    for (const b of brush) {
      if (b.kind !== "mosaic") continue;
      m.lineWidth = b.size;
      m.beginPath();
      const p0 = b.pts[0]!;
      m.moveTo(p0.x, p0.y);
      // A click alone makes a dot.
      if (b.pts.length === 1) m.lineTo(p0.x + 0.01, p0.y);
      for (const p of b.pts.slice(1)) m.lineTo(p.x, p.y);
      m.stroke();
    }
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.globalCompositeOperation = "source-in";
    m.drawImage(mosaic(), -ox, -oy);
    ctx.drawImage(mask, 0, 0);
  }
  ctx.setTransform(k, 0, 0, k, -ox, -oy);
  ctx.lineCap = ctx.lineJoin = "round";
  for (const mk of marks) {
    ctx.strokeStyle = ctx.fillStyle = mk.color;
    ctx.lineWidth = mk.size;
    ctx.beginPath();
    switch (mk.kind) {
      case "rect":
        ctx.lineJoin = "miter";
        ctx.strokeRect(Math.min(mk.a.x, mk.b.x), Math.min(mk.a.y, mk.b.y), Math.abs(mk.b.x - mk.a.x), Math.abs(mk.b.y - mk.a.y));
        ctx.lineJoin = "round";
        break;
      case "ellipse":
        ctx.ellipse((mk.a.x + mk.b.x) / 2, (mk.a.y + mk.b.y) / 2, Math.abs(mk.b.x - mk.a.x) / 2, Math.abs(mk.b.y - mk.a.y) / 2, 0, 0, 2 * Math.PI);
        ctx.stroke();
        break;
      case "arrow": {
        // The line stops where the head starts, so that the tip is sharp.
        const ang = Math.atan2(mk.b.y - mk.a.y, mk.b.x - mk.a.x);
        const len = Math.hypot(mk.b.x - mk.a.x, mk.b.y - mk.a.y);
        const head = Math.min(10 + mk.size * 3, len);
        const spread = 0.42;
        const base = { x: mk.b.x - head * 0.8 * Math.cos(ang), y: mk.b.y - head * 0.8 * Math.sin(ang) };
        ctx.moveTo(mk.a.x, mk.a.y);
        ctx.lineTo(base.x, base.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mk.b.x, mk.b.y);
        ctx.lineTo(mk.b.x - head * Math.cos(ang - spread), mk.b.y - head * Math.sin(ang - spread));
        ctx.lineTo(mk.b.x - head * Math.cos(ang + spread), mk.b.y - head * Math.sin(ang + spread));
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "pen":
      {
        const p0 = mk.pts[0]!;
        ctx.moveTo(p0.x, p0.y);
        if (mk.pts.length === 1) ctx.lineTo(p0.x + 0.01, p0.y);
        for (const p of mk.pts.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
        break;
      }
      case "text":
        ctx.font = textFont(mk.size);
        ctx.textBaseline = "top";
        mk.text.split("\n").forEach((l, i) => ctx.fillText(l, mk.at.x, mk.at.y + i * mk.size * textLine + mk.size * (textLine - 1) / 2));
        break;
    }
  }
  ctx.restore();
}

export function showShot(app: HTMLElement, display: number) {
  document.documentElement.classList.add("shot");
  document.title = "截图";
  const btn = (act: string, title: string, body: string, cls = "") => `<button data-act="${act}" title="${title}"${cls ? ` class="${cls}"` : ""}>${body}</button>`;
  app.innerHTML = `
    <img class="sh-img" alt="" draggable="false" crossorigin="anonymous" />
    <canvas class="sh-canvas"></canvas>
    <div class="sh-dim"></div>
    <div class="sh-sel" hidden>${handles.map((h) => `<i class="sh-h" data-h="${h}"></i>`).join("")}</div>
    <div class="sh-size" hidden></div>
    <div class="sh-bar" hidden>
      ${tools.map(([t, n]) => `<button class="sh-tool" data-tool="${t}" title="${n}">${markIcons[t]}</button>`).join("")}
      ${btn("undo", "撤销 (Ctrl+Z)", markIcons.undo, "sh-tool")}
      <span class="sh-sep"></span>
      ${btn("long", "长截图：框住要滚动的内容，往下滚动拼成一张", markIcons.long, "sh-tool")}
      ${btn("ocr", "识别文字", "文字")}
      ${btn("translate", "翻译 (T)", "翻译")}
      ${btn("pin", "贴在屏幕上 (P)", "贴图")}
      ${btn("save", "保存 (Ctrl+S)", "保存")}
      <span class="sh-sep"></span>
      ${btn("cancel", "取消 (Esc)", "✕")}
      ${btn("copy", "复制 (Enter)", "✓ 复制", "primary")}
    </div>
    <div class="sh-opts" hidden>
      <span class="sh-sizes">${[0, 1, 2].map((i) => `<button data-size="${i}" title="${["细", "中", "粗"][i]}"><i></i></button>`).join("")}</span>
      <span class="sh-sep"></span>
      <span class="sh-colors">${colors.map((c) => `<button data-color="${c}"><i style="background:${c}"></i></button>`).join("")}</span>
    </div>
    <div class="sh-tip">拖动框选 · Esc 或右键取消</div>`;
  const img = app.querySelector<HTMLImageElement>(".sh-img")!;
  const canvas = app.querySelector<HTMLCanvasElement>(".sh-canvas")!;
  const ctx = canvas.getContext("2d")!;
  const box = app.querySelector<HTMLElement>(".sh-sel")!;
  const size = app.querySelector<HTMLElement>(".sh-size")!;
  const bar = app.querySelector<HTMLElement>(".sh-bar")!;
  const opts = app.querySelector<HTMLElement>(".sh-opts")!;
  const tip = app.querySelector<HTMLElement>(".sh-tip")!;

  let frame: ShotFrame | null = null;
  let sel: Rect | null = null;
  let done = false; // the selection is made, with its toolbar
  let busy = false;
  let drag: { kind: "new" | "move" | "resize" | "mark"; h?: string; x: number; y: number; orig: Rect } | null = null;
  let tool: Tool | null = null;
  let marks: Mark[] = [];
  let pref = markPrefs();
  let editing: { el: HTMLTextAreaElement; at: Pt; color: string; size: number } | null = null;
  let pixelated: HTMLCanvasElement | null = null;

  // ratio turns the page's pixels into the screenshot's.
  const ratio = () => (frame ? frame.width / innerWidth : 1);
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

  // mosaic is the screenshot made of coarse blocks, which the mosaic
  // brush shows.
  const mosaic = () => {
    if (pixelated) return pixelated;
    const w = canvas.width;
    const h = canvas.height;
    const block = Math.max(6, Math.round(9 * ratio()));
    const small = document.createElement("canvas");
    small.width = Math.ceil(w / block);
    small.height = Math.ceil(h / block);
    const s = small.getContext("2d")!;
    s.imageSmoothingQuality = "high";
    s.drawImage(img, 0, 0, small.width, small.height);
    pixelated = document.createElement("canvas");
    pixelated.width = w;
    pixelated.height = h;
    const p = pixelated.getContext("2d")!;
    p.imageSmoothingEnabled = false;
    p.drawImage(small, 0, 0, small.width * block, small.height * block);
    return pixelated;
  };

  let painting = 0;
  const paint = () => {
    if (painting) return;
    painting = requestAnimationFrame(() => {
      painting = 0;
      if (sel) paintMarks(ctx, marks, ratio(), 0, 0, sel, mosaic);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
  };

  const dim = app.querySelector<HTMLElement>(".sh-dim")!;
  const render = () => {
    box.hidden = size.hidden = !sel;
    bar.hidden = !sel || !done || busy;
    opts.hidden = bar.hidden || !tool;
    tip.hidden = !!sel;
    // The dimming has a hole where the selection is.
    dim.style.clipPath = sel
      ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${sel.x}px ${sel.y}px, ${sel.x + sel.w}px ${sel.y}px, ${sel.x + sel.w}px ${sel.y + sel.h}px, ${sel.x}px ${sel.y + sel.h}px, ${sel.x}px ${sel.y}px)`
      : "";
    paint();
    if (!sel) return;
    Object.assign(box.style, { left: `${sel.x}px`, top: `${sel.y}px`, width: `${sel.w}px`, height: `${sel.h}px` });
    box.classList.toggle("done", done);
    box.dataset.tool = tool ?? "";
    size.textContent = `${Math.round(sel.w * ratio())} × ${Math.round(sel.h * ratio())}`;
    size.style.left = `${sel.x}px`;
    size.style.top = `${sel.y >= 26 ? sel.y - 24 : sel.y + 4}px`;
    if (bar.hidden) return;
    bar.querySelectorAll<HTMLElement>("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === tool));
    bar.querySelector<HTMLButtonElement>('[data-act="undo"]')!.disabled = !marks.length;
    const bw = bar.offsetWidth;
    const bh = bar.offsetHeight;
    const oh = tool ? opts.offsetHeight + 4 : 0;
    let top = sel.y + sel.h + 6;
    let below = true;
    if (top + bh + oh > innerHeight - 4) {
      top = sel.y - bh - oh - 6;
      below = false;
    }
    if (top < 4) {
      top = sel.y + sel.h - bh - oh - 6;
      below = true;
    }
    const left = clamp(sel.x + sel.w - bw, 4, innerWidth - bw - 4);
    bar.style.left = `${left}px`;
    bar.style.top = `${below ? top : top + oh}px`;
    if (!tool) return;
    const sz = sizes[tool];
    opts.querySelectorAll<HTMLElement>("[data-size]").forEach((b) => {
      const i = Number(b.dataset.size);
      b.classList.toggle("on", i === pref.size);
      const d = tool === "text" ? 6 + i * 4 : tool === "mosaic" ? 8 + i * 4 : 4 + i * 3;
      Object.assign(b.querySelector("i")!.style, { width: `${d}px`, height: `${d}px` });
      b.title = tool === "text" ? `${sz[i]} 号字` : ["细", "中", "粗"][i]!;
    });
    opts.querySelector<HTMLElement>(".sh-colors")!.hidden = tool === "mosaic";
    opts.querySelector<HTMLElement>(".sh-sep")!.hidden = tool === "mosaic";
    opts.querySelectorAll<HTMLElement>("[data-color]").forEach((b) => b.classList.toggle("on", b.dataset.color === pref.color));
    opts.style.left = `${left}px`;
    opts.style.top = `${below ? top + bh + 4 : top}px`;
  };

  const setPref = (p: Partial<typeof pref>) => {
    pref = { ...pref, ...p };
    try {
      localStorage.setItem("shot-mark", JSON.stringify(pref));
    } catch {}
    if (editing) {
      if (p.color) editing.color = p.color;
      if (tool === "text" && p.size !== undefined) editing.size = sizeOf("text", p.size);
      styleEditor();
      editing.el.focus();
    }
    render();
  };

  // ---- Text being typed, in a box over the screenshot ----

  const styleEditor = () => {
    if (!editing) return;
    Object.assign(editing.el.style, {
      left: `${editing.at.x}px`,
      top: `${editing.at.y}px`,
      color: editing.color,
      font: textFont(editing.size),
      lineHeight: String(textLine),
      maxWidth: `${(sel ? sel.x + sel.w : innerWidth) - editing.at.x}px`,
    });
  };

  const openEditor = (at: Pt) => {
    const el = document.createElement("textarea");
    el.className = "sh-text";
    el.spellcheck = false;
    el.rows = 1;
    app.appendChild(el);
    editing = { el, at, color: pref.color, size: sizeOf("text", pref.size) };
    styleEditor();
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("blur", () => commitText());
    setTimeout(() => el.focus());
  };

  const commitText = () => {
    if (!editing) return;
    const { el, at, color, size } = editing;
    editing = null;
    el.remove();
    const text = el.value.replace(/\s+$/, "");
    if (text) marks.push({ kind: "text", at, text, color, size });
    render();
  };

  // ---- Loading a screenshot, and ending one ----

  const reset = () => {
    if (editing) {
      editing.el.remove();
      editing = null;
    }
    sel = null;
    done = busy = false;
    drag = null;
    tool = null;
    marks = [];
    render();
  };

  const load = async () => {
    const f = await Shot.frame(display);
    if (!f || f.seq === frame?.seq) return;
    frame = f;
    pixelated = null;
    canvas.width = f.width;
    canvas.height = f.height;
    reset();
    tip.textContent = f.mode === "translate" ? "框选要翻译的文字 · Esc 取消" : f.mode === "ocr" ? "框选要识别的文字 · Esc 取消" : f.mode === "qr" ? "框选二维码 · Esc 取消" : "拖动框选 · Esc 或右键取消";
    img.src = f.url;
    try {
      await img.decode();
    } catch {
      return;
    }
    // A moment to paint the new picture before the window shows.
    await new Promise((r) => setTimeout(r, 30));
    void Shot.ready(display, f.seq);
  };
  events.shotCaptured.on(() => void load());
  // Hidden again, the window lets go of the screen's picture and its
  // canvas, tens of megabytes; the next screenshot brings its own.
  events.shotEnded.on(() => {
    img.removeAttribute("src");
    pixelated = null;
    canvas.width = canvas.height = 0;
  });
  void load();

  const cancel = () => {
    reset();
    void Shot.cancel();
  };

  // layer is what was drawn on the selection, as a transparent PNG of the
  // selection's size in base64, or "" for nothing.
  const layer = async (r: ShotRect) => {
    if (!marks.length || !sel) return "";
    const c = document.createElement("canvas");
    c.width = r.w;
    c.height = r.h;
    paintMarks(c.getContext("2d")!, marks, ratio(), r.x, r.y, sel, mosaic);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
    if (!blob) throw new Error("画的标注保存不了");
    const url = await new Promise<string>((ok) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.readAsDataURL(blob);
    });
    return url.slice(url.indexOf(",") + 1);
  };

  const act = async (action: string) => {
    if (action === "cancel") return cancel();
    if (action === "undo") {
      marks.pop();
      return render();
    }
    if (!sel || !frame || busy) return;
    commitText();
    const k = ratio();
    const r: ShotRect = { x: Math.round(sel.x * k), y: Math.round(sel.y * k), w: Math.round(sel.w * k), h: Math.round(sel.h * k) };
    busy = true;
    render();
    try {
      if (action === "long") await Shot.scroll(display, r);
      else await Shot.finish(display, r, action, await layer(r));
    } catch (e) {
      busy = false;
      render();
      tip.hidden = false;
      tip.textContent = errorText(e);
      return;
    }
    reset();
  };

  bar.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tool]");
    if (t) {
      commitText();
      tool = tool === t.dataset.tool ? null : (t.dataset.tool as Tool);
      return render();
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (b) void act(b.dataset.act!);
  });
  opts.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (b?.dataset.size) setPref({ size: Number(b.dataset.size) });
    else if (b?.dataset.color) setPref({ color: b.dataset.color });
  });
  for (const el of [bar, opts]) {
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      // The text being typed keeps the focus.
      if (editing) e.preventDefault();
    });
  }

  const inside = (x: number, y: number, r: Rect) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  app.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !frame || busy) return;
    if (editing) {
      // A click elsewhere ends the text.
      commitText();
      return;
    }
    const h = (e.target as HTMLElement).dataset.h;
    const p = { x: e.clientX, y: e.clientY };
    if (h && sel && done) drag = { kind: "resize", h, ...p, orig: { ...sel } };
    else if (sel && done && tool && inside(p.x, p.y, sel)) {
      if (tool === "text") {
        e.preventDefault();
        openEditor({ x: p.x, y: p.y - (sizeOf("text", pref.size) * textLine) / 2 });
        return;
      }
      const size = sizeOf(tool, pref.size);
      marks.push(tool === "pen" || tool === "mosaic" ? { kind: tool, pts: [p], color: pref.color, size } : { kind: tool, a: p, b: p, color: pref.color, size });
      drag = { kind: "mark", ...p, orig: { ...sel } };
    } else if (sel && done && inside(p.x, p.y, sel)) drag = { kind: "move", ...p, orig: { ...sel } };
    else if (marks.length) return; // what was drawn is not thrown away by a stray click
    else {
      drag = { kind: "new", ...p, orig: { ...p, w: 0, h: 0 } };
      sel = null;
      done = false;
    }
    try {
      app.setPointerCapture(e.pointerId);
    } catch {}
    render();
  });
  app.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const x = clamp(e.clientX, 0, innerWidth);
    const y = clamp(e.clientY, 0, innerHeight);
    const o = drag.orig;
    if (drag.kind === "mark") {
      const m = marks[marks.length - 1]!;
      if ("pts" in m) {
        const last = m.pts[m.pts.length - 1]!;
        if (Math.hypot(x - last.x, y - last.y) >= 1.5) m.pts.push({ x, y });
      } else if ("a" in m) {
        let b = { x, y };
        // Shift keeps a square, a circle, or a line at 45° steps.
        if (e.shiftKey && m.kind !== "arrow") {
          const d = Math.max(Math.abs(x - m.a.x), Math.abs(y - m.a.y));
          b = { x: m.a.x + Math.sign(x - m.a.x) * d, y: m.a.y + Math.sign(y - m.a.y) * d };
        } else if (e.shiftKey) {
          const ang = Math.round(Math.atan2(y - m.a.y, x - m.a.x) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(x - m.a.x, y - m.a.y);
          b = { x: m.a.x + len * Math.cos(ang), y: m.a.y + len * Math.sin(ang) };
        }
        m.b = b;
      }
      return paint();
    }
    if (drag.kind === "new") {
      sel = { x: Math.min(x, drag.x), y: Math.min(y, drag.y), w: Math.abs(x - drag.x), h: Math.abs(y - drag.y) };
    } else if (drag.kind === "move") {
      sel = { x: clamp(o.x + x - drag.x, 0, innerWidth - o.w), y: clamp(o.y + y - drag.y, 0, innerHeight - o.h), w: o.w, h: o.h };
    } else {
      let [l, t, r, b] = [o.x, o.y, o.x + o.w, o.y + o.h];
      if (drag.h!.includes("w")) l = x;
      if (drag.h!.includes("e")) r = x;
      if (drag.h!.includes("n")) t = y;
      if (drag.h!.includes("s")) b = y;
      sel = { x: Math.min(l, r), y: Math.min(t, b), w: Math.abs(r - l), h: Math.abs(b - t) };
    }
    render();
  });
  app.addEventListener("pointerup", () => {
    if (!drag) return;
    const kind = drag.kind;
    drag = null;
    if (kind === "mark") {
      // A shape too small to see was a slip.
      const m = marks[marks.length - 1]!;
      if ("a" in m && Math.abs(m.b.x - m.a.x) < 3 && Math.abs(m.b.y - m.a.y) < 3) marks.pop();
      return render();
    }
    if (!sel || sel.w < 3 || sel.h < 3) return reset();
    done = true;
    render();
    // From 截图翻译 or 识别文字, the selection goes on at once.
    if (kind === "new" && frame?.mode) void act(frame.mode);
  });
  app.addEventListener("dblclick", (e) => {
    if (sel && done && !tool && inside(e.clientX, e.clientY, sel)) void act("copy");
  });
  app.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (sel && !busy) reset();
    else cancel();
  });
  addEventListener("keydown", (e) => {
    if (!frame) return;
    const k = e.key.toLowerCase();
    if (editing) {
      // Esc, or Ctrl+Enter, ends the text; Enter starts a new line.
      if (e.key === "Escape" || (e.key === "Enter" && e.ctrlKey)) {
        e.preventDefault();
        commitText();
      }
      return;
    }
    if (e.key === "Escape") return cancel();
    if (!sel || !done) return;
    if (e.ctrlKey && k === "z") void act("undo");
    else if (e.key === "Enter" || (e.ctrlKey && k === "c")) void act("copy");
    else if (e.ctrlKey && k === "s") {
      e.preventDefault();
      void act("save");
    } else if (!e.ctrlKey && k === "p") void act("pin");
    else if (!e.ctrlKey && k === "t") void act("translate");
    else if (e.key.startsWith("Arrow")) {
      // Arrows move the selection a pixel, with Shift ten.
      e.preventDefault();
      const n = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0;
      const dy = e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0;
      sel = { ...sel, x: clamp(sel.x + dx, 0, innerWidth - sel.w), y: clamp(sel.y + dy, 0, innerHeight - sel.h) };
      render();
    }
  });
}

// ---- The long screenshot: a frame around the region, and its panel ----

export function showScrollFrame(app: HTMLElement) {
  document.documentElement.classList.add("scrollframe");
  document.title = "长截图";
  app.innerHTML = `<div class="sf-border"></div>`;
}

export function showScroll(app: HTMLElement) {
  document.documentElement.classList.add("scroll");
  document.title = "长截图";
  app.innerHTML = `
    <div class="ss-head"><b>长截图</b><span class="ss-size muted"></span></div>
    <div class="ss-view"><img class="ss-img" alt="" draggable="false" /></div>
    <p class="ss-note"></p>
    <button class="ss-auto">自动滚动</button>
    <div class="ss-acts">
      <button data-act="" title="取消 (Esc)">取消</button>
      <button data-act="pin" title="贴在屏幕上">贴图</button>
      <button data-act="save" title="保存">保存</button>
      <button data-act="copy" class="primary" title="复制 (Enter)">复制</button>
    </div>`;
  const img = app.querySelector<HTMLImageElement>(".ss-img")!;
  const view = app.querySelector<HTMLElement>(".ss-view")!;
  const note = app.querySelector<HTMLElement>(".ss-note")!;
  const sizeEl = app.querySelector<HTMLElement>(".ss-size")!;
  const auto = app.querySelector<HTMLButtonElement>(".ss-auto")!;
  let seq = -1;
  let on = false;
  let ending = false;

  const show = async (st: ScrollShotState) => {
    on = st.auto;
    auto.textContent = on ? "停止自动滚动" : "自动滚动";
    auto.classList.toggle("on", on);
    sizeEl.textContent = st.height ? `${st.width} × ${st.height}` : "";
    note.textContent = st.note || (on ? "正在自动滚动，鼠标移出框就暂停" : "在框里往下滚动鼠标滚轮，滚到哪拼到哪");
    note.classList.toggle("warn", !!st.note);
    if (st.seq === seq) return;
    seq = st.seq;
    // The new picture loads before it takes the old one's place.
    const next = new Image();
    next.src = st.preview;
    try {
      await next.decode();
    } catch {
      return;
    }
    if (st.seq !== seq) return;
    img.src = next.src;
    view.scrollTop = view.scrollHeight;
  };
  events.scrollShotChanged.on((st) => void show(st));

  const end = (action: string) => {
    if (ending) return;
    ending = true;
    void Shot.scrollEnd(action);
  };
  auto.addEventListener("click", () => void Shot.scrollAuto(!on));
  app.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => b.addEventListener("click", () => end(b.dataset.act!)));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") end("");
    else if (e.key === "Enter") end("copy");
  });
  img.addEventListener("load", () => (view.scrollTop = view.scrollHeight));

  void Shot.scrollState().then(async (st) => {
    await show(st);
    void Shot.scrollReady();
  });
}

// ---- The pinned picture ----

// panelHeight is the text panel's, under the picture.
const panelHeight = 200;
const panelWidth = 420;

export async function showPin(app: HTMLElement, id: string) {
  document.documentElement.classList.add("pin");
  document.title = "贴图";
  const info = await Shot.pin(id);
  document.documentElement.style.setProperty("--pad", `${info.pad}px`);
  app.innerHTML = `
    <div class="pn-card">
      <div class="pn-view">
        <img class="pn-img" alt="" draggable="false" />
        <div class="pn-layer" hidden></div>
        <div class="pn-tools">
          <button data-act="ocr" title="识别文字">文字</button>
          <button data-act="translate" title="翻译">翻译</button>
          <button data-act="copy" title="复制图片 (Ctrl+C)">复制</button>
          <button data-act="close" title="关闭 (Esc)">✕</button>
        </div>
        <div class="pn-zoom" hidden></div>
      </div>
      <div class="pn-panel" hidden>
        <div class="pn-head">
          <div class="s-seg pn-tabs"><button data-tab="text">原文</button><button data-tab="tr">译文</button></div>
          <select class="pn-to" title="翻译成">
            <option value="auto">自动</option><option value="zh">译成中文</option><option value="en">译成英文</option>
          </select>
          <span class="pn-status muted"></span>
          <span class="l-spacer"></span>
          <button class="pn-cover" hidden></button>
          <button class="pn-copy primary">复制</button>
        </div>
        <textarea class="pn-text" spellcheck="false"></textarea>
      </div>
    </div>`;
  const img = app.querySelector<HTMLImageElement>(".pn-img")!;
  const view = app.querySelector<HTMLElement>(".pn-view")!;
  const layer = app.querySelector<HTMLElement>(".pn-layer")!;
  const panel = app.querySelector<HTMLElement>(".pn-panel")!;
  const text = app.querySelector<HTMLTextAreaElement>(".pn-text")!;
  const status = app.querySelector<HTMLElement>(".pn-status")!;
  const cover = app.querySelector<HTMLButtonElement>(".pn-cover")!;
  const to = app.querySelector<HTMLSelectElement>(".pn-to")!;
  const zoomLabel = app.querySelector<HTMLElement>(".pn-zoom")!;
  to.value = settings.shot.to || "auto";

  // A long screenshot starts small enough for its screen.
  let zoom = Math.min(1, (info.maxHeight - 2 * info.pad - 16) / info.height, (info.maxWidth - 2 * info.pad - 16) / info.width);
  let tab: "text" | "tr" = "text";
  let ocr: OCRResult | null = null;
  let tr: Translation | null = null;
  let covered = false; // the translation covers the picture
  let run = 0; // the latest translation, so that an older one coming back late is dropped

  const layout = () => {
    const w = Math.round(info.width * zoom);
    const h = Math.round(info.height * zoom);
    Object.assign(view.style, { width: `${w}px`, height: `${h}px` });
    const cardW = panel.hidden ? w : Math.max(w, panelWidth);
    panel.style.width = `${cardW}px`;
    const cardH = h + (panel.hidden ? 0 : panelHeight);
    void Shot.resizePin(id, cardW + 2 * info.pad, cardH + 2 * info.pad);
    fitLines();
  };

  const showPanel = () => {
    if (!panel.hidden) return;
    panel.hidden = false;
    // The picture shrinks to leave the panel room on the screen.
    const room = Math.min((info.maxHeight - panelHeight - 2 * info.pad - 16) / info.height, (info.maxWidth - 2 * info.pad - 16) / info.width);
    if (zoom > room) zoom = Math.max(room, 0.2);
    layout();
  };

  const setTab = (t: "text" | "tr") => {
    tab = t;
    app.querySelectorAll<HTMLElement>(".pn-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    to.hidden = t !== "tr";
    text.value = t === "tr" ? (tr?.text ?? "") : (ocr?.text ?? "");
    renderCover();
  };

  const renderCover = () => {
    const can = !!tr?.lines.length;
    cover.hidden = !can;
    layer.hidden = !can || !covered;
    cover.textContent = covered ? "看原图" : "看译文";
  };

  const recognize = async () => {
    if (ocr) return ocr;
    status.textContent = "正在识别…";
    ocr = await Shot.ocr(id);
    return ocr;
  };

  const doOCR = async () => {
    showPanel();
    setTab("text");
    try {
      const r = await recognize();
      if (tab === "text") text.value = r.text;
      status.textContent = r.lines.length ? `${r.lines.length} 行` : "没有识别到文字";
    } catch (e) {
      status.textContent = errorText(e);
    }
  };

  const doTranslate = async () => {
    showPanel();
    setTab("tr");
    const mine = ++run;
    tr = null;
    text.value = "";
    renderCover();
    try {
      const r = await recognize();
      if (!r.lines.length) {
        status.textContent = "没有识别到文字";
        return;
      }
      status.textContent = "正在翻译…";
      const t = await Shot.translate(id, to.value);
      if (mine !== run) return;
      tr = t;
      covered = t.lines.length > 0;
      // The layer shows first: hidden, its lines have no size to fit.
      renderCover();
      drawLines();
      if (tab === "tr") text.value = t.text;
      status.textContent = `已译成${t.to === "zh" ? "中文" : "英文"}`;
    } catch (e) {
      if (mine === run) status.textContent = errorText(e);
    }
  };

  // drawLines covers every recognized line with its translation, in the
  // line's colors, as large as the line's height allows.
  const drawLines = () => {
    if (!ocr || !tr?.lines.length) return;
    const nw = img.naturalWidth || 1;
    const nh = img.naturalHeight || 1;
    const pct = (v: number, of: number) => ((v / of) * 100).toFixed(3);
    layer.innerHTML = ocr.lines
      .map((l, i) => {
        const x = l.x - 2;
        const y = l.y - 2;
        return `<div class="pn-line" style="left:${pct(x, nw)}%;top:${pct(y, nh)}%;width:${pct(l.w + 4, nw)}%;height:${pct(l.h + 4, nh)}%;background:${l.bg};color:${l.fg}">${esc(tr!.lines[i] ?? "")}</div>`;
      })
      .join("");
    fitLines();
  };

  const fitLines = () => {
    if (layer.hidden) return;
    layer.querySelectorAll<HTMLElement>(".pn-line").forEach((el) => {
      let fs = Math.max(el.clientHeight * 0.82, 6);
      el.style.fontSize = `${fs}px`;
      while (el.scrollWidth > el.clientWidth + 1 && fs > 6) {
        fs *= 0.9;
        el.style.fontSize = `${fs}px`;
      }
    });
  };

  const copyImage = () =>
    void Shot.copyPin(id).then(() => flash("已复制图片"), (e) => flash(errorText(e)));

  const flash = (msg: string) => {
    zoomLabel.textContent = msg;
    zoomLabel.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (zoomLabel.hidden = true), 900);
  };
  let flashTimer = 0;

  app.querySelector(".pn-tools")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!b) return;
    const a = b.dataset.act;
    if (a === "ocr") void doOCR();
    else if (a === "translate") void doTranslate();
    else if (a === "copy") copyImage();
    else if (a === "close") void Shot.closePin(id);
  });
  app.querySelectorAll<HTMLElement>(".pn-tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.tab === "tr" && !tr) void doTranslate();
      else setTab(b.dataset.tab as "text" | "tr");
    }),
  );
  to.addEventListener("change", () => void doTranslate());
  cover.addEventListener("click", () => {
    covered = !covered;
    renderCover();
    fitLines();
  });
  app.querySelector(".pn-copy")!.addEventListener("click", () => {
    void navigator.clipboard.writeText(text.value).then(
      () => (status.textContent = "已复制文字"),
      (e) => (status.textContent = errorText(e)),
    );
  });
  events.pinAction.on((e) => {
    if (e.id !== id) return;
    if (e.action === "ocr") void doOCR();
    else if (e.action === "translate") void doTranslate();
  });

  // Dragging moves it, a double click closes it, the wheel zooms it.
  let start: { x: number; y: number } | null = null;
  view.addEventListener("pointerdown", (e) => {
    if (e.button === 0 && !(e.target as HTMLElement).closest("button")) start = { x: e.screenX, y: e.screenY };
  });
  view.addEventListener("pointermove", (e) => {
    if (start && Math.hypot(e.screenX - start.x, e.screenY - start.y) > 4) {
      start = null;
      void Shot.dragPin(id);
    }
  });
  view.addEventListener("pointerup", () => (start = null));
  view.addEventListener("dblclick", (e) => {
    if (!(e.target as HTMLElement).closest("button")) void Shot.closePin(id);
  });
  view.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    void Shot.pinMenu(id);
  });
  view.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom = Math.min(Math.max(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.2), 5);
      flash(`${Math.round(zoom * 100)}%`);
      layout();
    },
    { passive: false },
  );
  addEventListener("keydown", (e) => {
    const typing = document.activeElement === text;
    if (e.key === "Escape") {
      if (typing) text.blur();
      else void Shot.closePin(id);
    } else if (e.ctrlKey && e.key.toLowerCase() === "c" && !typing && !getSelection()?.toString()) {
      copyImage();
    }
  });

  img.src = info.url;
  try {
    await img.decode();
  } catch (e) {
    showError(e);
  }
  layout();
  await Shot.pinReady(id);
  if (info.mode === "ocr") void doOCR();
  else if (info.mode === "translate") void doTranslate();
}
