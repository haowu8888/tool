// The developer's small tools: JSON, encodings, timestamps, digests, QR
// codes (made, or read from a picture or the screen), UUIDs and passwords.
import { onFileDrop } from "mygo-runtime";
import { icons } from "./icons";
import { Dev, Notes, events, type DevHashes, type DevQRResult } from "./mygo";
import { ago } from "./services";
import { errorText, esc, onLeave, showError, toast } from "./ui";

type Tab = "json" | "codec" | "time" | "hash" | "qr" | "gen";
const tabs: [Tab, string][] = [
  ["json", "JSON"],
  ["codec", "编码转换"],
  ["time", "时间戳"],
  ["hash", "哈希"],
  ["qr", "二维码"],
  ["gen", "UUID / 密码"],
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
      ({ json: renderJSON, codec: renderCodec, time: renderTime, hash: renderHash, qr: renderQR, gen: renderGen })[t](body, off);
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

function renderJSON(box: HTMLElement) {
  box.innerHTML = `
    <div class="dv-two">
      <div class="dv-col"><div class="dv-bar"><b>输入</b><span class="l-spacer"></span><button data-do="paste">粘贴</button><button data-do="clear">清空</button></div><textarea class="dv-text dv-in" spellcheck="false" placeholder='粘贴 JSON，如 {"a":1,"b":[1,2]}'></textarea></div>
      <div class="dv-col"><div class="dv-bar"><b>结果</b><span class="dv-msg"></span><span class="l-spacer"></span><button data-do="copy">复制</button><button data-do="use">用作输入</button></div><textarea class="dv-text dv-out" spellcheck="false" readonly></textarea></div>
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
  const msg = box.querySelector<HTMLElement>(".dv-msg")!;
  const indent = () => {
    const v = box.querySelector<HTMLSelectElement>(".dv-indent")!.value;
    return v === "tab" ? "\t" : Number(v);
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
      switch (what) {
        case "format":
          r = JSON.stringify(parse(), null, indent());
          break;
        case "minify":
          r = JSON.stringify(parse());
          break;
        case "sort":
          r = JSON.stringify(sortKeys(parse()), null, indent());
          break;
        case "escape":
          r = JSON.stringify(input.value);
          break;
        case "unescape": {
          const v = JSON.parse(input.value.trim());
          if (typeof v !== "string") throw new Error("输入不是 JSON 字符串（要带引号，如 \"{\\\"a\\\":1}\"）");
          r = v;
          break;
        }
        default:
          return;
      }
      out.value = r;
      msg.className = "dv-msg dv-ok";
      msg.textContent = `✓ ${r.length.toLocaleString()} 字符`;
    } catch (e) {
      out.value = "";
      msg.className = "dv-msg dv-bad";
      msg.textContent = errorText(e);
    }
  };
  box.addEventListener("click", (e) => {
    const what = (e.target as HTMLElement).closest<HTMLElement>("[data-do]")?.dataset.do;
    if (!what) return;
    if (what === "paste") void navigator.clipboard.readText().then((t) => ((input.value = kept.json = t), run("format")), showError);
    else if (what === "clear") (input.value = kept.json = ""), (out.value = ""), (msg.textContent = "");
    else if (what === "copy") out.value && copy(out.value);
    else if (what === "use") out.value && ((input.value = kept.json = out.value), (out.value = ""), (msg.textContent = ""));
    else run(what);
  });
  // Pasted, it is formatted at once.
  input.addEventListener("paste", () => setTimeout(() => run("format")));
  if (input.value) run("format");
}

// ---- Encodings ----

const utf8 = { enc: new TextEncoder(), dec: new TextDecoder("utf-8", { fatal: true }) };

const codecs: Record<string, [string, (s: string) => string, (s: string) => string]> = {
  base64: [
    "Base64",
    (s) => {
      // In pieces: a long text spread at once overflows the stack.
      const b = utf8.enc.encode(s);
      let bin = "";
      for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    (s) => {
      const t = s.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
      return utf8.dec.decode(Uint8Array.from(atob(t + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0)));
    },
  ],
  url: ["URL", (s) => encodeURIComponent(s), (s) => decodeURIComponent(s.replace(/\+/g, " "))],
  html: [
    "HTML 实体",
    (s) => s.replace(/[&<>"']/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" }[c]};`),
    (s) => {
      const t = document.createElement("textarea");
      t.innerHTML = s;
      return t.value;
    },
  ],
  unicode: [
    "Unicode 转义",
    (s) => [...s].map((c) => (c.charCodeAt(0) < 128 ? c : [...c].map((u) => "\\u" + u.charCodeAt(0).toString(16).padStart(4, "0")).join(""))).join("").replace(/[\ud800-\udfff]/g, (u) => "\\u" + u.charCodeAt(0).toString(16)),
    (s) => s.replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})/gi, (_, a, b) => String.fromCodePoint(parseInt(a ?? b, 16))),
  ],
  hex: [
    "十六进制",
    (s) => [...utf8.enc.encode(s)].map((b) => b.toString(16).padStart(2, "0")).join(" "),
    (s) => {
      const t = s.replace(/0x/gi, "").replace(/[^0-9a-f]/gi, "");
      if (t.length % 2) throw new Error("十六进制位数不对");
      return utf8.dec.decode(Uint8Array.from(t.match(/../g) ?? [], (h) => parseInt(h, 16)));
    },
  ],
  jwt: [
    "JWT",
    () => {
      throw new Error("JWT 只能解码");
    },
    (s) =>
      s
        .trim()
        .split(".")
        .slice(0, 2)
        .map((part, i) => `// ${i ? "载荷" : "头部"}\n${JSON.stringify(JSON.parse(codecs.base64![2](part)), null, 2)}`)
        .join("\n\n"),
  ],
};

function renderCodec(box: HTMLElement) {
  const kind = kept.codecKind ?? "base64";
  box.innerHTML = `
    <div class="s-seg dv-kinds">${Object.entries(codecs)
      .map(([k, [name]]) => `<button data-kind="${k}" class="${k === kind ? "on" : ""}">${name}</button>`)
      .join("")}</div>
    <div class="dv-two">
      <div class="dv-col"><div class="dv-bar"><b>输入</b><span class="l-spacer"></span><button data-do="paste">粘贴</button><button data-do="clear">清空</button></div><textarea class="dv-text dv-in" spellcheck="false" placeholder="要编码或解码的文字"></textarea></div>
      <div class="dv-col"><div class="dv-bar"><b>结果</b><span class="dv-msg"></span><span class="l-spacer"></span><button data-do="copy">复制</button><button data-do="use">用作输入</button></div><textarea class="dv-text dv-out" spellcheck="false" readonly></textarea></div>
    </div>
    <div class="dv-acts"><button class="primary" data-do="enc">编码 →</button><button class="primary" data-do="dec">解码 →</button><span class="muted dv-tip">输入时自动判断：看着像编码过的就解码</span></div>`;
  const input = area(box, ".dv-in", "codec");
  const out = box.querySelector<HTMLTextAreaElement>(".dv-out")!;
  const msg = box.querySelector<HTMLElement>(".dv-msg")!;
  let cur = kind;
  const run = (dir: "enc" | "dec") => {
    if (!input.value) {
      out.value = msg.textContent = "";
      return;
    }
    try {
      out.value = codecs[cur]![dir === "enc" ? 1 : 2](input.value);
      msg.className = "dv-msg dv-ok";
      msg.textContent = dir === "enc" ? "已编码" : "已解码";
    } catch (e) {
      out.value = "";
      msg.className = "dv-msg dv-bad";
      msg.textContent = `${dir === "enc" ? "编码" : "解码"}失败：${errorText(e).replace(/^.*?: /, "")}`;
    }
  };
  // looksEncoded guesses which way the input goes.
  const looksEncoded = (s: string) =>
    ({
      base64: /^[A-Za-z0-9+/_-]{8,}={0,2}$/.test(s.trim()),
      url: /%[0-9a-f]{2}/i.test(s),
      html: /&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(s),
      unicode: /\\u[0-9a-f]{4}/i.test(s),
      hex: /^(0x)?([0-9a-f]{2}[\s,]*)+$/i.test(s.trim()),
      jwt: true,
    })[cur] ?? false;
  const auto = () => run(looksEncoded(input.value) ? "dec" : "enc");
  input.addEventListener("input", auto);
  box.querySelectorAll<HTMLElement>(".dv-kinds button").forEach((b) =>
    b.addEventListener("click", () => {
      cur = kept.codecKind = b.dataset.kind!;
      box.querySelectorAll(".dv-kinds button").forEach((o) => o.classList.toggle("on", o === b));
      auto();
    }),
  );
  box.addEventListener("click", (e) => {
    const what = (e.target as HTMLElement).closest<HTMLElement>("[data-do]")?.dataset.do;
    if (what === "enc" || what === "dec") run(what);
    else if (what === "paste") void navigator.clipboard.readText().then((t) => ((input.value = kept.codec = t), auto()), showError);
    else if (what === "clear") (input.value = kept.codec = ""), auto();
    else if (what === "copy") out.value && copy(out.value);
    else if (what === "use") out.value && ((input.value = kept.codec = out.value), auto());
  });
  auto();
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
    <div class="dv-time-in"><input class="l-search dv-ts" placeholder="时间戳（秒或毫秒，自动判断）或日期，如 2026-11-15 08:30、2026-11-15T00:30:00Z" spellcheck="false" /></div>
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
  const render = () => {
    kept.time = input.value;
    const s = input.value.trim();
    if (!s) {
      conv.innerHTML = `<div class="s-row muted">输入时间戳或日期，这里列出各种格式</div>`;
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

// ---- Digests ----

function renderHash(box: HTMLElement, off: (fn: () => void) => void) {
  box.innerHTML = `
    <div class="dv-bar"><b>文字</b><span class="l-spacer"></span><button data-do="file">选文件…</button><span class="muted">也可以把文件拖进窗口</span></div>
    <textarea class="dv-text dv-in dv-short" spellcheck="false" placeholder="输入文字，按 UTF-8 算"></textarea>
    <div class="dv-bar"><b class="dv-src">结果</b><span class="l-spacer"></span><label class="dv-opt"><input type="checkbox" class="dv-upper" /> 大写</label></div>
    <div class="s-card dv-hashes"></div>
    <div class="dv-time-in"><input class="l-search dv-expect" placeholder="粘贴期望的哈希值，对比是否一致" spellcheck="false" /></div>`;
  const input = area(box, ".dv-in", "hash");
  const list = box.querySelector<HTMLElement>(".dv-hashes")!;
  const upper = box.querySelector<HTMLInputElement>(".dv-upper")!;
  const expect = box.querySelector<HTMLInputElement>(".dv-expect")!;
  let h: DevHashes | null = null;
  let src = "";
  const render = () => {
    box.querySelector(".dv-src")!.textContent = src || "结果";
    if (!h) {
      list.innerHTML = `<div class="s-row muted">输入文字或选文件</div>`;
      return;
    }
    const want = expect.value.trim().toLowerCase();
    const rows: [string, string][] = [
      ["MD5", h.md5],
      ["SHA-1", h.sha1],
      ["SHA-256", h.sha256],
      ["SHA-512", h.sha512],
      ["CRC32", h.crc32],
    ];
    list.innerHTML =
      rows
        .map(([k, v]) => {
          const shown = upper.checked ? v.toUpperCase() : v;
          const hit = want && v === want;
          return `<div class="s-row dv-hash${hit ? " hit" : ""}"><span>${k}${hit ? " ✓ 一致" : ""}</span><code>${shown}</code><button data-copy="${shown}">复制</button></div>`;
        })
        .join("") + (want && !rows.some(([, v]) => v === want) ? `<div class="s-row s-bad">和期望值都不一致</div>` : "");
  };
  let timer = 0;
  const hashText = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (!input.value) {
        h = null;
        src = "";
        return render();
      }
      void Dev.hash(input.value).then((r) => {
        h = r;
        src = `文字的哈希（${r.size} 字节）`;
        render();
      });
    }, 150);
  };
  const fileDone = (r: DevHashes) => {
    if (!r.name) return;
    h = r;
    src = `文件「${r.name}」的哈希（${fmtSize(r.size)}）`;
    render();
  };
  input.addEventListener("input", hashText);
  upper.addEventListener("change", render);
  expect.addEventListener("input", render);
  box.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-do="file"]')) void Dev.pickFile().then(fileDone, showError);
    const c = t.closest<HTMLElement>("[data-copy]");
    if (c) copy(c.dataset.copy!);
  });
  off(
    onFileDrop(({ paths }) => {
      if (!paths[0]) return;
      toast("正在计算…");
      void Dev.hashFile(paths[0]).then(fileDone, showError);
    }),
  );
  if (input.value) hashText();
  else render();
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} 字节`;
  if (n < 1 << 20) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1 << 30) return `${(n / (1 << 20)).toFixed(1)} MB`;
  return `${(n / (1 << 30)).toFixed(2)} GB`;
}

// ---- QR codes ----

function renderQR(box: HTMLElement, off: (fn: () => void) => void) {
  box.innerHTML = `
    <div class="dv-two">
      <div class="dv-col">
        <div class="dv-bar"><b>生成</b><span class="l-spacer"></span><button data-do="paste">用剪贴板</button><select class="dv-size"><option value="256">256</option><option value="384" selected>384</option><option value="512">512</option><option value="768">768</option></select></div>
        <textarea class="dv-text dv-in dv-short" spellcheck="false" placeholder="网址或文字，如 http://cloudreve.haowu.fun/s/qLux"></textarea>
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
    <div class="dv-bar"><b>UUID</b><span class="l-spacer"></span><label class="dv-opt">个数<select class="dv-n"><option>1</option><option>5</option><option>10</option><option>50</option></select></label><label class="dv-opt"><input type="checkbox" class="dv-upper" /> 大写</label><label class="dv-opt"><input type="checkbox" class="dv-nodash" /> 去掉横线</label><button data-do="uuid" class="primary">生成</button><button data-do="copy-uuid">复制</button></div>
    <textarea class="dv-text dv-short dv-uuid" readonly spellcheck="false"></textarea>
    <div class="dv-bar"><b>随机密码</b><span class="l-spacer"></span><label class="dv-opt">长度<input type="number" class="dv-len" min="4" max="128" value="20" /></label><label class="dv-opt"><input type="checkbox" class="dv-sym" checked /> 符号</label><label class="dv-opt"><input type="checkbox" class="dv-amb" checked /> 去掉易混字符</label><button data-do="pw" class="primary">生成</button><button data-do="copy-pw">复制</button></div>
    <input class="l-search dv-pw" readonly spellcheck="false" />
    <p class="muted dv-tip">都用浏览器的安全随机数（crypto）生成，不经过网络。</p>`;
  const q = <T extends HTMLElement>(s: string) => box.querySelector<T>(s)!;
  const uuid = () => {
    const n = Number(q<HTMLSelectElement>(".dv-n").value);
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
  box.querySelectorAll("select, input[type=checkbox]").forEach((el) => el.addEventListener("change", () => (el.closest(".dv-bar")!.querySelector('[data-do="pw"]') ? pw() : uuid())));
  uuid();
  pw();
}
