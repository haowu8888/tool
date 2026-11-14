// The reminder bubble's page: the ringing todos beside the floating ball,
// to do, put off or dismiss, the services that went down and the Flow
// runs that failed.
import { Flow, Notes, Reminder, Services, events, type FlowAlert, type ServiceView, type Todo } from "./mygo";
import { REPEATS, dueInfo } from "./notes";
import { settings } from "./settings";
import { chime, esc } from "./ui";

// shown is how many todos the bubble lists; the rest are a link.
const shown = 3;

export function showBubble(app: HTMLElement) {
  document.documentElement.classList.add("bubble");
  document.title = "待办提醒";
  let seen = new Set<string>();
  let alerts: Todo[] = [];
  let down: ServiceView[] = [];
  let failed: FlowAlert[] = [];
  const render = () => {
    if (!alerts.length && !down.length && !failed.length) return;
    // The first section has the ✕.
    const first = alerts.length ? "todo" : down.length ? "svc" : "flow";
    app.innerHTML = `
      <div class="b-card">
        ${
          alerts.length
            ? `<div class="b-head">
          <span class="b-bell">⏰</span><b>待办到时间了</b>${alerts.length > 1 ? `<span class="b-count">${alerts.length}</span>` : ""}
          <span class="l-spacer"></span>
          <button class="b-x" title="收起：悬浮球上留着红点，点球打开待办">✕</button>
        </div>
        ${alerts
          .slice(0, shown)
          .map((t) => {
            const detail = t.detail?.split("\n")[0];
            return `
              <div class="b-item" data-id="${t.id}">
                <div class="b-text">${t.important ? "★ " : ""}${esc(t.text)}</div>
                <div class="b-meta">${t.repeat ? `🔁 ${REPEATS[t.repeat]} · ` : ""}${t.due ? dueInfo(t.due).label : ""}${detail ? ` · ${esc(detail)}` : ""}</div>
                <div class="b-actions">
                  <button class="b-done">✓ 完成</button>
                  <button data-snooze="10">10 分钟后</button>
                  <button data-snooze="60">1 小时后</button>
                  <button class="b-ok">知道了</button>
                </div>
              </div>`;
          })
          .join("")}
        <button class="b-open">${alerts.length > shown ? `还有 ${alerts.length - shown} 条，打开待办` : "打开待办"}</button>`
            : ""
        }
        ${
          down.length
            ? `<div class="b-head${alerts.length ? " b-second" : ""}">
          <span class="b-bell">🔴</span><b>服务掉线了</b>${down.length > 1 ? `<span class="b-count">${down.length}</span>` : ""}
          <span class="l-spacer"></span>
          ${first === "svc" ? `<button class="b-x" title="收起：悬浮球上留着红点">✕</button>` : ""}
        </div>
        ${down
          .slice(0, shown)
          .map(
            (v) => `
              <div class="b-item" data-svc="${v.id}">
                <div class="b-text">${esc(v.name)}</div>
                <div class="b-meta">${esc(v.state.message ?? "")} · ${esc(v.target)}</div>
                <div class="b-actions">
                  <button class="b-retry">重新检查</button>
                  <button class="b-ack">知道了</button>
                </div>
              </div>`,
          )
          .join("")}
        <button class="b-svc">${down.length > shown ? `还有 ${down.length - shown} 个，打开服务监控` : "打开服务监控"}</button>`
            : ""
        }
        ${
          failed.length
            ? `<div class="b-head${first !== "flow" ? " b-second" : ""}">
          <span class="b-bell">🛠</span><b>构建失败</b>${failed.length > 1 ? `<span class="b-count">${failed.length}</span>` : ""}
          <span class="l-spacer"></span>
          ${first === "flow" ? `<button class="b-x" title="收起：悬浮球上留着红点">✕</button>` : ""}
        </div>
        ${failed
          .slice(-shown)
          .reverse()
          .map(
            (a) => `
              <div class="b-item" data-run="${esc(a.runId)}">
                <div class="b-text">${esc(a.pipeline)} #${a.number}</div>
                <div class="b-meta">${a.at ? new Date(a.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) + " 失败" : "失败"}</div>
                <div class="b-actions">
                  <button class="b-log">看日志</button>
                  <button class="b-rerun">重试</button>
                  <button class="b-ack">知道了</button>
                </div>
              </div>`,
          )
          .join("")}
        ${failed.length > shown ? `<button class="b-flow">还有 ${failed.length - shown} 次，打开 Flow 流水线</button>` : ""}`
            : ""
        }
      </div>`;
    app.querySelector(".b-x")?.addEventListener("click", () => void Reminder.collapse());
    app.querySelector(".b-open")?.addEventListener("click", () => void Reminder.open());
    app.querySelector(".b-svc")?.addEventListener("click", () => {
      void Reminder.collapse();
      void Services.open();
    });
    app.querySelectorAll<HTMLElement>(".b-item[data-id]").forEach((item) => {
      const t = alerts.find((t) => t.id === item.dataset.id)!;
      item.querySelector(".b-done")!.addEventListener("click", () => void Notes.saveTodo({ ...t, done: true }));
      item.querySelector(".b-ok")!.addEventListener("click", () => void Notes.dismiss(t.id));
      item.querySelectorAll<HTMLElement>("[data-snooze]").forEach((b) => b.addEventListener("click", () => void Notes.snooze(t.id, Number(b.dataset.snooze))));
    });
    app.querySelector(".b-flow")?.addEventListener("click", () => {
      void Reminder.collapse();
      void Flow.show("");
    });
    app.querySelectorAll<HTMLElement>(".b-item[data-run]").forEach((item) => {
      const id = item.dataset.run!;
      item.querySelector(".b-log")!.addEventListener("click", () => {
        void Reminder.collapse();
        void Flow.show(id);
      });
      item.querySelector(".b-rerun")!.addEventListener("click", () => void Flow.retry(id));
      item.querySelector(".b-ack")!.addEventListener("click", () => void Flow.ack(id));
    });
    app.querySelectorAll<HTMLElement>(".b-item[data-svc]").forEach((item) => {
      const id = item.dataset.svc!;
      item.querySelector(".b-retry")!.addEventListener("click", () => void Services.check(id));
      item.querySelector(".b-ack")!.addEventListener("click", () => void Services.ack(id));
    });
    // The window fits the card.
    const card = app.querySelector<HTMLElement>(".b-card")!;
    void Reminder.resize(Math.ceil(card.getBoundingClientRect().height) + 16);
    // A chime for a todo that just started ringing, a service that just
    // went down or a run that just failed, unless turned off.
    const ids = [...alerts.map((t) => t.id), ...down.map((v) => "svc:" + v.id), ...failed.map((a) => "run:" + a.runId)];
    if (settings.reminder.sound && ids.some((id) => !seen.has(id))) chime();
    seen = new Set(ids);
  };
  events.todoAlertsChanged.on((list) => {
    alerts = list ?? [];
    render();
  });
  events.servicesChanged.on((list) => {
    down = (list ?? []).filter((v) => v.state.alert);
    render();
  });
  events.flowChanged.on((s) => {
    failed = s.alerts ?? [];
    render();
  });
  void Flow.alerts().then((a) => {
    failed = a ?? [];
    render();
  });
  void Notes.alerts().then((a) => {
    alerts = a ?? [];
    render();
  });
  void Services.alerts().then((a) => {
    down = a ?? [];
    render();
  });
}
