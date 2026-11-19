(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const c = (m, ...a) => mygo.call(m, ...a);
  const out = {};
  try {
  const tile = (name) => [...document.querySelectorAll(".l-tile")].find((t) => t.querySelector(".l-name").textContent === name);
  // Search and Enter launches notepad.
  const s = document.querySelector(".panel .l-search");
  s.value = "note"; s.dispatchEvent(new Event("input"));
  await wait(100);
  out.results = [...document.querySelectorAll(".l-tile.selected .l-name")].map((n) => n.textContent);
  s.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await wait(1500);
  out.toast = document.querySelector(".l-toast")?.textContent;
  s.value = ""; s.dispatchEvent(new Event("input"));
  // Drag Everything in front of notepad, into 常用.
  let d = await c("Launcher.List");
  const id = (n) => d.apps.find((a) => a.name === n).id;
  const cat = (n) => d.categories.find((x) => x.name === n).id;
  const dt = new DataTransfer();
  tile("Everything").dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
  tile("notepad").dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
  tile("notepad").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  tile("Everything")?.dispatchEvent(new DragEvent("dragend", { dataTransfer: dt, bubbles: true }));
  await wait(500);
  out.afterDrag = [...document.querySelectorAll(".l-body section")].map((s) => s.querySelector("h2").textContent + ": " + [...s.querySelectorAll(".l-name")].map((n) => n.textContent).join(","));
  // Categories: add, rename, move up, delete with an app in it.
  const t = await c("Launcher.AddCategory", "测试分类");
  await c("Launcher.RenameCategory", t.id, "测试分类2");
  await c("Launcher.MoveCategory", t.id, 0);
  await c("Launcher.MoveApp", id("notepad"), t.id, "");
  await wait(300);
  out.withTest = [...document.querySelectorAll(".l-chip")].map((e) => e.textContent);
  await c("Launcher.DeleteCategory", t.id);
  d = await c("Launcher.List");
  out.notepadCategory = d.apps.find((a) => a.name === "notepad").category === undefined ? "未分类" : "?";
  await wait(300);
  out.afterDelete = [...document.querySelectorAll(".l-chip")].map((e) => e.textContent);
  out.launches = d.apps.find((a) => a.name === "notepad").launches;
  // Context menu, then delete notepad through it.
  tile("notepad").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
  out.menu = [...document.querySelectorAll(".l-menu button")].map((b) => b.textContent);
  [...document.querySelectorAll(".l-menu button")].find((b) => b.textContent === "删除").click();
  await wait(500);
  out.final = [...document.querySelectorAll(".l-body section")].map((s) => s.querySelector("h2").textContent + ": " + [...s.querySelectorAll(".l-name")].map((n) => n.textContent).join(","));
  } catch (e) { out.error = e.stack; }
  return out;
})()
