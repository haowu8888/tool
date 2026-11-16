// The kanban: issues in status columns, like Multica's and Linear's, with
// projects, labels, priorities, due dates, a checklist and comments.
import { Board, events, type BoardData, type BoardEvent, type BoardIssue, type BoardLabel, type BoardProject } from "./mygo";
import { icons as toolIcons } from "./icons";
import { initialsIndex } from "./launcher";
import { esc, onLeave, openDialog, showError, toast } from "./ui";

const svg = (body: string, size = 14) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

// The columns, in their order, with their icons.
const STATUSES: { id: string; name: string; icon: string }[] = [
  { id: "backlog", name: "待规划", icon: svg(`<circle cx="8" cy="8" r="6" stroke-dasharray="2.2 2"/>`) },
  { id: "todo", name: "待办", icon: svg(`<circle cx="8" cy="8" r="6"/>`) },
  { id: "in_progress", name: "进行中", icon: svg(`<circle cx="8" cy="8" r="6"/><path d="M8 4a4 4 0 0 1 0 8z" fill="currentColor" stroke="none"/>`) },
  { id: "in_review", name: "审核中", icon: svg(`<circle cx="8" cy="8" r="6"/><path d="M8 4a4 4 0 1 1-4 4h4z" fill="currentColor" stroke="none"/>`) },
  { id: "blocked", name: "已阻塞", icon: svg(`<circle cx="8" cy="8" r="6"/><path d="m3.8 3.8 8.4 8.4"/>`) },
  { id: "done", name: "已完成", icon: svg(`<circle cx="8" cy="8" r="6.5" fill="currentColor" stroke="none"/><path d="m5.3 8.2 1.9 1.9 3.6-3.7" stroke="var(--card)" stroke-width="1.7"/>`) },
];

const bar = (x: number, h: number, on: boolean) => `<rect x="${x}" y="${13 - h}" width="2.6" height="${h}" rx="0.8" fill="currentColor" stroke="none" opacity="${on ? 1 : 0.28}"/>`;
const PRIORITIES: { id: string; name: string; icon: string }[] = [
  { id: "urgent", name: "紧急", icon: svg(`<rect x="2" y="2" width="12" height="12" rx="3" fill="currentColor" stroke="none"/><path d="M8 5v3.6M8 11h.01" stroke="var(--card)" stroke-width="1.8"/>`) },
  { id: "high", name: "高", icon: svg(bar(2.5, 5, true) + bar(6.7, 8, true) + bar(10.9, 11, true)) },
  { id: "medium", name: "中", icon: svg(bar(2.5, 5, true) + bar(6.7, 8, true) + bar(10.9, 11, false)) },
  { id: "low", name: "低", icon: svg(bar(2.5, 5, true) + bar(6.7, 8, false) + bar(10.9, 11, false)) },
  { id: "", name: "无优先级", icon: svg(`<path d="M3 8h1.6M7.2 8h1.6M11.4 8H13"/>`) },
];
const RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, "": 4 };

const COLORS = ["#6366f1", "#3b82f6", "#06b6d4", "#22c55e", "#eab308", "#f97316", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"];

const icon = {
  plus: svg(`<path d="M8 3v10M3 8h10"/>`),
  fold: svg(`<path d="m10 4-4 4 4 4"/>`),
  board: svg(`<rect x="2" y="2.5" width="3.5" height="11" rx="1"/><rect x="6.25" y="2.5" width="3.5" height="7" rx="1"/><rect x="10.5" y="2.5" width="3.5" height="9" rx="1"/>`),
  list: svg(`<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>`),
  all: svg(`<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="m5.5 8 1.8 1.8L10.8 6.3"/>`),
  active: svg(`<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>`),
  urgent: svg(`<path d="M8 2.5v7M8 12.5h.01"/>`),
  due: svg(`<rect x="2.5" y="3" width="11" height="10.5" rx="2"/><path d="M2.5 6.5h11M5.5 1.8v2.4M10.5 1.8v2.4"/>`),
  recent: svg(`<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.8h2.8"/><path d="M8 5.5V8l1.8 1.2"/>`),
  folder: svg(`<path d="M2 4.5c0-.6.4-1 1-1h3.2l1.3 1.5H13c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z"/>`),
  tag: svg(`<path d="M2.5 2.5h5l6 6-5 5-6-6z"/><circle cx="5.3" cy="5.3" r=".8" fill="currentColor"/>`),
  more: svg(`<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>`),
  close: svg(`<path d="m4 4 8 8M12 4l-8 8"/>`),
  trash: svg(`<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>`),
  copy: svg(`<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>`),
  check: svg(`<path d="m3.5 8.3 3 3 6-6.3"/>`),
  comment: svg(`<path d="M2.5 3.5h11v7.5h-6.5l-3 2.5v-2.5h-1.5z"/>`),
  subs: svg(`<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="m5 8 2 2 4-4"/>`),
  search: svg(`<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>`),
};

// A view picks issues; the project and labels picked narrow it further.
const VIEWS: { id: string; name: string; icon: string; test: (is: BoardIssue) => boolean }[] = [
  { id: "all", name: "全部任务", icon: icon.all, test: () => true },
  { id: "active", name: "未完成", icon: icon.active, test: (is) => is.status !== "done" },
  { id: "urgent", name: "紧急和高优先级", icon: icon.urgent, test: (is) => is.status !== "done" && (is.priority === "urgent" || is.priority === "high") },
  { id: "due", name: "到期和逾期", icon: icon.due, test: (is) => is.status !== "done" && !!is.due && is.due <= addDays(today(), 3) },
  { id: "recent", name: "最近更新", icon: icon.recent, test: (is) => Date.now() - is.updated < 7 * 864e5 },
];

const SORTS: [string, string][] = [
  ["manual", "手动排序"],
  ["priority", "优先级"],
  ["updated", "最近更新"],
  ["created", "创建时间"],
  ["due", "截止日期"],
];

// What the page shows, kept for the next visit.
interface ViewState {
  view: string;
  project: string | null; // null for any, "" for none
  labels: string[];
  layout: "board" | "list";
  sort: string;
  folded: string[]; // the statuses whose columns are folded
}

const stateKey = "board-view";
let state: ViewState = loadState();

function loadState(): ViewState {
  const fallback: ViewState = { view: "all", project: null, labels: [], layout: "board", sort: "manual", folded: [] };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(stateKey) ?? "{}") };
  } catch {
    return fallback;
  }
}

function keepState() {
  try {
    localStorage.setItem(stateKey, JSON.stringify(state));
  } catch {}
}

let panel: HTMLElement | null = null;
let data: BoardData = { next: 1, projects: [], labels: [], issues: [] };
let query = "";
let peekID = ""; // the issue the side panel shows

export const boardTool = {
  id: "board",
  name: "看板",
  icon: toolIcons.board,
  render(p: HTMLElement) {
    panel = p;
    p.innerHTML = `
      <div class="bd-wrap">
        <aside class="bd-side"></aside>
        <section class="bd-main">
          <header class="bd-top">
            <span class="bd-title"></span>
            <label class="bd-search">${icon.search}<input type="search" placeholder="搜索标题、描述或 #编号  /" /></label>
            <span class="bd-grow"></span>
            <select class="bd-sort" title="排序">${SORTS.map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select>
            <span class="bd-seg">
              <button data-layout="board" title="看板">${icon.board}</button><button data-layout="list" title="列表">${icon.list}</button>
            </span>
            <button class="primary bd-new">${icon.plus}新建任务</button>
          </header>
          <div class="bd-body"></div>
          <aside class="bd-peek" hidden></aside>
        </section>
      </div>`;
    const search = p.querySelector<HTMLInputElement>(".bd-search input")!;
    search.value = query;
    search.addEventListener("input", () => {
      query = search.value;
      drawBody();
    });
    search.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && search.value) {
        e.stopPropagation();
        search.value = query = "";
        drawBody();
      }
    });
    const sort = p.querySelector<HTMLSelectElement>(".bd-sort")!;
    sort.value = state.sort;
    sort.addEventListener("change", () => {
      state.sort = sort.value;
      keepState();
      drawBody();
    });
    p.querySelector(".bd-seg")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-layout]");
      if (!b) return;
      state.layout = b.dataset.layout as ViewState["layout"];
      keepState();
      draw();
    });
    p.querySelector(".bd-new")!.addEventListener("click", () => newIssue());
    p.querySelector(".bd-side")!.addEventListener("click", onSide);
    p.querySelector<HTMLElement>(".bd-side")!.addEventListener("contextmenu", onSideMenu);
    bindBody(p.querySelector<HTMLElement>(".bd-body")!);
    bindPeek(p.querySelector<HTMLElement>(".bd-peek")!);
    onLeave(events.boardChanged.on((d) => {
      if (pending) return; // the page's own changes show already
      data = d;
      draw();
    }));
    onLeave(() => {
      flushDesc();
      closeMenu();
    });
    draw();
    void Board.list().then((d) => {
      data = d;
      draw();
    }, showError);
  },
};

function shown() {
  return !!panel?.isConnected && !!panel.querySelector(".bd-wrap");
}

// --- Changes ---------------------------------------------------------------

// The page shows a change at once and sends the changes to Go one after
// another. Broadcasts made while some are on the way would show older
// data, so they wait, and the board is read once the last is done.
let pending = 0;
let queue: Promise<unknown> = Promise.resolve();

function send<T>(remote: () => Promise<T>, local?: () => void): Promise<T | undefined> {
  if (local) {
    local();
    draw();
  }
  pending++;
  const done = queue.then(remote).catch((e) => {
    showError(e);
    return undefined;
  });
  queue = done.finally(async () => {
    if (--pending) return;
    try {
      data = await Board.list();
    } catch {}
    if (!pending) draw();
  });
  return done;
}

function issue(id: string) {
  return data.issues.find((is) => is.id === id);
}

// patch changes some fields of an issue. A description being typed goes
// along, or the change would send the old one.
function patch(id: string, change: Partial<BoardIssue>) {
  const is = issue(id);
  if (!is) return;
  if (descTimer && descFor === id) {
    clearTimeout(descTimer);
    descTimer = 0;
    change = { desc: peekEl()?.querySelector<HTMLTextAreaElement>(".bd-desc")?.value ?? is.desc, ...change };
  }
  const next: BoardIssue = { ...is, ...change, updated: Date.now() };
  if (change.status && change.status !== is.status) next.done = change.status === "done" ? Date.now() : 0;
  void send(
    () => Board.update(next),
    () => (data.issues = data.issues.map((x) => (x.id === id ? next : x))),
  );
}

// move puts an issue in a column, in front of the issue with ID before or
// at the column's end, as Board.Move does.
function move(id: string, status: string, before: string) {
  const is = issue(id);
  if (!is || (is.status === status && before === id)) return;
  void send(
    () => Board.move(id, status, before),
    () => {
      const list = data.issues.filter((x) => x.id !== id);
      const moved = { ...is, status, updated: is.status === status ? is.updated : Date.now() };
      if (is.status !== status) moved.done = status === "done" ? Date.now() : 0;
      let at = before ? list.findIndex((x) => x.id === before) : -1;
      if (at < 0) {
        at = list.length;
        for (let j = list.length - 1; j >= 0; j--)
          if (list[j]!.status === status) {
            at = j + 1;
            break;
          }
      }
      list.splice(at, 0, moved);
      data.issues = list;
    },
  );
}

function remove(id: string) {
  const at = data.issues.findIndex((x) => x.id === id);
  const is = data.issues[at];
  if (!is) return;
  const before = data.issues[at + 1]?.id ?? "";
  if (peekID === id) closePeek();
  void send(
    () => Board.delete(id),
    () => (data.issues = data.issues.filter((x) => x.id !== id)),
  ).then(() => toast(`已删除 #${is.num}`, { label: "撤销", run: () => void send(() => Board.restore(is, before)) }));
}

// --- Picking issues --------------------------------------------------------

function today() {
  return ymd(new Date());
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

function matches(is: BoardIssue, q: string) {
  if (!q) return true;
  const n = q.replace(/^#/, "");
  if (/^\d+$/.test(n) && String(is.num).startsWith(n)) return true;
  const title = is.title.toLowerCase();
  return title.includes(q) || initialsIndex(is.title, q.replace(/\s+/g, "")) >= 0 || (is.desc ?? "").toLowerCase().includes(q);
}

function visible() {
  const view = VIEWS.find((v) => v.id === state.view) ?? VIEWS[0]!;
  const q = query.trim().toLowerCase();
  return data.issues.filter(
    (is) =>
      view.test(is) &&
      (state.project === null || (is.project ?? "") === state.project) &&
      state.labels.every((l) => is.labels?.includes(l)) &&
      matches(is, q),
  );
}

function sorted(list: BoardIssue[]) {
  const by: Record<string, (a: BoardIssue, b: BoardIssue) => number> = {
    priority: (a, b) => RANK[a.priority ?? ""]! - RANK[b.priority ?? ""]!,
    updated: (a, b) => b.updated - a.updated,
    created: (a, b) => b.created - a.created,
    due: (a, b) => (a.due || "9999").localeCompare(b.due || "9999"),
  };
  const f = by[state.sort];
  return f ? [...list].sort(f) : list;
}

// --- Drawing ---------------------------------------------------------------

function draw() {
  if (!shown()) return;
  if (state.project && !data.projects.some((p) => p.id === state.project)) state.project = null;
  state.labels = state.labels.filter((l) => data.labels.some((x) => x.id === l));
  drawSide();
  drawTop();
  drawBody();
  drawPeek();
}

function drawSide() {
  const side = panel!.querySelector<HTMLElement>(".bd-side")!;
  const count = (f: (is: BoardIssue) => boolean) => data.issues.filter(f).length || "";
  const item = (attrs: string, ic: string, name: string, n: number | string, active: boolean, title = "") =>
    `<button class="bd-item${active ? " active" : ""}" ${attrs}${title ? ` title="${esc(title)}"` : ""}><span class="bd-ic">${ic}</span><span class="bd-name">${esc(name)}</span><span class="bd-n">${n}</span></button>`;
  side.innerHTML = `
    <div class="bd-side-h">看板</div>
    <div class="bd-sec"><span>视图</span></div>
    ${VIEWS.map((v) => item(`data-view="${v.id}"`, v.icon, v.name, count(v.test), state.view === v.id)).join("")}
    <div class="bd-sec"><span>项目</span><button class="bd-add" data-add="project" title="新建项目">${icon.plus}</button></div>
    ${data.projects.map((p) => item(`data-project="${p.id}"`, `<i class="bd-dot" style="background:${esc(p.color)}"></i>`, p.name, count((is) => is.project === p.id && is.status !== "done"), state.project === p.id, "右键编辑")).join("")}
    ${item(`data-project=""`, icon.folder, "无项目", count((is) => !is.project && is.status !== "done"), state.project === "")}
    <div class="bd-sec"><span>标签</span><button class="bd-add" data-add="label" title="新建标签">${icon.plus}</button></div>
    ${data.labels.map((l) => item(`data-label="${l.id}"`, `<i class="bd-dot square" style="background:${esc(l.color)}"></i>`, l.name, count((is) => !!is.labels?.includes(l.id) && is.status !== "done"), state.labels.includes(l.id), "右键编辑")).join("")}
    <p class="bd-tip muted">按 C 新建任务，/ 搜索。拖动卡片换状态或排序。</p>`;
}

function onSide(e: Event) {
  const t = e.target as HTMLElement;
  const add = t.closest<HTMLElement>("[data-add]");
  if (add) return add.dataset.add === "project" ? editProject() : editLabel();
  const b = t.closest<HTMLElement>(".bd-item");
  if (!b) return;
  if (b.dataset.view) state.view = b.dataset.view;
  else if (b.dataset.project !== undefined) state.project = state.project === b.dataset.project ? null : b.dataset.project;
  else if (b.dataset.label) {
    const id = b.dataset.label;
    state.labels = state.labels.includes(id) ? state.labels.filter((l) => l !== id) : [...state.labels, id];
  }
  keepState();
  draw();
}

function onSideMenu(e: MouseEvent) {
  const b = (e.target as HTMLElement).closest<HTMLElement>(".bd-item");
  if (b?.dataset.project) {
    e.preventDefault();
    editProject(data.projects.find((p) => p.id === b.dataset.project));
  } else if (b?.dataset.label) {
    e.preventDefault();
    editLabel(data.labels.find((l) => l.id === b.dataset.label));
  }
}

function drawTop() {
  const view = VIEWS.find((v) => v.id === state.view) ?? VIEWS[0]!;
  const project = state.project === null ? "" : state.project === "" ? "无项目" : (data.projects.find((p) => p.id === state.project)?.name ?? "");
  const labels = state.labels.map((id) => data.labels.find((l) => l.id === id)?.name).filter(Boolean);
  panel!.querySelector(".bd-title")!.innerHTML =
    `<span class="bd-ic">${view.icon}</span>${esc(view.name)}` +
    (project ? `<span class="bd-crumb">/ ${esc(project)}</span>` : "") +
    (labels.length ? `<span class="bd-crumb">· ${esc(labels.join("、"))}</span>` : "");
  panel!.querySelectorAll<HTMLElement>(".bd-seg button").forEach((b) => b.classList.toggle("on", b.dataset.layout === state.layout));
}

function drawBody() {
  if (!shown()) return;
  const body = panel!.querySelector<HTMLElement>(".bd-body")!;
  const list = sorted(visible());
  if (state.layout === "list") return drawList(body, list);
  // The columns stay, so that each keeps where it was scrolled to.
  let board = body.querySelector<HTMLElement>(".bd-board");
  if (!board) {
    body.innerHTML = `<div class="bd-board">${STATUSES.map((s) => `<div class="bd-col" data-status="${s.id}"></div>`).join("")}</div>`;
    board = body.querySelector<HTMLElement>(".bd-board")!;
  }
  for (const s of STATUSES) {
    const col = board.querySelector<HTMLElement>(`.bd-col[data-status="${s.id}"]`)!;
    const cards = list.filter((is) => is.status === s.id);
    const folded = state.folded.includes(s.id);
    const top = col.querySelector(".bd-cards")?.scrollTop ?? 0;
    col.classList.toggle("folded", folded);
    col.innerHTML = folded
      ? `<button class="bd-col-h" data-unfold title="展开"><span class="bd-st st-${s.id}">${s.icon}</span><span class="bd-col-name">${s.name}</span><span class="bd-n">${cards.length}</span></button>`
      : `<div class="bd-col-h">
           <span class="bd-st st-${s.id}">${s.icon}</span><span class="bd-col-name">${s.name}</span><span class="bd-n">${cards.length}</span>
           <span class="bd-grow"></span>
           <button class="bd-icon" data-fold title="收起这一列">${icon.fold}</button>
           <button class="bd-icon" data-new title="在这一列新建">${icon.plus}</button>
         </div>
         <div class="bd-cards">${cards.length ? cards.map(card).join("") : `<div class="bd-empty">无任务</div>`}</div>`;
    const box = col.querySelector(".bd-cards");
    if (box) box.scrollTop = top;
  }
}

function card(is: BoardIssue) {
  const p = PRIORITIES.find((x) => x.id === (is.priority ?? ""))!;
  const comments = is.activity?.filter((e) => e.kind === "comment").length ?? 0;
  const subs = is.subs ?? [];
  return `
    <div class="bd-card${is.id === peekID ? " peeked" : ""}" draggable="true" data-id="${is.id}" tabindex="0">
      <div class="bd-card-top"><span class="bd-key">#${is.num}</span>${is.priority ? `<span class="bd-prio p-${is.priority}" title="优先级：${p.name}">${p.icon}</span>` : ""}</div>
      <p class="bd-card-title">${esc(is.title)}</p>
      ${metaChips(is)}
      <div class="bd-card-foot">
        ${subs.length ? `<span class="bd-meta" title="子任务">${icon.subs}${subs.filter((s) => s.done).length}/${subs.length}</span>` : ""}
        ${comments ? `<span class="bd-meta" title="评论">${icon.comment}${comments}</span>` : ""}
        <span class="bd-grow"></span>
        <span class="bd-time">${is.status === "done" && is.done ? `完成于 ${ago(is.done)}` : `更新于 ${ago(is.updated)}`}</span>
      </div>
    </div>`;
}

// metaChips are an issue's project, labels and due date, when it has them.
function metaChips(is: BoardIssue) {
  const project = data.projects.find((p) => p.id === is.project);
  const labels = (is.labels ?? []).map((id) => data.labels.find((l) => l.id === id)).filter((l): l is BoardLabel => !!l);
  const due = is.due ? dueChip(is) : "";
  if (!project && !labels.length && !due) return "";
  return `<div class="bd-chips">
    ${project ? `<span class="bd-chip"><i class="bd-dot" style="background:${esc(project.color)}"></i>${esc(project.name)}</span>` : ""}
    ${labels.map((l) => `<span class="bd-chip"><i class="bd-dot square" style="background:${esc(l.color)}"></i>${esc(l.name)}</span>`).join("")}
    ${due}
  </div>`;
}

function dueChip(is: BoardIssue) {
  const t = today();
  const due = is.due!;
  const cls = is.status === "done" ? "" : due < t ? " late" : due === t ? " soon" : "";
  return `<span class="bd-chip bd-due${cls}" title="截止日期 ${due}">${icon.due}${dayText(due)}</span>`;
}

function dayText(day: string) {
  const t = today();
  if (day === t) return "今天";
  if (day === addDays(t, 1)) return "明天";
  if (day === addDays(t, -1)) return "昨天";
  const [y, m, d] = day.split("-").map(Number);
  return y === new Date().getFullYear() ? `${m}月${d}日` : day;
}

function ago(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} 天前`;
  const d = new Date(ms);
  return d.getFullYear() === new Date().getFullYear() ? `${d.getMonth() + 1}月${d.getDate()}日` : ymd(d);
}

function drawList(body: HTMLElement, list: BoardIssue[]) {
  const top = body.querySelector(".bd-list")?.scrollTop ?? 0;
  body.innerHTML = `<div class="bd-list">${
    list.length
      ? STATUSES.map((s) => {
          const rows = list.filter((is) => is.status === s.id);
          if (!rows.length) return "";
          return `
            <div class="bd-group">
              <div class="bd-group-h"><span class="bd-st st-${s.id}">${s.icon}</span>${s.name}<span class="bd-n">${rows.length}</span><span class="bd-grow"></span><button class="bd-icon" data-new="${s.id}" title="新建">${icon.plus}</button></div>
              ${rows.map(row).join("")}
            </div>`;
        }).join("")
      : `<div class="bd-empty big">${data.issues.length ? "没有符合条件的任务" : "还没有任务，按 C 或点右上角「新建任务」"}</div>`
  }</div>`;
  body.querySelector(".bd-list")!.scrollTop = top;
}

function row(is: BoardIssue) {
  const p = PRIORITIES.find((x) => x.id === (is.priority ?? ""))!;
  const project = data.projects.find((x) => x.id === is.project);
  const labels = (is.labels ?? []).map((id) => data.labels.find((l) => l.id === id)).filter((l): l is BoardLabel => !!l);
  return `
    <div class="bd-row${is.id === peekID ? " peeked" : ""}" data-id="${is.id}" tabindex="0">
      <button class="bd-prio p-${is.priority || "none"}" data-pick="priority" title="优先级：${p.name}">${p.icon}</button>
      <span class="bd-key">#${is.num}</span>
      <button class="bd-st st-${is.status}" data-pick="status" title="状态">${STATUSES.find((s) => s.id === is.status)?.icon ?? ""}</button>
      <span class="bd-row-title">${esc(is.title)}</span>
      <span class="bd-grow"></span>
      ${labels.map((l) => `<span class="bd-chip"><i class="bd-dot square" style="background:${esc(l.color)}"></i>${esc(l.name)}</span>`).join("")}
      ${project ? `<span class="bd-chip"><i class="bd-dot" style="background:${esc(project.color)}"></i>${esc(project.name)}</span>` : ""}
      ${is.due ? dueChip(is) : ""}
      <span class="bd-time">${ago(is.updated)}</span>
    </div>`;
}

// --- Board events ----------------------------------------------------------

let dragged = "";

function bindBody(body: HTMLElement) {
  body.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const col = t.closest<HTMLElement>(".bd-col");
    if (t.closest("[data-unfold]") || t.closest("[data-fold]")) {
      const s = col!.dataset.status!;
      state.folded = state.folded.includes(s) ? state.folded.filter((x) => x !== s) : [...state.folded, s];
      keepState();
      return drawBody();
    }
    const add = t.closest<HTMLElement>("[data-new]");
    if (add) return newIssue({ status: add.dataset.new || col?.dataset.status });
    const pick = t.closest<HTMLElement>("[data-pick]");
    const item = t.closest<HTMLElement>(".bd-card, .bd-row");
    if (pick && item) return pickField(pick, item.dataset.id!, pick.dataset.pick!);
    if (item) openPeek(item.dataset.id!);
  });
  body.addEventListener("keydown", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(".bd-card, .bd-row");
    if (item && e.key === "Enter") openPeek(item.dataset.id!);
  });
  body.addEventListener("contextmenu", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(".bd-card, .bd-row");
    if (!item) return;
    e.preventDefault();
    cardMenu(e, item.dataset.id!);
  });

  body.addEventListener("dragstart", (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".bd-card");
    if (!c) return;
    dragged = c.dataset.id!;
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", `#${issue(dragged)?.num ?? ""}`);
    requestAnimationFrame(() => c.classList.add("dragging"));
  });
  body.addEventListener("dragend", () => {
    dragged = "";
    clearDrop();
    body.querySelector(".dragging")?.classList.remove("dragging");
  });
  body.addEventListener("dragover", (e) => {
    const col = (e.target as HTMLElement).closest<HTMLElement>(".bd-col");
    if (!dragged || !col) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    const spot = dropSpot(col, e.clientY);
    clearDrop();
    col.classList.add("drop");
    if (state.sort === "manual" && spot.card) spot.card.classList.add(spot.after ? "drop-after" : "drop-before");
  });
  body.addEventListener("dragleave", (e) => {
    const col = (e.target as HTMLElement).closest<HTMLElement>(".bd-col");
    if (col && !col.contains(e.relatedTarget as Node)) clearDrop();
  });
  body.addEventListener("drop", (e) => {
    const col = (e.target as HTMLElement).closest<HTMLElement>(".bd-col");
    if (!dragged || !col) return;
    e.preventDefault();
    const id = dragged;
    const spot = dropSpot(col, e.clientY);
    clearDrop();
    const status = col.dataset.status!;
    // Sorted by something else, only the status changes.
    if (state.sort !== "manual") return issue(id)?.status === status ? undefined : move(id, status, "");
    let before = "";
    if (spot.card) before = spot.after ? (nextCard(spot.card)?.dataset.id ?? "") : spot.card.dataset.id!;
    if (before === id) return;
    // After the last visible card: in front of the issue that follows it
    // in the data, so that hidden ones keep their place too.
    if (!before && spot.card) before = afterInData(spot.card.dataset.id!, status, id);
    move(id, status, before);
  });
}

// dropSpot is the card the pointer is over or nearest below, and whether
// the dragged card goes after it.
function dropSpot(col: HTMLElement, y: number): { card: HTMLElement | null; after: boolean } {
  const cards = [...col.querySelectorAll<HTMLElement>(".bd-card:not(.dragging)")];
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (y < r.top + r.height / 2) return { card: c, after: false };
  }
  const last = cards.at(-1) ?? null;
  return { card: last, after: !!last };
}

function nextCard(c: HTMLElement) {
  let n = c.nextElementSibling as HTMLElement | null;
  while (n && (!n.classList.contains("bd-card") || n.classList.contains("dragging"))) n = n.nextElementSibling as HTMLElement | null;
  return n;
}

function afterInData(id: string, status: string, skip: string) {
  const at = data.issues.findIndex((x) => x.id === id);
  const next = data.issues.slice(at + 1).find((x) => x.status === status && x.id !== skip);
  return next?.id ?? "";
}

function clearDrop() {
  panel?.querySelectorAll(".drop, .drop-before, .drop-after").forEach((el) => el.classList.remove("drop", "drop-before", "drop-after"));
}

// --- Menus -----------------------------------------------------------------

interface MenuItem {
  label: string;
  icon?: string;
  checked?: boolean;
  danger?: boolean;
  run: () => void;
  keep?: boolean; // the menu stays open, for picking several
}

let menuEl: HTMLElement | null = null;

function closeMenu() {
  menuEl?.remove();
  menuEl = null;
  document.removeEventListener("mousedown", onOutside, true);
  document.removeEventListener("keydown", onMenuKey, true);
}

function onOutside(e: MouseEvent) {
  if (menuEl && !menuEl.contains(e.target as Node)) closeMenu();
}

function onMenuKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault(); // a dialog under it stays open
    e.stopPropagation();
    closeMenu();
  }
}

// menu shows items below a button, or at the pointer.
function menu(at: HTMLElement | MouseEvent, items: MenuItem[], title = "") {
  closeMenu();
  const m = document.createElement("div");
  m.className = "bd-menu";
  const fill = () => {
    m.innerHTML =
      (title ? `<div class="bd-menu-h">${esc(title)}</div>` : "") +
      items
        .map(
          (it, i) =>
            `<button data-i="${i}" class="${it.danger ? "danger" : ""}"><span class="bd-ic">${it.icon ?? ""}</span><span class="bd-name">${esc(it.label)}</span><span class="bd-check">${it.checked ? icon.check : ""}</span></button>`,
        )
        .join("");
  };
  fill();
  m.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (!b) return;
    const it = items[Number(b.dataset.i)]!;
    if (it.keep) {
      it.checked = !it.checked;
      fill();
    } else closeMenu();
    it.run();
  });
  (document.querySelector("dialog[open]") ?? document.body).append(m);
  const r = at instanceof MouseEvent ? { left: at.clientX, bottom: at.clientY, top: at.clientY } : at.getBoundingClientRect();
  const w = m.offsetWidth;
  const h = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  m.style.top = `${r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  menuEl = m;
  setTimeout(() => {
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onMenuKey, true);
  }, 0);
}

// fieldItems are the choices of one field of an issue: status, priority,
// project or labels.
function fieldItems(is: BoardIssue, field: string, set: (change: Partial<BoardIssue>) => void): MenuItem[] {
  if (field === "status") return STATUSES.map((s) => ({ label: s.name, icon: `<span class="bd-st st-${s.id}">${s.icon}</span>`, checked: is.status === s.id, run: () => set({ status: s.id }) }));
  if (field === "priority")
    return PRIORITIES.map((p) => ({ label: p.name, icon: `<span class="bd-prio p-${p.id || "none"}">${p.icon}</span>`, checked: (is.priority ?? "") === p.id, run: () => set({ priority: p.id }) }));
  if (field === "project")
    return [
      { label: "无项目", icon: icon.folder, checked: !is.project, run: () => set({ project: "" }) },
      ...data.projects.map((p) => ({ label: p.name, icon: `<i class="bd-dot" style="background:${esc(p.color)}"></i>`, checked: is.project === p.id, run: () => set({ project: p.id }) })),
      { label: "新建项目…", icon: icon.plus, run: () => editProject(undefined, (p) => set({ project: p.id })) },
    ];
  // Labels: several, so the menu stays open; each pick reads the labels
  // the last one left.
  const labels = new Set(is.labels ?? []);
  return [
    ...data.labels.map((l) => ({
      label: l.name,
      icon: `<i class="bd-dot square" style="background:${esc(l.color)}"></i>`,
      checked: labels.has(l.id),
      keep: true,
      run: () => {
        if (labels.has(l.id)) labels.delete(l.id);
        else labels.add(l.id);
        set({ labels: data.labels.map((x) => x.id).filter((x) => labels.has(x)) });
      },
    })),
    { label: "新建标签…", icon: icon.plus, run: () => editLabel(undefined, (l) => set({ labels: [...labels, l.id] })) },
  ];
}

const FIELD_NAMES: Record<string, string> = { status: "状态", priority: "优先级", project: "项目", labels: "标签" };

function pickField(at: HTMLElement, id: string, field: string) {
  const is = issue(id);
  if (is) menu(at, fieldItems(is, field, (c) => patch(id, c)), FIELD_NAMES[field]);
}

function cardMenu(e: MouseEvent, id: string) {
  const is = issue(id);
  if (!is) return;
  const sub = (field: string) => () => setTimeout(() => menu(e, fieldItems(issue(id) ?? is, field, (c) => patch(id, c)), FIELD_NAMES[field]), 0);
  menu(e, [
    { label: "打开", icon: icon.all, run: () => openPeek(id) },
    { label: "状态…", icon: `<span class="bd-st st-${is.status}">${STATUSES.find((s) => s.id === is.status)?.icon ?? ""}</span>`, run: sub("status") },
    { label: "优先级…", icon: PRIORITIES.find((p) => p.id === (is.priority ?? ""))!.icon, run: sub("priority") },
    { label: "项目…", icon: icon.folder, run: sub("project") },
    { label: "标签…", icon: icon.tag, run: sub("labels") },
    { label: "复制编号和标题", icon: icon.copy, run: () => void copy(`#${is.num} ${is.title}`) },
    { label: "删除", icon: icon.trash, danger: true, run: () => remove(id) },
  ]);
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制");
  } catch (e) {
    showError(e);
  }
}

// --- Dialogs ---------------------------------------------------------------

// newIssue asks for a new issue, starting from the view's project and the
// column it was asked from.
function newIssue(start: Partial<BoardIssue> = {}) {
  const draft: BoardIssue = {
    id: "",
    num: 0,
    title: "",
    status: start.status ?? "todo",
    priority: start.priority ?? (state.view === "urgent" ? "high" : ""),
    project: start.project ?? state.project ?? "",
    labels: start.labels ?? [...state.labels],
    due: "",
    created: 0,
    updated: 0,
  };
  const dlg = openDialog(`
    <form class="bd-new-form" method="dialog">
      <div class="bd-new-h"><span class="muted">新建任务</span><button type="button" class="bd-icon" data-close title="关闭">${icon.close}</button></div>
      <input class="bd-new-title" placeholder="任务标题" maxlength="500" required />
      <textarea class="bd-new-desc" rows="4" placeholder="添加描述…（可选）"></textarea>
      <div class="bd-props-row"></div>
      <div class="bd-new-foot">
        <label class="l-check"><input type="checkbox" class="bd-more" /> 继续新建</label>
        <span class="bd-grow"></span>
        <button type="submit" class="primary">创建任务</button>
      </div>
    </form>`);
  dlg.classList.add("bd-dialog");
  const props = dlg.querySelector<HTMLElement>(".bd-props-row")!;
  const fillProps = () => {
    props.innerHTML = propButtons(draft) + `<label class="bd-pill bd-date">${icon.due}<input type="date" value="${draft.due ?? ""}" /></label>`;
    props.querySelector<HTMLInputElement>("input[type=date]")!.addEventListener("change", (e) => (draft.due = (e.target as HTMLInputElement).value));
  };
  fillProps();
  props.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
    if (!b) return;
    menu(b, fieldItems(draft, b.dataset.pick!, (c) => (Object.assign(draft, c), fillProps())), FIELD_NAMES[b.dataset.pick!]);
  });
  const title = dlg.querySelector<HTMLInputElement>(".bd-new-title")!;
  const desc = dlg.querySelector<HTMLTextAreaElement>(".bd-new-desc")!;
  const more = dlg.querySelector<HTMLInputElement>(".bd-more")!;
  try {
    more.checked = localStorage.getItem("board-more") === "true";
  } catch {}
  more.addEventListener("change", () => {
    try {
      localStorage.setItem("board-more", String(more.checked));
    } catch {}
  });
  desc.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.ctrlKey) dlg.querySelector("form")!.requestSubmit();
  });
  dlg.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!title.value.trim()) return;
    const made = await send(() => Board.create({ ...draft, title: title.value, desc: desc.value }));
    if (!made) return;
    if (more.checked) {
      title.value = desc.value = "";
      title.focus();
      toast(`已创建 #${made.num}`);
    } else {
      dlg.close();
      toast(`已创建 #${made.num}`, { label: "打开", run: () => openPeek(made.id) });
    }
  });
  title.focus();
}

// propButtons are the buttons that pick an issue's status, priority,
// project and labels.
function propButtons(is: BoardIssue) {
  const s = STATUSES.find((x) => x.id === is.status) ?? STATUSES[1]!;
  const p = PRIORITIES.find((x) => x.id === (is.priority ?? ""))!;
  const project = data.projects.find((x) => x.id === is.project);
  const labels = (is.labels ?? []).map((id) => data.labels.find((l) => l.id === id)).filter((l): l is BoardLabel => !!l);
  return `
    <button type="button" class="bd-pill" data-pick="status"><span class="bd-st st-${s.id}">${s.icon}</span>${s.name}</button>
    <button type="button" class="bd-pill" data-pick="priority"><span class="bd-prio p-${p.id || "none"}">${p.icon}</span>${is.priority ? p.name : "优先级"}</button>
    <button type="button" class="bd-pill" data-pick="project">${project ? `<i class="bd-dot" style="background:${esc(project.color)}"></i>${esc(project.name)}` : `${icon.folder}项目`}</button>
    <button type="button" class="bd-pill" data-pick="labels">${labels.length ? labels.map((l) => `<i class="bd-dot square" style="background:${esc(l.color)}"></i>${esc(l.name)}`).join(" ") : `${icon.tag}标签`}</button>`;
}

function colorPicker(chosen: string) {
  return `<div class="bd-colors">${COLORS.map((c) => `<button type="button" class="bd-color${c === chosen ? " on" : ""}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join("")}</div>`;
}

function bindColors(dlg: HTMLElement, pick: (c: string) => void) {
  dlg.querySelector(".bd-colors")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-color]");
    if (!b) return;
    dlg.querySelectorAll(".bd-color").forEach((x) => x.classList.toggle("on", x === b));
    pick(b.dataset.color!);
  });
}

// editNamed is the dialog of a project or a label: a name and a color.
function editNamed<T extends BoardProject | BoardLabel>(kind: string, item: T | undefined, save: (x: T) => Promise<T>, del: (id: string) => Promise<void>, done?: (x: T) => void) {
  const x = { id: "", name: "", color: COLORS[(kind === "项目" ? data.projects.length : data.labels.length + 6) % COLORS.length]!, ...item } as T;
  const dlg = openDialog(`
    <h2>${item ? `编辑${kind}` : `新建${kind}`}</h2>
    <form method="dialog">
      <label>名称<input class="bd-name-in" value="${esc(x.name)}" maxlength="60" required /></label>
      <label>颜色</label>
      ${colorPicker(x.color)}
      <div class="l-buttons">
        ${item ? `<button type="button" class="bd-del">删除</button>` : ""}
        <span class="bd-grow"></span>
        <button type="button" data-close>取消</button>
        <button type="submit" class="primary">保存</button>
      </div>
    </form>`);
  bindColors(dlg, (c) => (x.color = c));
  const name = dlg.querySelector<HTMLInputElement>(".bd-name-in")!;
  name.focus();
  name.select();
  dlg.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const saved = await send(() => save({ ...x, name: name.value }));
    if (!saved) return;
    dlg.close();
    done?.(saved);
  });
  dlg.querySelector(".bd-del")?.addEventListener("click", async () => {
    const used = data.issues.filter((is) => (kind === "项目" ? is.project === x.id : is.labels?.includes(x.id))).length;
    if (used && !confirm(`有 ${used} 个任务用着「${x.name}」，删除后它们${kind === "项目" ? "变成无项目" : "去掉这个标签"}，任务本身不删。确定删除？`)) return;
    dlg.close();
    await send(() => del(x.id));
  });
}

function editProject(p?: BoardProject, done?: (p: BoardProject) => void) {
  editNamed("项目", p, (x) => Board.saveProject(x), (id) => Board.deleteProject(id), done);
}

function editLabel(l?: BoardLabel, done?: (l: BoardLabel) => void) {
  editNamed("标签", l, (x) => Board.saveLabel(x), (id) => Board.deleteLabel(id), done);
}

// --- The side panel of an issue --------------------------------------------

let descTimer = 0;
let descFor = "";

function peekEl() {
  return panel?.querySelector<HTMLElement>(".bd-peek") ?? null;
}

function openPeek(id: string) {
  if (peekID !== id) flushDesc();
  peekID = id;
  const el = peekEl();
  if (el) el.innerHTML = ""; // drawn anew for this issue
  drawPeek();
  drawBody();
}

function closePeek() {
  flushDesc();
  peekID = "";
  const el = peekEl();
  if (el) {
    el.hidden = true;
    el.innerHTML = "";
  }
  drawBody();
}

function flushDesc() {
  if (!descTimer) return;
  clearTimeout(descTimer);
  descTimer = 0;
  const desc = peekEl()?.querySelector<HTMLTextAreaElement>(".bd-desc")?.value;
  if (desc !== undefined) patch(descFor, { desc });
}

function drawPeek() {
  const el = peekEl();
  if (!el) return;
  const is = issue(peekID);
  if (!is) {
    if (peekID) closePeek();
    return;
  }
  el.hidden = false;
  if (!el.querySelector(".bd-peek-in")) {
    el.innerHTML = `
      <div class="bd-peek-in">
        <div class="bd-peek-top">
          <span class="bd-key bd-peek-key"></span>
          <span class="bd-grow"></span>
          <button class="bd-icon" data-act="copy" title="复制编号和标题">${icon.copy}</button>
          <button class="bd-icon" data-act="delete" title="删除">${icon.trash}</button>
          <button class="bd-icon" data-act="close" title="关闭（Esc）">${icon.close}</button>
        </div>
        <div class="bd-peek-scroll">
          <textarea class="bd-peek-title" rows="1" maxlength="500" placeholder="任务标题"></textarea>
          <div class="bd-props">
            <span class="muted">状态</span><div data-prop="status"></div>
            <span class="muted">优先级</span><div data-prop="priority"></div>
            <span class="muted">项目</span><div data-prop="project"></div>
            <span class="muted">标签</span><div data-prop="labels"></div>
            <span class="muted">截止日期</span><div><label class="bd-pill bd-date">${icon.due}<input type="date" class="bd-due-in" /></label><button class="bd-icon bd-due-x" title="清除日期">${icon.close}</button></div>
          </div>
          <textarea class="bd-desc" placeholder="添加描述…"></textarea>
          <div class="bd-h3">子任务 <span class="bd-n bd-subs-n"></span></div>
          <div class="bd-subs"></div>
          <form class="bd-sub-add"><input placeholder="＋ 添加子任务，回车确定" maxlength="300" /></form>
          <div class="bd-h3">动态</div>
          <div class="bd-activity"></div>
          <form class="bd-comment">
            <textarea rows="2" placeholder="写评论…  Ctrl+Enter 发送"></textarea>
            <button type="submit" class="primary">评论</button>
          </form>
        </div>
      </div>`;
  }
  const title = el.querySelector<HTMLTextAreaElement>(".bd-peek-title")!;
  const desc = el.querySelector<HTMLTextAreaElement>(".bd-desc")!;
  el.querySelector(".bd-peek-key")!.textContent = `#${is.num}`;
  // What is being typed stays.
  if (document.activeElement !== title) title.value = is.title;
  if (document.activeElement !== desc && !(descTimer && descFor === is.id)) desc.value = is.desc ?? "";
  grow(title);
  grow(desc);
  const buttons = document.createElement("div");
  buttons.innerHTML = propButtons(is);
  for (const b of buttons.querySelectorAll<HTMLElement>("[data-pick]")) {
    const slot = el.querySelector(`[data-prop="${b.dataset.pick}"]`)!;
    if (slot.innerHTML !== b.outerHTML) slot.innerHTML = b.outerHTML;
  }
  const due = el.querySelector<HTMLInputElement>(".bd-due-in")!;
  if (document.activeElement !== due) due.value = is.due ?? "";
  el.querySelector<HTMLElement>(".bd-due-x")!.hidden = !is.due;
  const subs = is.subs ?? [];
  el.querySelector(".bd-subs-n")!.textContent = subs.length ? `${subs.filter((s) => s.done).length}/${subs.length}` : "";
  el.querySelector(".bd-subs")!.innerHTML = subs
    .map(
      (s) =>
        `<div class="bd-sub${s.done ? " done" : ""}" data-sub="${s.id}"><input type="checkbox"${s.done ? " checked" : ""} /><span class="bd-sub-t">${esc(s.title)}</span><button class="bd-icon" data-sub-x title="删除">${icon.close}</button></div>`,
    )
    .join("");
  const act = el.querySelector<HTMLElement>(".bd-activity")!;
  const html = (is.activity ?? []).map(activityLine).join("");
  if (act.innerHTML !== html) act.innerHTML = html;
}

function grow(t: HTMLTextAreaElement) {
  t.style.height = "auto";
  t.style.height = `${t.scrollHeight}px`;
}

const NAMES: Record<string, (v: string) => string> = {
  status: (v) => STATUSES.find((s) => s.id === v)?.name ?? v,
  priority: (v) => PRIORITIES.find((p) => p.id === v)?.name ?? v,
  project: (v) => (v ? (data.projects.find((p) => p.id === v)?.name ?? "已删除的项目") : "无项目"),
  due: (v) => (v ? dayText(v) : "无"),
  title: (v) => `「${v}」`,
};
const VERBS: Record<string, string> = { status: "状态", priority: "优先级", project: "项目", due: "截止日期", title: "标题" };

function activityLine(e: BoardEvent) {
  const when = `<span class="bd-time" title="${new Date(e.at).toLocaleString()}">${ago(e.at)}</span>`;
  if (e.kind === "comment")
    return `<div class="bd-ev comment" data-ev="${e.id}"><div class="bd-ev-h">评论 · ${when}<span class="bd-grow"></span><button class="bd-icon" data-ev-x title="删除评论">${icon.trash}</button></div><div class="bd-ev-text">${esc(e.text ?? "")}</div></div>`;
  if (e.kind === "created") return `<div class="bd-ev"><i></i>创建了任务 · ${when}</div>`;
  const name = NAMES[e.kind] ?? ((v: string) => v);
  return `<div class="bd-ev"><i></i>${VERBS[e.kind] ?? e.kind}：${esc(name(e.from ?? ""))} → <b>${esc(name(e.to ?? ""))}</b> · ${when}</div>`;
}

function bindPeek(el: HTMLElement) {
  el.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const is = issue(peekID);
    if (!is) return;
    const a = t.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (a === "close") return closePeek();
    if (a === "delete") return remove(is.id);
    if (a === "copy") return void copy(`#${is.num} ${is.title}`);
    const pick = t.closest<HTMLElement>("[data-pick]");
    if (pick) return pickField(pick, is.id, pick.dataset.pick!);
    if (t.closest(".bd-due-x")) return patch(is.id, { due: "" });
    const sub = t.closest<HTMLElement>("[data-sub]");
    if (sub && t.closest("[data-sub-x]")) return patch(is.id, { subs: (is.subs ?? []).filter((s) => s.id !== sub.dataset.sub) });
    if (sub && t.matches("input[type=checkbox]"))
      return patch(is.id, { subs: (is.subs ?? []).map((s) => (s.id === sub.dataset.sub ? { ...s, done: (t as HTMLInputElement).checked } : s)) });
    const ev = t.closest<HTMLElement>("[data-ev]");
    if (ev && t.closest("[data-ev-x]")) {
      const id = ev.dataset.ev!;
      void send(
        () => Board.deleteComment(is.id, id),
        () => (data.issues = data.issues.map((x) => (x.id === is.id ? { ...x, activity: x.activity?.filter((y) => y.id !== id) } : x))),
      );
    }
  });
  el.addEventListener("input", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches(".bd-peek-title, .bd-desc, .bd-comment textarea")) grow(t as HTMLTextAreaElement);
    if (t.matches(".bd-desc")) {
      clearTimeout(descTimer);
      descFor = peekID;
      descTimer = setTimeout(() => {
        descTimer = 0;
        patch(descFor, { desc: (t as HTMLTextAreaElement).value });
      }, 600);
    }
  });
  el.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches(".bd-due-in") && peekID) patch(peekID, { due: t.value });
  });
  const saveTitle = (t: HTMLTextAreaElement) => {
    const is = issue(peekID);
    const v = t.value.replace(/\s+/g, " ").trim();
    if (!is) return;
    if (!v) t.value = is.title;
    else if (v !== is.title) patch(is.id, { title: v });
  };
  el.addEventListener("focusout", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches(".bd-peek-title")) saveTitle(t as HTMLTextAreaElement);
    if (t.matches(".bd-desc")) flushDesc();
  });
  el.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches(".bd-peek-title") && e.key === "Enter") {
      e.preventDefault();
      (t as HTMLTextAreaElement).blur();
    }
    if (t.matches(".bd-comment textarea") && e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      t.closest("form")!.requestSubmit();
    }
  });
  el.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const is = issue(peekID);
    if (!is) return;
    if (form.matches(".bd-sub-add")) {
      const input = form.querySelector("input")!;
      const v = input.value.trim();
      if (!v) return;
      input.value = "";
      patch(is.id, { subs: [...(is.subs ?? []), { id: "", title: v }] });
    } else if (form.matches(".bd-comment")) {
      const box = form.querySelector("textarea")!;
      const v = box.value.trim();
      if (!v) return;
      box.value = "";
      grow(box);
      void send(
        () => Board.comment(is.id, v),
        () =>
          (data.issues = data.issues.map((x) =>
            x.id === is.id ? { ...x, updated: Date.now(), activity: [...(x.activity ?? []), { id: `local-${Date.now()}`, at: Date.now(), kind: "comment", text: v }] } : x,
          )),
      );
    }
  });
}

// C writes a new issue, / searches and Escape closes the side panel, as
// in Linear.
document.addEventListener("keydown", (e) => {
  if (!shown() || document.querySelector("dialog[open]") || menuEl || e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target as HTMLElement;
  const typing = t.matches("input, textarea, select, [contenteditable]");
  if (e.key === "Escape" && peekID) {
    if (typing) t.blur();
    else closePeek();
    return;
  }
  if (typing) return;
  if (e.key === "c" || e.key === "C") {
    e.preventDefault();
    newIssue();
  } else if (e.key === "/") {
    e.preventDefault();
    panel!.querySelector<HTMLInputElement>(".bd-search input")!.focus();
  }
});
