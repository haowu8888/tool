// Searches the apps of the computer by pinyin initials through the
// launcher's own matcher, as the picker's search box does.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.nav-item[data-id="launcher"]').click();
  await wait(200);
  document.querySelector("#l-installed").click();
  for (let i = 0; i < 50 && !document.querySelector("dialog[open] .l-item"); i++) await wait(200);
  const s = document.querySelector("dialog[open] .l-search");
  const out = {};
  for (const q of ["wx", "txqq", "bdwp", "wyyyy", "wyyyl", "jsq", "kzmb", "vsc", "360ys", "every", "zyglq"]) {
    s.value = q; s.dispatchEvent(new Event("input"));
    out[q] = [...document.querySelectorAll("dialog[open] .l-item .l-name")].slice(0, 4).map((n) => n.textContent).join(",");
  }
  document.querySelector("dialog[open]").close();
  // The main list: CCleaner64 by "ccl", Everything by its path.
  const m = document.querySelector(".panel .l-search");
  for (const q of ["ccl", "desktop"]) { m.value = q; m.dispatchEvent(new Event("input")); out["main:" + q] = [...document.querySelectorAll(".l-tile .l-name")].map((n) => n.textContent).join(","); }
  m.value = ""; m.dispatchEvent(new Event("input"));
  return out;
})()
