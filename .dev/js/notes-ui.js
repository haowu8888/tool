// Tests the notes tool through its page: quick-add with a time, groups,
// ticking, the star, editing, undoing a delete, and notes with autosave.
// It removes what it added.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const c = (m, ...a) => mygo.call(m, ...a);
  const out = {};
  const before = await c("Notes.List");
  document.querySelector('.nav-item[data-id="notes"]').click();
  await wait(300);
  document.querySelector('.n-tabs button[data-view="todos"]').click();
  await wait(100);

  // Quick-add: the hint shows the parsed time; Enter adds it.
  const add = async (text, star) => {
    const input = document.querySelector(".n-add input");
    input.value = text;
    input.dispatchEvent(new Event("input"));
    if (star) document.querySelector(".n-star").click();
    const hint = document.querySelector(".n-hint").textContent;
    input.form.requestSubmit();
    await wait(400);
    return hint;
  };
  out.hint1 = await add("测试 明天 15:00 开会");
  out.hint2 = await add("测试 交报告 周五", true);
  out.hint3 = await add("测试 无日期的事");
  // One overdue a minute ago: the reminder marks it within 15 seconds.
  const past = new Date(Date.now() - 60000);
  const pad = (n) => String(n).padStart(2, "0");
  const due = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}T${pad(past.getHours())}:${pad(past.getMinutes())}`;
  await c("Notes.SaveTodo", { id: "", text: "测试 过期提醒", due, created: 0 });
  await wait(300);
  const groups = () => [...document.querySelectorAll(".n-todos section")].map((s) => s.querySelector("h2").textContent.trim() + ": " + [...s.querySelectorAll(".n-todo")].map((r) => r.querySelector(".n-text").textContent + (r.querySelector(".n-due") ? "[" + r.querySelector(".n-due").textContent + "]" : "") + (r.querySelector(".n-imp.on") ? "★" : "")).join(" | "));
  out.groups = groups();
  out.count = document.querySelector(".n-count").textContent + (document.querySelector(".n-count.overdue") ? " (red)" : "");

  // Tick one: it moves to 已完成.
  const row = [...document.querySelectorAll(".n-todo")].find((r) => r.textContent.includes("无日期的事"));
  row.querySelector("input").click();
  await wait(800);
  document.querySelector(".n-fold")?.click();
  await wait(100);
  out.afterTick = groups();

  // Edit: change text and clear the date.
  [...document.querySelectorAll(".n-todo .n-body")].find((b) => b.textContent.includes("开会")).click();
  await wait(100);
  const dlg = document.querySelector("dialog[open]");
  dlg.querySelector("[name=text]").value = "测试 开会（改）";
  dlg.querySelector("[name=detail]").value = "带上电脑";
  dlg.querySelector("[data-clear]").click();
  dlg.querySelector("form").requestSubmit();
  await wait(400);
  out.edited = (await c("Notes.List")).todos.filter((t) => t.text.includes("开会")).map((t) => [t.text, t.detail, t.due ?? ""]);

  // Delete and undo.
  [...document.querySelectorAll(".n-todo")].find((r) => r.textContent.includes("交报告")).querySelector(".n-del").click();
  await wait(300);
  out.toast = document.querySelector(".l-toast")?.textContent;
  document.querySelector(".l-toast button").click();
  await wait(300);
  out.undone = (await c("Notes.List")).todos.some((t) => t.text.includes("交报告") && t.important);

  // The reminder.
  await wait(16000);
  out.reminded = (await c("Notes.List")).todos.find((t) => t.text === "测试 过期提醒")?.reminded;

  // Notes: new, type, autosave, pin, search.
  document.querySelector('.n-tabs button[data-view="notes"]').click();
  await wait(100);
  document.querySelector("#n-new").click();
  await wait(400);
  const ed = document.querySelector(".n-doc .ProseMirror").editor;
  out.focused = ed.isFocused;
  ed.commands.setContent("<p>测试笔记标题</p><p>第二行内容</p>", true);
  await wait(800);
  out.status = document.querySelector(".n-status").textContent;
  out.saved = (await c("Notes.List")).notes.find((n) => n.body.includes("测试笔记标题"))?.body;
  document.querySelector(".n-pin").click();
  await wait(300);
  out.list = [...document.querySelectorAll(".n-item .n-title")].map((t) => t.textContent);
  const search = document.querySelector(".n-side .l-search");
  search.value = "第二行";
  search.dispatchEvent(new Event("input"));
  out.search = [...document.querySelectorAll(".n-item .n-title")].map((t) => t.textContent);
  search.value = "";
  search.dispatchEvent(new Event("input"));
  // An empty new note goes when another is opened.
  document.querySelector("#n-new").click();
  await wait(400);
  document.querySelector(".n-item:not(.active)").click();
  await wait(400);
  out.notesAfter = (await c("Notes.List")).notes.map((n) => JSON.stringify(n.body.slice(0, 10)) + (n.pinned ? "📌" : ""));

  // Clean up what the test added.
  const d = await c("Notes.List");
  for (const t of d.todos) if (t.text.startsWith("测试") && !before.todos.some((b) => b.id === t.id)) await c("Notes.DeleteTodo", t.id);
  for (const n of d.notes) if (!before.notes.some((b) => b.id === n.id)) await c("Notes.DeleteNote", n.id);
  document.querySelector('.n-tabs button[data-view="todos"]').click();
  return JSON.stringify(out, null, 1);
})()
