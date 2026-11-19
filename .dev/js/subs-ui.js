// A todo's steps, which make one whole with it: they show under it, tick
// and delete like todos, the last one ticked ticks the todo off (with
// 撤销), ticking the todo off ticks them all, and a repeating todo's steps
// start over. ＋子项 adds the first one. Deletes its todos afterwards.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const t = await mygo.call("Notes.SaveTodo", { id: "", text: "子项测试", subs: [{ id: "", text: "第一步" }, { id: "", text: "  " }, { id: "", text: "第二步" }], created: 0 });
  out.saved = t.subs.length === 2 && t.subs.every((s) => s.id);
  document.querySelector('.nav-item[data-id="notes"]').click();
  await wait(300);
  document.querySelector('.n-tabs [data-view="todos"]')?.click();
  await wait(300);
  const row = () => document.querySelector(`.n-todo[data-id="${t.id}"]`);
  out.shownAtOnce = row().querySelectorAll(".n-sub").length;
  const tick = async (sel) => {
    const el = row().querySelector(sel);
    el.checked = true;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(500);
  };
  await tick(`[data-sub="${t.subs[0].id}"] input`);
  out.ticked = row().querySelector(".n-subs-n").textContent.trim();
  row().querySelector(".n-sub-more").click();
  await wait(100);
  const input = row().querySelector(".n-sub-new");
  input.value = "第三步";
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await wait(400);
  out.added = row().querySelector(".n-subs-n").textContent.trim();
  out.keepsFocus = document.activeElement === row().querySelector(".n-sub-new");
  row().querySelector(".n-sub-new").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(100);
  out.escCloses = !row().querySelector(".n-sub-new");
  // Deleting a step.
  const third = row().querySelectorAll(".n-sub")[2];
  third.querySelector(".n-sub-del").click();
  await wait(400);
  out.deleted = row().querySelectorAll(".n-sub").length;
  // The last step ticks the todo off; 撤销 brings it back.
  await tick(".n-sub input:not(:checked)");
  let d = await mygo.call("Notes.List");
  out.autoDone = d.todos.find((x) => x.id === t.id).done;
  out.toast = document.querySelector(".l-toast")?.textContent;
  document.querySelector(".l-toast button").click();
  await wait(400);
  d = await mygo.call("Notes.List");
  const back = d.todos.find((x) => x.id === t.id);
  out.undone = !back.done && back.subs.filter((s) => s.done).length === 1;
  // Ticking the todo ticks its steps.
  await tick("input");
  await wait(300);
  d = await mygo.call("Notes.List");
  out.wholeDone = d.todos.find((x) => x.id === t.id).subs.every((s) => s.done);
  await mygo.call("Notes.DeleteTodo", t.id);
  // ＋子项 on a todo without steps opens the box.
  const e = await mygo.call("Notes.SaveTodo", { id: "", text: "空子项测试", created: 0 });
  await wait(300);
  document.querySelector(`.n-todo[data-id="${e.id}"] .n-sub-open`).click();
  await wait(100);
  out.plusOpens = document.activeElement === document.querySelector(`.n-todo[data-id="${e.id}"] .n-sub-new`);
  await mygo.call("Notes.DeleteTodo", e.id);
  // A repeating one, done, starts its steps over for the next time.
  const r = await mygo.call("Notes.SaveTodo", { id: "", text: "重复子项测试", due: "2026-11-20", repeat: "day", subs: [{ id: "", text: "a", done: true }], created: 0 });
  const r2 = await mygo.call("Notes.SaveTodo", { ...r, done: true });
  out.repeatReset = !r2.done && r2.subs.every((s) => !s.done) && r2.due === "2026-11-21";
  await mygo.call("Notes.DeleteTodo", r.id);
  return out;
})();
