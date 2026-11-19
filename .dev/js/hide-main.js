// Closes the main window to the tray, as its × does, and tells whether its
// page went hidden; then starting the exe again must show it.
//   node .dev/cdp.mjs @.dev/js/hide-main.js
(async () => {
  const s = await mygo.call("Settings.Get");
  if (s.closeAction !== "hide") return "skipped: closing quits (closeAction=" + s.closeAction + ")";
  await mygo.window.close();
  await new Promise((r) => setTimeout(r, 1000));
  return document.visibilityState;
})()
