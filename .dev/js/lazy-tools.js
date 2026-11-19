// The tools toolbox.ts loads on first show (lazyTool): none of their code
// before, each shows once picked, and leaving one while it loads keeps its
// page out of the next tool's panel. It goes back to the tool it found.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const loaded = (name) => performance.getEntriesByType("resource").some((e) => new RegExp(`/assets/${name}-[^/]+\\.js$`).test(e.name));
  const nav = (id) => document.querySelector(`.nav-item[data-id="${id}"]`);
  const panel = () => document.querySelector(".panel");
  const was = document.querySelector(".nav-item.active")?.dataset.id;
  const out = { atStart: { board: loaded("board"), imageedit: loaded("imageedit"), devtools: loaded("devtools") } };

  // Leaving 开发工具 before its code comes: 快捷启动 shows alone.
  nav("dev").click();
  nav("launcher").click();
  await sleep(1500);
  out.leftWhileLoading = { devPage: !!panel().querySelector(".dv-tabs"), launcher: !!panel().querySelector(".l-search, .launcher, input") };

  const shows = {};
  for (const [id, sel] of [["board", ".bd-wrap"], ["image", ".iv"], ["dev", ".dv-tabs"]]) {
    nav(id).click();
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      await sleep(100);
      ok = !!panel().querySelector(sel);
    }
    shows[id] = ok;
  }
  out.shows = shows;
  // Back and forth once more: still one page, no doubles.
  nav("board").click();
  await sleep(300);
  out.boardOnce = panel().querySelectorAll(".bd-wrap").length;
  if (was) nav(was).click();
  return JSON.stringify(out);
})();
