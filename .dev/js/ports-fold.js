// 端口占用: the list scrolls in its own box, and folds.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.nav-item[data-id="monitor"]').click();
  await wait(2500);
  const g = document.querySelector(".m-ports-g");
  const box = g.querySelector(".m-ports");
  if (g.classList.contains("folded")) g.querySelector(".m-port-fold").click(), await wait(800);
  const out = { rows: box.querySelectorAll(".m-port").length, h: box.clientHeight, scrollH: box.scrollHeight };
  box.scrollTop = 600;
  await wait(5600); // a refresh keeps the place
  out.kept = box.scrollTop;
  g.scrollIntoView();
  g.querySelector(".m-port-fold").click();
  await wait(200);
  out.folded = [g.classList.contains("folded"), box.offsetHeight, g.querySelector(".m-port-fold").textContent, g.querySelector(".m-ports-sum").textContent];
  out.saved = localStorage.getItem("ports-folded");
  return out;
})();
