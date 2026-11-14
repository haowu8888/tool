// The floating ball's page: a click opens the toolbox, a right click its
// menu, dragging moves it, and files dropped on it go to the launcher.
import { onFileDrop } from "mygo-runtime";
import { Flow, Launcher, Notes, Reminder, Services, VirtualScreen, Widget, events, type FlowAlert, type LauncherApp, type ServiceView, type Todo } from "./mygo";
import { baseName } from "./launcher";
import icon from "./assets/widget.png";

// dragThreshold is how far the pointer moves before a press becomes a drag.
const dragThreshold = 4;

export function showWidget(app: HTMLElement) {
  document.documentElement.classList.add("widget");
  // The window's title follows the page's; scripts tell it from 工具箱.
  document.title = "工具箱悬浮球";
  app.innerHTML = `
    <div class="w-ball" title="工具箱：单击打开 · 右键菜单 · 拖动移动 · 拖文件进来加到快捷启动">
      <img src="${icon}" alt="" draggable="false" />
      <span class="w-badge" hidden></span>
      <span class="w-alert" hidden></span>
    </div>`;
  const ball = app.querySelector<HTMLElement>(".w-ball")!;

  let start: { x: number; y: number } | null = null;
  ball.addEventListener("pointerdown", (e) => {
    if (e.button === 0) start = { x: e.screenX, y: e.screenY };
  });
  ball.addEventListener("pointermove", (e) => {
    if (start && Math.hypot(e.screenX - start.x, e.screenY - start.y) > dragThreshold) {
      start = null;
      // Go follows the pointer until the button is released.
      void Widget.drag();
    }
  });
  ball.addEventListener("pointerup", () => {
    // While todos ring a click shows them rather than the toolbox's home.
    if (start) void (ringing ? Reminder.open() : down ? Services.open() : failed.length ? Flow.show(failed[failed.length - 1]!.runId) : Widget.open());
    start = null;
  });
  // Stuck to a screen edge, the ball slides out while the pointer is over it.
  ball.addEventListener("pointerenter", () => void Widget.peek(true));
  ball.addEventListener("pointerleave", () => void Widget.peek(false));
  ball.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    void Widget.menu();
  });

  // A dot shows while the physical displays are off.
  const badge = ball.querySelector<HTMLElement>(".w-badge")!;
  const render = (on: boolean) => {
    badge.hidden = !on;
    badge.title = "物理屏已断开";
  };
  events.virtualScreenChanged.on(render);
  void VirtualScreen.isActive().then(render);

  // Ringing todos and services that went down: a red badge with their
  // count, and the ball sways.
  let ringing = 0;
  let down = 0;
  let failed: FlowAlert[] = [];
  const alert = ball.querySelector<HTMLElement>(".w-alert")!;
  const renderAlerts = () => {
    const n = ringing + down + failed.length;
    alert.hidden = !n;
    alert.textContent = n > 9 ? "9+" : String(n);
    ball.classList.toggle("w-ring", !!n);
    const parts = [ringing && `${ringing} 条待办到时间了`, down && `${down} 个服务掉线`, failed.length && `${failed.length} 次构建失败`].filter(Boolean);
    ball.title = parts.length ? `${parts.join("，")}：单击查看` : "工具箱：单击打开 · 右键菜单 · 拖动移动 · 拖文件进来加到快捷启动";
  };
  const setTodos = (alerts: Todo[]) => {
    ringing = alerts.length;
    renderAlerts();
  };
  const setDown = (list: ServiceView[]) => {
    down = list.filter((v) => v.state.alert).length;
    renderAlerts();
  };
  events.todoAlertsChanged.on((list) => setTodos(list ?? []));
  void Notes.alerts().then(setTodos);
  events.servicesChanged.on((list) => setDown(list ?? []));
  void Services.alerts().then((list) => setDown(list ?? []));
  const setFailed = (list: FlowAlert[]) => {
    failed = list;
    renderAlerts();
  };
  events.flowChanged.on((s) => setFailed(s.alerts ?? []));
  void Flow.alerts().then((list) => setFailed(list ?? []));

  onFileDrop(({ paths }) => {
    if (!paths.length) return;
    const apps = paths.map((path) => ({ id: "", name: baseName(path), path, category: "" }) as LauncherApp);
    void Launcher.addApps(apps).then(() => {
      ball.classList.remove("w-added");
      void ball.offsetWidth; // restart the animation
      ball.classList.add("w-added");
    });
  });
}
