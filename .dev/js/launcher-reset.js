(async () => {
  const c = (m, ...a) => mygo.call(m, ...a);
  let d = await c("Launcher.List");
  const sys = d.categories.find((x) => x.name === "系统工具").id;
  const common = d.categories.find((x) => x.name === "常用").id;
  const ev = d.apps.find((a) => a.name === "Everything");
  if (ev) await c("Launcher.MoveApp", ev.id, sys, "");
  for (const a of d.apps.filter((a) => a.name === "notepad")) await c("Launcher.DeleteApp", a.id);
  await c("Launcher.AddApps", [{ id: "", name: "notepad", path: "C:\\Windows\\System32\\notepad.exe", category: common }]);
  d = await c("Launcher.List");
  return d.apps.map((a) => a.name + "@" + (d.categories.find((x) => x.id === a.category)?.name ?? "未分类"));
})()
