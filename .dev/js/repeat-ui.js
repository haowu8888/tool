// Tests repeating todos through the page: quick-add with 每天, the 🔁 in
// the row, the edit dialog's 重复, ringing at the time, 稍后 keeping the
// due, and ticking moving it on. It removes what it added.
//   node .dev/cdp.mjs @.dev/js/repeat-ui.js
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const c = (m, ...a) => mygo.call(m, ...a);
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const find = async (text) => (await c("Notes.List")).todos.find((t) => t.text === text);
  const out = {};
  document.querySelector('.nav-item[data-id="notes"]').click();
  await wait(300);
  document.querySelector('.n-tabs button[data-view="todos"]').click();
  await wait(100);

  // Quick-add: the hint says it repeats, the row shows 🔁.
  const input = document.querySelector(".n-add input");
  input.value = "每天 晚上11点 测试循环A";
  input.dispatchEvent(new Event("input"));
  out.hint = document.querySelector(".n-hint").textContent.trim();
  input.form.requestSubmit();
  await wait(500);
  const a = await find("测试循环A");
  out.added = a && { due: a.due, repeat: a.repeat };
  const row = () => [...document.querySelectorAll(".n-todo")].find((r) => r.textContent.includes("测试循环A"));
  out.row = row()?.querySelector(".n-due")?.textContent;

  // The edit dialog shows 每天.
  row().querySelector(".n-body").click();
  await wait(200);
  out.dialogRepeat = document.querySelector('dialog[open] select[name="repeat"]')?.value;
  document.querySelector("dialog[open] [data-close]").click();
  await wait(200);

  // Ticking moves it to tomorrow and says so.
  row().querySelector("input").click();
  await wait(900);
  const a2 = await find("测试循环A");
  out.ticked = { due: a2.due, done: !!a2.done, toast: document.querySelector(".l-toast")?.textContent };
  out.tickedRow = row()?.querySelector(".n-due")?.textContent;

  // One at the next minute rings; 稍后 keeps its due.
  const at = new Date(Date.now() + 60000);
  const due = `${ymd(at)}T${hm(at)}`;
  const b = await c("Notes.SaveTodo", { id: "", text: "测试循环B", due, repeat: "day", created: 0 });
  let rang = false;
  for (let i = 0; i < 60 && !rang; i++) {
    await wait(2000);
    rang = !!(await find("测试循环B"))?.alert;
  }
  out.rang = rang;
  await c("Notes.Snooze", b.id, 10);
  const b2 = await find("测试循环B");
  out.snoozed = { due: b2.due, sameDue: b2.due === due, snooze: b2.snooze, alert: !!b2.alert };
  // Done from the bubble's 完成: on to tomorrow, the snooze gone.
  await c("Notes.SaveTodo", { ...b2, done: true });
  const b3 = await find("测试循环B");
  const tomorrow = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1);
  out.done = { due: b3.due, ok: b3.due === `${ymd(tomorrow)}T${hm(at)}`, snooze: b3.snooze ?? "", alert: !!b3.alert, done: !!b3.done };

  // Bad input.
  out.noDate = await c("Notes.SaveTodo", { id: "", text: "测试循环C", repeat: "day", created: 0 }).then(() => "saved!", (e) => String(e.message ?? e));

  for (const t of (await c("Notes.List")).todos) if (t.text.startsWith("测试循环")) await c("Notes.DeleteTodo", t.id);
  return out;
})();
