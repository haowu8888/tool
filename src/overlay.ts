// The monitor overlay's page: the numbers the user picks, in a small bar
// on top of the other windows. Dragging moves it, a double click opens the
// monitor, a right click shows its menu.
import { diskTemp, fanGuess, feedFan, level, loadLevel } from "./monitor";
import { Monitor, Overlay, events, type MonitorSample } from "./mygo";
import { onSettings, settings } from "./settings";

const dragThreshold = 4;

// short writes a rate compactly: 12K, 3.4M.
function short(n: number) {
  if (n < 1024) return `${n.toFixed(0)}B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)}K`;
  return `${(n / 1024 ** 2).toFixed(1)}M`;
}

// items are what the overlay can show: a label and the value with its
// color, or null when there is nothing to show, as a temperature unknown.
const items: Record<string, (s: MonitorSample) => [string, string, string] | null> = {
  cpu: (s) => ["CPU", `${s.cpu.usage.toFixed(0)}%`, loadLevel(s.cpu.usage)],
  cpuTemp: (s) => (s.cpu.temp ? ["CPU", `${s.cpu.temp.toFixed(0)}°C`, level(s.cpu.temp)] : null),
  cpuFreq: (s) => ["频率", `${s.cpu.freq.toFixed(1)}G`, "ok"],
  mem: (s) => ["内存", `${s.memory.percent.toFixed(0)}%`, loadLevel(s.memory.percent)],
  gpu: (s) => ["GPU", `${s.gpu.usage.toFixed(0)}%`, loadLevel(s.gpu.usage)],
  gpuTemp: (s) => (s.gpu.temp ? ["GPU", `${s.gpu.temp.toFixed(0)}°C`, level(s.gpu.temp)] : null),
  diskTemp: (s) => {
    const t = diskTemp(s);
    return t ? ["硬盘", `${t.toFixed(0)}°C`, level(t)] : null;
  },
  net: (s) => ["网络", `↓${short(s.netDown)} ↑${short(s.netUp)}`, "ok"],
  disk: (s) => ["读写", `${short(s.diskRead + s.diskWrite)}/s`, "ok"],
  fan: () => {
    const f = fanGuess();
    return f ? ["风扇", f.label, f.level] : null;
  },
  battery: (s) => (s.battery ? ["电池", `${s.battery.charging ? "⚡" : ""}${s.battery.percent.toFixed(0)}%`, s.battery.percent < 20 && !s.battery.ac ? "hot" : "ok"] : null),
};

// widths are the values' widest texts in ch, so the bar keeps its width as
// the numbers change: each new width resizes the window, and a transparent
// window shows black in the new strip until the page draws over it.
const widths: Record<string, number> = { cpu: 4, cpuTemp: 5, cpuFreq: 4, mem: 4, gpu: 4, gpuTemp: 5, diskTemp: 5, net: 13, disk: 7, fan: 4, battery: 5 };

export function showOverlay(app: HTMLElement) {
  document.documentElement.classList.add("overlay");
  document.title = "系统监控悬浮窗";
  app.innerHTML = `<div class="o-bar" title="拖动移动 · 双击打开系统监控 · 右键菜单"><span class="o-wait">读取中…</span></div>`;
  const bar = app.querySelector<HTMLElement>(".o-bar")!;
  let last: MonitorSample | null = null;
  // The window only grows until the items or their layout change, for the
  // same reason as widths.
  let layout = "";
  let fit = { w: 0, h: 0 };
  const render = (s: MonitorSample) => {
    last = s;
    feedFan(s);
    const o = settings.monitor.overlay;
    bar.classList.toggle("vertical", o.vertical);
    const cells = o.items.flatMap((k) => {
      const c = items[k]?.(s);
      return c ? [{ k, c }] : [];
    });
    bar.innerHTML = cells.length ? cells.map(({ k, c: [l, v, lvl] }) => `<span class="o-item"><span class="o-label">${l}</span><b class="o-${lvl}" style="min-width: ${widths[k] ?? 0}ch">${v}</b></span>`).join("") : `<span class="o-wait">在设置里选要显示的内容</span>`;
    const next = `${o.vertical} ${cells.map((c) => c.k).join()}`;
    if (next !== layout) {
      layout = next;
      fit = { w: 0, h: 0 };
    }
    // The window fits the bar.
    const r = bar.getBoundingClientRect();
    const w = Math.max(fit.w, Math.ceil(r.width) + 8);
    const h = Math.max(fit.h, Math.ceil(r.height) + 8);
    if (w !== fit.w || h !== fit.h) {
      fit = { w, h };
      void Overlay.resize(w, h);
    }
  };
  events.monitorSampled.on(render);
  onSettings(() => last && render(last));
  void Monitor.last().then((s) => s.time && render(s));

  let start: { x: number; y: number } | null = null;
  bar.addEventListener("pointerdown", (e) => {
    if (e.button === 0) start = { x: e.screenX, y: e.screenY };
  });
  bar.addEventListener("pointermove", (e) => {
    if (start && Math.hypot(e.screenX - start.x, e.screenY - start.y) > dragThreshold) {
      start = null;
      void Overlay.drag();
    }
  });
  bar.addEventListener("pointerup", () => (start = null));
  bar.addEventListener("dblclick", () => void Overlay.open());
  bar.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    void Overlay.menu();
  });
}
