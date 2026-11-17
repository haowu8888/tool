// The settings: kept by Go in settings.json, shown in the 设置 panel.
import { chime, esc, onLeave, openDialog } from "./ui";
import { accents, applyAppearance, backgroundURL, defaultAccent, isDark, styles } from "./appearance";
import { petSVG, pets } from "./pets";
import ballIcon from "./assets/widget.png";
import { AI, Overlay, Settings, Updates, events, type AISettings, type AppSettings, type ShortcutSetting, type ShortcutStatus, type UpdateState } from "./mygo";

// ToolInfo is what the settings know of a tool of the sidebar.
export interface ToolInfo {
  id: string;
  name: string;
  icon: string;
}

export let settings: AppSettings;

const listeners: ((s: AppSettings) => void)[] = [];

// onSettings calls fn whenever the settings change, until the function
// it returns is called.
export function onSettings(fn: (s: AppSettings) => void) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export async function loadSettings() {
  setSettings(await Settings.get());
}

// While saves of this page are on their way, what Go sends is older than
// what the page has: the last save brings the settings back itself.
events.settingsChanged.on((s) => {
  if (!pending) setSettings(s);
});

// fill gives the lists Go sends as null their empty selves.
function fill(s: AppSettings) {
  s.tools ??= [];
  s.shortcuts ??= [];
  return s;
}

function setSettings(s: AppSettings) {
  settings = fill(s);
  // Go switches the windows' appearance too; the attribute makes the page
  // follow it without waiting for that.
  if (s.theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = s.theme;
  applyAppearance(s.appearance);
  for (const fn of [...listeners]) fn(s);
}

// orderTools sorts tools as the user ordered them; tools the settings do
// not list follow in their own order.
export function orderTools<T extends ToolInfo>(tools: T[]): T[] {
  const at = (t: T) => {
    const i = settings.tools.findIndex((s) => s.id === t.id);
    return i < 0 ? settings.tools.length + tools.indexOf(t) : i;
  };
  return [...tools].sort((a, b) => at(a) - at(b));
}

export function isHidden(id: string) {
  return settings.tools.some((t) => t.id === id && t.hidden);
}

// overlayItems are what the monitor overlay can show, in its order.
const overlayItems: [string, string][] = [
  ["cpu", "CPU 占用"],
  ["cpuTemp", "CPU 温度"],
  ["cpuFreq", "CPU 频率"],
  ["mem", "内存"],
  ["gpu", "显卡占用"],
  ["gpuTemp", "显卡温度"],
  ["diskTemp", "硬盘温度"],
  ["net", "网速"],
  ["disk", "硬盘读写"],
  ["fan", "风扇（估计）"],
  ["battery", "电池"],
];

// shortcutKeys returns the keys of a global shortcut, as Ctrl+Alt+B, or ""
// when it is off.
export function shortcutKeys(id: string) {
  const s = settings.shortcuts.find((s) => s.id === id);
  return s && !s.disabled ? displayKeys(s.keys) : "";
}

// displayKeys writes an accelerator as Windows does: CmdOrCtrl is Ctrl and
// Super the Windows key.
function displayKeys(keys: string) {
  return keys.replace("CmdOrCtrl", "Ctrl").replace("Super", "Win");
}

// kbd shows keys as key caps.
export function kbd(keys: string) {
  return displayKeys(keys)
    .split("+")
    .map((p) => `<kbd>${p}</kbd>`)
    .join("+");
}

// acceleratorOf turns a key press into an accelerator, as CmdOrCtrl+Alt+N,
// or returns "" while only modifiers are down or none of Ctrl, Alt and Win
// is, which a global shortcut needs.
function acceleratorOf(e: KeyboardEvent) {
  const named: Record<string, string> = {
    Space: "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", PrintScreen: "PrintScreen",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";",
    Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`",
    NumpadAdd: "NumAdd", NumpadSubtract: "NumSub", NumpadMultiply: "NumMult", NumpadDivide: "NumDiv", NumpadDecimal: "NumDec",
  };
  const c = e.code;
  const key = /^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5) : /^F\d{1,2}$/.test(c) ? c : /^Numpad\d$/.test(c) ? "Num" + c.slice(6) : named[c];
  if (!key || !(e.ctrlKey || e.altKey || e.metaKey)) return "";
  return [e.ctrlKey && "CmdOrCtrl", e.metaKey && "Super", e.altKey && "Alt", e.shiftKey && "Shift", key].filter(Boolean).join("+");
}

export function save(change: (s: AppSettings) => void) {
  // The change counts here at once, so that another made right after
  // starts from it rather than from the old settings and undoes it; the
  // saves go to Go one after another, and what Go made of them (or kept,
  // when one fails) comes back after the last.
  const s: AppSettings = structuredClone(settings);
  change(s);
  settings = s;
  pending++;
  saving = saving.then(async () => {
    try {
      await Settings.save(s);
    } catch (e) {
      alert(`保存设置失败：${e instanceof Error ? e.message : e}`);
    }
    if (--pending === 0) setSettings(await Settings.get());
  });
  return saving;
}

let saving: Promise<void> = Promise.resolve();
let pending = 0; // saves on their way

// renderPanel updates the 设置 panel last rendered.
let renderPanel: ((s: AppSettings) => void) | null = null;
onSettings((s) => renderPanel?.(s));

// aiFields is the form of an OpenAI compatible service: the AI writing's,
// and the translation's on the screenshot page. Its elements' ids start
// with id.
export function aiFields(id: string) {
  return `
      <div class="s-card s-ai">
        <div class="s-row"><span>接口地址</span><input id="${id}-url" placeholder="https://api.example.com/v1" spellcheck="false" /></div>
        <div class="s-row"><span>API Key</span><input id="${id}-key" type="password" placeholder="sk-…" spellcheck="false" /></div>
        <div class="s-row"><span>模型</span><span class="s-ai-model"><input id="${id}-model" list="${id}-models" placeholder="如 gpt-4o-mini" spellcheck="false" /><datalist id="${id}-models"></datalist><button id="${id}-fetch">获取模型</button></span></div>
        <div class="s-row"><span>连接<small class="muted" id="${id}-result">保存后可以测试</small></span><button id="${id}-test">测试</button></div>
      </div>`;
}

// bindAIFields fills the form of aiFields and saves it as the fields
// change; tests and models use what the fields say. It returns a function
// that fills the fields again, as from other settings.
export function bindAIFields(root: HTMLElement, id: string, get: () => AISettings | undefined, put: (s: AppSettings, ai: AISettings) => void) {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const url = $<HTMLInputElement>(`#${id}-url`);
  const key = $<HTMLInputElement>(`#${id}-key`);
  const model = $<HTMLInputElement>(`#${id}-model`);
  const result = $(`#${id}-result`);
  const now = (): AISettings => ({ baseUrl: url.value.trim(), apiKey: key.value.trim(), model: model.value.trim() });
  const fill = () => {
    const ai = get();
    url.value = ai?.baseUrl ?? "";
    key.value = ai?.apiKey ?? "";
    model.value = ai?.model ?? "";
  };
  fill();
  for (const input of [url, key, model]) input.addEventListener("change", () => void save((s) => put(s, now())));
  $(`#${id}-fetch`).addEventListener("click", async () => {
    result.className = "muted";
    result.textContent = "正在获取模型…";
    try {
      const models = (await AI.models(now())) ?? [];
      $(`#${id}-models`).innerHTML = models.map((m) => `<option value="${esc(m)}"></option>`).join("");
      result.textContent = models.length ? `找到 ${models.length} 个模型，点模型框选择` : "接口没有列出模型，直接填模型名";
      model.focus();
    } catch (e) {
      result.className = "s-bad";
      result.textContent = e instanceof Error ? e.message : String(e);
    }
  });
  $(`#${id}-test`).addEventListener("click", async () => {
    result.className = "muted";
    result.textContent = "正在请求（慢的模型要等几十秒）…";
    try {
      const reply = await AI.test(now());
      result.className = "s-ok";
      result.textContent = `正常：${reply.slice(0, 40)}`;
    } catch (e) {
      result.className = "s-bad";
      result.textContent = e instanceof Error ? e.message : String(e);
    }
  });
  return fill;
}

export function renderSettings(panel: HTMLElement, tools: ToolInfo[]) {
  panel.innerHTML = `
    <h1>设置</h1>
    <section class="s-group">
      <h2>外观</h2>
      <div class="s-card">
        <div class="s-row">
          <span>主题</span>
          <div class="s-seg" data-key="theme">
            <button data-value="system">跟随系统</button>
            <button data-value="light">☀ 白天</button>
            <button data-value="dark">☾ 夜晚</button>
          </div>
        </div>
        <div class="s-row s-look-row"><span>风格<small class="muted">背景、卡片和线条的配色，白天夜晚各一套</small></span><div class="s-styles"></div></div>
        <div class="s-row s-look-row">
          <span>强调色<small class="muted">按钮、选中项和链接的颜色</small></span>
          <div class="s-accents">${accents.map(([c, name]) => `<button type="button" data-accent="${c}" title="${name}" style="--sw:${c}"></button>`).join("")}<label class="s-accent-custom" title="自定义颜色"><input type="color" id="s-accent" /></label></div>
        </div>
        <div class="s-row s-look-row">
          <span>背景图片<small class="muted">只用在工具箱主窗口，图片会复制到数据文件夹</small></span>
          <span class="s-key-edit"><span class="s-bg-thumb" hidden></span><button type="button" id="s-bg-pick">选择图片</button><button type="button" id="s-bg-clear" hidden>移除</button></span>
        </div>
        <div class="s-row s-sub s-bg-row"><span>图片不透明度<small class="muted">越低图片越淡，透出底下的背景色</small></span><span class="s-range"><input type="range" id="s-bg-opacity" min="10" max="100" step="5" /><output></output></span></div>
        <div class="s-row s-sub s-bg-row"><span>遮罩浓度<small class="muted">图片上盖一层背景色，越浓文字越清楚</small></span><span class="s-range"><input type="range" id="s-bg-dim" min="0" max="90" step="5" /><output></output></span></div>
        <div class="s-row s-sub s-bg-row"><span>模糊</span><span class="s-range"><input type="range" id="s-bg-blur" min="0" max="30" step="1" /><output></output></span></div>
        <div class="s-row s-sub s-bg-row"><span>卡片不透明度</span><span class="s-range"><input type="range" id="s-bg-cards" min="40" max="100" step="5" /><output></output></span></div>
        <div class="s-row"><span>恢复默认外观<small class="muted">风格、强调色和背景图片回到默认，主题不变</small></span><button type="button" id="s-look-reset">恢复</button></div>
      </div>
    </section>
    <section class="s-group">
      <h2>窗口</h2>
      <div class="s-card">
        <div class="s-row">
          <span>关闭主窗口时</span>
          <div class="s-seg" data-key="closeAction">
            <button data-value="hide">隐藏到托盘</button>
            <button data-value="quit">退出程序</button>
          </div>
        </div>
        <div class="s-row">
          <span>打开时显示</span>
          <select id="s-home"></select>
        </div>
        <label class="s-row"><span>开机自动启动</span><input type="checkbox" id="s-login" /></label>
        <label class="s-row s-sub"><span>开机启动时只在托盘，不弹出窗口</span><input type="checkbox" id="s-hidden" /></label>
      </div>
    </section>
    <section class="s-group">
      <h2>快捷启动</h2>
      <div class="s-card">
        <label class="s-row"><span>启动软件后隐藏窗口<small class="muted">关掉后启动软件时工具箱窗口留在原处</small></span><input type="checkbox" id="s-l-hide" /></label>
      </div>
    </section>
    <section class="s-group">
      <h2>悬浮球</h2>
      <div class="s-card">
        <label class="s-row"><span>在桌面显示悬浮球<small class="muted">像桌宠一样一直浮在最上层</small></span><input type="checkbox" id="s-widget" /></label>
        <div class="s-row s-sub s-look-row"><span>形象<small class="muted">小角色会眨眼、偶尔自己动，鼠标移上去开心、有提醒时着急、电脑 5 分钟没人用就睡觉；自定义用透明 PNG 或 GIF 动图</small></span><div class="s-styles s-pets"></div></div>
        <div class="s-row s-sub"><span>大小</span><span class="s-range"><input type="range" id="s-size" min="40" max="160" step="4" /><output></output></span></div>
        <div class="s-row s-sub"><span>不透明度</span><span class="s-range"><input type="range" id="s-opacity" min="30" max="100" step="5" /><output></output></span></div>
        <label class="s-row s-sub"><span>贴边吸附<small class="muted">拖到离屏幕左右边缘 32 像素以内松手，自动贴到边上</small></span><input type="checkbox" id="s-snap" /></label>
        <label class="s-row s-sub s-sub2"><span>贴边后缩进去一半<small class="muted">鼠标移上去滑出来，移开后再缩回去</small></span><input type="checkbox" id="s-tuck" /></label>
        <div class="s-row s-sub"><span>位置</span><button id="s-reset">放回默认位置</button></div>
      </div>
      <p class="muted s-tip">单击打开工具箱，右键是快捷菜单（快捷启动、断开物理屏、设置等），拖动可移动（开了贴边吸附时，松手靠近屏幕左右边缘会自动贴边，还可以缩进去一半）；把文件或快捷方式拖到球上会加进快捷启动。物理屏断开时球上会亮一个绿点。</p>
    </section>
    <section class="s-group">
      <h2>工具</h2>
      <p class="muted s-tip">勾选的工具显示在侧栏，用箭头调整顺序。隐藏的工具快捷键和托盘菜单照常可用。</p>
      <ul class="s-tools"></ul>
    </section>
    <section class="s-group">
      <h2>全局快捷键</h2>
      <div class="s-card s-keys"></div>
      <p class="muted s-tip">点按键框，再按下新的组合键（要带 Ctrl、Alt 或 Win），Esc 取消；录制时所有全局快捷键暂停。被其他程序占用时换一组键即可。</p>
    </section>
    <section class="s-group">
      <h2>系统监控</h2>
      <div class="s-card s-mon">
        <div class="s-row"><span>刷新频率</span><select id="s-mon-interval"><option value="500">0.5 秒</option><option value="1000">1 秒</option><option value="2000">2 秒</option><option value="5000">5 秒</option></select></div>
        <div class="s-row"><span>温度警戒线<small class="muted">到这个温度显示红色，低 15°C 起显示黄色</small></span><select id="s-mon-warn">${[70, 75, 80, 85, 90, 95, 100].map((t) => `<option value="${t}">${t}°C</option>`).join("")}</select></div>
        <div class="s-row"><span>LibreHardwareMonitor 地址<small class="muted">读 CPU 温度、功耗和风扇用；留空不读</small></span><input id="s-mon-lhm" placeholder="http://127.0.0.1:8085" spellcheck="false" /></div>
      </div>
    </section>
    <section class="s-group">
      <h2>监控悬浮窗</h2>
      <div class="s-card s-mon">
        <label class="s-row"><span>显示悬浮窗<small class="muted">置顶的小条，拖动移动，双击打开系统监控，右键菜单</small></span><input type="checkbox" id="s-ov-show" /></label>
        <div class="s-row s-sub"><span>显示内容</span><span class="s-ov-items">${overlayItems.map(([k, label]) => `<label><input type="checkbox" value="${k}" />${label}</label>`).join("")}</span></div>
        <label class="s-row s-sub"><span>竖着排</span><input type="checkbox" id="s-ov-vertical" /></label>
        <div class="s-row s-sub"><span>不透明度</span><span class="s-range"><input type="range" id="s-ov-opacity" min="30" max="100" step="5" /><output></output></span></div>
        <label class="s-row s-sub"><span>鼠标穿透<small class="muted">点击穿过悬浮窗落到下面的窗口；开着时用托盘菜单或快捷键关悬浮窗</small></span><input type="checkbox" id="s-ov-click" /></label>
        <div class="s-row s-sub"><span>位置</span><button id="s-ov-reset">放回默认位置</button></div>
      </div>
    </section>
    <section class="s-group">
      <h2>待办提醒</h2>
      <div class="s-card">
        <div class="s-row"><span>提醒气泡自动收起<small class="muted">人不在电脑前时，气泡过一会儿收起，悬浮球上的红点一直留着，点球直接打开待办</small></span>
          <select id="s-autohide">${[1, 3, 5, 10, 30].map((m) => `<option value="${m}">${m} 分钟后</option>`).join("")}<option value="0">不自动收起</option></select></div>
        <label class="s-row"><span>新提醒时播放提示音</span><span class="s-key-edit"><button type="button" id="s-chime">试听</button><input type="checkbox" id="s-sound" /></span></label>
      </div>
    </section>
    <section class="s-group">
      <h2>AI 写作</h2>
      <p class="muted s-tip">笔记里输入 / 或选中文字时的 AI 写作（润色、续写、翻译等）用它。填 OpenAI 兼容的接口，比如你给 Outline 用的 new-api。</p>
      ${aiFields("s-ai")}
    </section>
    <section class="s-group" id="s-tr-ai">
      <h2>AI 翻译</h2>
      <p class="muted s-tip">截图翻译选「AI」引擎时用它，和 AI 写作分开配置：翻译要快，挑个快的模型。<button class="s-tr-copy">用 AI 写作的配置</button></p>
      ${aiFields("s-tr-ai")}
    </section>
    <section class="s-group">
      <h2>关于</h2>
      <div class="s-card">
        <div class="s-row"><span>版本<small class="muted" id="s-up-info"></small></span><span class="s-key-edit"><button type="button" id="s-up-check">检查更新</button><button type="button" id="s-up-install" class="s-up-install" hidden></button></span></div>
        <label class="s-row"><span>自动检查更新<small class="muted">启动一分钟后和之后每六小时看一次网盘（Flow 每次发布都会传上去），有新版本时侧栏「设置」上有红点</small></span><input type="checkbox" id="s-up-auto" /></label>
        <div class="s-row"><span>数据文件夹<small class="muted" id="s-dir"></small></span><button id="s-open">打开</button></div>
      </div>
    </section>`;

  for (const seg of panel.querySelectorAll<HTMLElement>(".s-seg")) {
    const key = seg.dataset.key as "theme" | "closeAction";
    seg.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (b) void save((s) => (s[key] = b.dataset.value!));
    });
  }
  const $ = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)!;
  const stylesBox = $(".s-styles");
  stylesBox.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (b) void save((s) => (s.appearance.style = b.dataset.style!));
  });
  $(".s-accents").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (b) void save((s) => (s.appearance.accent = b.dataset.accent!));
  });
  const accent = $<HTMLInputElement>("#s-accent");
  accent.addEventListener("change", () => void save((s) => (s.appearance.accent = accent.value)));
  $("#s-bg-pick").addEventListener("click", () => void Settings.pickBackground().catch((e) => alert(e)));
  $("#s-bg-clear").addEventListener("click", () => void Settings.clearBackground().catch((e) => alert(e)));
  const bgOpacity = $<HTMLInputElement>("#s-bg-opacity");
  const bgDim = $<HTMLInputElement>("#s-bg-dim");
  const bgBlur = $<HTMLInputElement>("#s-bg-blur");
  const bgCards = $<HTMLInputElement>("#s-bg-cards");
  const showBgRange = () => {
    bgOpacity.nextElementSibling!.textContent = `${bgOpacity.value}%`;
    bgDim.nextElementSibling!.textContent = `${bgDim.value}%`;
    bgBlur.nextElementSibling!.textContent = `${bgBlur.value}px`;
    bgCards.nextElementSibling!.textContent = `${bgCards.value}%`;
  };
  // Sliding shows the change at once; letting go saves it.
  for (const r of [bgOpacity, bgDim, bgBlur, bgCards]) {
    r.addEventListener("input", () => {
      showBgRange();
      applyAppearance({ ...settings.appearance, opacity: +bgOpacity.value, dim: +bgDim.value, blur: +bgBlur.value, cards: +bgCards.value });
    });
  }
  bgOpacity.addEventListener("change", () => void save((s) => (s.appearance.opacity = +bgOpacity.value)));
  bgDim.addEventListener("change", () => void save((s) => (s.appearance.dim = +bgDim.value)));
  bgBlur.addEventListener("change", () => void save((s) => (s.appearance.blur = +bgBlur.value)));
  bgCards.addEventListener("change", () => void save((s) => (s.appearance.cards = +bgCards.value)));
  $("#s-look-reset").addEventListener("click", () => {
    if (settings.appearance.background) void Settings.clearBackground().catch((e) => alert(e));
    void save((s) => Object.assign(s.appearance, { style: "default", accent: defaultAccent, opacity: 100, dim: 40, blur: 0, cards: 85 }));
  });
  const home = $<HTMLSelectElement>("#s-home");
  home.addEventListener("change", () => void save((s) => (s.homeTool = home.value)));
  const login = $<HTMLInputElement>("#s-login");
  login.addEventListener("change", () => void save((s) => (s.openAtLogin = login.checked)));
  const hidden = $<HTMLInputElement>("#s-hidden");
  hidden.addEventListener("change", () => void save((s) => (s.startHidden = hidden.checked)));
  const launchHide = $<HTMLInputElement>("#s-l-hide");
  launchHide.addEventListener("change", () => void save((s) => (s.launcher.hideAfterLaunch = launchHide.checked)));
  const widget = $<HTMLInputElement>("#s-widget");
  widget.addEventListener("change", () => void save((s) => (s.widget.show = widget.checked)));
  const snap = $<HTMLInputElement>("#s-snap");
  snap.addEventListener("change", () => void save((s) => (s.widget.snap = snap.checked)));
  const tuck = $<HTMLInputElement>("#s-tuck");
  tuck.addEventListener("change", () => void save((s) => (s.widget.tuck = tuck.checked)));
  // The system monitor and its overlay.
  const monInterval = $<HTMLSelectElement>("#s-mon-interval");
  monInterval.addEventListener("change", () => void save((s) => (s.monitor.interval = +monInterval.value)));
  const monWarn = $<HTMLSelectElement>("#s-mon-warn");
  monWarn.addEventListener("change", () => void save((s) => (s.monitor.tempWarn = +monWarn.value)));
  const monLHM = $<HTMLInputElement>("#s-mon-lhm");
  monLHM.value = settings.monitor.sensorsUrl;
  monLHM.addEventListener("change", () => void save((s) => (s.monitor.sensorsUrl = monLHM.value.trim())));
  const ovShow = $<HTMLInputElement>("#s-ov-show");
  ovShow.addEventListener("change", () => void save((s) => (s.monitor.overlay.show = ovShow.checked)));
  const ovVertical = $<HTMLInputElement>("#s-ov-vertical");
  ovVertical.addEventListener("change", () => void save((s) => (s.monitor.overlay.vertical = ovVertical.checked)));
  const ovClick = $<HTMLInputElement>("#s-ov-click");
  ovClick.addEventListener("change", () => void save((s) => (s.monitor.overlay.clickThrough = ovClick.checked)));
  const ovOpacity = $<HTMLInputElement>("#s-ov-opacity");
  ovOpacity.addEventListener("input", () => (ovOpacity.nextElementSibling!.textContent = `${ovOpacity.value}%`));
  ovOpacity.addEventListener("change", () => void save((s) => (s.monitor.overlay.opacity = +ovOpacity.value / 100)));
  const ovItems = $(".s-ov-items");
  ovItems.addEventListener("change", () => {
    const on = new Set([...ovItems.querySelectorAll<HTMLInputElement>("input:checked")].map((i) => i.value));
    // In the list's order.
    void save((s) => (s.monitor.overlay.items = overlayItems.map(([k]) => k).filter((k) => on.has(k))));
  });
  $("#s-ov-reset").addEventListener("click", () => void Overlay.resetPosition());
  const autoHide = $<HTMLSelectElement>("#s-autohide");
  autoHide.addEventListener("change", () => void save((s) => (s.reminder.autoHide = +autoHide.value)));
  const sound = $<HTMLInputElement>("#s-sound");
  sound.addEventListener("change", () => void save((s) => (s.reminder.sound = sound.checked)));
  $("#s-chime").addEventListener("click", (e) => {
    e.preventDefault();
    chime();
  });
  const size = $<HTMLInputElement>("#s-size");
  const opacity = $<HTMLInputElement>("#s-opacity");
  const showRange = () => {
    size.nextElementSibling!.textContent = `${size.value}`;
    opacity.nextElementSibling!.textContent = `${opacity.value}%`;
  };
  for (const r of [size, opacity]) r.addEventListener("input", showRange);
  size.addEventListener("change", () => void save((s) => (s.widget.size = +size.value)));
  opacity.addEventListener("change", () => void save((s) => (s.widget.opacity = +opacity.value / 100)));
  $("#s-reset").addEventListener("click", () => void Settings.resetWidget());
  const petsBox = $(".s-pets");
  petsBox.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const del = el.closest<HTMLElement>("[data-del]");
    if (del) {
      e.stopPropagation();
      const name = del.dataset.del!;
      const dlg = openDialog(`
        <h2>删除这个形象？</h2>
        <p class="s-pet-del-pic"><img src="${backgroundURL(name)}" alt="" /></p>
        <p class="muted">图片会从工具箱的数据文件夹里删掉，原来的文件不受影响。</p>
        <div class="l-buttons"><button type="button" data-close>取消</button><button type="button" class="primary danger-bg" data-ok>删除</button></div>`);
      dlg.querySelector("[data-ok]")!.addEventListener("click", () => {
        dlg.close();
        void Settings.removePetImage(name).catch((e) => alert(e));
      });
      return;
    }
    const b = el.closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.dataset.add) void Settings.pickPetImage().catch((e) => alert(e));
    else if (b.dataset.image) void save((s) => ((s.widget.pet = "custom"), (s.widget.image = b.dataset.image!)));
    else void save((s) => (s.widget.pet = b.dataset.pet!));
  });
  $("#s-open").addEventListener("click", () => void Settings.openDataFolder().catch((e) => alert(e)));

  const list = $<HTMLUListElement>(".s-tools");
  const writeTools = (order: ToolInfo[], hide: (id: string) => boolean) =>
    save((s) => (s.tools = order.map((t) => ({ id: t.id, hidden: hide(t.id) }))));
  list.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    const order = orderTools(tools);
    const i = order.findIndex((t) => t.id === b.closest("li")!.dataset.id);
    const j = i + (b.dataset.move === "up" ? -1 : 1);
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    void writeTools(order, isHidden);
  });
  list.addEventListener("change", (e) => {
    const box = e.target as HTMLInputElement;
    const id = box.closest("li")!.dataset.id!;
    void writeTools(orderTools(tools), (t) => (t === id ? !box.checked : isHidden(t)));
  });

  const render = (s: AppSettings) => {
    if (!panel.querySelector(".s-tools")) return; // another tool shows
    for (const seg of panel.querySelectorAll<HTMLElement>(".s-seg")) {
      const value = s[seg.dataset.key as "theme" | "closeAction"];
      for (const b of seg.querySelectorAll<HTMLButtonElement>("button")) b.classList.toggle("on", b.dataset.value === value);
    }
    const order = orderTools(tools);
    home.innerHTML =
      `<option value="">第一个工具</option>` +
      order.map((t) => `<option value="${t.id}">${t.name}</option>`).join("") +
      `<option value="settings">设置</option>`;
    home.value = s.homeTool;
    const a = s.appearance;
    stylesBox.innerHTML = styles
      .map((st) => {
        const p = isDark() ? st.dark : st.light;
        return `<button type="button" data-style="${st.id}" class="${st.id === a.style ? "on" : ""}" style="--p-bg:${p.bg};--p-card:${p.card};--p-line:${p.line};--p-fg:${p.fg}"><span class="s-style-sw"><i></i></span>${st.name}</button>`;
      })
      .join("");
    const preset = accents.some(([c]) => c === a.accent);
    for (const b of panel.querySelectorAll<HTMLButtonElement>(".s-accents button")) b.classList.toggle("on", b.dataset.accent === a.accent);
    accent.value = a.accent;
    accent.parentElement!.classList.toggle("on", !preset);
    accent.parentElement!.style.setProperty("--sw", preset ? "" : a.accent);
    const thumb = $(".s-bg-thumb");
    thumb.hidden = !a.background;
    thumb.style.backgroundImage = a.background ? `url("${backgroundURL(a.background)}")` : "";
    $("#s-bg-clear").hidden = !a.background;
    $("#s-bg-pick").textContent = a.background ? "换一张" : "选择图片";
    for (const el of panel.querySelectorAll<HTMLElement>(".s-bg-row")) el.hidden = !a.background;
    bgOpacity.value = String(a.opacity);
    bgDim.value = String(a.dim);
    bgBlur.value = String(a.blur);
    bgCards.value = String(a.cards);
    showBgRange();
    login.checked = s.openAtLogin;
    hidden.checked = s.startHidden;
    hidden.disabled = !s.openAtLogin;
    launchHide.checked = s.launcher.hideAfterLaunch;
    widget.checked = s.widget.show;
    snap.checked = s.widget.snap;
    tuck.checked = s.widget.tuck;
    monInterval.value = String(s.monitor.interval);
    monWarn.value = String(s.monitor.tempWarn);
    ovShow.checked = s.monitor.overlay.show;
    ovVertical.checked = s.monitor.overlay.vertical;
    ovClick.checked = s.monitor.overlay.clickThrough;
    ovOpacity.value = String(Math.round(s.monitor.overlay.opacity * 100));
    ovOpacity.nextElementSibling!.textContent = `${ovOpacity.value}%`;
    ovItems.querySelectorAll<HTMLInputElement>("input").forEach((i) => (i.checked = s.monitor.overlay.items.includes(i.value)));
    for (const el of panel.querySelectorAll<HTMLElement>(".s-mon .s-sub")) el.classList.toggle("off", !s.monitor.overlay.show);
    autoHide.value = String(s.reminder.autoHide);
    sound.checked = s.reminder.sound;
    const w = s.widget;
    petsBox.innerHTML =
      pets
        .filter((p) => p.id !== "custom")
        .map((p) => {
          const pic = p.id === "ball" ? `<img class="s-pet-ball" src="${ballIcon}" alt="" />` : petSVG(p.id, "idle");
          return `<button type="button" data-pet="${p.id}" class="${p.id === w.pet ? "on" : ""}" title="${p.name}"><span class="s-pet-pic">${pic}</span>${p.name}</button>`;
        })
        .join("") +
      w.images
        .map(
          (name, i) =>
            `<button type="button" data-image="${esc(name)}" class="${w.pet === "custom" && w.image === name ? "on" : ""}"><span class="s-pet-pic"><img src="${backgroundURL(name)}" alt="" /></span>自定义 ${i + 1}<span class="s-pet-del" data-del="${esc(name)}" title="删除">✕</span></button>`,
        )
        .join("") +
      `<button type="button" data-add="1" title="选一张透明 PNG 或 GIF 动图"><span class="s-pet-pic s-pet-add">＋</span>添加</button>`;
    size.value = String(s.widget.size);
    opacity.value = String(Math.round(s.widget.opacity * 100));
    showRange();
    for (const el of panel.querySelectorAll<HTMLElement>(".s-sub:not(.s-mon .s-sub):not(.s-bg-row)")) {
      const on = el.querySelector("#s-hidden") ? s.openAtLogin : s.widget.show && (!el.querySelector("#s-tuck") || s.widget.snap);
      el.classList.toggle("off", !on);
    }
    list.innerHTML = order
      .map(
        (t, i) => `
        <li data-id="${t.id}">
          <label><input type="checkbox" ${isHidden(t.id) ? "" : "checked"} /><span class="icon">${t.icon}</span>${t.name}</label>
          <button data-move="up" title="上移" ${i === 0 ? "disabled" : ""}>↑</button>
          <button data-move="down" title="下移" ${i === order.length - 1 ? "disabled" : ""}>↓</button>
        </li>`,
      )
      .join("");
  };
  render(settings);
  renderPanel = render;

  bindAIFields(panel, "s-ai", () => settings.ai, (s, ai) => (s.ai = ai));
  const fillTrAI = bindAIFields(panel, "s-tr-ai", () => settings.shot.ai, (s, ai) => (s.shot.ai = ai));
  $(".s-tr-copy").addEventListener("click", () => void save((s) => (s.shot.ai = { ...s.ai })).then(fillTrAI));

  // The global shortcuts: a row each, whose key caps record new keys.
  const keysBox = $(".s-keys");
  let recording: { id: string; button: HTMLButtonElement } | null = null;
  const saveShortcut = async (id: string, change: (s: ShortcutSetting) => void) => {
    const s: AppSettings = structuredClone(settings);
    change(s.shortcuts.find((k) => k.id === id)!);
    try {
      await Settings.save(s);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
    await renderKeys();
  };
  const stopRecording = () => {
    if (!recording) return;
    recording = null;
    document.removeEventListener("keydown", onRecordKey, true);
    void Settings.pauseShortcuts(false).then(renderKeys);
  };
  const onRecordKey = (e: KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return stopRecording();
    const acc = acceleratorOf(e);
    if (!acc) {
      recording.button.innerHTML = e.key === "Control" || e.key === "Alt" || e.key === "Shift" || e.key === "Meta" ? "请继续按…" : "要带 Ctrl、Alt 或 Win";
      return;
    }
    const { id } = recording;
    recording = null;
    document.removeEventListener("keydown", onRecordKey, true);
    // Saving applies the keys, which resumes the shortcuts too.
    void Settings.pauseShortcuts(false).then(() => saveShortcut(id, (k) => (k.keys = acc)));
  };
  const renderKeys = async () => {
    if (!keysBox.isConnected || recording) return;
    const keys: ShortcutStatus[] = await Settings.shortcuts();
    keysBox.innerHTML = keys
      .map(
        (k) => `
        <div class="s-row${k.disabled ? " s-key-off" : ""}" data-id="${k.id}" data-default="${k.default}">
          <span>${k.action}<small class="${k.error && !k.disabled ? "s-bad" : "muted"}" title="${esc(k.error ?? "")}">${
            k.disabled ? "已停用" : k.error ? "注册失败，可能被其他程序占用" : "正常"
          }${k.keys !== k.default ? ` · 默认 ${displayKeys(k.default)}` : ""}</small></span>
          <span class="s-key-edit">
            <button class="s-key" title="点一下，再按新的组合键">${kbd(k.keys)}</button>
            <button class="s-key-reset" title="恢复默认 ${displayKeys(k.default)}"${k.keys === k.default ? " disabled" : ""}>↺</button>
            <input type="checkbox" title="启用"${k.disabled ? "" : " checked"} />
          </span>
        </div>`,
      )
      .join("");
  };
  keysBox.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>(".s-row");
    const id = row?.dataset.id;
    if (!id) return;
    const key = t.closest<HTMLButtonElement>(".s-key");
    if (key) {
      stopRecording();
      recording = { id, button: key };
      key.classList.add("recording");
      key.textContent = "请按下快捷键…";
      document.addEventListener("keydown", onRecordKey, true);
      void Settings.pauseShortcuts(true);
      key.addEventListener("blur", stopRecording, { once: true });
    } else if (t.closest(".s-key-reset")) {
      void saveShortcut(id, (k) => (k.keys = row!.dataset.default!));
    }
  });
  keysBox.addEventListener("change", (e) => {
    const box = e.target as HTMLInputElement;
    const id = box.closest<HTMLElement>(".s-row")!.dataset.id!;
    void saveShortcut(id, (k) => (k.disabled = !box.checked));
  });
  void renderKeys();
  void Settings.about().then((a) => ($("#s-dir").textContent = a.dataDir));

  // Updates: the builds Flow uploads to the cloud drive.
  const upAuto = $<HTMLInputElement>("#s-up-auto");
  upAuto.checked = settings.update.auto;
  onLeave(onSettings((s) => (upAuto.checked = s.update.auto)));
  upAuto.addEventListener("change", () => void save((s) => (s.update.auto = upAuto.checked)));
  const upInfo = $("#s-up-info");
  const upCheck = $<HTMLButtonElement>("#s-up-check");
  const upInstall = $<HTMLButtonElement>("#s-up-install");
  const showUpdate = (u: UpdateState) => {
    const kind = u.portable ? "免安装版" : "安装版";
    let info = `${u.current || "开发版"} · ${kind}`;
    if (u.installing) info += ` · 正在下载 ${u.size ? Math.floor((u.done / u.size) * 100) : 0}%，完成后自动重启`;
    else if (u.checking) info += " · 正在检查…";
    else if (u.error) info += ` · ${u.error}`;
    else if (u.newer) info += ` · 有新版本 ${u.latest}（${new Date(u.published!).toLocaleString()} 发布，${(u.size! / 1048576).toFixed(1)} MB）`;
    else if (u.checked) info += ` · 已是最新${u.latest ? `（网盘上是 ${u.latest}）` : ""}`;
    upInfo.textContent = info;
    upInfo.classList.toggle("s-bad", !!u.error);
    upCheck.disabled = u.checking || u.installing;
    upInstall.hidden = !u.newer;
    upInstall.disabled = u.installing;
    upInstall.textContent = u.installing ? "正在更新…" : `更新到 ${u.latest}`;
  };
  onLeave(events.updateChanged.on(showUpdate));
  void Updates.state().then(showUpdate);
  upCheck.addEventListener("click", () => void Updates.check().catch(() => {}));
  upInstall.addEventListener("click", () => {
    if (!confirm("下载新版本后工具箱会退出，装好后自动重新打开。现在更新？")) return;
    void Updates.install().catch((e) => alert(e instanceof Error ? e.message : String(e)));
  });
}
