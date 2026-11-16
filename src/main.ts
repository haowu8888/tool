// VirtualScreen and events are generated from the Go code by `mygo generate`.
import { Updates, VirtualScreen, events, type DisplayInfo, type UpdateState } from "./mygo";
import { icons } from "./icons";
import { clipsTool, showClips } from "./clips";
import { focusSearch, launcherTool } from "./launcher";
import { monitorTool } from "./monitor";
import { servicesTool } from "./services";
import { flowTool } from "./flow";
import { devTool } from "./devtools";
import { boardTool } from "./board";
import { recordTool, showRecordPanel } from "./record";
import { focusAdd, notesTool } from "./notes";
import { showOverlay } from "./overlay";
import { shotTool, showPin, showScroll, showScrollFrame, showShot } from "./shot";
import { isHidden, kbd, loadSettings, onSettings, orderTools, renderSettings, settings, shortcutKeys } from "./settings";
import { errorText, esc, leave, onLeave, openDialog, toast } from "./ui";
import { showBubble } from "./bubble";
import { showWidget } from "./widget";

const app = document.querySelector<HTMLDivElement>("#app")!;

// A tool is one entry of the sidebar and the panel it shows.
interface Tool {
  id: string;
  name: string;
  icon: string; // an SVG of src/icons.ts
  render(panel: HTMLElement): void;
}

const tools: Tool[] = [
  launcherTool,
  notesTool,
  boardTool,
  shotTool,
  recordTool,
  clipsTool,
  monitorTool,
  servicesTool,
  flowTool,
  devTool,
  {
    id: "virtual-screen",
    name: "断开物理屏",
    icon: icons.monitorOff,
    render(panel) {
      panel.innerHTML = `
        <h1>断开物理屏</h1>
        <p class="muted">像 RustDesk 的隐私模式 2：桌面移到一块虚拟显示器上，本机的物理显示器从桌面断开、没有信号。远程控制看到并操作的是虚拟显示器。</p>
        <div class="card">
          <div class="status"><span class="dot"></span><span class="status-text"></span></div>
          <button class="primary" id="virtual"></button>
        </div>
        <p class="notice muted" hidden></p>
        <section class="s-group v-group">
          <h2>显示器<span class="v-summary"></span></h2>
          <div class="s-card v-displays"><div class="s-row muted">正在读取…</div></div>
        </section>
        <ul class="tips muted">
          <li>${shortcutKeys("virtual") ? `全局快捷键 ${kbd(shortcutKeys("virtual"))} 断开 / 恢复。本机屏幕是暗的、又不是这里断开的（残留的虚拟显示器占着桌面，或者一块显示器都没有）时，按它会把物理屏点亮、拔掉虚拟显示器。RustDesk 正连着时它不动显示器（多半是 RustDesk 的隐私模式），而是打开这里让你选。` : "全局快捷键已在设置里停用。"}</li>
          <li>远程那边也可以点托盘菜单「恢复物理屏」，或这里的按钮。退出工具箱、或者工具箱异常结束后下次启动，都会恢复原来的显示器布局。</li>
          <li>需要 RustDesk 自带的虚拟显示器驱动（usbmmidd，装 RustDesk 时一起装上）。虚拟显示器的分辨率尽量和原来的主屏一致，没有这个分辨率就用 1920×1080。</li>
          <li>断开后一直保持到你恢复为止。RustDesk 的会话结束时会把虚拟显示器拔掉、物理屏跟着亮起来，这里会马上重新插上并再断开（物理屏会亮一两秒）。</li>
          <li>RustDesk 自己的隐私模式开着时不能用，两个选一个：想让物理屏在 RustDesk 退出后也不亮，就用这里的，不用开隐私模式。</li>
          <li>锁屏界面上全局快捷键不管用（RustDesk 可以设成会话结束后锁定）。这时动一下本机的键盘或鼠标，物理屏会自己亮起来让你登录，断开随之结束；RustDesk 连着时远程那边的操作不算。</li>
          <li>屏幕是直接没信号，不是盖黑幕，所以指针、任务栏都不会露出来。</li>
        </ul>`;
      const button = panel.querySelector<HTMLButtonElement>("#virtual")!;
      const notice = panel.querySelector<HTMLElement>(".notice")!;
      const render = (active: boolean) => {
        panel.querySelector(".status")!.classList.toggle("on", active);
        panel.querySelector(".status-text")!.textContent = active ? "物理屏已断开" : "未开启";
        button.textContent = active ? "恢复物理屏" : "断开物理屏";
        button.dataset.active = String(active);
      };
      button.addEventListener("click", async () => {
        notice.hidden = true;
        button.disabled = true;
        try {
          await (button.dataset.active === "true" ? VirtualScreen.stop() : VirtualScreen.start());
        } catch (e) {
          if (button.dataset.active === "true") {
            notice.textContent = `恢复失败：${errorText(e)}`;
            notice.hidden = false;
          } else {
            showStartFailed(errorText(e));
          }
        } finally {
          button.disabled = false;
        }
      });
      onLeave(events.virtualScreenChanged.on(render));
      void VirtualScreen.isActive().then(render);
      // The monitors, every 2 seconds while the page shows: RustDesk and
      // the system change them too.
      const box = panel.querySelector<HTMLElement>(".v-displays")!;
      const refresh = async () => {
        if (!box.isConnected) return clearInterval(timer);
        if (document.visibilityState === "visible") renderDisplays(panel, await VirtualScreen.displays());
      };
      const timer = setInterval(() => void refresh(), 2000);
      onLeave(() => clearInterval(timer));
      onLeave(events.virtualScreenChanged.on(() => void refresh()));
      void refresh();
    },
  },
];

// renderDisplays lists the monitors and says whether this computer's
// screen shows.
function renderDisplays(panel: HTMLElement, list: DisplayInfo[]) {
  const box = panel.querySelector<HTMLElement>(".v-displays");
  if (!box) return;
  const lit = list.some((d) => !d.virtual && d.active);
  const other = list.some((d) => d.virtual && d.active && !d.mine);
  const why = lit ? "" : list.some((d) => d.mine) ? "（已断开物理屏）" : other ? "（虚拟屏占着桌面，多半是 RustDesk 的隐私模式）" : "";
  panel.querySelector(".v-summary")!.innerHTML = `<span class="v-lit ${lit ? "on" : "off"}">本机屏幕：${lit ? "亮" : "暗"}</span><span class="muted">${why}</span>`;
  box.innerHTML = list.length
    ? list
        .map((d) => {
          // usbmmidd's monitor claims a made-up name, as ACER S271HL.
          const title = d.virtual ? "虚拟显示器" : d.monitor || d.name;
          const detail = d.virtual ? (d.mine ? "工具箱插的" : "其他程序插的，多半是 RustDesk") + " · usbmmidd" : `物理屏 · ${d.adapter}`;
          const state = d.active ? `${d.virtual ? "已接入" : "亮着"} ${d.width}×${d.height}` : "已断开";
          return `
            <div class="s-row v-display">
              <span><b>${esc(title)}</b><small class="muted">${esc(detail)} · ${esc(d.name.replace(/^\\\\.\\/, ""))}</small></span>
              <span class="v-state">${d.primary && d.active ? `<span class="v-chip primary">主屏</span>` : ""}<span class="v-chip ${d.active ? "on" : "off"}">${state}</span></span>
            </div>`;
        })
        .join("")
    : `<div class="s-row muted">没有找到显示器</div>`;
}

// showStartFailed tells, in a dialog, why the virtual screen could not
// turn on, or why it ended by itself. With no physical display showing,
// which RustDesk's privacy mode does, the screen is dark already: it says
// so and offers to light it.
function showStartFailed(reason: string) {
  document.querySelector<HTMLDialogElement>("dialog.v-failed")?.close();
  const noPhysical = reason.includes("物理显示器");
  const ended = reason.includes("保持不住");
  const keys = shortcutKeys("virtual");
  const dlg = openDialog(`
    <h2>⚠ ${ended ? "断开物理屏已结束" : "断开物理屏失败"}</h2>
    <p class="v-reason">${esc(reason)}</p>
    ${
      ended
        ? ""
        : noPhysical
        ? `<p>现在<b>没有亮着的物理屏</b>，本机屏幕已经是暗的，多半是 RustDesk 的隐私模式开着，不需要再断开。</p>
           <p class="muted">想让本机屏幕亮起来：点下面的「强制找回物理屏」。这会点亮物理屏、拔掉虚拟显示器，RustDesk 的隐私模式也随之结束。${keys ? `没有 RustDesk 连着时，按 ${kbd(keys)} 也一样。` : ""}</p>`
        : `<p class="muted">显示器没有被改动。</p>`
    }
    <p class="l-error" hidden></p>
    <div class="l-buttons">
      <button type="button" data-close>知道了</button>
      ${noPhysical ? `<button type="button" class="primary" id="v-rescue">强制找回物理屏</button>` : ""}
    </div>`);
  dlg.classList.add("v-failed");
  dlg.querySelector<HTMLButtonElement>("#v-rescue")?.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      const done = await VirtualScreen.rescue();
      dlg.close();
      toast(done ? "已找回物理屏" : "物理屏本来就亮着");
    } catch (err) {
      const p = dlg.querySelector<HTMLElement>(".l-error")!;
      p.textContent = `找回失败：${errorText(err)}`;
      p.hidden = false;
      b.disabled = false;
    }
  });
}

// settingsTool is pinned to the bottom of the sidebar, never hidden.
const settingsTool: Tool = { id: "settings", name: "设置", icon: icons.settings, render: (panel) => renderSettings(panel, tools) };

function showToolbox() {
  app.innerHTML = `
    <aside class="nav${loadCollapsed() ? " collapsed" : ""}">
      <div class="brand"><span class="brand-name">工具箱</span><button class="nav-toggle" title="收起 / 展开侧栏">${icons.sidebar}</button></div>
      <div class="nav-tools"></div>
      ${navItem(settingsTool)}
    </aside>
    <main class="panel"></main>`;
  const nav = app.querySelector<HTMLElement>(".nav")!;
  nav.querySelector(".nav-toggle")!.addEventListener("click", () => {
    const collapsed = nav.classList.toggle("collapsed");
    try {
      localStorage.setItem(collapsedKey, String(collapsed));
    } catch {}
  });
  nav.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".nav-item");
    if (b) select(b.dataset.id!);
  });
  renderNav();
  onSettings(renderNav);
  // The shortcut, the tray or the floating ball failed to turn it on.
  events.virtualScreenFailed.on(showStartFailed);
  // A red dot on 设置 while a newer build waits on the cloud drive.
  const markUpdate = (u: UpdateState) => nav.querySelector(`.nav-item[data-id="${settingsTool.id}"]`)!.classList.toggle("has-update", u.newer);
  events.updateChanged.on(markUpdate);
  void Updates.state().then(markUpdate);
  const home = settings.homeTool;
  select(home === settingsTool.id || visibleTools().some((t) => t.id === home) ? home : (visibleTools()[0] ?? settingsTool).id);
}

function navItem(t: Tool) {
  return `<button class="nav-item${t.id === current ? " active" : ""}" data-id="${t.id}" title="${t.name}"><span class="icon">${t.icon}</span><span class="nav-name">${t.name}</span></button>`;
}

// The sidebar can shrink to its icons; the choice stays with this browser.
const collapsedKey = "nav-collapsed";

function loadCollapsed() {
  try {
    return localStorage.getItem(collapsedKey) === "true";
  } catch {
    return false;
  }
}

function visibleTools() {
  return orderTools(tools).filter((t) => !isHidden(t.id));
}

// renderNav lists the tools the user shows, in their order.
function renderNav() {
  app.querySelector(".nav-tools")!.innerHTML = visibleTools().map(navItem).join("");
}

let current = "";

// select shows a tool in the panel, unless it shows already. Hidden tools
// show too, when a shortcut asks for them.
function select(id: string) {
  const tool = [...tools, settingsTool].find((t) => t.id === id) ?? tools[0]!;
  const panel = app.querySelector<HTMLElement>(".panel");
  if (!panel || tool.id === current) return; // the floating ball has none
  current = tool.id;
  app.querySelectorAll<HTMLElement>(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.id === tool.id));
  leave(); // the last tool's listeners
  tool.render(panel);
}

// The shortcut Ctrl+Alt+Space brings up the launcher's search.
events.launcherSummoned.on(() => {
  document.querySelector<HTMLDialogElement>("dialog[open]")?.close();
  select(launcherTool.id);
  focusSearch();
});

// The floating ball's menu asks for a tool, as 设置, or for a new todo.
events.showTool.on((id) => {
  document.querySelector<HTMLDialogElement>("dialog[open]")?.close();
  select(id);
  if (id === notesTool.id) focusAdd();
});

await loadSettings();
const params = new URLSearchParams(location.search);
if (params.has("widget")) {
  showWidget(app);
} else if (params.has("bubble")) {
  showBubble(app);
} else if (params.has("overlay")) {
  showOverlay(app);
} else if (params.has("shot")) {
  showShot(app, Number(params.get("shot")));
} else if (params.has("clips")) {
  showClips(app);
} else if (params.has("longframe")) {
  showScrollFrame(app);
} else if (params.has("rec")) {
  showRecordPanel(app);
} else if (params.has("scroll")) {
  showScroll(app);
} else if (params.has("pin")) {
  void showPin(app, params.get("pin")!);
} else {
  showToolbox();
}
