// The system monitor: the processor, memory, graphics, network, disks and
// battery, live, their temperatures, the busiest programs, and what the
// computer is.
import { icons } from "./icons";
import { Monitor, Notes, Overlay, events, type MonitorSample, type ProcessSample, type SensorReading, type SystemInfo } from "./mygo";
import { onSettings, settings } from "./settings";
import { errorText, esc, openDialog, showError, toast } from "./ui";

// history keeps the last minute or so of each card's number for its chart.
const history: Record<string, number[]> = {};
const historySize = 60;
let panel: HTMLElement | null = null;
let info: SystemInfo | null = null;
let lastSample: MonitorSample | null = null;

export const monitorTool = {
  id: "monitor",
  name: "系统监控",
  icon: icons.monitor,
  render(p: HTMLElement) {
    panel = p;
    p.innerHTML = `
      <div class="l-head">
        <h1>系统监控</h1>
        <div class="l-actions"><button id="m-overlay"></button></div>
      </div>
      <div class="m-cards"></div>
      <section class="s-group m-wide"><h2>处理器核心<span class="muted m-cores-sum"></span></h2><div class="m-cores"></div></section>
      <section class="s-group m-wide"><h2>温度</h2><div class="s-card m-temps"></div><p class="muted s-tip m-temp-tip" hidden></p></section>
      <section class="s-group m-wide"><h2>磁盘空间</h2><div class="s-card m-disks"></div></section>
      <section class="s-group m-wide"><h2>占用最多的程序<span class="muted">（同名进程合在一起）</span></h2><div class="s-card m-procs"></div></section>
      <section class="s-group m-wide"><h2>系统信息<span class="l-spacer"></span><button id="m-copy">复制全部</button><button id="m-refresh">刷新</button></h2><div class="s-card m-info"><div class="s-row muted">正在读取系统信息…</div></div></section>`;
    p.querySelector("#m-overlay")!.addEventListener("click", () => void Overlay.toggle());
    p.querySelector("#m-copy")!.addEventListener("click", () => void navigator.clipboard.writeText(infoText()).then(() => toast("已复制系统信息"), showError));
    p.querySelector("#m-refresh")!.addEventListener("click", () => void loadInfo(true));
    p.querySelector(".m-procs")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      const pr = b && drawnProcs[Number(b.dataset.i)];
      if (pr) confirmEnd(pr);
    });
    renderOverlayButton();
    watch(true);
    if (lastSample) render(lastSample);
    else void Monitor.last().then((s) => s.time && render(s));
    void loadInfo(false);
  },
};

function shown() {
  return !!panel?.isConnected && !!panel.querySelector(".m-cards");
}

// watch tells Go whether the page wants samples: only while it shows.
let watching = false;
function watch(on: boolean) {
  if (on === watching) return;
  watching = on;
  void Monitor.watch("page", on);
}

document.addEventListener("visibilitychange", () => watch(document.visibilityState === "visible" && shown()));

// pressing is whether a mouse button is down on the page. A sample drawn
// then could put another program in the row under the pointer, and its 结束
// would end that one: the next sample draws instead.
let pressing = false;
addEventListener("pointerdown", () => (pressing = true), true);
addEventListener("pointermove", (e) => (pressing &&= e.buttons !== 0), true);
for (const type of ["pointerup", "pointercancel", "blur"]) addEventListener(type, () => (pressing = false), true);

events.monitorSampled.on((s) => {
  lastSample = s;
  feedFan(s);
  if (!shown()) return watch(false);
  for (const [k, v] of Object.entries({ cpu: s.cpu.usage, mem: s.memory.percent, gpu: s.gpu.usage, net: s.netDown + s.netUp, disk: s.diskRead + s.diskWrite })) {
    const h = (history[k] ??= []);
    h.push(v);
    if (h.length > historySize) h.shift();
  }
  if (!pressing) render(s);
});

onSettings(() => {
  if (shown()) renderOverlayButton();
});

function renderOverlayButton() {
  const b = panel?.querySelector<HTMLButtonElement>("#m-overlay");
  if (b) b.textContent = settings.monitor.overlay.show ? "隐藏悬浮窗" : "显示悬浮窗";
}

// ---- Formatting ----

export function fmtBytes(n: number) {
  if (n < 1024) return `${n.toFixed(0)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function fmtRate(n: number) {
  return `${fmtBytes(n)}/s`;
}

// level colors a temperature: ok, warm from 15 below the warning, hot.
export function level(temp: number) {
  const warn = settings.monitor.tempWarn;
  return temp >= warn ? "hot" : temp >= warn - 15 ? "warm" : "ok";
}

export function loadLevel(percent: number) {
  return percent >= 90 ? "hot" : percent >= 70 ? "warm" : "ok";
}

function fmtUptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d} 天 ${h} 小时` : h ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

// ---- The fan, guessed ----

// This laptop does not report its fan's speed, so the fan's effort is
// guessed from the CPU's temperature and power over the last 10 seconds,
// which is what the fan follows.
const fanWindow = 10_000;
const fanSamples: { time: number; temp: number; power: number }[] = [];

export const fanTip = "这台华为笔记本读不到风扇转速，这里按 CPU 最近 10 秒的平均温度和功耗估计，仅供参考：平均 ≥80°C 或 ≥35 W 时风扇一般在高速转，≥68°C 或 ≥20 W 中速，再低多半很安静或停转。";

// feedFan keeps a sample for the guess.
export function feedFan(s: MonitorSample) {
  if (!s.cpu.temp || fanSamples.at(-1)?.time === s.time) return;
  fanSamples.push({ time: s.time, temp: s.cpu.temp, power: s.cpu.power });
  while (fanSamples.length && fanSamples[0]!.time < s.time - fanWindow) fanSamples.shift();
}

// fanGuess is the fan's likely effort, or null without the CPU's
// temperature.
export function fanGuess(): { level: "hot" | "warm" | "ok"; label: string; temp: number; power: number } | null {
  if (!fanSamples.length) return null;
  const temp = fanSamples.reduce((n, x) => n + x.temp, 0) / fanSamples.length;
  const power = fanSamples.reduce((n, x) => n + x.power, 0) / fanSamples.length;
  if (temp >= 80 || power >= 35) return { level: "hot", label: "高速", temp, power };
  if (temp >= 68 || power >= 20) return { level: "warm", label: "中速", temp, power };
  return { level: "ok", label: "安静", temp, power };
}

// diskTemp is the hottest disk's own temperature, its first sensor.
export function diskTemp(s: MonitorSample) {
  return Math.max(0, ...s.temps.filter((t) => t.group === "硬盘" && !t.name.includes("传感器")).map((t) => t.value));
}

// ---- Drawing ----

// patch makes a box's content the HTML given by changing only what differs
// from what it shows. The elements that stay are the same elements after,
// so that a sample every second does not take away the row under the
// pointer, its tooltip, a selection or a click under way.
function patch(box: Element, html: string) {
  const next = document.createElement("template");
  next.innerHTML = html;
  morph(box, next.content);
}

function morph(old: ParentNode, next: ParentNode) {
  const was = [...old.childNodes];
  const now = [...next.childNodes];
  now.forEach((n, i) => {
    const o = was[i];
    if (!o) old.appendChild(n);
    else if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName) old.replaceChild(n, o);
    else if (o instanceof Element && n instanceof Element) {
      // A chart keeps the size spark gave it.
      if (!(o instanceof HTMLCanvasElement)) for (const a of [...o.attributes]) if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
      for (const a of n.attributes) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
      morph(o, n);
    } else if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue;
  });
  for (const o of was.slice(now.length)) old.removeChild(o);
}

// The programs as last drawn: a row's 结束 ends the one at its place.
let drawnProcs: ProcessSample[] = [];

function confirmEnd(pr: ProcessSample) {
  const dlg = openDialog(`
    <h2>结束 ${esc(pr.name)}？</h2>
    <p>${pr.count > 1 ? `会结束它的全部 ${pr.count} 个进程。` : ""}没保存的内容会丢失，系统进程结束了可能导致异常。</p>
    <div class="l-buttons"><button data-close>取消</button><button class="primary danger-bg" id="m-kill">结束</button></div>`);
  dlg.querySelector("#m-kill")!.addEventListener("click", async () => {
    dlg.close();
    try {
      await Monitor.endProcesses(pr.pids);
      toast(`已结束 ${pr.name}`);
    } catch (e) {
      showError(e);
    }
  });
}

function render(s: MonitorSample) {
  if (!shown()) return;
  const p = panel!;
  const temp = (t: number) => (t ? ` · <span class="m-${level(t)}">${t.toFixed(0)}°C</span>` : "");
  const dt = diskTemp(s);
  const cards = [
    { key: "cpu", title: "处理器", value: `${s.cpu.usage.toFixed(0)}%`, lvl: loadLevel(s.cpu.usage), sub: `${s.cpu.freq.toFixed(2)} GHz${temp(s.cpu.temp)}${s.cpu.power ? ` · ${s.cpu.power.toFixed(1)} W` : ""}`, max: 100 },
    { key: "mem", title: "内存", value: `${s.memory.percent.toFixed(0)}%`, lvl: loadLevel(s.memory.percent), sub: `${fmtBytes(s.memory.used)} / ${fmtBytes(s.memory.total)}`, max: 100 },
    {
      key: "gpu",
      title: "显卡",
      value: `${s.gpu.usage.toFixed(0)}%`,
      lvl: loadLevel(s.gpu.usage),
      sub: `${s.gpu.clock ? `${(s.gpu.clock / 1000).toFixed(2)} GHz · ` : ""}${s.gpu.power ? `${s.gpu.power.toFixed(1)} W · ` : ""}显存 ${fmtBytes(s.gpu.memory)}${temp(s.gpu.temp)}`,
      max: 100,
    },
    { key: "net", title: "网络", value: `↓ ${fmtRate(s.netDown)}`, lvl: "ok", sub: `↑ ${fmtRate(s.netUp)}`, max: 0 },
    { key: "disk", title: "硬盘读写", value: fmtRate(s.diskRead + s.diskWrite), lvl: "ok", sub: `读 ${fmtRate(s.diskRead)} · 写 ${fmtRate(s.diskWrite)}${temp(dt)}`, max: 0 },
  ];
  const b = s.battery;
  patch(
    p.querySelector(".m-cards")!,
    cards
      .map(
        (c) => `
        <div class="m-card">
          <div class="m-card-head"><span>${c.title}</span><b class="m-${c.lvl}">${c.value}</b></div>
          <div class="m-sub">${c.sub}</div>
          <canvas data-key="${c.key}" data-max="${c.max}"></canvas>
        </div>`,
      )
      .join("") +
    (b
      ? `<div class="m-card">
          <div class="m-card-head"><span>电池</span><b class="m-${b.percent < 20 && !b.ac ? "hot" : "ok"}">${b.percent.toFixed(0)}%</b></div>
          <div class="m-sub">${b.charging ? "充电中" : b.ac ? "接通电源" : "使用电池"}${b.rate ? ` · ${b.rate > 0 ? "+" : ""}${b.rate.toFixed(1)} W` : ""}</div>
          <div class="m-sub">健康 ${b.health.toFixed(0)}%${b.cycles ? ` · 循环 ${b.cycles} 次` : ""} · 已开机 ${fmtUptime(s.uptime)}</div>
          <div class="m-battery"><span style="width:${b.percent}%"></span></div>
        </div>`
      : `<div class="m-card"><div class="m-card-head"><span>已开机</span><b>${fmtUptime(s.uptime)}</b></div></div>`),
  );
  p.querySelectorAll<HTMLCanvasElement>(".m-cards canvas").forEach(spark);

  const cores = s.cpu.cores ?? [];
  p.querySelector(".m-cores-sum")!.textContent = `（${cores.length} 个逻辑处理器）`;
  patch(p.querySelector(".m-cores")!, cores.map((v, i) => `<div class="m-core" title="CPU ${i}：${v.toFixed(0)}%"><span class="m-${loadLevel(v)}" style="height:${Math.max(2, v)}%"></span></div>`).join(""));

  renderTemps(s);

  patch(
    p.querySelector(".m-disks")!,
    s.disks
      .map((d) => {
        const pct = (d.used / d.total) * 100;
        return `<div class="s-row"><span>${d.name}<small class="muted">已用 ${fmtBytes(d.used)}，剩余 ${fmtBytes(d.total - d.used)}，共 ${fmtBytes(d.total)}</small></span><span class="m-bar"><span class="m-${loadLevel(pct)}" style="width:${pct}%"></span></span><b class="m-pct">${pct.toFixed(0)}%</b></div>`;
      })
      .join(""),
  );

  // The buttons' clicks are the box's to take, in monitorTool.render.
  drawnProcs = s.processes;
  patch(
    p.querySelector(".m-procs")!,
    s.processes.length
      ? s.processes
          .map(
            (pr, i) => `
        <div class="s-row m-proc">
          <span class="m-proc-name">${esc(pr.name)}${pr.count > 1 ? `<small class="muted">${pr.count} 个进程</small>` : ""}</span>
          <span class="m-proc-cpu m-${loadLevel(pr.cpu)}">${pr.cpu.toFixed(1)}%</span>
          <span class="m-proc-mem">${fmtBytes(pr.memory)}</span>
          <button data-i="${i}">结束</button>
        </div>`,
          )
          .join("")
      : `<div class="s-row muted">正在统计…</div>`,
  );

  renderInfo(s);
}

function renderTemps(s: MonitorSample) {
  const p = panel!;
  // Each core's temperature goes in one row of chips, as P1 48°.
  const isCore = (t: SensorReading) => t.group === "CPU" && /(?:^|· )(P-Core|E-Core|Core) #\d+$/.test(t.name);
  const cores = s.temps.filter(isCore);
  const rows: SensorReading[] = s.temps.filter((t) => !isCore(t)).sort((a, b) => order(a.group) - order(b.group));
  const box = p.querySelector<HTMLElement>(".m-temps")!;
  const coreRow = cores.length
    ? `<div class="s-row m-core-temps"><span><span class="m-group">CPU</span>各核心</span><span class="m-chips">${cores
        .map((t) => {
          const m = t.name.match(/(P|E)?-?Core #(\d+)$/)!;
          return `<span class="m-chip m-${level(t.value)}" title="${esc(t.name)}">${m[1] ?? "C"}${m[2]} ${t.value.toFixed(0)}°</span>`;
        })
        .join("")}</span></div>`
    : "";
  const fan = fanGuess();
  const fanRow = fan
    ? `<div class="s-row" title="${fanTip}"><span><span class="m-group">风扇</span>估计转速<small class="muted">按 CPU 最近 10 秒平均 ${fan.temp.toFixed(0)}°C、${fan.power.toFixed(0)} W 估计，不是实测</small></span><b class="m-pct m-${fan.level}">${fan.label}</b></div>`
    : "";
  patch(
    box,
    fanRow +
      rows
        .map((t) => {
          const max = t.max || 100;
          return `<div class="s-row"><span title="${esc(t.name)}"><span class="m-group">${esc(t.group)}</span>${esc(sensorName(t))}</span><span class="m-bar"><span class="m-${level(t.value)}" style="width:${Math.min(100, (t.value / max) * 100)}%"></span></span><b class="m-pct m-${level(t.value)}">${t.value.toFixed(0)}°C</b></div>`;
        })
        .join("") +
      coreRow +
      s.fans.map((f) => `<div class="s-row"><span><span class="m-group">风扇</span>${esc(f.name)}</span><b class="m-pct">${f.value.toFixed(0)} 转</b></div>`).join("") || `<div class="s-row muted">没有读到温度</div>`,
  );
  // The tip changes only with whether the sensors answer.
  const tip = p.querySelector<HTMLElement>(".m-temp-tip")!;
  const sensors = String(s.sensors);
  if (tip.dataset.sensors === sensors) return;
  tip.dataset.sensors = sensors;
  tip.hidden = false;
  if (s.sensors) {
    tip.textContent = `风扇：${fanTip}`;
  } else {
    tip.innerHTML = `CPU 温度 Windows 没有提供读取接口，要靠带驱动的软件读。装上 <a href="#" data-url="https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases">LibreHardwareMonitor</a> 并在它的「选项 → 远程网页服务器」里开启（端口 8085），这里就会显示 CPU 各核温度、功耗和风扇转速。硬盘温度不用装也能读。`;
    tip.querySelector("a")!.addEventListener("click", (e) => {
      e.preventDefault();
      void Notes.openURL((e.target as HTMLElement).dataset.url!);
    });
  }
}

// sensorName shortens LibreHardwareMonitor's names: the CPU's rows need no
// model name, the group says it.
function sensorName(t: SensorReading) {
  if (t.group !== "CPU") return t.name;
  const name = t.name.split(" · ").pop()!;
  return ({ "CPU Package": "封装（整体）", "Core Max": "最热的核心", "Core Average": "核心平均" } as Record<string, string>)[name] ?? name;
}

function order(group: string) {
  const i = ["CPU", "GPU", "硬盘", "主板", "内存", "电池"].indexOf(group);
  return i < 0 ? 9 : i;
}

// spark draws a card's history as a small area chart; a max of 0 scales
// to the largest value.
function spark(canvas: HTMLCanvasElement) {
  const data = history[canvas.dataset.key!] ?? [];
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  if (data.length < 2) return;
  const max = Number(canvas.dataset.max) || Math.max(...data, 1);
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#3b82f6";
  const step = w / (historySize - 1);
  const x0 = w - (data.length - 1) * step;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = x0 + i * step;
    const y = h - (Math.min(v, max) / max) * (h - 2) - 1;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.lineTo(w, h);
  ctx.lineTo(x0, h);
  ctx.closePath();
  ctx.fillStyle = accent + "26";
  ctx.fill();
}

// ---- System information ----

async function loadInfo(refresh: boolean) {
  const box = panel?.querySelector<HTMLElement>(".m-info");
  const old = info;
  if (refresh) {
    // Without one, the samples leave the box be until the new one is read.
    info = null;
    if (box) box.innerHTML = `<div class="s-row muted">正在读取系统信息…</div>`;
  }
  try {
    info = await Monitor.info(refresh);
  } catch (e) {
    info = old;
    if (old) showError(e);
    else if (box) box.innerHTML = `<div class="s-row l-error">${esc(errorText(e))}</div>`;
  }
  if (lastSample) renderInfo(lastSample);
}

function infoRows(s: MonitorSample | null): [string, string[]][] {
  if (!info) return [];
  const i = info;
  return [
    ["系统", [`${i.os}`, i.version]],
    ["设备", [i.model, `主板 ${i.board} · BIOS ${i.bios}`]],
    ["计算机", [i.computer]],
    ["处理器", [i.cpu, i.cpuCores]],
    ["内存", [i.memory]],
    ["显卡", i.gpus ?? []],
    ["硬盘", i.disks ?? []],
    ["显示器", i.displays ?? []],
    ["网络", i.network ?? []],
    ["电池", i.battery ? [i.battery + (s?.battery ? `，健康 ${s.battery.health.toFixed(0)}%` : "")] : []],
    ["开机", [`${i.boot}${s ? `，已运行 ${fmtUptime(s.uptime)}` : ""}`]],
  ];
}

function renderInfo(s: MonitorSample) {
  const box = panel?.querySelector<HTMLElement>(".m-info");
  if (!box || !info) return;
  // Only once: it does not change, and a redraw would lose a selection.
  const uptime = box.querySelector('[data-k="开机"] .m-info-v');
  if (uptime) {
    uptime.textContent = infoRows(s).at(-1)![1][0]!;
    return;
  }
  box.innerHTML = infoRows(s)
    .filter(([, v]) => v.length && v.some(Boolean))
    .map(([k, v]) => `<div class="s-row m-info-row" data-k="${k}"><span class="muted">${k}</span><span class="m-info-v">${v.filter(Boolean).map(esc).join("<br>")}</span></div>`)
    .join("");
}

function infoText() {
  return infoRows(lastSample)
    .filter(([, v]) => v.length)
    .map(([k, v]) => `${k}：${v.filter(Boolean).join("；")}`)
    .join("\n");
}
