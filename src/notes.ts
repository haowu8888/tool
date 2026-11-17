// The notes tool: todos, grouped by when they are due and reminded of by
// the floating ball's bubble at their time, and notes, rich texts whose
// first line is their title, written in an editor after Outline's.
import { onFileDrop } from "mygo-runtime";
import type { NoteEditor } from "./editor";
import { icons } from "./icons";
import { Launcher, Notes, events, type Note, type NotesData, type SubTask, type Todo } from "./mygo";
import { shortcutKeys } from "./settings";
import { errorText, esc, lightbox, openDialog, showError, toast } from "./ui";
import { REPEATS, WEEKDAYS, dueInfo, startOfDay } from "./due";

type View = "todos" | "notes";

let data: NotesData = { todos: [], notes: [] };
let view: View = loadView();
let panel: HTMLElement | null = null; // the panel while it shows the tool
let important = false; // the new todo's star
let showDone = false; // the done todos are folded away
const folded = new Set<string>(); // todos whose steps are folded away
let typingSub = ""; // the todo whose new step is being typed, to keep its focus
let addImages: string[] = []; // the new todo's pictures
let editImages: ((urls: string[]) => void) | null = null; // the edit dialog's, while open
let noteID = ""; // the note in the editor
let noteQuery = "";

export const notesTool = {
  id: "notes",
  name: "笔记待办",
  icon: icons.notes,
  render(p: HTMLElement) {
    panel = p;
    p.innerHTML = `
      <div class="n-wrap">
        <div class="l-head">
          <h1>笔记待办</h1>
          <div class="s-seg n-tabs">
            <button data-view="todos">待办<span class="n-count"></span></button>
            <button data-view="notes">笔记</button>
          </div>
        </div>
        <div class="n-view"></div>
      </div>`;
    p.querySelectorAll<HTMLElement>(".n-tabs button").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view as View)));
    renderView();
    void Notes.list().then((d) => {
      setData(d);
      // A note left empty, as by 新建 and then nothing, is not kept.
      for (const n of d.notes) if (!n.body.trim() && n.id !== noteID) void Notes.deleteNote(n.id);
    }, showError);
  },
};

// focusAdd shows the todos with the new todo's box focused, for the
// floating ball's 记一条待办.
export function focusAdd() {
  if (!shown()) return;
  if (view !== "todos") switchView("todos");
  panel!.querySelector<HTMLInputElement>(".n-add input")?.focus();
}

events.notesChanged.on(setData);

function setData(d: NotesData) {
  data = d;
  if (!shown()) return;
  renderCount();
  if (view === "todos") renderTodos();
  else renderNotes();
}

function shown() {
  return !!panel?.isConnected && !!panel.querySelector(".n-wrap");
}

const viewKey = "notes-view";

function loadView(): View {
  try {
    return localStorage.getItem(viewKey) === "notes" ? "notes" : "todos";
  } catch {
    return "todos";
  }
}

function switchView(v: View) {
  view = v;
  try {
    localStorage.setItem(viewKey, v);
  } catch {}
  renderView();
}

function renderView() {
  panel!.querySelectorAll<HTMLElement>(".n-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  const box = panel!.querySelector<HTMLElement>(".n-view")!;
  if (view === "todos") {
    box.innerHTML = `
      <form class="n-add">
        <input class="l-search" placeholder="添加待办，回车保存" maxlength="500" />
        <button type="button" class="n-pic" title="添加图片（也可以粘贴截图或把图片拖进来）">${icons.image}</button>
        <button type="button" class="n-star" title="标为重要">☆</button>
      </form>
      <div class="n-thumbs n-add-imgs"></div>
      <p class="muted n-hint"></p>
      <div class="n-todos"></div>`;
    bindAdd(box);
    renderTodos();
  } else {
    box.innerHTML = `
      <div class="n-notes">
        <aside class="n-side">
          <div class="l-row"><input class="l-search" type="search" placeholder="搜索笔记" /><button class="primary" id="n-new" title="Ctrl+N">新建</button></div>
          <div class="n-list"></div>
        </aside>
        <section class="n-editor"></section>
      </div>`;
    const search = box.querySelector<HTMLInputElement>(".l-search")!;
    search.value = noteQuery;
    search.addEventListener("input", () => {
      noteQuery = search.value;
      renderNoteList();
    });
    box.querySelector("#n-new")!.addEventListener("click", () => void newNote());
    renderNotes();
  }
  renderCount();
}

// renderCount shows on the 待办 tab how many todos are left, in red when
// some are overdue.
function renderCount() {
  const left = data.todos.filter((t) => !t.done);
  const count = panel!.querySelector<HTMLElement>(".n-count")!;
  count.textContent = left.length ? String(left.length) : "";
  count.classList.toggle("overdue", left.some((t) => t.due && dueInfo(t.due).overdue));
}

// ---- Todos ----

function bindAdd(box: HTMLElement) {
  const form = box.querySelector<HTMLFormElement>(".n-add")!;
  const input = form.querySelector("input")!;
  const star = form.querySelector<HTMLButtonElement>(".n-star")!;
  const hint = box.querySelector<HTMLElement>(".n-hint")!;
  const renderStar = () => {
    star.textContent = important ? "★" : "☆";
    star.classList.toggle("on", important);
  };
  const renderHint = () => {
    const q = parseQuick(input.value);
    hint.innerHTML = q.due
      ? `<span class="n-due">${q.repeat ? `🔁 ${REPEATS[q.repeat]} · ` : ""}${dueInfo(q.due).label}</span> ${q.due.includes("T") ? (q.repeat ? "每次到点都会提醒 · " : "到点会弹出提醒 · ") : ""}「${esc(q.text)}」`
      : `回车添加。可以直接写时间：明天 15:00 开会、周五 交报告、下午3点半 取快递、每天 8点 吃药${shortcutKeys("todo") ? `。随时按 ${shortcutKeys("todo")} 记一条` : ""}`;
  };
  star.addEventListener("click", () => {
    important = !important;
    renderStar();
    input.focus();
  });
  const imgs = box.querySelector<HTMLElement>(".n-add-imgs")!;
  renderAddImages = () => {
    imgs.innerHTML = thumbs(addImages, true);
    bindThumbs(imgs, addImages, (i) => {
      addImages.splice(i, 1);
      renderAddImages();
    });
  };
  form.querySelector(".n-pic")!.addEventListener("click", () =>
    void pickImages().then((urls) => {
      addImages.push(...urls);
      renderAddImages();
      input.focus();
    }, showError),
  );
  input.addEventListener("paste", (e) =>
    void pasteImages(e, (urls) => {
      addImages.push(...urls);
      renderAddImages();
    }),
  );
  input.addEventListener("input", renderHint);
  // Escape clears the box, then hides a window the shortcut brought up.
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (input.value) {
      input.value = "";
      renderHint();
    } else {
      void Launcher.dismiss();
    }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = parseQuick(input.value);
    if (!q.text) return;
    try {
      await Notes.saveTodo({ id: "", text: q.text, due: q.due, repeat: q.repeat, important, images: addImages } as Todo);
      input.value = "";
      important = false;
      addImages = [];
      renderAddImages();
      renderStar();
      renderHint();
      // Brought up by the shortcut, the window goes away again.
      void Launcher.dismiss();
    } catch (err) {
      showError(err);
    }
  });
  renderStar();
  renderHint();
  renderAddImages();
}

// ---- A todo's pictures ----

let renderAddImages = () => {};

// thumbs draws pictures small, each with ✕ to take it out when removable.
function thumbs(urls: string[], removable: boolean) {
  return urls
    .map(
      (u, i) =>
        `<span class="n-thumb" data-i="${i}"><img src="${esc(u)}" alt="" loading="lazy" draggable="false" />${removable ? `<button type="button" class="n-thumb-del" title="移除图片">✕</button>` : ""}</span>`,
    )
    .join("");
}

// bindThumbs opens a picture full size on a click, and takes it out on ✕.
function bindThumbs(box: HTMLElement, urls: string[], remove?: (i: number) => void) {
  box.querySelectorAll<HTMLElement>(".n-thumb").forEach((el) => {
    const i = Number(el.dataset.i);
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if ((e.target as HTMLElement).closest(".n-thumb-del")) remove?.(i);
      else lightbox(urls, i);
    });
  });
}

// saveImages keeps the pictures among files pasted or dropped in the page.
async function saveImages(files: File[]) {
  const urls: string[] = [];
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
    urls.push((await Notes.saveFile(f.name || `粘贴的图片.${f.type.split("/")[1] ?? "png"}`, data)).url);
  }
  return urls;
}

// pasteImages takes the pictures of a paste, as a screenshot, to add. It
// reports whether there were any; a paste of text goes on as usual.
function pasteImages(e: ClipboardEvent, add: (urls: string[]) => void) {
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
  if (!files.length) return false;
  e.preventDefault();
  void saveImages(files).then(add, showError);
  return true;
}

async function pickImages() {
  return ((await Notes.pickFiles("image", true)) ?? []).map((f) => f.url);
}

const imageExt = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

interface Group {
  name: string;
  todos: Todo[];
  className?: string;
}

function renderTodos() {
  const box = panel!.querySelector<HTMLElement>(".n-todos");
  if (!box) return;
  if (!data.todos.length) {
    box.innerHTML = `<div class="l-empty"><p>没有待办。</p><p class="muted">在上面输入要做的事，回车就加上了。</p></div>`;
    return;
  }
  // A step half typed stays through the redrawing, as when another todo
  // starts ringing meanwhile.
  const typing = typingSub ? box.querySelector<HTMLInputElement>(`.n-todo[data-id="${typingSub}"] .n-sub-new`) : null;
  const typed = typing && !typing.dataset.sent ? { value: typing.value, start: typing.selectionStart, end: typing.selectionEnd, focus: document.activeElement === typing } : null;
  const left = data.todos.filter((t) => !t.done);
  const groups: Group[] = [
    { name: "已逾期", todos: [], className: "overdue" },
    { name: "今天", todos: [] },
    { name: "以后", todos: [] },
    { name: "没有日期", todos: [] },
  ];
  for (const t of left) {
    const info = t.due ? dueInfo(t.due) : null;
    groups[!info ? 3 : info.overdue ? 0 : info.days === 0 ? 1 : 2]!.todos.push(t);
  }
  // Important ones first, then the soonest; the newest first otherwise.
  for (const g of groups) g.todos.sort((a, b) => Number(!!b.important) - Number(!!a.important) || (a.due ?? "").localeCompare(b.due ?? ""));
  const done = data.todos.filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  box.innerHTML =
    groups
      .filter((g) => g.todos.length)
      .map((g) => `<section><h2 class="${g.className ?? ""}">${g.name}<span>${g.todos.length}</span></h2>${g.todos.map(todoRow).join("")}</section>`)
      .join("") +
    (left.length ? "" : `<p class="muted n-all-done">全部完成了 🎉</p>`) +
    (done.length
      ? `<section class="n-done">
          <h2><button class="n-fold">${showDone ? "▾" : "▸"} 已完成<span>${done.length}</span></button><button class="n-clear">清除已完成</button></h2>
          ${showDone ? done.map(todoRow).join("") : ""}
        </section>`
      : "");
  box.querySelector(".n-fold")?.addEventListener("click", () => {
    showDone = !showDone;
    renderTodos();
  });
  box.querySelector(".n-clear")?.addEventListener("click", () => void Notes.clearDone().then((n) => toast(`已清除 ${n} 条`), showError));
  box.querySelectorAll<HTMLElement>(".n-todo").forEach((row) => {
    const t = data.todos.find((t) => t.id === row.dataset.id);
    if (!t) return;
    row.querySelector("input")!.addEventListener("change", (e) => {
      const done = (e.target as HTMLInputElement).checked;
      row.classList.toggle("done", done);
      // A moment to see it ticked before it moves to 已完成, or on to its
      // next time.
      setTimeout(
        () =>
          void Notes.saveTodo({ ...t, done }).then((n) => {
            if (done && n.repeat) toast(`下次：${dueInfo(n.due!).label}`);
          }, showError),
        done ? 350 : 0,
      );
    });
    row.querySelector(".n-body")!.addEventListener("click", () => editTodo(t));
    const imgs = row.querySelector<HTMLElement>(".n-imgs");
    if (imgs) bindThumbs(imgs, t.images!);
    bindSubs(row, t);
    row.querySelector(".n-imp")!.addEventListener("click", () => void Notes.saveTodo({ ...t, important: !t.important }).catch(showError));
    row.querySelector(".n-del")!.addEventListener("click", () => void deleteTodo(t));
    row.querySelector("[data-snooze]")?.addEventListener("click", () => void Notes.snooze(t.id, 10).then(() => toast("10 分钟后再提醒"), showError));
    row.querySelector(".n-ok")?.addEventListener("click", () => void Notes.dismiss(t.id).catch(showError));
  });
  const input = typingSub ? box.querySelector<HTMLInputElement>(`.n-todo[data-id="${typingSub}"] .n-sub-new`) : null;
  if (input) {
    if (typed?.value) {
      input.value = typed.value;
      input.setSelectionRange(typed.start, typed.end);
    }
    if (!typed || typed.focus) input.focus();
  }
}

// ---- A todo's steps ----

// saveSubs saves a todo's steps. The todo and its steps are one: the last
// step ticked off ticks the todo off too, which can be undone.
async function saveSubs(t: Todo, subs: SubTask[]) {
  const all = subs.length > 0 && subs.every((s) => s.done);
  const was = (t.subs ?? []).length > 0 && (t.subs ?? []).every((s) => s.done);
  try {
    if (all && !was && !t.done) {
      const n = await Notes.saveTodo({ ...t, subs, done: true });
      toast(n.repeat ? `子项都完成了，下次：${dueInfo(n.due!).label}` : `子项都完成了，「${t.text}」已完成`, {
        label: "撤销",
        run: () => void Notes.saveTodo({ ...n, done: false, due: t.due, subs: t.subs }).catch(showError),
      });
    } else await Notes.saveTodo({ ...t, subs });
  } catch (e) {
    showError(e);
  }
}

function bindSubs(row: HTMLElement, t: Todo) {
  const subs = t.subs ?? [];
  row.querySelector(".n-subs-n")?.addEventListener("click", () => {
    if (folded.has(t.id)) folded.delete(t.id);
    else folded.add(t.id);
    renderTodos();
  });
  // ＋子项 opens a box to type the first, or the next one.
  const startTyping = () => {
    folded.delete(t.id);
    typingSub = t.id;
    renderTodos();
  };
  row.querySelector(".n-sub-open")?.addEventListener("click", startTyping);
  row.querySelector(".n-sub-more")?.addEventListener("click", startTyping);
  const box = row.querySelector<HTMLElement>(".n-subs");
  if (!box) return;
  box.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    const id = el.closest<HTMLElement>("[data-sub]")?.dataset.sub;
    if (el.type !== "checkbox" || !id) return;
    void saveSubs(
      t,
      subs.map((s) => (s.id === id ? { ...s, done: el.checked } : s)),
    );
  });
  box.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>(".n-sub-del")?.closest<HTMLElement>("[data-sub]")?.dataset.sub;
    if (id) void saveSubs(
      t,
      subs.filter((s) => s.id !== id),
    );
  });
  const input = box.querySelector<HTMLInputElement>(".n-sub-new");
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      typingSub = "";
      renderTodos();
      return;
    }
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    const text = input.value.trim();
    if (!text || input.dataset.sent) return;
    // Enter adds it and stays for the next one.
    typingSub = t.id;
    input.dataset.sent = "1"; // what it holds is added: the next box starts empty
    void saveSubs(t, [...subs, { id: "", text, done: false }]);
  });
  input?.addEventListener("blur", () => {
    if (typingSub === t.id && !input.value) {
      typingSub = "";
      // Nothing typed: the box goes, after a click on something else.
      setTimeout(renderTodos, 150);
    }
  });
}

function subsList(t: Todo) {
  const subs = t.subs ?? [];
  return `
    <div class="n-subs">
      ${subs
        .map(
          (s) => `
        <div class="n-sub${s.done ? " done" : ""}" data-sub="${s.id}">
          <input type="checkbox" title="完成"${s.done ? " checked" : ""} />
          <span class="n-sub-text">${esc(s.text)}</span>
          <button class="n-sub-del" title="删除子项">✕</button>
        </div>`,
        )
        .join("")}
      ${t.done ? "" : typingSub === t.id ? `<input class="n-sub-new" placeholder="添加子项，回车保存，Esc 结束" maxlength="300" />` : `<button class="n-sub-more">＋ 添加子项</button>`}
    </div>`;
}

function todoRow(t: Todo) {
  const info = t.due ? dueInfo(t.due) : null;
  const detail = t.detail?.split("\n")[0];
  return `
    <div class="n-todo${t.done ? " done" : ""}${t.alert && !t.done ? " ringing" : ""}" data-id="${t.id}">
      <input type="checkbox" title="完成"${t.done ? " checked" : ""} />
      <button class="n-body" title="编辑"><span class="n-text">${esc(t.text)}</span>${detail ? `<span class="n-detail muted">${esc(detail)}</span>` : ""}</button>
      ${info ? `<span class="n-due${info.overdue && !t.done ? " overdue" : ""}" title="${esc(dueTitle(t))}">${t.repeat ? "🔁 " : t.due!.includes("T") ? "⏰ " : ""}${info.label}</span>` : ""}
      ${subsChip(t)}
      ${t.alert && !t.done ? `<span class="n-ring"><button data-snooze="10" title="10 分钟后再提醒">稍后</button><button class="n-ok" title="不再提醒">知道了</button></span>` : ""}
      ${t.subs?.length || t.done ? "" : `<button class="n-sub-open" title="添加子项">＋子项</button>`}
      <button class="n-imp${t.important ? " on" : ""}" title="重要">${t.important ? "★" : "☆"}</button>
      <button class="n-del" title="删除">✕</button>
      ${t.images?.length ? `<div class="n-thumbs n-imgs">${thumbs(t.images, false)}</div>` : ""}
      ${(t.subs?.length && !folded.has(t.id)) || typingSub === t.id ? subsList(t) : ""}
    </div>`;
}

// subsChip shows how many steps are done, and opens them.
function subsChip(t: Todo) {
  const subs = t.subs ?? [];
  if (!subs.length) return "";
  const done = subs.filter((s) => s.done).length;
  const pct = Math.round((done / subs.length) * 100);
  const open = !folded.has(t.id);
  return `<button class="n-subs-n${done === subs.length ? " all" : ""}" title="${open ? "收起子项" : "展开子项"}" style="--pct:${pct}%"><span class="n-subs-bar"></span>${done}/${subs.length}${open ? " ▾" : " ▸"}</button>`;
}


function dueTitle(t: Todo) {
  let s = t.due!.replace("T", " ");
  if (t.repeat) s += ` · ${REPEATS[t.repeat]}重复，完成后到下一次`;
  if (t.snooze) s += ` · 稍后 ${t.snooze.slice(11)} 再提醒`;
  return s;
}

async function deleteTodo(t: Todo) {
  try {
    // Back where it was, as it was: with its ID, and no ringing again.
    const at = data.todos.findIndex((o) => o.id === t.id);
    await Notes.deleteTodo(t.id);
    toast(`已删除「${t.text}」`, { label: "撤销", run: () => void Notes.restoreTodo(t, at).catch(showError) });
  } catch (e) {
    showError(e);
  }
}

function editTodo(t: Todo) {
  const dlg = openDialog(`
    <form method="dialog">
      <h2>编辑待办</h2>
      <label>内容<input name="text" required maxlength="500" /></label>
      <label>备注<textarea name="detail" rows="3" placeholder="可选"></textarea></label>
      <div class="n-edit-subs"><span class="n-edit-label">子项</span><div class="n-edit-sublist"></div><button type="button" data-addsub>＋ 添加子项</button></div>
      <div class="n-edit-imgs"><span class="n-edit-label">图片<span class="muted">可以直接粘贴截图，或把图片拖进来</span></span><div class="n-thumbs"></div><button type="button" data-addimg>＋ 添加图片</button></div>
      <div class="l-row n-when">
        <label>日期<input type="date" name="date" /></label>
        <label>时间（24 小时）<input name="time" placeholder="如 15:00" maxlength="5" autocomplete="off" /></label>
        <button type="button" data-clear>清除</button>
      </div>
      <div class="n-times">${["09:00", "12:00", "14:00", "18:00", "20:00", "22:00"].map((t) => `<button type="button" data-time="${t}">${t}</button>`).join("")}</div>
      <label>重复<select name="repeat"><option value="">不重复</option>${Object.entries(REPEATS)
        .map(([v, name]) => `<option value="${v}">${name}</option>`)
        .join("")}</select></label>
      <p class="muted n-tip">设了时间的待办，到点悬浮球旁会弹出提醒（球上亮红点），点「稍后」可以推迟。重复的待办完成后自动排到下一次；没完成的，到下一次时间也会再提醒。</p>
      <label class="l-check"><input type="checkbox" name="important" /> 重要</label>
      <p class="l-error" hidden></p>
      <div class="l-buttons"><button type="button" class="danger" data-delete>删除</button><span class="l-spacer"></span><button type="button" data-close>取消</button><button class="primary" type="submit">保存</button></div>
    </form>`);
  const form = dlg.querySelector("form")!;
  const field = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
  field("text").value = t.text;
  field("detail").value = t.detail ?? "";
  field("date").value = t.due?.slice(0, 10) ?? "";
  field("time").value = t.due?.slice(11) ?? "";
  field("important").checked = !!t.important;
  const repeat = form.elements.namedItem("repeat") as HTMLSelectElement;
  repeat.value = t.repeat ?? "";
  // The steps: a line each, with its tick; Enter in one adds the next.
  const subList = dlg.querySelector<HTMLElement>(".n-edit-sublist")!;
  const addSubLine = (s: SubTask = { id: "", text: "", done: false }, focus = false) => {
    const line = document.createElement("div");
    line.className = "n-edit-sub";
    line.dataset.id = s.id;
    line.innerHTML = `<input type="checkbox" title="完成"${s.done ? " checked" : ""} /><input class="n-edit-subtext" maxlength="300" placeholder="子项内容" /><button type="button" title="删除">✕</button>`;
    const text = line.querySelector<HTMLInputElement>(".n-edit-subtext")!;
    text.value = s.text;
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        addSubLine(undefined, true);
      }
    });
    line.querySelector("button")!.addEventListener("click", () => line.remove());
    subList.appendChild(line);
    if (focus) text.focus();
  };
  (t.subs ?? []).forEach((s) => addSubLine(s));
  // The pictures: pasted anywhere in the dialog, dropped on the window, or
  // picked.
  const images = [...(t.images ?? [])];
  const imgBox = dlg.querySelector<HTMLElement>(".n-edit-imgs .n-thumbs")!;
  const renderImages = () => {
    imgBox.innerHTML = thumbs(images, true);
    bindThumbs(imgBox, images, (i) => {
      images.splice(i, 1);
      renderImages();
    });
  };
  const addImgs = (urls: string[]) => {
    images.push(...urls);
    renderImages();
  };
  renderImages();
  dlg.querySelector("[data-addimg]")!.addEventListener("click", () => void pickImages().then(addImgs, showError));
  dlg.addEventListener("paste", (e) => void pasteImages(e, addImgs));
  editImages = addImgs;
  dlg.addEventListener("close", () => {
    if (editImages === addImgs) editImages = null;
  });
  dlg.querySelector("[data-addsub]")!.addEventListener("click", () => addSubLine(undefined, true));
  const readSubs = (): SubTask[] =>
    [...subList.querySelectorAll<HTMLElement>(".n-edit-sub")].map((l) => ({
      id: l.dataset.id ?? "",
      text: l.querySelector<HTMLInputElement>(".n-edit-subtext")!.value,
      done: l.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked,
    }));
  // Repeating needs a day to start from.
  repeat.addEventListener("change", () => {
    if (repeat.value && !field("date").value) field("date").value = ymd(new Date());
  });
  // A time without a date is today's; 9, 930 and 9:5 become 09:00, 09:30
  // and 09:05.
  const fixTime = () => {
    const t = parseTime(field("time").value);
    if (t) field("time").value = t;
    if (t && !field("date").value) field("date").value = ymd(new Date());
    return t;
  };
  field("time").addEventListener("change", fixTime);
  dlg.querySelectorAll<HTMLElement>("[data-time]").forEach((b) =>
    b.addEventListener("click", () => {
      field("time").value = b.dataset.time!;
      fixTime();
    }),
  );
  dlg.querySelector("[data-clear]")!.addEventListener("click", () => {
    field("date").value = "";
    field("time").value = "";
    repeat.value = "";
  });
  dlg.querySelector("[data-delete]")!.addEventListener("click", () => {
    dlg.close();
    void deleteTodo(t);
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = field("time").value.trim();
    const time = raw ? fixTime() : "";
    const date = field("date").value;
    const fail = (msg: string) => {
      const p = dlg.querySelector<HTMLElement>(".l-error")!;
      p.textContent = msg;
      p.hidden = false;
    };
    if (raw && time === null) return fail("时间要写成 24 小时制，如 08:30、15:00、21:45");
    if (repeat.value && !date) return fail("重复的待办要有日期");
    try {
      await Notes.saveTodo({ ...t, text: field("text").value, detail: field("detail").value, due: date + (time ? "T" + time : ""), repeat: repeat.value, important: field("important").checked, subs: readSubs(), images });
      dlg.close();
    } catch (err) {
      const p = dlg.querySelector<HTMLElement>(".l-error")!;
      p.textContent = errorText(err);
      p.hidden = false;
    }
  });
}

// ---- Dates ----

// parseTime reads a time of day as 24-hour HH:MM: 9, 930, 9:5, 21点,
// 21:30; "" for nothing, null for no time.
function parseTime(s: string): string | null {
  s = s.trim().replace("：", ":").replace(/点$/, "");
  if (!s) return "";
  const m = s.match(/^(\d{1,2})(?:[:.](\d{1,2})|(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? m[3] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

function ymd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// parseQuick takes the day and the time out of a new todo's text, as in
// 明天 15:00 开会, 周五 交报告 or 下午3点半 取快递, and returns the rest
// and the due. A time without a day is the next such time; 1点 to 6点
// without 上午 are in the afternoon, and 今晚8点 is 20:00. 每天, 工作日,
// 每周五, 每月15号 and 每年3月5日 make it repeat, from the first such day.
export function parseQuick(input: string, now = new Date()): { text: string; due: string; repeat: string } {
  let text = input;
  let day = null as Date | null;
  let hour = -1;
  let minute = 0;
  let defaultHour = -1; // 今晚 without a time is at 20:00
  let half = ""; // 今晚 and 明晚 say 晚上 for the time, 明早 says 早上
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean) => {
    const m = text.match(re);
    if (m && fn(m)) text = text.slice(0, m.index) + " " + text.slice(m.index! + m[0].length);
  };
  const today = startOfDay(now);
  // The next such day of the week, today included: 0 is Monday, 6 Sunday.
  const weekday = (want: number) => addDays(today, (want - ((today.getDay() + 6) % 7) + 7) % 7);
  let repeat = "";
  take(/(?:每个?)?工作日(?![志报记])|每[天日]/, (m) => {
    repeat = m[0].endsWith("工作日") ? "weekday" : "day";
    return true;
  });
  if (!repeat)
    take(/每个?(?:周|星期|礼拜)([一二三四五六日天])?/, (m) => {
      repeat = "week";
      if (m[1]) day = weekday(Math.min("一二三四五六日天".indexOf(m[1]), 6));
      return true;
    });
  if (!repeat)
    take(/每个?月(?:(\d{1,2})[日号])?/, (m) => {
      repeat = "month";
      const date = Number(m[1] ?? 0);
      if (!m[1]) return true;
      if (date < 1 || date > 31) return false;
      // This month's, unless it passed; the month's last day for a 31号
      // it does not have.
      const on = (y: number, mo: number) => new Date(y, mo, Math.min(date, new Date(y, mo + 1, 0).getDate()));
      day = on(today.getFullYear(), today.getMonth());
      if (day < today) day = on(today.getFullYear(), today.getMonth() + 1);
      return true;
    });
  if (!repeat)
    take(/每年/, () => {
      repeat = "year";
      return true;
    });
  if (!day)
    take(/(大后天|后天|明天|今天|今晚|明早|明晚)/, (m) => {
      const word = m[1]!;
      day = addDays(today, { 今天: 0, 今晚: 0, 明天: 1, 明早: 1, 明晚: 1, 后天: 2, 大后天: 3 }[word]!);
      if (word.endsWith("晚")) [defaultHour, half] = [20, "晚上"];
      if (word === "明早") [defaultHour, half] = [9, "早上"];
      return true;
    });
  if (!day)
    take(/(下)?(?:周|星期|礼拜)([一二三四五六日天])/, (m) => {
      const want = Math.min("一二三四五六日天".indexOf(m[2]!), 6);
      day = m[1] ? addDays(today, 7 - ((today.getDay() + 6) % 7) + want) : weekday(want);
      return true;
    });
  if (!day)
    take(/(\d{1,2})月(\d{1,2})[日号]?/, (m) => {
      const month = Number(m[1]) - 1;
      const date = Number(m[2]);
      if (month > 11 || date < 1 || date > 31) return false;
      let d = new Date(today.getFullYear(), month, date);
      if (d < today) d = new Date(today.getFullYear() + 1, month, date);
      if (d.getDate() !== date) return false; // 2月30日
      day = d;
      return true;
    });
  take(/(上午|早上|中午|下午|傍晚|晚上)?\s*(?<!\d)(\d{1,2})(?:[:：](\d{2})|点(?:(半)|(\d{1,2})分?)?)/, (m) => {
    let h = Number(m[2]);
    const min = m[3] ? Number(m[3]) : m[4] ? 30 : m[5] ? Number(m[5]) : 0;
    const when = m[1] ?? half;
    if ((when === "下午" || when === "傍晚" || when === "晚上") && h < 12) h += 12;
    if (when === "中午" && h < 3) h += 12;
    // 3点 alone is in the afternoon: nobody plans for 3 at night.
    if (!when && h >= 1 && h <= 6) h += 12;
    if (h > 23 || min > 59) return false;
    // 晚上12点 is the midnight that ends the day.
    if (when === "晚上" && h === 12) [h, day] = [0, addDays(day ?? today, 1)];
    hour = h;
    minute = min;
    return true;
  });
  if (hour < 0 && defaultHour >= 0) hour = defaultHour;
  // Only a time, as 晚上8点, is the text too.
  text = text.replace(/\s+/g, " ").trim() || input.trim();
  if (hour >= 0 && !day) {
    // The next such time: today's, unless it passed.
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute);
    day = at > now ? today : addDays(today, 1);
  }
  // Repeating starts today, or on the next working day.
  if (repeat && !day) day = today;
  if (repeat === "weekday") while (day!.getDay() % 6 === 0) day = addDays(day!, 1);
  if (!day) return { text, due: "", repeat };
  return { text, due: ymd(day) + (hour >= 0 ? `T${pad(hour)}:${pad(minute)}` : ""), repeat };
}

// ---- Notes ----

// The editor, with TipTap and KaTeX, is most of the page's code. It loads
// when the notes first show, so that the floating ball, the bubble and the
// overlay, which are this page too, and the toolbox's start do without it.
let editorLib: typeof import("./editor") | null = null;
let editorLoading: Promise<void> | null = null;

function loadEditor() {
  return (editorLoading ??= import("./editor").then(
    (lib) => {
      editorLib = lib;
      if (shown() && view === "notes") renderEditor();
    },
    (e) => {
      editorLoading = null; // the next note tries again
      throw e;
    },
  ));
}

// noteText is a note's text, a line a block, for its title, its preview
// and the search.
function noteText(body: string) {
  if (!/^\s*</.test(body)) return body;
  const doc = new DOMParser().parseFromString(body.replace(/<\/(p|h[1-6]|li|blockquote|pre|div)>|<br\s*\/?>/gi, "$&\n"), "text/html");
  return (doc.body.textContent ?? "").replace(/\n{2,}/g, "\n");
}

// The text of the notes' bodies, which are HTML, by body.
const texts = new Map<string, string>();

function textOf(n: Note) {
  let t = texts.get(n.body);
  if (t === undefined) {
    if (texts.size > 500) texts.clear();
    t = noteText(n.body);
    texts.set(n.body, t);
  }
  return t;
}

function title(n: Note) {
  return textOf(n).trim().split("\n")[0]!.trim().slice(0, 80) || "新笔记";
}

function sortedNotes() {
  const q = noteQuery.trim().toLowerCase();
  return data.notes
    .filter((n) => !q || textOf(n).toLowerCase().includes(q))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updated - a.updated);
}

function renderNotes() {
  if (!data.notes.some((n) => n.id === noteID)) noteID = sortedNotes()[0]?.id ?? "";
  renderNoteList();
  renderEditor();
}

function renderNoteList() {
  const list = panel!.querySelector<HTMLElement>(".n-list");
  if (!list) return;
  const notes = sortedNotes();
  list.innerHTML = notes.length
    ? notes
        .map((n) => {
          const rest = textOf(n).trim().split("\n").slice(1).join(" ").trim();
          return `
            <button class="n-item${n.id === noteID ? " active" : ""}" data-id="${n.id}">
              <span class="n-title">${n.pinned ? "📌 " : ""}${esc(title(n))}</span>
              <span class="n-meta muted">${shortTime(n.updated)}　${esc(rest.slice(0, 60))}</span>
            </button>`;
        })
        .join("")
    : `<p class="muted n-none">${noteQuery.trim() ? "没有找到" : "还没有笔记"}</p>`;
  list.querySelectorAll<HTMLElement>(".n-item").forEach((b) => b.addEventListener("click", () => openNote(b.dataset.id!)));
}

let ed: NoteEditor | null = null; // the editor and the note it shows
let edID = "";
let saveTimer = 0;
let pending = ""; // what waits for the pause to be saved
let saving: Promise<unknown> = Promise.resolve();

function destroyEditor() {
  flush();
  ed?.destroy();
  ed = null;
  edID = "";
}

function renderEditor() {
  const box = panel!.querySelector<HTMLElement>(".n-editor");
  if (!box) return;
  const note = data.notes.find((n) => n.id === noteID);
  if (!note) {
    destroyEditor();
    box.innerHTML = `<div class="l-empty n-blank"><p>${data.notes.length ? "选一篇笔记" : "还没有笔记"}</p><p class="muted">点「新建」或按 Ctrl+N 写一篇。第一行是标题；输入 / 调出命令和 AI 写作，选中文字可以设置格式；边写边自动保存。</p></div>`;
    return;
  }
  if (ed && edID === note.id && box.querySelector(".n-doc")) {
    // Our own save coming back, maybe older than what the editor has: only
    // the editor writes a note, so it keeps what it has.
    renderBar(note);
    return;
  }
  const lib = editorLib;
  if (!lib) {
    // It draws the note once it is there.
    void loadEditor().catch(showError);
    return;
  }
  destroyEditor();
  box.innerHTML = `
    <div class="n-bar">
      <span class="muted n-status"></span>
      <span class="l-spacer"></span>
      <button class="n-pin"></button>
      <button class="n-copy" title="复制为纯文本">复制</button>
      <button class="n-remove danger">删除</button>
    </div>
    <div class="n-doc"></div>`;
  edID = note.id;
  const id = note.id;
  ed = lib.createEditor(
    box.querySelector<HTMLElement>(".n-doc")!,
    lib.noteHTML(note.body),
    (html) => {
      box.querySelector(".n-status")!.textContent = "正在保存…";
      pending = html;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = 0;
        void save(id, pending);
      }, 400);
    },
    () => {
      const n = data.notes.find((n) => n.id === id);
      return n ? title(n) : "";
    },
  );
  ed.editor.on("blur", flush);
  box.querySelector(".n-pin")!.addEventListener("click", () => {
    const n = data.notes.find((n) => n.id === noteID);
    if (n) void Notes.saveNote({ ...n, pinned: !n.pinned }).catch(showError);
  });
  box.querySelector(".n-copy")!.addEventListener("click", () => void navigator.clipboard.writeText(ed?.editor.getText({ blockSeparator: "\n" }) ?? "").then(() => toast("已复制"), showError));
  box.querySelector(".n-remove")!.addEventListener("click", () => void deleteNote());
  renderBar(note);
}

function renderBar(note: Note) {
  const box = panel!.querySelector<HTMLElement>(".n-editor")!;
  if (!saveTimer) box.querySelector(".n-status")!.textContent = `已保存 · ${shortTime(note.updated)} · ${[...textOf(note).replace(/\s/g, "")].length} 字`;
  box.querySelector(".n-pin")!.textContent = note.pinned ? "取消置顶" : "置顶";
}

function save(id: string, body: string) {
  const n = data.notes.find((n) => n.id === id);
  if (!n) return;
  saving = Notes.saveNote({ ...n, body }).catch(showError);
  return saving;
}

// flush saves what is typed at once, rather than after the pause.
function flush() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = 0;
  void save(edID, pending);
}

async function openNote(id: string) {
  if (id === noteID) return;
  flush();
  await saving;
  // A note left empty goes.
  const prev = data.notes.find((n) => n.id === noteID);
  if (prev && !prev.body.trim()) void Notes.deleteNote(prev.id);
  noteID = id;
  renderNoteList();
  renderEditor();
}

async function newNote() {
  try {
    const n = await Notes.saveNote({ id: "", body: "" } as Note);
    if (!data.notes.some((m) => m.id === n.id)) data.notes.push(n);
    noteQuery = "";
    panel!.querySelector<HTMLInputElement>(".n-side .l-search")!.value = "";
    await loadEditor();
    await openNote(n.id);
    ed?.editor.commands.focus();
  } catch (e) {
    showError(e);
  }
}

async function deleteNote() {
  flush();
  await saving;
  const n = data.notes.find((n) => n.id === noteID);
  if (!n) return;
  try {
    await Notes.deleteNote(n.id);
    if (n.body.trim()) toast(`已删除「${title(n)}」`, { label: "撤销", run: () => void Notes.saveNote({ ...n, id: "" }).catch(showError) });
  } catch (e) {
    showError(e);
  }
}

// shortTime is 15:20 today, 昨天, or 11月9日.
function shortTime(ms: number) {
  const d = new Date(ms);
  const days = Math.round((startOfDay(new Date()).getTime() - startOfDay(d).getTime()) / 86400000);
  if (days === 0) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (days === 1) return "昨天";
  return d.getFullYear() === new Date().getFullYear() ? `${d.getMonth() + 1}月${d.getDate()}日` : ymd(d);
}

// Ctrl+N writes a new note, Ctrl+F searches them.
document.addEventListener("keydown", (e) => {
  if (!shown() || view !== "notes" || !e.ctrlKey || document.querySelector("dialog[open]")) return;
  if (e.key === "n") {
    e.preventDefault();
    void newNote();
  } else if (e.key === "f") {
    e.preventDefault();
    panel!.querySelector<HTMLInputElement>(".n-side .l-search")?.focus();
  }
});

// Files dropped on the window while a note shows go into it: pictures and
// videos to see, others as attachments. Pictures dropped on the todos go
// with the todo being edited, or else the one being added.
onFileDrop(({ paths }) => {
  if (shown() && view === "todos") {
    const pics = paths.filter((p) => imageExt.test(p));
    if (!pics.length) return;
    void Notes.importFiles(pics).then((files) => {
      const urls = (files ?? []).map((f) => f.url);
      if (editImages) editImages(urls);
      else {
        addImages.push(...urls);
        renderAddImages();
      }
    }, showError);
    return;
  }
  if (!shown() || view !== "notes" || !ed || !paths.length) return;
  const target = ed;
  void Notes.importFiles(paths).then((files) => target.insertFiles(files ?? []), showError);
});

addEventListener("beforeunload", flush);
