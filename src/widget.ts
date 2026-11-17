// The floating ball's page: a click opens the toolbox, a right click its
// menu, dragging moves it, and files dropped on it go to the launcher.
import { onFileDrop } from "mygo-runtime";
import { Flow, Launcher, Notes, PetChat, Reminder, Services, Settings, VirtualScreen, Widget, events, type FlowAlert, type LauncherApp, type ServiceView, type Todo, type WidgetSettings } from "./mygo";
import { backgroundURL } from "./appearance";
import { baseName } from "./launcher";
import { isDrawn, petSVG, zzSVG, type Mood } from "./pets";
import icon from "./assets/widget.png";

// dragThreshold is how far the pointer moves before a press becomes a drag.
const dragThreshold = 4;

// longPress is how long a press without moving takes to open the chat.
const longPress = 500;

// sleepAfter is how many seconds nobody uses the computer before a pet
// falls asleep.
const sleepAfter = 300;

export function showWidget(app: HTMLElement) {
  document.documentElement.classList.add("widget");
  // The window's title follows the page's; scripts tell it from 工具箱.
  document.title = "工具箱悬浮球";
  app.innerHTML = `
    <div class="w-ball" data-mood="idle" title="工具箱：单击打开 · 长按聊天 · 右键菜单 · 拖动移动 · 拖文件进来加到快捷启动">
      <div class="w-look"></div>
      <span class="w-badge" hidden></span>
      <span class="w-alert" hidden></span>
    </div>`;
  const ball = app.querySelector<HTMLElement>(".w-ball")!;
  const look = ball.querySelector<HTMLElement>(".w-look")!;

  // The look: the ball, a drawn pet, or the user's picture.
  let pet = "";
  const setLook = (w: WidgetSettings) => {
    const id = w.pet === "custom" && !w.image ? "ball" : w.pet;
    const key = id === "custom" ? "custom:" + w.image : id;
    if (key === pet) return;
    pet = key;
    ball.classList.toggle("w-pet", id !== "ball");
    if (isDrawn(id)) look.innerHTML = petSVG(id);
    else if (id === "custom") look.innerHTML = `<div class="p-fig pet-custom"><img src="${backgroundURL(w.image)}" alt="" draggable="false" /></div>${zzSVG}`;
    else look.innerHTML = `<img src="${icon}" alt="" draggable="false" />`;
    mood();
  };
  void Settings.get().then((s) => setLook(s.widget));
  events.settingsChanged.on((s) => setLook(s.widget));

  // A pet's mood follows what goes on: carried, alarmed, the pointer over
  // it, or nobody at the computer.
  let hover = false;
  let dragging = false;
  let asleep = false;
  const mood = () => {
    const m: Mood = dragging ? "drag" : ringing + down + failed.length ? "alert" : hover ? "happy" : asleep ? "sleep" : "idle";
    ball.dataset.mood = m;
  };
  // act plays a short animation once, as a jump when clicked.
  const act = (name: string) => {
    look.classList.remove("p-act-" + name);
    void look.offsetWidth; // restart the animation
    look.classList.add("p-act-" + name);
  };
  look.addEventListener("animationend", (e) => {
    if ((e.target as Element) === look) look.className = "w-look";
  });
  // Now and then an idle pet hops or looks around by itself.
  const fidget = () => {
    setTimeout(fidget, 8000 + Math.random() * 14000);
    if (pet !== "ball" && ball.dataset.mood === "idle") act(Math.random() < 0.5 ? "hop" : "tilt");
  };
  setTimeout(fidget, 6000);
  // It sleeps while the keyboard and mouse are idle, and wakes soon after.
  const checkIdle = async () => {
    if (pet !== "ball") {
      const idle = await Widget.idle().catch(() => 0);
      if (asleep !== idle >= sleepAfter) {
        asleep = idle >= sleepAfter;
        mood();
      }
    }
    setTimeout(checkIdle, asleep ? 3000 : 20000);
  };
  setTimeout(checkIdle, 20000);

  let start: { x: number; y: number } | null = null;
  // Held down without moving, the pet opens its chat instead of the
  // toolbox.
  let press = 0;
  const unpress = () => {
    clearTimeout(press);
    press = 0;
  };
  ball.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    start = { x: e.screenX, y: e.screenY };
    unpress();
    press = window.setTimeout(() => {
      press = 0;
      if (!start) return;
      start = null;
      act("poke");
      void PetChat.open();
    }, longPress);
  });
  ball.addEventListener("pointercancel", () => {
    start = null;
    unpress();
  });
  ball.addEventListener("pointermove", (e) => {
    if (dragging && !e.buttons) {
      dragging = false; // the release went unseen
      mood();
    }
    if (start && Math.hypot(e.screenX - start.x, e.screenY - start.y) > dragThreshold) {
      start = null;
      unpress();
      dragging = true;
      mood();
      // Go follows the pointer until the button is released.
      void Widget.drag();
    }
  });
  ball.addEventListener("pointerup", () => {
    unpress();
    // While todos ring a click shows them rather than the toolbox's home.
    if (start) {
      act("poke");
      void (ringing ? Reminder.open() : down ? Services.open() : failed.length ? Flow.show(failed[failed.length - 1]!.runId) : Widget.open());
    }
    start = null;
    if (dragging) {
      dragging = false;
      mood();
    }
  });
  // Stuck to a screen edge, the ball slides out while the pointer is over it.
  ball.addEventListener("pointerenter", () => {
    hover = true;
    asleep = false;
    mood();
    void Widget.peek(true);
  });
  ball.addEventListener("pointerleave", () => {
    hover = false;
    mood();
    void Widget.peek(false);
  });
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
    mood();
    const parts = [ringing && `${ringing} 条待办到时间了`, down && `${down} 个服务掉线`, failed.length && `${failed.length} 次构建失败`].filter(Boolean);
    ball.title = parts.length ? `${parts.join("，")}：单击查看` : "工具箱：单击打开 · 长按聊天 · 右键菜单 · 拖动移动 · 拖文件进来加到快捷启动";
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
