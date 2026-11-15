// Screen recording: the tool's page in the toolbox, with the recordings
// saved, and the small panel beside the region being recorded (?rec).
import { icons } from "./icons";
import { Record, events, type RecordFile, type RecordState } from "./mygo";
import { kbd, onSettings, save, settings, shortcutKeys } from "./settings";
import { esc, onLeave, openDialog, showError, toast } from "./ui";

// clock shows ms as 03:21, or 1:03:21.
export function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h ? `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

function fileSize(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function when(t: number) {
  const d = new Date(t);
  const today = new Date();
  const hm = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `今天 ${hm}`;
  if (d.toDateString() === new Date(today.getTime() - 864e5).toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

// play shows a video in a dialog.
function play(f: RecordFile) {
  const dlg = openDialog(`
    <div class="rc-player">
      <video src="${esc(f.url)}" controls autoplay></video>
      <div class="l-actions"><span class="muted">${esc(f.name)}</span><button data-close>关闭</button></div>
    </div>`);
  dlg.classList.add("rc-dialog");
  // Closed, it stops: the dialog goes, and its video with it.
  dlg.addEventListener("close", () => dlg.querySelector("video")?.pause());
}

// ---- The tool's page ----

export const recordTool = {
  id: "record",
  name: "屏幕录制",
  icon: icons.record,
  render(p: HTMLElement) {
    const key = shortcutKeys("record");
    p.innerHTML = `
      <h1>屏幕录制</h1>
      <p class="muted">框选屏幕上的一块录成 MP4 视频，单击就录整个屏幕；可以带上电脑播放的声音和麦克风。</p>
      <div class="rc-start">
        <button class="sh-go rc-go">${icons.record}<b>开始录屏</b><span class="sh-key">${key ? kbd(key) : `<span class="muted">未设快捷键</span>`}</span></button>
        <div class="rc-live" hidden>
          <span class="rc-dot"></span><b class="rc-time">00:00</b><span class="muted rc-live-text">正在录屏</span>
          <button class="rc-pause">暂停</button><button class="primary rc-stop">停止并保存</button>
        </div>
      </div>
      <section class="s-group">
        <h2>录制</h2>
        <div class="s-card">
          <div class="s-row"><span>帧率<small class="muted">一般 30 就够；录游戏、动画选 60，文件大一些</small></span>
            <div class="s-seg rc-fps">${[15, 30, 60].map((n) => `<button data-fps="${n}">${n}</button>`).join("")}</div>
          </div>
          <label class="s-row"><span>录鼠标指针</span><input type="checkbox" class="rc-cursor" /></label>
          <label class="s-row"><span>录电脑播放的声音<small class="muted">扬声器或耳机里放出来的声音</small></span><input type="checkbox" class="rc-sound" /></label>
          <label class="s-row"><span>录麦克风<small class="muted">用系统默认的麦克风，和电脑的声音混在一起</small></span><input type="checkbox" class="rc-mic" /></label>
          <div class="s-row"><span>保存到<small class="muted rc-dir"></small></span><span class="rc-dir-acts"><button class="rc-pick">更改</button><button class="rc-open-dir">打开</button></span></div>
        </div>
      </section>
      <section class="s-group">
        <h2>录好的视频<span class="muted rc-count"></span></h2>
        <div class="rc-list"><p class="muted">正在读取…</p></div>
      </section>
      <ul class="tips muted">
        <li>${key ? `${kbd(key)} 开始录屏，录的时候再按一次停止并保存；` : ""}托盘和悬浮球菜单里也有「录屏」，截图的工具栏里点 ${icons.record.replace("<svg", '<svg class="sh-inline"')} 也能把选区录下来。</li>
        <li>录的时候区域外有红框，旁边的小面板可以暂停、停止或丢弃，拖动它可以挪开；红框和面板都不会录进视频。</li>
        <li>视频是 H.264 + AAC 的 MP4，微信、网页、剪辑软件都能直接用；「复制」后可以直接粘贴到聊天窗口发送。</li>
      </ul>`;

    const go = p.querySelector<HTMLButtonElement>(".rc-go")!;
    const live = p.querySelector<HTMLElement>(".rc-live")!;
    const timeEl = p.querySelector<HTMLElement>(".rc-time")!;
    const liveText = p.querySelector<HTMLElement>(".rc-live-text")!;
    const pauseBtn = p.querySelector<HTMLButtonElement>(".rc-pause")!;
    const list = p.querySelector<HTMLElement>(".rc-list")!;

    go.addEventListener("click", () => void Record.start().catch(showError));
    p.querySelector(".rc-stop")!.addEventListener("click", () => void Record.stop(false));
    pauseBtn.addEventListener("click", () => void Record.pause(state.state === "recording"));

    // The recording going on, with its clock running here.
    let state: RecordState = { state: "idle" } as RecordState;
    let since = 0;
    const tick = () => {
      if (state.state === "recording") timeEl.textContent = clock(state.elapsed + performance.now() - since);
    };
    const timer = setInterval(tick, 500);
    onLeave(() => clearInterval(timer));
    const show = (st: RecordState) => {
      const was = state.state;
      state = st;
      since = performance.now();
      const going = st.state === "recording" || st.state === "paused";
      go.hidden = going;
      live.hidden = !going;
      live.classList.toggle("paused", st.state === "paused");
      timeEl.textContent = clock(st.elapsed);
      liveText.textContent = st.state === "paused" ? "已暂停" : `正在录屏 · ${st.width} × ${st.height}`;
      pauseBtn.textContent = st.state === "paused" ? "继续" : "暂停";
      if (st.state !== was && (st.state === "done" || st.state === "idle" || st.state === "failed")) void refresh();
    };
    onLeave(events.recordChanged.on(show));
    void Record.state().then(show);

    // The settings.
    const bind = (cls: string, key: "cursor" | "sound" | "mic") => {
      const el = p.querySelector<HTMLInputElement>(cls)!;
      el.addEventListener("change", () => void save((s) => (s.record[key] = el.checked)));
      return () => (el.checked = settings.record[key]);
    };
    const fills = [bind(".rc-cursor", "cursor"), bind(".rc-sound", "sound"), bind(".rc-mic", "mic")];
    p.querySelectorAll<HTMLElement>(".rc-fps button").forEach((b) => b.addEventListener("click", () => void save((s) => (s.record.fps = Number(b.dataset.fps)))));
    const dirEl = p.querySelector<HTMLElement>(".rc-dir")!;
    const render = () => {
      if (!p.querySelector(".rc-fps")) return;
      fills.forEach((f) => f());
      p.querySelectorAll<HTMLElement>(".rc-fps button").forEach((b) => b.classList.toggle("on", Number(b.dataset.fps) === settings.record.fps));
      void Record.dir().then((d) => (dirEl.textContent = d), showError);
    };
    onLeave(onSettings(render));
    render();
    p.querySelector(".rc-pick")!.addEventListener("click", () => void Record.pickDir().then((d) => void (d && refresh()), showError));
    p.querySelector(".rc-open-dir")!.addEventListener("click", () => void Record.openDir().catch(showError));

    // The recordings saved.
    let files: RecordFile[] = [];
    const refresh = async () => {
      try {
        files = await Record.list();
      } catch (e) {
        list.innerHTML = `<p class="muted">${esc(String(e instanceof Error ? e.message : e))}</p>`;
        return;
      }
      if (!list.isConnected) return;
      p.querySelector(".rc-count")!.textContent = files.length ? `${files.length} 个` : "";
      list.innerHTML = files.length
        ? files
            .slice(0, 50)
            .map(
              (f, i) => `
          <div class="rc-item" data-i="${i}">
            <button class="rc-thumb" data-act="play" title="播放"><video src="${esc(f.url)}#t=0.5" preload="metadata" muted></video><span class="rc-len">${f.duration ? clock(f.duration) : ""}</span></button>
            <div class="rc-info">
              <b title="${esc(f.name)}">${esc(f.name.replace(/\.mp4$/i, ""))}</b>
              <small class="muted">${when(f.time)} · ${fileSize(f.size)}</small>
              <div class="rc-acts">
                <button data-act="copy" title="复制文件，可以粘贴到聊天窗口">复制</button>
                <button data-act="open" title="用系统的播放器打开">打开</button>
                <button data-act="reveal">所在位置</button>
                <button data-act="delete" class="danger" title="移到回收站">删除</button>
              </div>
            </div>
          </div>`,
            )
            .join("")
        : `<p class="muted">还没有录过。</p>`;
    };
    list.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      const f = files[Number(b?.closest<HTMLElement>(".rc-item")?.dataset.i)];
      if (!b || !f) return;
      const act = b.dataset.act;
      if (act === "play") play(f);
      else if (act === "open") void Record.open(f.path).catch(showError);
      else if (act === "reveal") void Record.reveal(f.path).catch(showError);
      else if (act === "copy") void Record.copy(f.path).then(() => toast("已复制，可以粘贴到聊天窗口或文件夹"), showError);
      else if (act === "delete")
        void Record.delete(f.path).then(() => {
          toast("已移到回收站");
          void refresh();
        }, showError);
    });
    void refresh();
  },
};

// ---- The panel beside the region being recorded ----

export function showRecordPanel(app: HTMLElement) {
  document.documentElement.classList.add("recpanel");
  document.title = "录屏";
  let state: RecordState = { state: "recording", elapsed: 0 } as RecordState;
  let since = performance.now();

  const render = () => {
    const st = state;
    const going = st.state === "recording" || st.state === "paused";
    document.documentElement.classList.toggle("done", !going && st.state !== "saving");
    if (going || st.state === "saving") {
      app.innerHTML = `
        <div class="rp-bar">
          <span class="rp-dot${st.state === "paused" ? " paused" : ""}"></span>
          <b class="rp-time">${clock(st.elapsed)}</b>
          <span class="rp-text muted">${st.state === "saving" ? "正在保存…" : st.state === "paused" ? "已暂停" : `${st.width}×${st.height}`}</span>
          ${
            going
              ? `<button data-act="pause" title="${st.state === "paused" ? "继续" : "暂停"}">${st.state === "paused" ? "▶" : "❚❚"}</button>
          <button data-act="stop" class="rp-stop" title="停止并保存"><i></i></button>
          <button data-act="discard" title="不要了，丢掉这段">✕</button>`
              : ""
          }
        </div>`;
      return;
    }
    if (st.state === "failed") {
      app.innerHTML = `
        <div class="rp-card">
          <b class="rp-title danger">录屏失败</b>
          <p class="rp-note">${esc(st.error)}</p>
          <div class="rp-acts"><button data-act="close" class="primary">关闭</button></div>
        </div>`;
      return;
    }
    app.innerHTML = `
      <div class="rp-card">
        <b class="rp-title">✓ 已保存 <span class="muted">${clock(st.elapsed)} · ${fileSize(st.size)}</span></b>
        <p class="rp-note${st.note ? " warn" : ""}" title="${esc(st.path)}">${esc(st.note || st.name)}</p>
        <div class="rp-acts">
          <button data-act="copy" title="复制文件，可以粘贴到聊天窗口">复制</button>
          <button data-act="open">播放</button>
          <button data-act="reveal">所在位置</button>
          <button data-act="close" class="primary">关闭</button>
        </div>
      </div>`;
  };

  const show = (st: RecordState) => {
    if (st.state === "idle") return;
    state = st;
    since = performance.now();
    render();
  };
  setInterval(() => {
    if (state.state !== "recording") return;
    const el = app.querySelector(".rp-time");
    if (el) el.textContent = clock(state.elapsed + performance.now() - since);
  }, 250);
  events.recordChanged.on(show);

  app.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "pause") void Record.pause(state.state === "recording");
    else if (act === "stop") void Record.stop(false);
    else if (act === "discard") {
      // Thrown away by a slip would be a shame: a second click does it.
      if (b.classList.contains("sure")) void Record.stop(true);
      else {
        b.classList.add("sure");
        b.textContent = "丢弃?";
        setTimeout(() => {
          b.classList.remove("sure");
          b.textContent = "✕";
        }, 2500);
      }
    } else if (act === "close") void Record.close();
    else if (act === "open") void Record.open(state.path).catch((e) => alert(String(e)));
    else if (act === "reveal") void Record.reveal(state.path).catch((e) => alert(String(e)));
    else if (act === "copy")
      void Record.copy(state.path).then(
        () => {
          b.textContent = "已复制";
          setTimeout(() => (b.textContent = "复制"), 1500);
        },
        (e) => alert(String(e)),
      );
  });
  // The panel is dragged by anything but its buttons.
  app.addEventListener("pointerdown", (e) => {
    if (e.button === 0 && !(e.target as HTMLElement).closest("button")) void Record.dragPanel();
  });

  void Record.state().then((st) => {
    show(st);
    void Record.ready();
  });
}
