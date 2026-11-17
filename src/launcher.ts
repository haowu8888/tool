// The launcher tool: the user's apps in categories, started with a click,
// or from the search box that Ctrl+Alt+Space brings up.
import { onFileDrop } from "mygo-runtime";
import { icons as toolIcons } from "./icons";
import { Launcher, events, type InstalledApp, type LauncherApp, type LauncherData } from "./mygo";
import { shortcutKeys } from "./settings";
import { baseName, errorText, esc, openDialog, showError, toast } from "./ui";

const ALL = "*"; // the 全部 filter
const NONE = ""; // the category of uncategorized apps

let data: LauncherData = { categories: [], apps: [] };
let filter = ALL; // a category ID, ALL or NONE
let query = "";
let selected = 0; // the highlighted tile of the search results
let panel: HTMLElement | null = null; // the panel while it shows the launcher
const icons = new Map<string, string>(); // path → data URL, "" for none

export const launcherTool = {
  id: "launcher",
  name: "快捷启动",
  icon: toolIcons.launcher,
  render(p: HTMLElement) {
    panel = p;
    p.innerHTML = `
      <div class="l-head">
        <h1>快捷启动</h1>
        <div class="l-actions">
          <button id="l-installed">从已装软件添加</button>
          <button class="primary" id="l-add">新增</button>
        </div>
      </div>
      <input class="l-search" type="search" placeholder="搜索名称、拼音首字母或路径，回车运行${shortcutKeys("launcher") ? `（随时按 ${shortcutKeys("launcher")} 调出）` : ""}" />
      <nav class="l-cats"></nav>
      <div class="l-body"></div>
      <p class="muted l-hint">单击运行 · 右键更多操作 · 拖动排序，拖到上面的分类上可换分类 · 把文件或快捷方式拖进窗口直接添加</p>`;
    const search = p.querySelector<HTMLInputElement>(".l-search")!;
    search.value = query;
    search.addEventListener("input", () => {
      query = search.value;
      selected = 0;
      renderBody();
    });
    search.addEventListener("keydown", (e) => {
      const results = visibleApps();
      if (e.key === "Enter" && results.length) {
        e.preventDefault();
        void launch(results[Math.min(selected, results.length - 1)]!.id, e.ctrlKey && e.shiftKey);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        selected = Math.max(0, Math.min(results.length - 1, selected + (e.key === "ArrowDown" ? 1 : -1)));
        renderBody();
      }
    });
    p.querySelector("#l-add")!.addEventListener("click", () => editApp());
    p.querySelector("#l-installed")!.addEventListener("click", () => void pickInstalled());
    void Launcher.list().then(setData, showError);
    render();
  },
};

// focusSearch selects the launcher's search box, for the shortcut.
export function focusSearch() {
  const search = panel?.querySelector<HTMLInputElement>(".l-search");
  if (!search) return;
  search.focus();
  search.select();
}

events.launcherChanged.on(setData);

function setData(d: LauncherData) {
  // Go leaves out an empty category.
  for (const a of d.apps) a.category ??= NONE;
  data = d;
  render();
}

// Escape hides the window that the shortcut brought up.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && shown() && !document.querySelector("dialog[open]") && !closeMenu()) {
    if (query) {
      query = "";
      panel!.querySelector<HTMLInputElement>(".l-search")!.value = "";
      renderBody();
    } else {
      void Launcher.dismiss();
    }
  }
});

// Files dropped on the window are added to the category shown.
onFileDrop(({ paths }) => {
  if (!shown() || !paths.length) return;
  const category = filter === ALL ? NONE : filter;
  const apps = paths.map((path) => ({ id: "", name: baseName(path), path, category }) as LauncherApp);
  void Launcher.addApps(apps).then((n) => toast(n ? `已添加 ${n} 项` : "已经在列表里了"), showError);
});

function shown() {
  return !!panel?.isConnected && !!panel.querySelector(".l-search");
}

function render() {
  if (!shown()) return;
  if (filter !== ALL && filter !== NONE && !data.categories.some((c) => c.id === filter)) filter = ALL;
  renderCats();
  renderBody();
}

function renderCats() {
  const nav = panel!.querySelector<HTMLElement>(".l-cats")!;
  const count = (id: string) => data.apps.filter((a) => a.category === id).length;
  const uncategorized = count(NONE);
  const chips = [
    { id: ALL, name: "全部", n: data.apps.length },
    ...data.categories.map((c) => ({ id: c.id, name: c.name, n: count(c.id) })),
    ...(uncategorized ? [{ id: NONE, name: "未分类", n: uncategorized }] : []),
  ];
  nav.innerHTML =
    chips
      .map((c) => `<button class="l-chip${c.id === filter ? " active" : ""}" data-cat="${esc(c.id)}">${esc(c.name)}<span>${c.n}</span></button>`)
      .join("") + `<button class="l-chip l-manage" title="管理分类">⚙ 管理分类</button>`;
  nav.querySelectorAll<HTMLElement>(".l-chip[data-cat]").forEach((chip) => {
    const id = chip.dataset.cat!;
    chip.addEventListener("click", () => {
      filter = id;
      render();
    });
    // Dropping a tile on a category moves it there.
    if (id === ALL) return;
    chip.addEventListener("dragover", (e) => {
      if (!dragged) return;
      e.preventDefault();
      chip.classList.add("drop");
    });
    chip.addEventListener("dragleave", () => chip.classList.remove("drop"));
    chip.addEventListener("drop", (e) => {
      e.preventDefault();
      chip.classList.remove("drop");
      if (dragged) void Launcher.moveApp(dragged, id, "").catch(showError);
    });
  });
  nav.querySelector(".l-manage")!.addEventListener("click", manageCategories);
}

// visibleApps returns the apps the search or the filter shows, in order.
function visibleApps(): LauncherApp[] {
  const q = query.trim().toLowerCase();
  if (q) {
    return data.apps
      .map((a) => ({ a, rank: matchRank(a.name, a.path, q) }))
      .filter((m) => m.rank >= 0)
      .sort((x, y) => x.rank - y.rank || (y.a.launches ?? 0) - (x.a.launches ?? 0))
      .map((m) => m.a);
  }
  return filter === ALL ? data.apps : data.apps.filter((a) => a.category === filter);
}

function renderBody() {
  if (!shown()) return;
  const body = panel!.querySelector<HTMLElement>(".l-body")!;
  if (!data.apps.length) {
    body.innerHTML = `
      <div class="l-empty">
        <p>还没有添加任何软件。</p>
        <p class="muted">点「从已装软件添加」勾选电脑上装好的软件（如 Everything、CCleaner），或点「新增」手动添加，也可以直接把 exe / 快捷方式拖进窗口。</p>
      </div>`;
    return;
  }
  if (query.trim()) {
    const results = visibleApps();
    body.innerHTML = results.length ? grid(results, NONE, true) : `<p class="muted">没有找到「${esc(query.trim())}」</p>`;
  } else if (filter === ALL) {
    const sections = [...data.categories, { id: NONE, name: "未分类" }]
      .map((c) => ({ c, apps: data.apps.filter((a) => a.category === c.id) }))
      .filter((s) => s.apps.length || s.c.id !== NONE);
    body.innerHTML = sections
      .map((s) => `<section><h2>${esc(s.c.name)}</h2>${s.apps.length ? grid(s.apps, s.c.id) : `<div class="l-grid l-drop-empty" data-cat="${esc(s.c.id)}"><span class="muted">拖到这里</span></div>`}</section>`)
      .join("");
  } else {
    const apps = visibleApps();
    body.innerHTML = apps.length ? grid(apps, filter) : `<div class="l-grid l-drop-empty" data-cat="${esc(filter)}"><span class="muted">这个分类还是空的：点「新增」，或把其他分类的图标拖到这里</span></div>`;
  }
  bindTiles(body);
  loadIcons(body);
}

function grid(apps: LauncherApp[], category: string, searching = false) {
  return `<div class="l-grid" data-cat="${esc(category)}">${apps
    .map(
      (a, i) => `
        <button class="l-tile${searching && i === Math.min(selected, apps.length - 1) ? " selected" : ""}" data-id="${a.id}" draggable="${!searching}" title="${esc(a.path + (a.args ? " " + a.args : ""))}">
          ${iconHTML(a.path, a.name)}
          <span class="l-name">${esc(a.name)}</span>
          ${a.admin ? `<span class="l-badge" title="以管理员身份运行">🛡</span>` : ""}
        </button>`,
    )
    .join("")}</div>`;
}

function iconHTML(path: string, name: string) {
  const url = icons.get(path);
  return url
    ? `<img class="l-icon" src="${url}" alt="" data-icon="${esc(path)}" />`
    : `<span class="l-icon l-fallback" data-icon="${esc(path)}">${esc([...name][0] ?? "?")}</span>`;
}

// loadIcons fetches the icons of the elements, a batch at a time, so that
// the page stays responsive. Icons shown already are asked for again: Go
// draws a file's icon anew once the file changed, as a new build of a
// program, and answers from its cache otherwise.
function loadIcons(root: HTMLElement) {
  const pending = [...new Set([...root.querySelectorAll<HTMLElement>("[data-icon]")].map((e) => e.dataset.icon!))];
  const batch = async () => {
    const paths = pending.splice(0, 16);
    if (!paths.length || !root.isConnected) return;
    const got = await Launcher.icons(paths);
    for (const [p, url] of Object.entries(got)) {
      const had = icons.get(p);
      icons.set(p, url);
      if (!url || url === had) continue;
      root.querySelectorAll<HTMLElement>("[data-icon]").forEach((e) => {
        if (e.dataset.icon === p) e.outerHTML = `<img class="l-icon" src="${url}" alt="" data-icon="${esc(p)}" />`;
      });
    }
    await batch();
  };
  void batch().catch(() => {});
}

let dragged: string | null = null; // the ID of the tile being dragged

function bindTiles(body: HTMLElement) {
  body.querySelectorAll<HTMLElement>(".l-tile").forEach((tile) => {
    const id = tile.dataset.id!;
    tile.addEventListener("click", (e) => void launch(id, e.ctrlKey && e.shiftKey));
    tile.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openMenu(id, e.clientX, e.clientY);
    });
    tile.addEventListener("dragstart", (e) => {
      dragged = id;
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", id);
      tile.classList.add("dragging");
    });
    tile.addEventListener("dragend", () => {
      dragged = null;
      tile.classList.remove("dragging");
      body.querySelectorAll(".drop-before").forEach((t) => t.classList.remove("drop-before"));
    });
    tile.addEventListener("dragover", (e) => {
      if (!dragged || dragged === id) return;
      e.preventDefault();
      e.stopPropagation();
      tile.classList.add("drop-before");
    });
    tile.addEventListener("dragleave", () => tile.classList.remove("drop-before"));
    tile.addEventListener("drop", (e) => {
      if (!dragged) return;
      e.preventDefault();
      e.stopPropagation();
      tile.classList.remove("drop-before");
      const category = data.apps.find((a) => a.id === id)?.category ?? NONE;
      if (dragged !== id) void Launcher.moveApp(dragged, category, id).catch(showError);
    });
  });
  // Dropping on a grid's free space puts the tile at that category's end.
  body.querySelectorAll<HTMLElement>(".l-grid[data-cat]").forEach((g) => {
    g.addEventListener("dragover", (e) => {
      if (dragged && !query.trim()) e.preventDefault();
    });
    g.addEventListener("drop", (e) => {
      if (!dragged || query.trim()) return;
      e.preventDefault();
      void Launcher.moveApp(dragged, g.dataset.cat!, "").catch(showError);
    });
  });
}

async function launch(id: string, admin: boolean) {
  try {
    await Launcher.launch(id, admin);
    const app = data.apps.find((a) => a.id === id);
    if (app) toast(`已启动 ${app.name}`);
  } catch (e) {
    showError(e);
  }
}

// The context menu of a tile.
function openMenu(id: string, x: number, y: number) {
  closeMenu();
  const app = data.apps.find((a) => a.id === id);
  if (!app) return;
  const menu = document.createElement("div");
  menu.className = "l-menu";
  const local = !app.path.includes("://") && !app.path.startsWith("shell:");
  const items: [string, () => void][] = [
    ["运行", () => void launch(id, false)],
    ["以管理员身份运行", () => void launch(id, true)],
    ...(local ? ([["打开所在位置", () => void Launcher.reveal(id).catch(showError)]] as [string, () => void][]) : []),
    ["编辑", () => editApp(app)],
    [
      "删除",
      () => {
        // Undone, it goes back in front of the one that came after it.
        const next = data.apps[data.apps.indexOf(app) + 1]?.id ?? "";
        void Launcher.deleteApp(id).then(
          () => toast(`已删除 ${app.name}`, { label: "撤销", run: () => void Launcher.restoreApp(app, next).catch(showError) }),
          showError,
        );
      },
    ],
  ];
  for (const [label, fn] of items) {
    const b = document.createElement("button");
    b.textContent = label;
    if (label === "删除") b.className = "danger";
    b.addEventListener("click", () => {
      closeMenu();
      fn();
    });
    menu.append(b);
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  setTimeout(() => document.addEventListener("mousedown", onOutside), 0);
}

function onOutside(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest(".l-menu")) closeMenu();
}

// closeMenu closes the context menu and reports whether one was open.
function closeMenu() {
  document.removeEventListener("mousedown", onOutside);
  const menu = document.querySelector(".l-menu");
  menu?.remove();
  return !!menu;
}

function categoryOptions(selectedID: string) {
  return [...data.categories, { id: NONE, name: "未分类" }]
    .map((c) => `<option value="${esc(c.id)}"${c.id === selectedID ? " selected" : ""}>${esc(c.name)}</option>`)
    .join("");
}

// editApp edits an app, or adds a new one.
function editApp(app?: LauncherApp) {
  const category = app?.category ?? (filter === ALL ? (data.categories[0]?.id ?? NONE) : filter);
  const dlg = openDialog(`
    <form method="dialog">
      <h2>${app ? "编辑" : "新增"}</h2>
      <label>路径<span class="l-row"><input name="path" required placeholder="程序、快捷方式、文件夹或网址" /><button type="button" data-browse="file">选择文件</button><button type="button" data-browse="dir">文件夹</button></span></label>
      <label>名称<input name="name" required /></label>
      <label>参数<input name="args" placeholder="可选，例如 -startup" /></label>
      <label>起始位置<input name="dir" placeholder="可选，默认是程序所在文件夹" /></label>
      <label>分类<select name="category">${categoryOptions(category)}</select></label>
      <label class="l-check"><input type="checkbox" name="admin" /> 总是以管理员身份运行</label>
      <p class="l-error" hidden></p>
      <div class="l-buttons"><button type="button" data-close>取消</button><button class="primary" type="submit">保存</button></div>
    </form>`);
  const form = dlg.querySelector("form")!;
  const field = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
  field("path").value = app?.path ?? "";
  field("name").value = app?.name ?? "";
  field("args").value = app?.args ?? "";
  field("dir").value = app?.dir ?? "";
  field("admin").checked = !!app?.admin;
  const fillName = () => {
    if (!field("name").value.trim() && field("path").value.trim()) field("name").value = baseName(field("path").value.trim());
  };
  field("path").addEventListener("change", fillName);
  dlg.querySelectorAll<HTMLElement>("[data-browse]").forEach((b) =>
    b.addEventListener("click", async () => {
      const path = await Launcher.browse(b.dataset.browse === "dir").catch(showError);
      if (!path) return;
      field("path").value = path;
      field("name").value = "";
      fillName();
    }),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await Launcher.saveApp({
        id: app?.id ?? "",
        name: field("name").value,
        path: field("path").value,
        args: field("args").value.trim(),
        dir: field("dir").value.trim(),
        category: (form.elements.namedItem("category") as HTMLSelectElement).value,
        admin: field("admin").checked,
      } as LauncherApp);
      dlg.close();
    } catch (err) {
      const p = dlg.querySelector<HTMLElement>(".l-error")!;
      p.textContent = errorText(err);
      p.hidden = false;
    }
  });
}

// pickInstalled lists the apps on the computer to add some.
async function pickInstalled() {
  const dlg = openDialog(`
    <div class="l-picker">
      <h2>从已装软件添加</h2>
      <input class="l-search" type="search" placeholder="搜索名称或拼音首字母，如 Everything、wx（微信）" />
      <div class="l-list"><p class="muted">正在查找已安装的软件…</p></div>
      <div class="l-buttons">
        <label>加到分类 <select>${categoryOptions(filter === ALL ? (data.categories[0]?.id ?? NONE) : filter)}</select></label>
        <span class="l-spacer"></span>
        <button type="button" data-close>取消</button>
        <button class="primary" id="l-add-picked" disabled>添加</button>
      </div>
    </div>`);
  const list = dlg.querySelector<HTMLElement>(".l-list")!;
  const search = dlg.querySelector<HTMLInputElement>(".l-search")!;
  const addButton = dlg.querySelector<HTMLButtonElement>("#l-add-picked")!;
  const picked = new Set<string>();
  let apps: InstalledApp[] = [];
  try {
    apps = await Launcher.installed();
  } catch (e) {
    list.innerHTML = `<p class="l-error">${esc(errorText(e))}</p>`;
    return;
  }
  const have = new Set(data.apps.map((a) => a.path.toLowerCase()));
  const update = () => {
    addButton.disabled = !picked.size;
    addButton.textContent = picked.size ? `添加 ${picked.size} 项` : "添加";
  };
  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    const shown = q
      ? apps
          .map((a) => ({ a, rank: matchRank(a.name, a.path, q) }))
          .filter((m) => m.rank >= 0)
          .sort((x, y) => x.rank - y.rank)
          .map((m) => m.a)
      : apps;
    list.innerHTML = shown.length
      ? shown
          .map((a) => {
            const added = have.has(a.path.toLowerCase());
            return `
              <label class="l-item${added ? " added" : ""}" title="${esc(a.path)}">
                <input type="checkbox" value="${esc(a.path)}"${added ? " disabled checked" : picked.has(a.path) ? " checked" : ""} />
                ${iconHTML(a.path, a.name)}
                <span class="l-name">${esc(a.name)}</span>
                <span class="muted">${added ? "已添加" : esc(a.source)}</span>
              </label>`;
          })
          .join("")
      : `<p class="muted">没有找到</p>`;
    list.querySelectorAll<HTMLInputElement>("input:not(:disabled)").forEach((box) =>
      box.addEventListener("change", () => {
        if (box.checked) picked.add(box.value);
        else picked.delete(box.value);
        update();
      }),
    );
    loadIcons(list);
  };
  search.addEventListener("input", renderList);
  addButton.addEventListener("click", async () => {
    const category = dlg.querySelector("select")!.value;
    const chosen = apps.filter((a) => picked.has(a.path)).map((a) => ({ id: "", name: a.name, path: a.path, category }) as LauncherApp);
    try {
      const n = await Launcher.addApps(chosen);
      dlg.close();
      toast(`已添加 ${n} 项`);
    } catch (e) {
      showError(e);
    }
  });
  renderList();
  search.focus();
}

// manageCategories adds, renames, orders and deletes categories.
function manageCategories() {
  const dlg = openDialog(`
    <div>
      <h2>管理分类</h2>
      <div class="l-cat-list"></div>
      <form class="l-row l-new-cat"><input placeholder="新分类名称" required /><button class="primary">添加</button></form>
      <p class="muted">删除分类不会删除里面的软件，它们会移到「未分类」。</p>
      <div class="l-buttons"><button type="button" data-close>完成</button></div>
    </div>`);
  const list = dlg.querySelector<HTMLElement>(".l-cat-list")!;
  const renderList = () => {
    list.innerHTML = data.categories
      .map(
        (c, i) => `
          <div class="l-row" data-id="${c.id}">
            <input value="${esc(c.name)}" />
            <span class="muted">${data.apps.filter((a) => a.category === c.id).length} 项</span>
            <button title="上移" data-move="${i - 1}"${i === 0 ? " disabled" : ""}>↑</button>
            <button title="下移" data-move="${i + 1}"${i === data.categories.length - 1 ? " disabled" : ""}>↓</button>
            <button class="danger" data-delete>删除</button>
          </div>`,
      )
      .join("");
    list.querySelectorAll<HTMLElement>(".l-row").forEach((row) => {
      const id = row.dataset.id!;
      const input = row.querySelector("input")!;
      const rename = () => {
        const c = data.categories.find((c) => c.id === id);
        if (c && input.value.trim() && input.value.trim() !== c.name) void Launcher.renameCategory(id, input.value).catch(showError);
      };
      input.addEventListener("change", rename);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
      });
      row.querySelectorAll<HTMLElement>("[data-move]").forEach((b) =>
        b.addEventListener("click", () => void Launcher.moveCategory(id, Number(b.dataset.move)).catch(showError)),
      );
      row.querySelector("[data-delete]")!.addEventListener("click", () => void Launcher.deleteCategory(id).catch(showError));
    });
  };
  const form = dlg.querySelector<HTMLFormElement>(".l-new-cat")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = form.querySelector("input")!;
    try {
      await Launcher.addCategory(input.value);
      input.value = "";
    } catch (err) {
      showError(err);
    }
  });
  // Every change comes back as launcherChanged.
  const off = events.launcherChanged.on(renderList);
  dlg.addEventListener("close", off);
  renderList();
}

// matchRank tells how well a query, in lower case, matches an app: 0 its
// name starts with it, 1 the pinyin initials of its name do, 2 its name
// has it, 3 its initials do, 4 its path does, or -1 for no match.
function matchRank(name: string, path: string, q: string) {
  const lower = name.toLowerCase();
  if (lower.startsWith(q)) return 0;
  const at = initialsIndex(name, q.replace(/\s+/g, ""));
  if (at === 0) return 1;
  if (lower.includes(q)) return 2;
  if (at > 0) return 3;
  return path.toLowerCase().includes(q) ? 4 : -1;
}

// The pinyin collation sorts a character after the first of these whose
// initial it has: 阿 is the first a, 八 the first b, and so on (no i, u, v).
const pinyin = new Intl.Collator("zh-Hans-CN-u-co-pinyin");
const BOUNDS = "阿八嚓哒妸发旮哈丌咔垃妈拏噢妑七呥仨他屲夕丫帀";
const LETTERS = "abcdefghjklmnopqrstwxyz";
// Characters of app names read more than one way: each reading's initial
// matches.
const POLYPHONES: Record<string, string> = {
  乐: "ly", 行: "xh", 重: "zc", 长: "cz", 藏: "cz", 调: "dt", 传: "cz", 朝: "cz", 单: "ds", 会: "hk",
  校: "xj", 解: "jx", 参: "cs", 便: "bp", 曾: "zc", 系: "xj", 省: "sx", 弹: "dt", 降: "jx", 率: "ls",
  卡: "kq", 沈: "sc", 区: "qo", 盛: "sc", 番: "fp",
};
const initialsCache = new Map<string, string[]>();

// initials returns, for each character of a name, the letters it may be
// typed as: the pinyin initials of a Chinese character, or the character
// itself in lower case.
function initials(name: string) {
  let sets = initialsCache.get(name);
  if (sets) return sets;
  sets = [...name].map((ch) => {
    if (POLYPHONES[ch]) return POLYPHONES[ch]!;
    if (!/[\u3400-\u9fff]/.test(ch)) return ch.toLowerCase();
    let letter = "";
    for (let i = 0; i < BOUNDS.length && pinyin.compare(BOUNDS[i]!, ch) <= 0; i++) letter = LETTERS[i]!;
    return letter;
  });
  initialsCache.set(name, sets);
  return sets;
}

// initialsIndex returns where q, as letters and digits, matches the
// initials of a name's characters in a row, or -1. A name without Chinese
// has the initials of its words: vsc for Visual Studio Code.
export function initialsIndex(name: string, q: string) {
  if (!q || !/^[a-z0-9]+$/.test(q)) return -1;
  if (!/[\u3400-\u9fff]/.test(name)) {
    const words = name.toLowerCase().match(/[a-z]+|[0-9]+/g) ?? [];
    return words.length > 1 ? words.map((w) => w[0]).join("").indexOf(q) : -1;
  }
  const sets = initials(name).filter((s) => s.trim());
  for (let i = 0; i + q.length <= sets.length; i++) {
    let k = 0;
    while (k < q.length && sets[i + k]!.includes(q[k]!)) k++;
    if (k === q.length) return i;
  }
  return -1;
}
