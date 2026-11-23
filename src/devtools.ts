// The developer's small tools: JSON (as a folding tree), timestamps, a
// calculator, QR codes (made, or read from a picture or the screen), UUIDs
// and passwords, running HTML, and the price of gold.
import { onFileDrop } from "mygo-runtime";
import { icons } from "./icons";
import { calc, calcFunctions, show as showNum, tidy } from "./calc";
import { Dev, Notes, events, type DevQRResult, type GoldChart, type GoldQuotes } from "./mygo";
import { ago } from "./services";
import { errorText, esc, onLeave, showError, toast } from "./ui";

type Tab = "json" | "time" | "calc" | "qr" | "gen" | "html" | "gold";
const tabs: [Tab, string][] = [
  ["json", "JSON"],
  ["time", "时间戳"],
  ["calc", "计算器"],
  ["qr", "二维码"],
  ["gen", "UUID / 密码"],
  ["html", "HTML 运行"],
  ["gold", "金价"],
];
const tabKey = "dev-tab";

function loadTab(): Tab {
  try {
    const t = localStorage.getItem(tabKey) as Tab;
    if (tabs.some(([id]) => id === t)) return t;
  } catch {}
  return "json";
}

let tab: Tab = loadTab();
// What the page holds while it shows another tool, so that coming back
// finds it as it was.
const kept: Record<string, string> = {};

function copy(text: string, what = "已复制") {
  void navigator.clipboard.writeText(text).then(() => toast(what), showError);
}

export const devTool = {
  id: "dev",
  name: "开发工具",
  icon: icons.dev,
  render(p: HTMLElement) {
    p.innerHTML = `
      <div class="sv-top"><h1>开发工具</h1></div>
      <div class="s-seg dv-tabs">${tabs.map(([id, name]) => `<button data-tab="${id}">${name}</button>`).join("")}</div>
      <div class="dv-body"></div>`;
    const body = p.querySelector<HTMLElement>(".dv-body")!;
    let leaveTab: (() => void)[] = [];
    const show = (t: Tab) => {
      tab = t;
      try {
        localStorage.setItem(tabKey, t);
      } catch {}
      p.querySelectorAll<HTMLElement>(".dv-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
      for (const fn of leaveTab.splice(0)) fn();
      const off = (fn: () => void) => leaveTab.push(fn);
      ({ json: renderJSON, time: renderTime, calc: renderCalc, qr: renderQR, gen: renderGen, html: renderHTML, gold: renderGold })[t](body, off);
    };
    p.querySelectorAll<HTMLElement>(".dv-tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab as Tab)));
    onLeave(() => {
      for (const fn of leaveTab.splice(0)) fn();
    });
    // A QR code cut out of the screen opens the QR tab with what it says.
    const found = (r: DevQRResult | null) => {
      if (!r) return;
      kept.qrFound = JSON.stringify(r);
      if (tab !== "qr") show("qr");
      else showFound(body, r);
    };
    onLeave(events.devQRFound.on(() => void Dev.takeQR().then(found)));
    show(tab);
    void Dev.takeQR().then(found);
  },
};

// area binds a textarea to kept[key].
function area(box: HTMLElement, sel: string, key: string) {
  const el = box.querySelector<HTMLTextAreaElement>(sel)!;
  el.value = kept[key] ?? "";
  el.addEventListener("input", () => (kept[key] = el.value));
  return el;
}

// ---- JSON ----

// The result shows as a tree, whose objects and arrays fold, or as text.
const viewKey = "dev-json-view";
let jsonView: "tree" | "text" = (() => {
  try {
    return localStorage.getItem(viewKey) === "text" ? "text" : "tree";
  } catch {
    return "tree";
  }
})();

const isBox = (v: unknown): v is Record<string, unknown> | unknown[] => !!v && typeof v === "object";

// count counts a value's nodes, up to a cap.
function count(v: unknown, cap = 5000): number {
  let n = 0;
  const walk = (x: unknown) => {
    if (++n > cap) return;
    if (isBox(x)) for (const c of Object.values(x)) walk(c);
  };
  walk(v);
  return n;
}

// pathOf is a member's path, as $.a.b[0] or $["a b"].
function pathOf(parent: string, key: string | number) {
  if (typeof key === "number") return `${parent}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

// JSONTree draws a value as a tree. Objects and arrays deeper than open
// levels start folded, their members drawn when first unfolded.
class JSONTree {
  private values: unknown[] = [];
  constructor(private el: HTMLElement) {
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const k = t.closest<HTMLElement>(".jt-k, .jt-ix");
      if (k) return copy(k.dataset.path!, `已复制路径 ${k.dataset.path}`);
      if (!t.closest(".jt-tg, .jt-o, .jt-sum")) return;
      const n = t.closest<HTMLElement>(".jt-n");
      // Alt or Shift unfolds all that is inside.
      if (n) this.toggle(n, e.altKey || e.shiftKey);
    });
  }

  show(v: unknown, open: number) {
    this.values = [];
    this.el.innerHTML = `<div class="jt">${this.node(v, null, "$", 0, open, true)}</div>`;
  }

  private node(v: unknown, key: string | number | null, path: string, depth: number, open: number, last: boolean): string {
    const comma = last ? "" : `<span class="jt-punct">,</span>`;
    const label =
      key === null
        ? ""
        : typeof key === "number"
          ? `<span class="jt-ix" data-path="${esc(path)}" title="点击复制路径">${key}</span><span class="jt-punct">: </span>`
          : `<span class="jt-k" data-path="${esc(path)}" title="点击复制路径">${esc(JSON.stringify(key))}</span><span class="jt-punct">: </span>`;
    if (!isBox(v) || !Object.keys(v).length) {
      return `<div class="jt-l"><span class="jt-tg"></span>${label}${leaf(v)}${comma}</div>`;
    }
    const arr = Array.isArray(v);
    const [o, c] = arr ? ["[", "]"] : ["{", "}"];
    const n = Object.keys(v).length;
    const id = this.values.push(v) - 1;
    const isOpen = depth < open;
    return `<div class="jt-n${isOpen ? "" : " fold"}" data-i="${id}" data-p="${esc(path)}" data-d="${depth}">
      <div class="jt-l"><span class="jt-tg"></span>${label}<span class="jt-o">${o}</span><span class="jt-sum">…<small>${n} ${arr ? "项" : "个键"}</small>${c}</span>${comma ? `<span class="jt-sumc">${comma}</span>` : ""}</div>
      <div class="jt-c">${isOpen ? this.children(v, path, depth, open) : ""}</div>
      <div class="jt-l jt-end"><span class="jt-tg"></span><span class="jt-o">${c}</span>${comma}</div>
    </div>`;
  }

  private children(v: Record<string, unknown> | unknown[], path: string, depth: number, open: number) {
    const entries: [string | number, unknown][] = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
    return entries.map(([k, x], i) => this.node(x, k, pathOf(path, k), depth + 1, open, i === entries.length - 1)).join("");
  }

  private toggle(n: HTMLElement, deep: boolean) {
    const c = n.querySelector<HTMLElement>(":scope > .jt-c")!;
    const fold = !n.classList.contains("fold") && !deep;
    if (!fold && (!c.childElementCount || deep)) {
      const v = this.values[Number(n.dataset.i)] as Record<string, unknown> | unknown[];
      const depth = Number(n.dataset.d);
      c.innerHTML = this.children(v, n.dataset.p!, depth, deep ? Infinity : depth + 1);
    }
    n.classList.toggle("fold", fold);
  }
}

function leaf(v: unknown) {
  if (v === null) return `<span class="jt-null">null</span>`;
  if (Array.isArray(v)) return `<span class="jt-o">[]</span>`;
  switch (typeof v) {
    case "string":
      return `<span class="jt-s">${esc(JSON.stringify(v))}</span>`;
    case "number":
      return `<span class="jt-num">${v}</span>`;
    case "boolean":
      return `<span class="jt-bool">${v}</span>`;
    default:
      return `<span class="jt-o">{}</span>`;
  }
}

function renderJSON(box: HTMLElement) {
  box.innerHTML = `
    <div class="dv-two">
      <div class="dv-col"><div class="dv-bar"><b>输入</b><span class="l-spacer"></span><button data-do="paste">粘贴</button><button data-do="clear">清空</button></div><textarea class="dv-text dv-in" spellcheck="false" placeholder='粘贴或输入 JSON，如 {"a":1,"b":[1,2]}'></textarea></div>
      <div class="dv-col">
        <div class="dv-bar"><b>结果</b><span class="s-seg dv-view"><button data-view="tree">树形</button><button data-view="text">文本</button></span><span class="dv-msg"></span><span class="l-spacer"></span><button data-do="copy">复制</button><button data-do="use">用作输入</button></div>
        <div class="dv-text dv-tree" hidden>
          <div class="jt-bar"><span class="muted">展开到</span><button data-level="1">1 层</button><button data-level="2">2 层</button><button data-level="3">3 层</button><button data-level="all">全部展开</button><button data-level="0">全部折叠</button><span class="l-spacer"></span><span class="muted jt-hint">点 ▸ 折叠/展开，Alt+点击展开整支，点键名复制路径</span></div>
          <div class="jt-box"></div>
        </div>
        <textarea class="dv-text dv-out" spellcheck="false" readonly></textarea>
      </div>
    </div>
    <div class="dv-acts">
      <button class="primary" data-do="format">格式化</button>
      <button data-do="minify">压缩</button>
      <button data-do="sort">键排序</button>
      <button data-do="escape">转成字符串</button>
      <button data-do="unescape">字符串还原</button>
      <label class="dv-opt">缩进<select class="dv-indent"><option value="2">2 空格</option><option value="4">4 空格</option><option value="tab">Tab</option></select></label>
    </div>`;
  const input = area(box, ".dv-in", "json");
  const out = box.querySelector<HTMLTextAreaElement>(".dv-out")!;
  const treeEl = box.querySelector<HTMLElement>(".dv-tree")!;
  const tree = new JSONTree(treeEl.querySelector<HTMLElement>(".jt-box")!);
  const msg = box.querySelector<HTMLElement>(".dv-msg")!;
  // The value the tree shows; undefined when the result is only text, as a
  // string made of JSON.
  let value: unknown;
  let last = "format";
  const indent = () => {
    const v = box.querySelector<HTMLSelectElement>(".dv-indent")!.value;
    return v === "tab" ? "\t" : Number(v);
  };
  const setView = () => {
    const tv = jsonView === "tree" && value !== undefined;
    treeEl.hidden = !tv;
    out.hidden = tv;
    box.querySelectorAll<HTMLElement>(".dv-view button").forEach((b) => {
      b.classList.toggle("on", b.dataset.view === (tv ? "tree" : "text"));
      b.toggleAttribute("disabled", b.dataset.view === "tree" && value === undefined && !!out.value);
    });
  };
  const drawTree = (open?: number) => {
    if (value === undefined) return;
    tree.show(value, open ?? (count(value, 400) <= 400 ? Infinity : 2));
  };
  const sortKeys = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) : v;
  const parse = () => {
    const text = input.value.trim();
    if (!text) throw new Error("没有输入");
    try {
      return JSON.parse(text);
    } catch (e) {
      // "… at position 12": where, as line and column.
      const m = errorText(e).match(/position (\d+)/);
      if (m) {
        const before = text.slice(0, Number(m[1]));
        const line = before.split("\n").length;
        const col = before.length - before.lastIndexOf("\n");
        throw new Error(`JSON 有错：第 ${line} 行第 ${col} 列附近（${errorText(e)}）`);
      }
      throw new Error("JSON 有错：" + errorText(e));
    }
  };
  const run = (what: string) => {
    try {
      let r: string;
      let v: unknown;
      switch (what) {
        case "format":
          v = parse();
          r = JSON.stringify(v, null, indent());
          break;
        case "minify":
          v = parse();
          r = JSON.stringify(v);
          break;
        case "sort":
          v = sortKeys(parse());
          r = JSON.stringify(v, null, indent());
          break;
        case "escape":
          r = JSON.stringify(input.value);
          break;
        case "unescape": {
          const s = JSON.parse(input.value.trim());
          if (typeof s !== "string") throw new Error("输入不是 JSON 字符串（要带引号，如 \"{\\\"a\\\":1}\"）");
          r = s;
          break;
        }
        default:
          return;
      }
      last = what;
      value = v;
      out.value = r;
      msg.className = "dv-msg dv-ok";
      msg.textContent = `✓ ${r.length.toLocaleString()} 字符`;
      // Minified, it is wanted as text.
      if (what === "minify") jsonView = "text";
      drawTree();
    } catch (e) {
      value = undefined;
      out.value = "";
      msg.className = "dv-msg dv-bad";
      msg.textContent = errorText(e);
      msg.title = errorText(e);
    }
    setView();
  };
  box.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const view = t.closest<HTMLElement>("[data-view]")?.dataset.view;
    if (view) {
      jsonView = view as "tree" | "text";
      try {
        localStorage.setItem(viewKey, jsonView);
      } catch {}
      return setView();
    }
    const level = t.closest<HTMLElement>("[data-level]")?.dataset.level;
    if (level) return drawTree(level === "all" ? Infinity : Number(level));
    const what = t.closest<HTMLElement>("[data-do]")?.dataset.do;
    if (!what) return;
    if (what === "paste") void navigator.clipboard.readText().then((s) => ((input.value = kept.json = s), run("format")), showError);
    else if (what === "clear") {
      input.value = kept.json = out.value = msg.textContent = "";
      value = undefined;
      setView();
    } else if (what === "copy") out.value && copy(out.value);
    else if (what === "use") out.value && ((input.value = kept.json = out.value), run("format"));
    else run(what);
  });
  // Typed or pasted, it is worked out again at once.
  let timer = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (!input.value.trim()) {
        out.value = msg.textContent = "";
        value = undefined;
        return setView();
      }
      run(last === "escape" || last === "unescape" ? "format" : last);
    }, 300);
  });
  box.querySelector(".dv-indent")!.addEventListener("change", () => input.value.trim() && run(last));
  if (input.value) run("format");
  else setView();
}

// ---- Timestamps ----

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function renderTime(box: HTMLElement, off: (fn: () => void) => void) {
  box.innerHTML = `
    <div class="s-card dv-now">
      <div class="s-row"><span>现在（秒）</span><b class="dv-now-s"></b><button data-copy-now="s">复制</button></div>
      <div class="s-row"><span>现在（毫秒）</span><b class="dv-now-ms"></b><button data-copy-now="ms">复制</button></div>
      <div class="s-row"><span>本地时间</span><b class="dv-now-l"></b><button data-copy-now="l">复制</button></div>
    </div>
    <div class="dv-time-in"><input class="l-search dv-ts" placeholder="时间戳（秒或毫秒，自动判断）或日期，如 2026-11-15 08:30" spellcheck="false" /><input type="datetime-local" step="1" class="dv-pick" title="选择日期和时间" /><button data-do="now">现在</button></div>
    <div class="s-card dv-conv"></div>`;
  const nowRow = () => {
    const d = new Date();
    box.querySelector(".dv-now-s")!.textContent = String(Math.floor(d.getTime() / 1000));
    box.querySelector(".dv-now-ms")!.textContent = String(d.getTime());
    box.querySelector(".dv-now-l")!.textContent = local(d);
  };
  nowRow();
  const t = setInterval(nowRow, 1000);
  off(() => clearInterval(t));
  const input = box.querySelector<HTMLInputElement>(".dv-ts")!;
  input.value = kept.time ?? "";
  const conv = box.querySelector<HTMLElement>(".dv-conv")!;
  const pick = box.querySelector<HTMLInputElement>(".dv-pick")!;
  // Picked, the time goes in the box as text.
  pick.addEventListener("input", () => {
    if (!pick.value) return;
    input.value = pick.value.replace("T", " ") + (pick.value.length === 16 ? ":00" : "");
    render();
  });
  const render = () => {
    kept.time = input.value;
    const s = input.value.trim();
    if (!s) {
      pick.value = "";
      conv.innerHTML = `<div class="s-row muted">输入时间戳或日期，或在右边选一个时间，这里列出各种格式</div>`;
      return;
    }
    let d: Date;
    let note = "";
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      // 13 digits are milliseconds, 16 microseconds, 19 nanoseconds.
      const digits = s.replace(/^-|\..*$/g, "").length;
      const ms = digits >= 18 ? n / 1e6 : digits >= 15 ? n / 1e3 : digits >= 12 ? n : n * 1000;
      note = digits >= 18 ? "按纳秒" : digits >= 15 ? "按微秒" : digits >= 12 ? "按毫秒" : "按秒";
      d = new Date(ms);
    } else {
      d = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(s) ? s.replace(" ", "T") : s);
    }
    if (isNaN(d.getTime())) {
      conv.innerHTML = `<div class="s-row s-bad">认不出这个时间</div>`;
      return;
    }
    if (document.activeElement !== pick && d.getFullYear() >= 1 && d.getFullYear() <= 9999) pick.value = local(d).replace(" ", "T");
    const rows: [string, string][] = [
      ["本地时间", local(d)],
      ["秒", String(Math.floor(d.getTime() / 1000))],
      ["毫秒", String(d.getTime())],
      ["ISO 8601（UTC）", d.toISOString()],
      ["RFC 1123", d.toUTCString()],
      ["星期", "日一二三四五六"[d.getDay()] ? `星期${"日一二三四五六"[d.getDay()]}` : ""],
      ["距现在", Math.abs(Date.now() - d.getTime()) < 1000 ? "现在" : d.getTime() > Date.now() ? relFuture(d.getTime()) : ago(d.getTime())],
    ];
    conv.innerHTML =
      (note ? `<div class="s-row muted">${note}</div>` : "") +
      rows.map(([k, v]) => `<div class="s-row"><span>${k}</span><b>${esc(v)}</b><button data-copy="${esc(v)}">复制</button></div>`).join("");
  };
  input.addEventListener("input", render);
  box.addEventListener("click", (e) => {
    const b = e.target as HTMLElement;
    if (b.closest('[data-do="now"]')) {
      input.value = local(new Date());
      render();
    }
    const now = b.closest<HTMLElement>("[data-copy-now]")?.dataset.copyNow;
    if (now) copy(box.querySelector(`.dv-now-${now}`)!.textContent!);
    const c = b.closest<HTMLElement>("[data-copy]");
    if (c) copy(c.dataset.copy!);
  });
  render();
  input.focus();
}

function relFuture(ms: number) {
  const s = (ms - Date.now()) / 1000;
  if (s < 3600) return `${Math.ceil(s / 60)} 分钟后`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时后`;
  return `${Math.floor(s / 86400)} 天后`;
}

// ---- Calculator ----

const histKey = "dev-calc-hist";
const degKey = "dev-calc-deg";

type Calc = { e: string; r: string };

function loadHist(): Calc[] {
  try {
    const h = JSON.parse(localStorage.getItem(histKey) ?? "[]");
    return Array.isArray(h) ? h.slice(0, 50) : [];
  } catch {
    return [];
  }
}

// The keypad: what a key shows, and what it types.
const keys: [string, string, string?][] = [
  ["C", "clear", "fn"],
  ["(", "("],
  [")", ")"],
  ["%", "%"],
  ["⌫", "back", "fn"],
  ["sin", "sin(", "sci"],
  ["cos", "cos(", "sci"],
  ["tan", "tan(", "sci"],
  ["xʸ", "^", "sci"],
  ["√", "sqrt(", "sci"],
  ["7", "7"],
  ["8", "8"],
  ["9", "9"],
  ["÷", "÷", "op"],
  ["π", "π", "sci"],
  ["4", "4"],
  ["5", "5"],
  ["6", "6"],
  ["×", "×", "op"],
  ["ln", "ln(", "sci"],
  ["1", "1"],
  ["2", "2"],
  ["3", "3"],
  ["−", "-", "op"],
  ["lg", "lg(", "sci"],
  ["0", "0"],
  [".", "."],
  ["Ans", "ans", "sci"],
  ["+", "+", "op"],
  ["=", "equals", "eq"],
];

// group puts thousands separators in a number as written by show.
function group(s: string) {
  if (s.includes("e")) return s;
  const [i, f] = s.split(".");
  return i!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
}

function renderCalc(box: HTMLElement) {
  let hist = loadHist();
  let deg = (() => {
    try {
      return localStorage.getItem(degKey) !== "rad";
    } catch {
      return true;
    }
  })();
  let ans = Number(hist[0]?.r ?? 0) || 0;
  box.innerHTML = `
    <div class="dv-calc">
      <div class="dv-calc-main">
        <div class="dv-calc-screen">
          <input class="dv-calc-in" spellcheck="false" autocomplete="off" placeholder="输入算式，如 (3+4)×2^3、15%×80、0xff+1" />
          <div class="dv-calc-r" title="点击复制">0</div>
          <div class="dv-calc-alt muted"></div>
        </div>
        <div class="dv-keys">${keys.map(([label, v, kind]) => `<button data-k="${esc(v)}" class="${kind ?? "num"}">${label}</button>`).join("")}</div>
        <div class="dv-bar dv-calc-opts"><span class="s-seg dv-deg"><button data-deg="1">角度</button><button data-deg="0">弧度</button></span><span class="l-spacer"></span><span class="muted dv-tip" title="${calcFunctions.join("、")}">回车计算，Esc 清空；还能用 mod、!、log(x, 底)、abs、round(x, 位数)、asin 等</span></div>
      </div>
      <div class="dv-calc-side">
        <div class="dv-bar"><b>历史</b><span class="l-spacer"></span><button data-do="clear-hist">清空</button></div>
        <div class="s-card dv-hist"></div>
      </div>
    </div>`;
  const input = box.querySelector<HTMLInputElement>(".dv-calc-in")!;
  const res = box.querySelector<HTMLElement>(".dv-calc-r")!;
  const alt = box.querySelector<HTMLElement>(".dv-calc-alt")!;
  const histEl = box.querySelector<HTMLElement>(".dv-hist")!;
  input.value = kept.calc ?? "";
  let result: number | null = null;
  const drawHist = () => {
    histEl.innerHTML = hist.length
      ? hist.map((h, i) => `<div class="s-row dv-h" data-h="${i}" title="点击放回算式"><span class="muted">${esc(h.e)} =</span><b>${esc(group(h.r))}</b></div>`).join("")
      : `<div class="s-row muted">按回车或 = 后算式记在这里</div>`;
  };
  const drawDeg = () => box.querySelectorAll<HTMLElement>(".dv-deg button").forEach((b) => b.classList.toggle("on", (b.dataset.deg === "1") === deg));
  // work works the input out as it is typed; a slip shows in place of the
  // result only once = is asked for.
  const work = (strict = false) => {
    kept.calc = input.value;
    const e = input.value.trim();
    res.classList.remove("bad");
    if (!e) {
      result = null;
      res.textContent = "0";
      alt.textContent = "";
      return;
    }
    try {
      result = tidy(calc(e, deg, ans));
      const s = showNum(result);
      res.textContent = group(s);
      const forms: string[] = [];
      if (Number.isSafeInteger(result) && result !== 0 && Math.abs(result) < 2 ** 53) {
        const sign = result < 0 ? "-" : "";
        const a = Math.abs(result);
        forms.push(`十六进制 ${sign}0x${a.toString(16).toUpperCase()}`, `二进制 ${sign}0b${a.toString(2)}`, `八进制 ${sign}0o${a.toString(8)}`);
      }
      alt.textContent = forms.join("  ·  ");
    } catch (err) {
      result = null;
      if (strict) {
        res.classList.add("bad");
        res.textContent = errorText(err);
        alt.textContent = "";
      } else alt.textContent = errorText(err);
    }
  };
  const equals = () => {
    work(true);
    if (result === null) return;
    const r = showNum(result);
    const e = input.value.trim();
    if (e !== r) {
      hist = [{ e, r }, ...hist.filter((h) => h.e !== e)].slice(0, 50);
      try {
        localStorage.setItem(histKey, JSON.stringify(hist));
      } catch {}
      drawHist();
    }
    ans = result;
    input.value = r;
    kept.calc = r;
    input.select();
  };
  // type puts text at the caret, in place of what is selected. A function
  // or ( wraps the selection; after =, with the result selected, a sign
  // goes on from it.
  const type = (t: string) => {
    let a = input.selectionStart ?? input.value.length;
    const b = input.selectionEnd ?? a;
    let text = t;
    if (t.endsWith("(") && a !== b) text = t + input.value.slice(a, b) + ")";
    else if (a === 0 && b === input.value.length && /^[-+×÷^%]$/.test(t)) a = b;
    input.value = input.value.slice(0, a) + text + input.value.slice(b);
    const at = a + text.length;
    input.setSelectionRange(at, at);
    work();
  };
  box.querySelector(".dv-keys")!.addEventListener("click", (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>("[data-k]")?.dataset.k;
    if (!k) return;
    input.focus();
    if (k === "clear") (input.value = ""), work();
    else if (k === "back") {
      const a = input.selectionStart ?? input.value.length;
      const b = input.selectionEnd ?? a;
      const x = a === b ? Math.max(0, a - 1) : a;
      input.value = input.value.slice(0, x) + input.value.slice(b);
      input.setSelectionRange(x, x);
      work();
    } else if (k === "equals") equals();
    else type(k);
  });
  input.addEventListener("input", () => work());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || (e.key === "=" && !e.shiftKey)) {
      e.preventDefault();
      equals();
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.value = "";
      work();
    }
  });
  res.addEventListener("click", () => result !== null && copy(showNum(result), `已复制 ${showNum(result)}`));
  histEl.addEventListener("click", (e) => {
    const h = hist[Number((e.target as HTMLElement).closest<HTMLElement>("[data-h]")?.dataset.h)];
    if (!h) return;
    input.value = h.e;
    input.focus();
    work();
  });
  box.querySelector('[data-do="clear-hist"]')!.addEventListener("click", () => {
    hist = [];
    try {
      localStorage.removeItem(histKey);
    } catch {}
    drawHist();
  });
  box.querySelector(".dv-deg")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-deg]");
    if (!b) return;
    deg = b.dataset.deg === "1";
    try {
      localStorage.setItem(degKey, deg ? "deg" : "rad");
    } catch {}
    drawDeg();
    work();
  });
  drawDeg();
  drawHist();
  work();
  input.focus();
}

// ---- QR codes ----

function renderQR(box: HTMLElement, off: (fn: () => void) => void) {
  box.innerHTML = `
    <div class="dv-two">
      <div class="dv-col">
        <div class="dv-bar"><b>生成</b><span class="l-spacer"></span><button data-do="paste">用剪贴板</button><select class="dv-size"><option value="256">256</option><option value="384" selected>384</option><option value="512">512</option><option value="768">768</option></select></div>
        <textarea class="dv-text dv-in dv-short" spellcheck="false" placeholder="网址或文字，如 https://cloudreve.haowu.fun/s/qLux"></textarea>
        <div class="dv-qr"><span class="muted">输入内容后在这里生成</span></div>
        <div class="dv-acts dv-qr-acts" hidden><button data-do="copy-img">复制图片</button><button data-do="save-img">保存…</button></div>
      </div>
      <div class="dv-col">
        <div class="dv-bar"><b>识别</b></div>
        <div class="dv-drop">
          <button class="primary" data-do="scan">截图识别</button>
          <p class="muted">框选屏幕上的二维码；也可以在这里 Ctrl+V 粘贴图片，或把图片文件拖进窗口</p>
        </div>
        <div class="s-card dv-found" hidden></div>
      </div>
    </div>`;
  const input = area(box, ".dv-in", "qr");
  const img = box.querySelector<HTMLElement>(".dv-qr")!;
  const size = box.querySelector<HTMLSelectElement>(".dv-size")!;
  let png = "";
  let timer = 0;
  const make = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const text = input.value;
      box.querySelector<HTMLElement>(".dv-qr-acts")!.hidden = !text;
      if (!text) {
        png = "";
        img.innerHTML = `<span class="muted">输入内容后在这里生成</span>`;
        return;
      }
      void Dev.qr(text, Number(size.value)).then(
        (b) => {
          png = b;
          img.innerHTML = `<img src="data:image/png;base64,${b}" alt="二维码" />`;
        },
        (e) => {
          png = "";
          img.innerHTML = `<span class="s-bad">${esc(errorText(e))}</span>`;
        },
      );
    }, 200);
  };
  input.addEventListener("input", make);
  size.addEventListener("change", make);
  const read = (p: Promise<DevQRResult>) => void p.then((r) => showFound(box, r), showError);
  box.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const what = t.closest<HTMLElement>("[data-do]")?.dataset.do;
    if (what === "paste") void navigator.clipboard.readText().then((s) => ((input.value = kept.qr = s), make()), showError);
    else if (what === "copy-img" && png) void Dev.copyImage(png).then(() => toast("已复制二维码图片"), showError);
    else if (what === "save-img" && png) void Dev.saveImage(png, "二维码").catch(showError);
    else if (what === "scan") void Dev.scanScreen();
    const c = t.closest<HTMLElement>("[data-copy]");
    if (c) copy(c.dataset.copy!);
    const o = t.closest<HTMLElement>("[data-open]");
    if (o) void Notes.openURL(o.dataset.open!).catch(showError);
  });
  // A picture pasted anywhere in the tab but the text box.
  const paste = (e: ClipboardEvent) => {
    if ((e.target as HTMLElement).closest?.("textarea, input")) return;
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    const r = new FileReader();
    r.onload = () => read(Dev.decodeQR(String(r.result).replace(/^data:[^,]*,/, "")));
    r.readAsDataURL(file);
  };
  document.addEventListener("paste", paste);
  off(() => document.removeEventListener("paste", paste));
  off(onFileDrop(({ paths }) => paths[0] && read(Dev.decodeQRFile(paths[0]))));
  make();
  if (kept.qrFound) showFound(box, JSON.parse(kept.qrFound));
}

function showFound(box: HTMLElement, r: DevQRResult) {
  kept.qrFound = JSON.stringify(r);
  const el = box.querySelector<HTMLElement>(".dv-found");
  if (!el) return;
  el.hidden = false;
  el.innerHTML = r.error
    ? `<div class="s-row s-bad">${esc(r.error)}</div>`
    : r.texts
        .map((t) => {
          const link = /^(https?:\/\/|mailto:)/i.test(t);
          return `<div class="s-row dv-qr-text"><span class="dv-qr-v">${esc(t)}</span><span class="dv-qr-b">${link ? `<button data-open="${esc(t)}">打开</button>` : ""}<button data-copy="${esc(t)}">复制</button></span></div>`;
        })
        .join("");
  if (!r.error && r.texts.length === 1) copy(r.texts[0]!, "已识别并复制");
}

// ---- UUIDs and passwords ----

function renderGen(box: HTMLElement) {
  box.innerHTML = `
    <div class="dv-bar"><b>UUID</b><span class="l-spacer"></span><label class="dv-opt">个数<input type="number" class="dv-n" min="1" max="1000" value="1" /></label><label class="dv-opt"><input type="checkbox" class="dv-upper" /> 大写</label><label class="dv-opt"><input type="checkbox" class="dv-nodash" /> 去掉横线</label><button data-do="uuid" class="primary">生成</button><button data-do="copy-uuid">复制</button></div>
    <textarea class="dv-text dv-short dv-uuid" readonly spellcheck="false"></textarea>
    <div class="dv-bar"><b>随机密码</b><span class="l-spacer"></span><label class="dv-opt">长度<input type="number" class="dv-len" min="4" max="128" value="20" /></label><label class="dv-opt"><input type="checkbox" class="dv-sym" checked /> 符号</label><label class="dv-opt"><input type="checkbox" class="dv-amb" checked /> 去掉易混字符</label><button data-do="pw" class="primary">生成</button><button data-do="copy-pw">复制</button></div>
    <input class="l-search dv-pw" readonly spellcheck="false" />
    <p class="muted dv-tip">都用浏览器的安全随机数（crypto）生成，不经过网络。</p>`;
  const q = <T extends HTMLElement>(s: string) => box.querySelector<T>(s)!;
  const uuid = () => {
    const n = Math.min(Math.max(Math.floor(Number(q<HTMLInputElement>(".dv-n").value)) || 1, 1), 1000);
    q<HTMLTextAreaElement>(".dv-uuid").value = Array.from({ length: n }, () => {
      let u: string = crypto.randomUUID();
      if (q<HTMLInputElement>(".dv-nodash").checked) u = u.replace(/-/g, "");
      return q<HTMLInputElement>(".dv-upper").checked ? u.toUpperCase() : u;
    }).join("\n");
  };
  const pw = () => {
    const len = Math.min(Math.max(Number(q<HTMLInputElement>(".dv-len").value) || 20, 4), 128);
    let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    if (q<HTMLInputElement>(".dv-sym").checked) chars += "!@#$%^&*-_=+?";
    if (q<HTMLInputElement>(".dv-amb").checked) chars = chars.replace(/[Il1O0o]/g, "");
    // Rejection keeps every character as likely as another.
    const out: string[] = [];
    const limit = 256 - (256 % chars.length);
    while (out.length < len) {
      for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) if (b < limit && out.length < len) out.push(chars[b % chars.length]!);
    }
    q<HTMLInputElement>(".dv-pw").value = out.join("");
  };
  box.addEventListener("click", (e) => {
    const what = (e.target as HTMLElement).closest<HTMLElement>("[data-do]")?.dataset.do;
    if (what === "uuid") uuid();
    else if (what === "pw") pw();
    else if (what === "copy-uuid") copy(q<HTMLTextAreaElement>(".dv-uuid").value);
    else if (what === "copy-pw") copy(q<HTMLInputElement>(".dv-pw").value);
  });
  box.querySelectorAll("input").forEach((el) => {
    if (el.readOnly) return;
    el.addEventListener(el.type === "number" ? "input" : "change", () => (el.closest(".dv-bar")!.querySelector('[data-do="pw"]') ? pw() : uuid()));
  });
  // A count kept between visits.
  const n = q<HTMLInputElement>(".dv-n");
  n.value = kept.uuidN ?? "1";
  n.addEventListener("input", () => (kept.uuidN = n.value));
  uuid();
  pw();
}

// ---- Running HTML ----

// An HTML page runs in a sandboxed frame, as a page Go serves
// (Dev.RunHTML): what it logs and throws shows in the console below it.
type Code = { html: string; auto: boolean };
const codeKey = "dev-html";
const sample = `<!doctype html>
<html>
<head>
<style>
  body {
    font-family: system-ui, "Microsoft YaHei", sans-serif;
    padding: 16px;
  }
  h1 {
    color: #4f7cff;
  }
</style>
</head>
<body>
<h1>你好</h1>
<button id="btn">点我</button>
<script>
  let n = 0;
  document.getElementById("btn").addEventListener("click", () => {
    n++;
    console.log("点了", n, "次", { n });
  });
</script>
</body>
</html>
`;

function loadCode(): Code {
  try {
    const c = JSON.parse(localStorage.getItem(codeKey) ?? "null");
    if (c && typeof c.html === "string") {
      // Kept from when CSS and JS had boxes of their own.
      let html = c.html;
      if (c.css?.trim()) html += `\n<style>\n${c.css}</style>\n`;
      if (c.js?.trim()) html += `\n<script>\n${c.js}</script>\n`;
      return { html, auto: c.auto !== false };
    }
  } catch {}
  return { html: sample, auto: true };
}

// bridge runs first in the frame: it sends console calls and uncaught
// errors to the tool. first is the page's line the box starts on.
const bridge = (first: number) => `(() => {
const show = (v) => {
  const seen = new WeakSet();
  const go = (v, d) => {
    if (typeof v === "string") return d ? JSON.stringify(v) : v;
    if (typeof v === "function") return "ƒ " + (v.name || "anonymous") + "()";
    if (typeof v === "bigint") return v + "n";
    if (typeof v === "symbol" || v === null || typeof v !== "object") return String(v);
    if (v instanceof Error) return v.stack || v.name + ": " + v.message;
    if (v instanceof Element) return "<" + v.tagName.toLowerCase() + (v.id ? "#" + v.id : "") + (v.className && typeof v.className === "string" ? "." + v.className.trim().split(/\\s+/).join(".") : "") + ">";
    if (seen.has(v)) return "[循环引用]";
    if (d > 3) return Array.isArray(v) ? "[…]" : "{…}";
    seen.add(v);
    if (Array.isArray(v)) return "[" + v.slice(0, 100).map((x) => go(x, d + 1)).join(", ") + (v.length > 100 ? ", …" : "") + "]";
    if (v instanceof Map) return "Map(" + v.size + ") {" + [...v].slice(0, 50).map(([k, x]) => go(k, d + 1) + " => " + go(x, d + 1)).join(", ") + "}";
    if (v instanceof Set) return "Set(" + v.size + ") {" + [...v].slice(0, 50).map((x) => go(x, d + 1)).join(", ") + "}";
    let keys;
    try { keys = Object.keys(v); } catch { return String(v); }
    const name = v.constructor && v.constructor !== Object && v.constructor.name ? v.constructor.name + " " : "";
    return name + "{" + keys.slice(0, 50).map((k) => (/^[A-Za-z_$][\\w$]*$/.test(k) ? k : JSON.stringify(k)) + ": " + go(v[k], d + 1)).join(", ") + (keys.length > 50 ? ", …" : "") + "}";
  };
  try { return go(v, 0); } catch (e) { return String(v); }
};
const post = (level, args) => { try { parent.postMessage({ devrun: 1, level, text: args.map(show).join(" ") }, "*"); } catch {} };
for (const level of ["log", "info", "warn", "error", "debug"]) {
  const orig = console[level];
  console[level] = (...a) => { post(level, a); orig.apply(console, a); };
}
const clear = console.clear;
console.clear = () => { post("clear", []); clear.call(console); };
addEventListener("error", (e) => {
  const at = e.filename === location.href && e.lineno >= ${first} ? "（第 " + (e.lineno - ${first} + 1) + " 行）" : "";
  post("error", [(e.error && e.error.stack && !at ? e.error.stack : e.message || "出错了") + at]);
});
addEventListener("unhandledrejection", (e) => post("error", ["未处理的 Promise 拒绝：", e.reason]));
})();`;

// withBridge puts the bridge before the page, which keeps its lines as
// they are in the box.
function withBridge(html: string) {
  const head = (first: number) => `<!doctype html><meta charset="utf-8"><script>${bridge(first)}</script>\n`;
  // The bridge's text is as many lines whatever the number in it.
  const first = head(0).split("\n").length;
  return head(first) + html.replace(/^(\s*)<!doctype[^>]*>/i, "$1");
}

function renderHTML(box: HTMLElement, off: (fn: () => void) => void) {
  box.innerHTML = `
    <div class="dv-two dv-run">
      <div class="dv-col">
        <div class="dv-bar"><b>HTML</b><span class="l-spacer"></span><label class="dv-opt" title="停止输入后自动运行"><input type="checkbox" class="dv-auto" /> 自动运行</label><button class="primary" data-do="run" title="Ctrl+Enter">运行</button></div>
        <textarea class="dv-text dv-code" spellcheck="false" placeholder="<h1>你好</h1>&#10;<script>console.log(1)</script>"></textarea>
        <div class="dv-acts"><button data-do="copy-code">复制</button><button data-do="sample">示例</button><button data-do="clear-code">清空</button><span class="muted dv-tip">Tab 缩进，Ctrl+Enter 运行；代码只在本机沙箱里运行，调不了工具箱</span></div>
      </div>
      <div class="dv-col">
        <div class="dv-bar"><b>预览</b><span class="l-spacer"></span><button data-do="run">刷新</button></div>
        <iframe class="dv-frame" sandbox="allow-scripts allow-modals allow-forms" referrerpolicy="no-referrer" title="预览"></iframe>
        <div class="dv-bar"><b>控制台</b><span class="dv-count muted"></span><span class="l-spacer"></span><button data-do="clear-log">清空</button></div>
        <div class="dv-log"></div>
      </div>
    </div>`;
  const q = <T extends HTMLElement>(s: string) => box.querySelector<T>(s)!;
  const code = loadCode();
  const el = q<HTMLTextAreaElement>(".dv-code");
  el.value = code.html;
  let frame = q<HTMLIFrameElement>(".dv-frame");
  const log = q<HTMLElement>(".dv-log");
  const auto = q<HTMLInputElement>(".dv-auto");
  auto.checked = code.auto;

  let saveTimer = 0;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = 0;
    try {
      localStorage.setItem(codeKey, JSON.stringify(code));
    } catch {}
  };

  // The console: what the frame logs, at most so many lines.
  let lines = 0;
  const count = () => (q<HTMLElement>(".dv-count").textContent = lines ? String(lines) : "");
  const clearLog = () => {
    log.innerHTML = `<div class="dv-log-empty muted">console.log 和报错会显示在这里</div>`;
    lines = 0;
    count();
  };
  const addLog = (level: string, text: string) => {
    if (level === "clear") return clearLog();
    if (!lines) log.innerHTML = "";
    const row = document.createElement("div");
    row.className = `dv-log-l ${level}`;
    row.textContent = text;
    log.append(row);
    if (++lines > 500) log.firstElementChild?.remove();
    count();
    log.scrollTop = log.scrollHeight;
  };
  const message = (e: MessageEvent) => {
    if (e.source !== frame.contentWindow || e.data?.devrun !== 1) return;
    addLog(String(e.data.level), String(e.data.text));
  };
  window.addEventListener("message", message);
  off(() => window.removeEventListener("message", message));

  let runTimer = 0;
  const run = () => {
    clearTimeout(runTimer);
    clearLog();
    void Dev.runHTML(withBridge(code.html)).then((url) => {
      // A new frame each time: WebView2 shows an error page for a sandboxed
      // frame sent from one devrun page to another.
      const f = frame.cloneNode() as HTMLIFrameElement;
      f.src = url;
      frame.replaceWith(f);
      frame = f;
    }, showError);
  };
  off(() => {
    clearTimeout(runTimer);
    if (saveTimer) save();
  });

  el.addEventListener("input", () => {
    code.html = el.value;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(save, 400);
    if (code.auto) {
      clearTimeout(runTimer);
      runTimer = window.setTimeout(run, 800);
    }
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      return run();
    }
    if (e.isComposing) return;
    const a = el.selectionStart;
    const lineStart = el.value.lastIndexOf("\n", a - 1) + 1;
    // insertText keeps Ctrl+Z working.
    if (e.key === "Tab" && !e.shiftKey && a === el.selectionEnd) {
      e.preventDefault();
      document.execCommand("insertText", false, "  ");
    } else if (e.key === "Enter" && !e.shiftKey) {
      // A new line as indented as the one it breaks, and one more after
      // an opening bracket.
      const indent = el.value.slice(lineStart, a).match(/^[ \t]*/)![0];
      const more = /[{[(]\s*$/.test(el.value.slice(lineStart, a)) ? "  " : "";
      if (!indent && !more) return;
      e.preventDefault();
      document.execCommand("insertText", false, "\n" + indent + more);
    }
  });

  box.addEventListener("click", (e) => {
    const what = (e.target as HTMLElement).closest<HTMLElement>("[data-do]")?.dataset.do;
    if (what === "run") run();
    else if (what === "clear-log") clearLog();
    else if (what === "copy-code") code.html && copy(code.html);
    else if (what === "sample" || what === "clear-code") {
      const was = code.html;
      const set = (html: string) => {
        el.value = code.html = html;
        save();
        run();
      };
      set(what === "sample" ? sample : "");
      toast(what === "sample" ? "已换成示例" : "已清空", { label: "撤销", run: () => set(was) });
    }
  });
  auto.addEventListener("change", () => {
    code.auto = auto.checked;
    save();
  });

  run();
}

// ---- Gold ----

// Prices from Sina finance (Dev.Gold), got again every 30 seconds while the
// tab shows, and London gold's chart over a span (Dev.GoldChart).
const ounce = 31.1034768; // grams
type Span = "day" | "month" | "quarter" | "year" | "5y";
const spans: [Span, string][] = [
  ["day", "今日"],
  ["month", "1 月"],
  ["quarter", "3 月"],
  ["year", "1 年"],
  ["5y", "5 年"],
];
const spanKey = "dev-gold-span";
const unitKey = "dev-gold-unit";
// The last prices, shown at once when the tab is opened again.
let lastGold: { q: GoldQuotes; at: number } | null = null;

function loadPref<T extends string>(key: string, ok: readonly T[], def: T): T {
  try {
    const v = localStorage.getItem(key) as T;
    if (ok.includes(v)) return v;
  } catch {}
  return def;
}

function savePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {}
}

const fix = (v: number, d = 2) => v.toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });
// Up is red and down green, as Chinese markets show it.
const trend = (d: number) => (d > 0 ? "dv-up" : d < 0 ? "dv-down" : "");
const signed = (v: number, d = 2) => (v > 0 ? "+" : "") + fix(v, d);

function renderGold(box: HTMLElement, off: (fn: () => void) => void) {
  box.innerHTML = `
    <div class="dv-bar"><b>实时金价</b><span class="muted dv-g-at"></span><span class="l-spacer"></span><span class="muted dv-g-fx"></span><button data-do="gold-refresh">刷新</button></div>
    <div class="dv-g-cards"></div>
    <div class="dv-bar dv-g-head"><b>伦敦金走势</b><span class="muted dv-g-range"></span><span class="l-spacer"></span>
      <div class="s-seg dv-g-unit"><button data-unit="usd">美元/盎司</button><button data-unit="cny">元/克</button></div>
      <div class="s-seg dv-g-spans">${spans.map(([id, name]) => `<button data-span="${id}">${name}</button>`).join("")}</div></div>
    <div class="dv-g-chart"><div class="muted dv-g-empty">正在加载…</div></div>
    <p class="muted dv-tip">行情来自新浪财经，国际金价有几秒到几十秒的延迟；国内金店的首饰价一般比上金所 Au99.99 高几十到一百多元/克。元/克走势按当前汇率折算。</p>`;
  const q = <T extends HTMLElement>(s: string) => box.querySelector<T>(s)!;
  const cards = q(".dv-g-cards");
  const chartEl = q(".dv-g-chart");
  let span = loadPref<Span>(spanKey, spans.map(([id]) => id), "day");
  let unit = loadPref(unitKey, ["usd", "cny"] as const, "cny");
  let chart: GoldChart | null = null;
  let gone = false;
  off(() => (gone = true));

  const rate = () => lastGold?.q.usdcny || 0;
  const showQuotes = () => {
    if (!lastGold) return;
    const { q: g, at } = lastGold;
    q(".dv-g-at").textContent = `· ${ago(at)}更新`;
    q(".dv-g-fx").textContent = g.usdcny ? `美元/人民币 ${g.usdcny.toFixed(4)}` : "";
    cards.innerHTML = g.quotes
      .map((x) => {
        const d = x.price - x.prev;
        const pct = x.prev ? (d / x.prev) * 100 : 0;
        const usd = x.unit.startsWith("美元");
        const gram = usd && g.usdcny ? `<div class="dv-g-sub muted">≈ ¥${fix((x.price * g.usdcny) / ounce)}/克</div>` : "";
        return `<div class="s-card dv-g-card">
          <div class="dv-g-name">${esc(x.name)}<span class="muted">${esc(x.unit)}</span></div>
          <div class="dv-g-price ${trend(d)}" title="点击复制">${fix(x.price, usd && x.price < 100 ? 3 : 2)}</div>
          <div class="dv-g-chg ${trend(d)}">${signed(d)}　${signed(pct)}%</div>${gram}
          <div class="dv-g-hl muted"><span>开 ${fix(x.open)}</span><span>高 ${fix(x.high)}</span><span>低 ${fix(x.low)}</span><span>昨收 ${fix(x.prev)}</span></div>
          <div class="dv-g-time muted">${esc(x.time.slice(5, 16))}</div>
        </div>`;
      })
      .join("");
  };
  const refresh = async (by = false) => {
    try {
      const g = await Dev.gold();
      if (gone) return;
      lastGold = { q: g, at: Date.now() };
      showQuotes();
      // The chart's last point moves with the price.
      if (span === "day" && chart) void loadChart();
      else drawChart();
    } catch (e) {
      if (gone) return;
      if (by) showError(e);
      q(".dv-g-at").innerHTML = `· <span class="dv-bad">${esc(errorText(e))}</span>`;
    }
  };

  // drawChart draws the chart as an SVG line stretched to the box, its
  // labels and the hover's readout laid over it in HTML.
  const drawChart = () => {
    if (!chart) return;
    if (unit === "cny" && !rate()) unit = "usd";
    const k = unit === "cny" ? rate() / ounce : 1;
    const pts = chart.points.map((p) => ({ t: p.t, v: p.v * k }));
    box.querySelectorAll<HTMLElement>(".dv-g-unit button").forEach((b) => b.classList.toggle("on", b.dataset.unit === unit));
    if (pts.length < 2) {
      chartEl.innerHTML = `<div class="muted dv-g-empty">${span === "day" ? "今天还没开盘" : "没有数据"}</div>`;
      q(".dv-g-range").textContent = "";
      return;
    }
    const base = span === "day" && chart.prev ? chart.prev * k : pts[0]!.v;
    const last = pts[pts.length - 1]!.v;
    const vs = pts.map((p) => p.v).concat(span === "day" && chart.prev ? [base] : []);
    let lo = Math.min(...vs);
    let hi = Math.max(...vs);
    const padY = (hi - lo) * 0.08 || 1;
    lo -= padY;
    hi += padY;
    const W = 1000;
    const H = 240;
    const x = (i: number) => (i / (pts.length - 1)) * W;
    const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
    const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
    const cls = trend(last - base) || "dv-flat";
    const d = last - base;
    q(".dv-g-range").textContent = `${pts[0]!.t} – ${pts[pts.length - 1]!.t}　${signed(d)}（${signed((d / base) * 100)}%）`;
    const maxI = pts.findIndex((p) => p.v === Math.max(...pts.map((p) => p.v)));
    const minI = pts.findIndex((p) => p.v === Math.min(...pts.map((p) => p.v)));
    const mark = (i: number, label: string, below: boolean) =>
      `<span class="dv-g-mark" style="left:${(x(i) / W) * 100}%;top:${(y(pts[i]!.v) / H) * 100}%;transform:translate(${i > pts.length / 2 ? "-100%" : "0"},${below ? "4px" : "calc(-100% - 4px)"})">${label} ${fix(pts[i]!.v)}</span>`;
    chartEl.innerHTML = `
      <svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <polygon class="dv-g-area" points="0,${H} ${line} ${W},${H}" />
        ${span === "day" && chart.prev ? `<line class="dv-g-base" x1="0" x2="${W}" y1="${y(base)}" y2="${y(base)}" />` : ""}
        <polyline class="dv-g-line" points="${line}" />
        <line class="dv-g-cursor" x1="0" x2="0" y1="0" y2="${H}" />
      </svg>
      ${mark(maxI, "高", false)}${mark(minI, "低", true)}
      <span class="dv-g-axis dv-g-hi">${fix(hi)}</span><span class="dv-g-axis dv-g-lo">${fix(lo)}</span>
      <div class="dv-g-tip"></div>`;
    const svg = chartEl.querySelector("svg")!;
    const cursor = chartEl.querySelector<SVGLineElement>(".dv-g-cursor")!;
    const tip = chartEl.querySelector<HTMLElement>(".dv-g-tip")!;
    svg.addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect();
      const i = Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1));
      const p = pts[Math.min(Math.max(i, 0), pts.length - 1)]!;
      const at = x(pts.indexOf(p));
      cursor.setAttribute("x1", String(at));
      cursor.setAttribute("x2", String(at));
      cursor.style.display = "block";
      const dd = p.v - base;
      tip.innerHTML = `${esc(p.t)}　<b>${fix(p.v)}</b>　<span class="${trend(dd)}">${signed(dd)}（${signed((dd / base) * 100)}%）</span>`;
      tip.style.display = "block";
      tip.style.left = `${(at / W) * 100}%`;
      tip.style.transform = `translateX(${at > W / 2 ? "calc(-100% - 8px)" : "8px"})`;
    });
    svg.addEventListener("mouseleave", () => {
      cursor.style.display = tip.style.display = "none";
    });
  };
  let loading = 0;
  const loadChart = async () => {
    const n = ++loading;
    box.querySelectorAll<HTMLElement>(".dv-g-spans button").forEach((b) => b.classList.toggle("on", b.dataset.span === span));
    try {
      const c = await Dev.goldChart(span);
      if (gone || n !== loading) return;
      chart = c;
      // Today's last minute may lag the quote: the price now ends it.
      const now = lastGold?.q.quotes.find((x) => x.code === "hf_XAU");
      if (span === "day" && now && chart.points.length) chart.points[chart.points.length - 1]!.v = now.price;
      drawChart();
    } catch (e) {
      if (gone || n !== loading) return;
      chartEl.innerHTML = `<div class="dv-g-empty dv-bad">${esc(errorText(e))}</div>`;
    }
  };

  cards.addEventListener("click", (e) => {
    const p = (e.target as HTMLElement).closest(".dv-g-price");
    if (p) copy(p.textContent!.replace(/,/g, ""), `已复制 ${p.textContent}`);
  });
  box.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-do], [data-span], [data-unit]");
    if (!t) return;
    if (t.dataset.do === "gold-refresh") void refresh(true).then(() => {
        if (span !== "day") void loadChart();
      });
    else if (t.dataset.span) {
      span = t.dataset.span as Span;
      savePref(spanKey, span);
      void loadChart();
    } else if (t.dataset.unit) {
      unit = t.dataset.unit as typeof unit;
      savePref(unitKey, unit);
      drawChart();
    }
  });

  showQuotes();
  void refresh().then(loadChart);
  // Not while the window is hidden in the tray.
  const timer = setInterval(() => !document.hidden && void refresh(), 30_000);
  off(() => clearInterval(timer));
}
