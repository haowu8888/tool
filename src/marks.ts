// What can be drawn on a picture, as WeChat's screenshots do: the
// screenshot's selection (shot.ts) and the image editor (imageedit.ts)
// share the marks and how they are painted.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  y: number;
}

export type Tool = "rect" | "ellipse" | "arrow" | "pen" | "mosaic" | "text";

export type Mark =
  | { kind: "rect" | "ellipse" | "arrow"; a: Pt; b: Pt; color: string; size: number }
  | { kind: "pen" | "mosaic"; pts: Pt[]; color: string; size: number }
  | { kind: "text"; at: Pt; text: string; color: string; size: number };

export const tools: [Tool, string][] = [
  ["rect", "矩形"],
  ["ellipse", "椭圆"],
  ["arrow", "箭头"],
  ["pen", "画笔"],
  ["mosaic", "马赛克"],
  ["text", "文字"],
];
export const colors = ["#f5222d", "#faad14", "#52c41a", "#1677ff", "#ffffff", "#000000"];
// Each tool's three sizes, in the page's pixels: a line's width, the
// mosaic brush's, the text's.
export const sizes: Record<Tool, number[]> = {
  rect: [2, 4, 7],
  ellipse: [2, 4, 7],
  arrow: [2, 4, 7],
  pen: [2, 4, 7],
  mosaic: [12, 22, 36],
  text: [16, 22, 32],
};
export const textFont = (size: number) => `${size}px "Microsoft YaHei", system-ui, sans-serif`;
export const textLine = 1.3;
export const sizeOf = (t: Tool, i: number) => sizes[t][i] ?? sizes[t][1]!;

// The color and size picked last, for the next screenshot.
const markPrefs = (): { color: string; size: number } => {
  try {
    const p = JSON.parse(localStorage.getItem("shot-mark") || "{}");
    return { color: colors.includes(p.color) ? p.color : colors[0]!, size: [0, 1, 2].includes(p.size) ? p.size : 1 };
  } catch {
    return { color: colors[0]!, size: 1 };
  }
};

// pen is what marks are drawn with, the same in the screenshots, the
// image editor and the collages: a color, and a size as an index of
// sizes.
export const pen = markPrefs();

// setPen changes the pen and keeps it for next time; a color of one's own
// is kept for this time only.
export function setPen(p: Partial<typeof pen>) {
  Object.assign(pen, p);
  try {
    const kept = JSON.parse(localStorage.getItem("shot-mark") || "{}");
    localStorage.setItem("shot-mark", JSON.stringify({ ...kept, size: pen.size, ...(colors.includes(pen.color) ? { color: pen.color } : {}) }));
  } catch {}
}

// newMark starts a mark of a tool, but text, where the pointer went down,
// with the pen; size is the tool's in the marks' units.
export function newMark(tool: Exclude<Tool, "text">, p: Pt, size: number): Mark {
  return tool === "pen" || tool === "mosaic" ? { kind: tool, pts: [p], color: pen.color, size } : { kind: tool, a: p, b: p, color: pen.color, size };
}

// dragMark follows the pointer with a mark being drawn: a stroke gets a
// point once the pointer went step further; a shape's corner follows it,
// with Shift a square, a circle, or an arrow at 45° steps.
export function dragMark(m: Mark, p: Pt, shift: boolean, step: number) {
  if ("pts" in m) {
    const last = m.pts[m.pts.length - 1]!;
    if (Math.hypot(p.x - last.x, p.y - last.y) >= step) m.pts.push({ x: p.x, y: p.y });
  } else if ("a" in m) {
    let b = { x: p.x, y: p.y };
    if (shift && m.kind !== "arrow") {
      const d = Math.max(Math.abs(p.x - m.a.x), Math.abs(p.y - m.a.y));
      b = { x: m.a.x + Math.sign(p.x - m.a.x) * d, y: m.a.y + Math.sign(p.y - m.a.y) * d };
    } else if (shift) {
      const ang = Math.round(Math.atan2(p.y - m.a.y, p.x - m.a.x) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(p.x - m.a.x, p.y - m.a.y);
      b = { x: m.a.x + len * Math.cos(ang), y: m.a.y + len * Math.sin(ang) };
    }
    m.b = b;
  }
}

// slip is whether a shape is too small to be meant: under min on both
// sides. Strokes and text always count.
export const slip = (m: Mark, min: number) => "a" in m && Math.abs(m.b.x - m.a.x) < min && Math.abs(m.b.y - m.a.y) < min;

// textBox is the box a text mark is typed in, over the picture, in a
// parent: Esc or Ctrl+Enter ends it (done), Enter starts a new line, and
// a click in it stays in it. It grows with its text (field-sizing).
export function textBox(parent: HTMLElement, className: string, done: () => void, value = "") {
  const el = document.createElement("textarea");
  el.className = className;
  el.spellcheck = false;
  el.rows = 1;
  el.value = value;
  parent.append(el);
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || (e.key === "Enter" && e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      done();
    }
  });
  setTimeout(() => el.focus());
  return el;
}

// styleTextBox puts a text box at a place of its parent, in a color and
// a size in the parent's pixels.
export function styleTextBox(el: HTMLTextAreaElement, x: number, y: number, color: string, size: number) {
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, color, font: textFont(size), lineHeight: String(textLine) });
}

// paintMarks draws marks on a canvas whose pixel (0, 0) is the marks'
// point (ox, oy) / k, only within clip. Mosaic goes under the rest: it
// shows the picture's own pixels, made coarse, from a canvas with
// mosaicScale of its pixels to a point (the screenshot's k; the image
// editor's 1, as its marks are in the picture's pixels).
export function paintMarks(ctx: CanvasRenderingContext2D, marks: Mark[], k: number, ox: number, oy: number, clip: Rect, mosaic: () => HTMLCanvasElement, mosaicScale = k) {
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
    m.globalCompositeOperation = "source-in";
    m.imageSmoothingEnabled = false;
    const src = mosaic();
    m.drawImage(src, 0, 0, src.width / mosaicScale, src.height / mosaicScale);
    m.setTransform(1, 0, 0, 1, 0, 0);
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

