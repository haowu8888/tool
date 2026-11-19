// The system monitor over CDP: the system information survives 刷新, the
// rows are changed in place rather than made anew with every sample, and
// the programs' CPU adds up to something possible.
//   node .dev/cdp.mjs @.dev/js/monitor-ui.js
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  document.querySelector('.nav-item[data-id="monitor"]').click();
  // The information takes PowerShell some 5 seconds the first time.
  for (let i = 0; i < 40 && !document.querySelector(".m-info-row"); i++) await sleep(500);
  out.rows = document.querySelectorAll(".m-info-row").length;
  document.querySelector("#m-refresh").click();
  await sleep(300);
  out.loading = document.querySelector(".m-info").textContent.trim();
  await sleep(1500); // a sample or two come meanwhile
  out.stillLoading = document.querySelector(".m-info").textContent.trim();
  for (let i = 0; i < 40 && !document.querySelector(".m-info-row"); i++) await sleep(500);
  await sleep(1500);
  out.rowsAfter = document.querySelectorAll(".m-info-row").length;
  out.error = document.querySelector(".m-info .l-error")?.textContent ?? "";
  out.uptime = document.querySelector('[data-k="开机"] .m-info-v')?.textContent;
  // Samples change the rows in place: a row stays the element it was, and
  // its 结束 asks before ending anything.
  const row = document.querySelector(".m-proc");
  const card = document.querySelector(".m-card canvas");
  await sleep(2500);
  out.sameElements = row.isConnected && row === document.querySelector(".m-proc") && card === document.querySelector(".m-card canvas");
  out.charts = [...document.querySelectorAll(".m-card canvas")].filter((c) => c.width > 0).length;
  row.querySelector("button").click();
  await sleep(150);
  out.dialog = document.querySelector("dialog[open] h2")?.textContent;
  document.querySelector("dialog[open] [data-close]")?.click();
  const s = await mygo.call("Monitor.Last");
  out.cpu = Math.round(s.cpu.usage);
  out.procSum = Math.round(s.processes.reduce((n, p) => n + p.cpu, 0) * 10) / 10;
  out.procs = s.processes.map((p) => `${p.name} ${p.cpu.toFixed(1)}%`);
  return out;
})()
