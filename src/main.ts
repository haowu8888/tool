// The app's pages: every window loads this, and it loads the page of its
// window only, so that the floating ball, the bubbles and the popups do not
// carry all the tools. VirtualScreen and events are generated from the Go
// code by `mygo generate`.
import { markMainWindow } from "./appearance";
import { loadSettings } from "./settings";

const app = document.querySelector<HTMLDivElement>("#app")!;

await loadSettings();
const params = new URLSearchParams(location.search);
// Each window's styles, after css/base.css (index.html), one after the
// other so that they apply in this order, and css/controls.css last.
const controls = () => import("./css/controls.css");
if (params.has("widget")) {
  await import("./css/widget.css");
  await import("./css/pets.css");
  await controls();
  (await import("./widget")).showWidget(app);
} else if (params.has("bubble")) {
  await import("./css/bubble.css");
  await controls();
  (await import("./bubble")).showBubble(app);
} else if (params.has("overlay")) {
  await import("./css/overlay.css");
  await controls();
  (await import("./overlay")).showOverlay(app);
} else if (params.has("shot")) {
  await import("./css/shot.css");
  await controls();
  (await import("./shot")).showShot(app, Number(params.get("shot")));
} else if (params.has("clips")) {
  await import("./css/clips.css");
  await controls();
  (await import("./clips")).showClips(app);
} else if (params.has("petchat")) {
  await import("./css/petchat.css");
  await import("./css/pets.css"); // the pet beside its words
  await controls();
  (await import("./petchat")).showPetChat(app);
} else if (params.has("longframe")) {
  await import("./css/shot.css");
  await controls();
  (await import("./shot")).showScrollFrame(app);
} else if (params.has("rec")) {
  await import("./css/recpanel.css");
  await controls();
  (await import("./record")).showRecordPanel(app);
} else if (params.has("scroll")) {
  await import("./css/shot.css");
  await controls();
  (await import("./shot")).showScroll(app);
} else if (params.has("pin")) {
  await import("./css/shot.css");
  await controls();
  void (await import("./shot")).showPin(app, params.get("pin")!);
} else {
  // The tools' pages; the pets show in 设置, the clipboard's items in its page.
  await import("./style.css");
  await import("./css/pets.css");
  await import("./css/clips.css");
  await controls();
  markMainWindow();
  (await import("./toolbox")).showToolbox();
}
