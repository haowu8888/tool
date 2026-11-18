// The clipboard history: the tool's page, and the popup the shortcut
// brings up at the pointer (?clips), whose picked item is pasted where the
// user was.
import { icons } from "./icons";
import { Clips, events, type ClipItem } from "./mygo";
import { kbd, onSettings, save, settings, shortcutKeys } from "./settings";
import { esc, onLeave, showError, toast } from "./ui";

type Filter = "all" | "text" | "image" | "files" | "pinned";

const filters: [Filter, string][] = [
  ["all", "全部"],
  ["text", "文字"],
  ["image", "图片"],
  ["files", "文件"],
  ["pinned", "置顶"],
];

let items: ClipItem[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

// load gets the history once, and keeps it as it changes.
function load() {
  loaded ??= Clips.list().then((list) => {
    items = list ?? [];
    events.clipsChanged.on((list) => {
      items = list ?? [];
      listeners.forEach((fn) => fn());
    });
  });
  return loaded;
}

function matches(c: ClipItem, f: Filter, q: string) {
  if (f === "pinned" ? !c.pinned : f !== "all" && c.kind !== f) return false;
  if (!q) return true;
  return [c.text, c.source, ...(c.files ?? [])].some((s) => s?.toLowerCase().includes(q));
}

// ago says when, as 刚刚, 3 分钟前, 14:20, 昨天 14:20 or 11-12.
function ago(ms: number, now = Date.now()) {
  const s = (now - ms) / 1000;
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  const d = new Date(ms);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (ms >= today) return hm;
  if (ms >= today - 86400000) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

// clipBody shows what an item holds.
function clipBody(c: ClipItem, compact: boolean) {
  if (c.kind === "image") return `<img class="cl-img" src="${esc(c.image ?? "")}" alt="" loading="lazy" draggable="false" />`;
  if (c.kind === "files") {
    const files = c.files ?? [];
    const shown = files.slice(0, compact ? 2 : 4).map((f) => `<div class="cl-file" title="${esc(f)}">📄 ${esc(baseName(f))}</div>`);
    if (files.length > shown.length) shown.push(`<div class="muted">还有 ${files.length - shown.length} 个</div>`);
    return shown.join("");
  }
  // Blank lines around and between would push the words out of the card.
  const text = (c.text ?? "").trim().replace(/\n\s*\n/g, "\n");
  return `<div class="cl-text">${esc(text.slice(0, compact ? 400 : 1000))}</div>`;
}

function clipMeta(c: ClipItem) {
  const parts = [ago(c.time)];
  if (c.source) parts.unshift(esc(c.source));
  if (c.kind === "text" && c.len) parts.push(`${c.len} 字`);
  if (c.kind === "image") parts.push(`${c.w} × ${c.h}`);
  if (c.kind === "files") parts.push(`${c.files?.length ?? 0} 个文件`);
  return parts.join(" · ");
}

// ---- The tool's page ----

export const clipsTool = {
  id: "clips",
  name: "剪贴板",
  icon: icons.clips,
  render(p: HTMLElement) {
    const key = shortcutKeys("clipboard");
    p.innerHTML = `
      <h1>剪贴板</h1>
      <p class="muted">复制过的文字、图片和文件都记在这里，点一下就重新复制。${key ? `在任何地方按 ${kbd(key)} 调出，选中回车就粘贴到原来的位置。` : "调出剪贴板历史的快捷键已在设置里停用。"}</p>
      <div class="cl-bar">
        <input class="l-search" type="search" placeholder="搜索文字、文件名或来源程序" />
        <div class="s-seg cl-filter">${filters.map(([f, n]) => `<button data-f="${f}">${n}</button>`).join("")}</div>
      </div>
      <div class="cl-list"></div>
      <div class="cl-under muted"><span class="cl-count"></span><button class="cl-top" hidden>回到顶部 ↑</button></div>
      <section class="s-group">
        <h2>设置</h2>
        <div class="s-card">
          <label class="s-row"><span>暂停记录<small class="muted">暂停时新复制的内容不会记下来</small></span><input type="checkbox" class="cl-pause" /></label>
          <div class="s-row"><span>最多保留<small class="muted">置顶的不算，一直留着</small></span>
            <select class="cl-max">${[100, 300, 1000].map((n) => `<option value="${n}">${n} 条</option>`).join("")}</select></div>
          <div class="s-row"><span>自动删除<small class="muted">超过这么久没再复制过的就删掉，置顶的不删</small></span>
            <select class="cl-days">${[
              [0, "不自动删"],
              [7, "7 天后"],
              [30, "30 天后"],
              [90, "90 天后"],
            ]
              .map(([n, name]) => `<option value="${n}">${name}</option>`)
              .join("")}</select></div>
          <label class="s-row"><span>不记录这些程序<small class="muted">在这些程序里复制的内容不记。填卡片上显示的程序名，用逗号分开</small></span>
            <input class="cl-exclude" placeholder="如 WindowsTerminal, KeePass" spellcheck="false" /></label>
          <div class="s-row"><span>清空<small class="muted">删掉所有没置顶的</small></span><button class="danger cl-clear">清空</button></div>
        </div>
      </section>
      <ul class="tips muted">
        <li>密码管理器（KeePass、Bitwarden、1Password 等）复制的密码会标明「不要记录」，这里不会记。</li>
        <li>只记纯文字：从网页、Word 复制的格式不保留。图片存在数据文件夹的 clip-files 里。</li>
      </ul>`;
    const list = p.querySelector<HTMLElement>(".cl-list")!;
    const search = p.querySelector<HTMLInputElement>(".l-search")!;
    const count = p.querySelector<HTMLElement>(".cl-count")!;
    const top = p.querySelector<HTMLButtonElement>(".cl-top")!;
    // The list scrolls in its own box, the search staying above it.
    list.addEventListener("scroll", () => (top.hidden = list.scrollTop < 200), { passive: true });
    top.addEventListener("click", () => list.scrollTo({ top: 0, behavior: "smooth" }));
    let filter: Filter = "all";
    const render = () => {
      if (!list.isConnected) return listeners.delete(render);
      p.querySelectorAll<HTMLElement>(".cl-filter button").forEach((b) => b.classList.toggle("on", b.dataset.f === filter));
      const q = search.value.trim().toLowerCase();
      const shown = items.filter((c) => matches(c, filter, q));
      count.textContent = items.length ? (shown.length === items.length ? `共 ${items.length} 条` : `${shown.length} / ${items.length} 条`) : "";
      list.innerHTML = shown.length
        ? shown
            .map(
              (c) => `
          <div class="cl-item cl-k-${c.kind}${c.pinned ? " pinned" : ""}" data-id="${c.id}" title="点击复制">
            <div class="cl-body">${clipBody(c, false)}</div>
            <div class="cl-foot"><span class="muted">${c.pinned ? "📌 " : ""}${clipMeta(c)}</span>
              <span class="cl-acts">${c.kind === "image" ? `<button data-act="edit">编辑</button>` : ""}<button data-act="pin">${c.pinned ? "取消置顶" : "置顶"}</button><button data-act="del">删除</button></span></div>
          </div>`,
            )
            .join("")
        : `<div class="l-empty"><p>${items.length ? "没有符合的内容。" : "还没有记录。"}</p><p class="muted">${items.length ? "换个关键词或分类试试。" : "复制点文字或截张图，就会出现在这里。"}</p></div>`;
    };
    list.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".cl-item");
      if (!row) return;
      const id = row.dataset.id!;
      const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
      const c = items.find((c) => c.id === id);
      if (act === "pin") void Clips.pin(id, !c?.pinned).catch(showError);
      else if (act === "del") void Clips.delete(id).catch(showError);
      else if (act === "edit") void Clips.edit(id).catch(showError);
      else void Clips.copy(id).then(() => toast("已复制"), showError);
    });
    search.addEventListener("input", render);
    p.querySelectorAll<HTMLElement>(".cl-filter button").forEach((b) =>
      b.addEventListener("click", () => {
        filter = b.dataset.f as Filter;
        render();
      }),
    );
    const pause = p.querySelector<HTMLInputElement>(".cl-pause")!;
    const max = p.querySelector<HTMLSelectElement>(".cl-max")!;
    pause.addEventListener("change", () => void save((s) => (s.clipboard.pause = pause.checked)));
    max.addEventListener("change", () => void save((s) => (s.clipboard.max = Number(max.value))));
    const days = p.querySelector<HTMLSelectElement>(".cl-days")!;
    const exclude = p.querySelector<HTMLInputElement>(".cl-exclude")!;
    days.addEventListener("change", () => void save((s) => (s.clipboard.days = Number(days.value))));
    exclude.addEventListener("change", () => void save((s) => (s.clipboard.exclude = exclude.value.split(/[,，、;；\s]+/).filter(Boolean))));
    p.querySelector(".cl-clear")!.addEventListener("click", () => void Clips.clear().then((n) => toast(`已清空 ${n} 条`), showError));
    const fill = () => {
      pause.checked = settings.clipboard.pause;
      max.value = String(settings.clipboard.max);
      days.value = String(settings.clipboard.days ?? 0);
      if (document.activeElement !== exclude) exclude.value = (settings.clipboard.exclude ?? []).join(", ");
    };
    onLeave(onSettings(fill));
    fill();
    listeners.add(render);
    onLeave(() => listeners.delete(render));
    void load().then(render, showError);
    // The times say 刚刚 and 3 分钟前: they move on.
    const tick = setInterval(() => (list.isConnected ? render() : clearInterval(tick)), 60000);
  },
};

// ---- The popup ----

export function showClips(app: HTMLElement) {
  document.documentElement.classList.add("clips");
  document.title = "剪贴板历史";
  app.innerHTML = `
    <div class="cp-head">
      <input class="cp-search" placeholder="搜索剪贴板历史" spellcheck="false" />
      <div class="cp-filter">${filters.map(([f, n]) => `<button data-f="${f}" tabindex="-1">${n}</button>`).join("")}</div>
    </div>
    <div class="cp-list"></div>
    <div class="cp-foot muted">Enter 粘贴 · Ctrl+Enter 只复制 · Ctrl+P 置顶 · Shift+Del 删除 · Tab 换分类</div>`;
  const search = app.querySelector<HTMLInputElement>(".cp-search")!;
  const list = app.querySelector<HTMLElement>(".cp-list")!;
  let filter: Filter = "all";
  let sel = 0;
  let shown: ClipItem[] = [];
  let acting = false; // pasting, which hides the window itself

  const render = () => {
    app.querySelectorAll<HTMLElement>(".cp-filter button").forEach((b) => b.classList.toggle("on", b.dataset.f === filter));
    const q = search.value.trim().toLowerCase();
    shown = items.filter((c) => matches(c, filter, q)).slice(0, 100);
    sel = Math.min(sel, Math.max(shown.length - 1, 0));
    list.innerHTML = shown.length
      ? shown
          .map(
            (c, i) => `
        <div class="cp-item cl-k-${c.kind}${i === sel ? " sel" : ""}" data-i="${i}">
          <span class="cp-n">${i < 9 ? i + 1 : ""}</span>
          <div class="cp-main"><div class="cl-body">${clipBody(c, true)}</div><div class="cp-meta muted">${c.pinned ? "📌 " : ""}${clipMeta(c)}</div></div>
        </div>`,
          )
          .join("")
      : `<div class="cp-empty muted">${items.length ? "没有符合的内容" : "还没有记录，复制点东西试试"}</div>`;
    list.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  };
  const move = (d: number) => {
    if (!shown.length) return;
    sel = (sel + d + shown.length) % shown.length;
    list.querySelectorAll(".cp-item").forEach((el, i) => el.classList.toggle("sel", i === sel));
    list.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  };
  const paste = (i: number, copyOnly = false) => {
    const c = shown[i];
    if (!c) return;
    acting = true;
    const done = copyOnly ? Clips.copy(c.id).then(() => Clips.hide()) : Clips.paste(c.id);
    void done.catch(showError).finally(() => (acting = false));
  };
  const setFilter = (f: Filter) => {
    filter = f;
    sel = 0;
    render();
  };

  search.addEventListener("input", () => {
    sel = 0;
    render();
  });
  list.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".cp-item");
    if (row) paste(Number(row.dataset.i));
  });
  list.addEventListener("mousemove", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".cp-item");
    if (row && Number(row.dataset.i) !== sel) move(Number(row.dataset.i) - sel);
  });
  app.querySelectorAll<HTMLElement>(".cp-filter button").forEach((b) =>
    b.addEventListener("mousedown", (e) => {
      e.preventDefault(); // the search keeps the keys
      setFilter(b.dataset.f as Filter);
    }),
  );
  addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (e.key === "Escape") void Clips.hide();
    else if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "PageDown") move(Math.min(8, shown.length - 1 - sel));
    else if (e.key === "PageUp") move(-Math.min(8, sel));
    else if (e.key === "End" && e.ctrlKey) move(shown.length - 1 - sel);
    else if (e.key === "Home" && e.ctrlKey) move(-sel);
    else if (e.key === "Enter") paste(sel, e.ctrlKey);
    else if (e.key === "Tab") {
      const i = filters.findIndex(([f]) => f === filter);
      setFilter(filters[(i + (e.shiftKey ? filters.length - 1 : 1)) % filters.length]![0]);
    } else if (e.altKey && /^[1-9]$/.test(e.key)) paste(Number(e.key) - 1);
    else if (e.ctrlKey && k === "p" && shown[sel]) void Clips.pin(shown[sel]!.id, !shown[sel]!.pinned);
    else if (e.shiftKey && e.key === "Delete" && shown[sel]) void Clips.delete(shown[sel]!.id);
    else return;
    e.preventDefault();
  });
  // Clicking elsewhere puts it away. Shown again, it first gets a blur
  // left over from when it was hidden, and the focus right after: only a
  // blur that lasts counts.
  addEventListener("blur", () => {
    setTimeout(() => {
      if (!acting && !document.hasFocus()) void Clips.hide();
    }, 150);
  });
  events.clipsSummoned.on(() => {
    search.value = "";
    filter = "all";
    sel = 0;
    render();
    list.scrollTop = 0;
    setTimeout(() => search.focus());
  });
  listeners.add(render);
  void load().then(render, showError);
}
