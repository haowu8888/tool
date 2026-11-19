// Adds Everything and CCleaner through the picker, notepad through the
// edit dialog, then reports what the panel shows.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, n = 60) => { for (let i = 0; i < n; i++) { const v = f(); if (v) return v; await wait(200); } throw new Error("timeout: " + f); };
  document.querySelector('.nav-item[data-id="launcher"]').click();
  await wait(300);
  document.querySelector("#l-installed").click();
  const dlg = await until(() => document.querySelector("dialog[open]"));
  await until(() => dlg.querySelector(".l-item"));
  const total = dlg.querySelectorAll(".l-item").length;
  const sel = dlg.querySelector("select");
  sel.value = [...sel.options].find((o) => o.text === "系统工具").value;
  for (const q of ["everything", "ccleaner64"]) {
    const s = dlg.querySelector(".l-search"); s.value = q; s.dispatchEvent(new Event("input"));
    await wait(100);
    const box = dlg.querySelector(".l-item input:not(:disabled)"); box.click();
  }
  const addLabel = dlg.querySelector("#l-add-picked").textContent;
  dlg.querySelector("#l-add-picked").click();
  await until(() => !document.querySelector("dialog[open]"));
  await wait(400);
  document.querySelector("#l-add").click();
  const ed = await until(() => document.querySelector("dialog[open] form"));
  ed.elements.path.value = "C:\\Windows\\System32\\notepad.exe"; ed.elements.path.dispatchEvent(new Event("change"));
  const autoName = ed.elements.name.value;
  ed.querySelector('button[type="submit"]').click();
  await until(() => !document.querySelector("dialog[open]"));
  await wait(1500);
  return {
    total, addLabel, autoName,
    chips: [...document.querySelectorAll(".l-chip")].map((e) => e.textContent),
    sections: [...document.querySelectorAll(".l-body section")].map((s) => s.querySelector("h2").textContent + ": " + [...s.querySelectorAll(".l-tile .l-name")].map((n) => n.textContent).join(",")),
    icons: [...document.querySelectorAll(".l-tile")].map((t) => t.querySelector("img") ? "img" : "fallback"),
  };
})()
