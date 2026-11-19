// The Flow tool: open a pipeline's failed run (opens on the failed job's
// log), outputs of a successful run, the run dialog (cancelled, nothing
// runs). Needs a connected Flow with the toolbox pipeline.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  document.querySelector('.nav-item[data-id="flow"]').click();
  await wait(600);
  const item = [...document.querySelectorAll(".fl-item")].find((el) => el.querySelector(".sv-name").textContent.includes("toolbox"));
  const failed = item.querySelector(".fl-runs i.fl-s-failed");
  failed.click();
  for (let i = 0; i < 30 && !item.querySelector(".fl-job"); i++) await wait(300);
  await wait(1500);
  out.head = item.querySelector(".fl-d-head").textContent.replace(/\s+/g, " ").trim();
  out.jobs = [...item.querySelectorAll(".fl-job")].map((j) => j.querySelector(".fl-job-row").textContent.replace(/\s+/g, " ").trim() + (j.classList.contains("open") ? " [open]" : ""));
  const log = item.querySelector(".fl-job.open .fl-log");
  out.logTail = log?.textContent.trim().split("\n").slice(-3);
  out.logScrolledToEnd = log ? log.scrollTop + log.clientHeight >= log.scrollHeight - 5 : null;
  // The latest, successful run: its outputs.
  item.querySelector(".fl-runs i:last-child").click();
  for (let i = 0; i < 30 && !item.querySelector(".fl-out"); i++) await wait(300);
  out.outs = [...item.querySelectorAll(".fl-out.named")].map((o) => o.textContent.replace(/\s+/g, " ").trim().slice(0, 80));
  // The run dialog, cancelled.
  item.querySelector('[data-act="run"]').click();
  await wait(300);
  out.dialog = document.querySelector("dialog[open] h2")?.textContent;
  document.querySelector("dialog[open] [data-close]").click();
  return out;
})()
