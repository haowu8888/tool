(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  [...document.querySelectorAll(".nav button, .nav a, nav *")].find((b) => b.textContent.trim() === "开发工具")?.click();
  for (let i = 0; i < 40 && !document.querySelector('.dv-tabs button[data-tab="gold"]'); i++) await wait(100);
  document.querySelector('.dv-tabs button[data-tab="gold"]').click();
  for (let i = 0; i < 80 && !document.querySelector(".dv-g-chart svg, .dv-g-chart .dv-bad"); i++) await wait(100);
  const cards = [...document.querySelectorAll(".dv-g-card")].map((c) => c.innerText.replace(/\s+/g, " "));
  const out = { at: document.querySelector(".dv-g-at")?.textContent, fx: document.querySelector(".dv-g-fx")?.textContent, cards, range: document.querySelector(".dv-g-range")?.textContent, chart: document.querySelector(".dv-g-chart").innerText.slice(0, 200), pts: document.querySelector(".dv-g-line")?.getAttribute("points").split(" ").length };
  document.querySelector('[data-span="year"]').click();
  await wait(2500);
  out.year = [document.querySelector(".dv-g-range")?.textContent, document.querySelector(".dv-g-line")?.getAttribute("points").split(" ").length];
  document.querySelector('[data-unit="usd"]').click();
  out.yearUsd = document.querySelector(".dv-g-range")?.textContent;
  document.querySelector('[data-unit="cny"]').click();
  document.querySelector('[data-span="day"]').click();
  await wait(2000);
  return JSON.stringify(out, null, 1);
})()
