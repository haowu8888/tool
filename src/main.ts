// The app's pages: every window loads this, and it loads the page of its
// window only, so that the floating ball, the bubbles and the popups do not
// carry all the tools. VirtualScreen and events are generated from the Go
// code by `mygo generate`.
import { markMainWindow } from "./appearance";
import { loadSettings } from "./settings";

const app = document.querySelector<HTMLDivElement>("#app")!;

await loadSettings();
const params = new URLSearchParams(location.search);
if (params.has("widget")) {
  (await import("./widget")).showWidget(app);
} else if (params.has("bubble")) {
  (await import("./bubble")).showBubble(app);
} else if (params.has("overlay")) {
  (await import("./overlay")).showOverlay(app);
} else if (params.has("shot")) {
  (await import("./shot")).showShot(app, Number(params.get("shot")));
} else if (params.has("clips")) {
  (await import("./clips")).showClips(app);
} else if (params.has("petchat")) {
  (await import("./petchat")).showPetChat(app);
} else if (params.has("longframe")) {
  (await import("./shot")).showScrollFrame(app);
} else if (params.has("rec")) {
  (await import("./record")).showRecordPanel(app);
} else if (params.has("scroll")) {
  (await import("./shot")).showScroll(app);
} else if (params.has("pin")) {
  void (await import("./shot")).showPin(app, params.get("pin")!);
} else {
  markMainWindow();
  (await import("./toolbox")).showToolbox();
}
