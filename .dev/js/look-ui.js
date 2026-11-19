// 设置 → 外观：风格、强调色、恢复默认（背景图片要选文件，另外测）
(async () => { try {
  const out = {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const s0 = await mygo.call("Settings.Get");
  out.initial = { theme: s0.theme, appearance: s0.appearance };
  document.querySelector('.nav-item[data-id="settings"]').click();
  await wait(300);
  out.styles = [...document.querySelectorAll(".s-styles button")].map((b) => b.textContent.trim());
  document.querySelector('.s-styles button[data-style="warm"]').click();
  await wait(500);
  document.querySelector('.s-accents button[data-accent="#8b5cf6"]').click();
  await wait(600);
  const cs = getComputedStyle(document.documentElement);
  out.after = {
    saved: (await mygo.call("Settings.Get")).appearance,
    bg: getComputedStyle(document.body).backgroundColor,
    accent: cs.getPropertyValue("--accent"),
    on: [...document.querySelectorAll(".s-styles .on, .s-accents .on")].map((b) => b.dataset.style || b.dataset.accent),
    bgRowsHidden: [...document.querySelectorAll(".s-bg-row")].every((r) => r.hidden),
  };
  return JSON.stringify(out);
} catch (e) { return "ERR " + e.stack; } })()
