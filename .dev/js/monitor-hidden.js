// The monitor's page stops watching while the main window is hidden in the
// tray (with the overlay off) and watches again when it shows: the time
// between two samples 3 seconds apart, 0 when sampling stopped.
//   node .dev/cdp.mjs @.dev/js/monitor-hidden.js
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const s = await mygo.call("Settings.Get");
  if (s.closeAction !== "hide") return "skipped: closing quits";
  document.querySelector('.nav-item[data-id="monitor"]').click();
  await sleep(1500);
  const advance = async () => {
    await sleep(2500);
    const a = await mygo.call("Monitor.Last");
    await sleep(3000);
    return (await mygo.call("Monitor.Last")).time - a.time;
  };
  await mygo.window.close();
  const hidden = await advance();
  // As a click on the floating ball shows the window.
  await mygo.call("Widget.Open");
  const shown = await advance();
  return { overlay: s.monitor.overlay.show, hidden, shown };
})()
