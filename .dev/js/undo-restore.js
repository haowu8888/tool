// The undoing of deletes puts things back as they were: a todo with its
// ID, steps and place; a launcher entry with its ID in front of the one
// that followed it. And the clipboard's settings (days, programs left
// out) save and come back cleaned up. Everything is put back afterwards.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  document.querySelector('.nav-item[data-id="notes"]').click();
  await wait(300);
  document.querySelector('.n-tabs button[data-view="todos"]').click();
  await wait(200);
  const t = await mygo.call("Notes.SaveTodo", { id: "", text: "测试-撤销删除", subs: [{ id: "", text: "子项", done: true }] });
  await mygo.call("Notes.SaveTodo", { id: "", text: "测试-在它前面" });
  await wait(300);
  const index = async () => (await mygo.call("Notes.List")).todos.findIndex((o) => o.id === t.id);
  const at = await index();
  document.querySelector(`.n-todo[data-id="${t.id}"] .n-del`).click();
  await wait(400);
  out.deleted = (await index()) < 0;
  document.querySelector(".l-toast button").click();
  await wait(400);
  const back = (await mygo.call("Notes.List")).todos.find((o) => o.id === t.id);
  out.todoBack = [!!back, (await index()) === at, back?.subs?.[0]?.done, back?.created === t.created];
  for (const o of (await mygo.call("Notes.List")).todos.filter((o) => o.text.startsWith("测试-"))) await mygo.call("Notes.DeleteTodo", o.id);

  // The launcher: its first entry deleted and restored through the API the menu uses.
  let d = await mygo.call("Launcher.List");
  if (d.apps.length >= 2) {
    const app = d.apps[0], next = d.apps[1].id;
    await mygo.call("Launcher.DeleteApp", app.id);
    out.appGone = !(await mygo.call("Launcher.List")).apps.some((a) => a.id === app.id);
    await mygo.call("Launcher.RestoreApp", app, next);
    d = await mygo.call("Launcher.List");
    out.appBack = [d.apps[0].id === app.id, d.apps[0].launches === app.launches, d.apps[0].category === app.category, d.apps[1].id === next];
  }

  // The clipboard's settings.
  document.querySelector('.nav-item[data-id="clips"]').click();
  await wait(400);
  const days = document.querySelector(".cl-days"), exclude = document.querySelector(".cl-exclude");
  const was = [days.value, exclude.value];
  days.value = "30";
  days.dispatchEvent(new Event("change"));
  exclude.value = "KeePass.exe，windowsterminal;  keepass";
  exclude.dispatchEvent(new Event("change"));
  await wait(600);
  const s = (await mygo.call("Settings.Get")).clipboard;
  out.clipSettings = [s.days, s.exclude, exclude.value];
  days.value = was[0];
  days.dispatchEvent(new Event("change"));
  exclude.value = was[1];
  exclude.dispatchEvent(new Event("change"));
  await wait(600);
  const s2 = (await mygo.call("Settings.Get")).clipboard;
  out.clipRestored = [s2.days, s2.exclude];
  document.querySelector('.nav-item[data-id="notes"]').click();
  return out;
})();
