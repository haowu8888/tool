// AI writing that fails at once, as with an address that is none: the
// panel must show the error every time, never stay at "AI 正在写…". The
// request ends before its ID is back at the page. Sets a bad address for
// the test and puts the settings back; removes its note.
//   node .dev/cdp.mjs @.dev/js/ai-fail.js
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const s = await mygo.call("Settings.Get");
  const tool = document.querySelector(".nav-item.active")?.dataset.id;
  const view = localStorage.getItem("notes-view");
  const out = { runs: [] };
  try {
    await mygo.call("Settings.Save", { ...s, ai: { ...s.ai, baseUrl: "not-a-url", model: s.ai.model || "x" } });
    document.querySelector('.nav-item[data-id="notes"]').click();
    await wait(300);
    document.querySelector('.n-tabs button[data-view="notes"]').click();
    await wait(200);
    document.querySelector("#n-new").click();
    await wait(600);
    const ed = document.querySelector(".n-doc .ProseMirror").editor;
    ed.commands.focus();
    ed.commands.insertContent("测试笔记：AI 失败");
    ed.commands.selectAll();
    await wait(200);
    const bar = document.querySelector(".e-toolbar");
    if (bar.hidden) return { error: "the toolbar did not show" };
    bar.querySelector('[data-cmd="ai"]').click();
    await wait(200);
    document.querySelector('.e-ai-menu [data-a="polish"]').click();
    for (let i = 0; i < 8; i++) {
      await wait(600);
      const p = document.querySelector(".e-ai");
      const err = p.querySelector(".l-error");
      out.runs.push((err.hidden ? "no error" : err.textContent) + " [" + [...p.querySelectorAll(".e-ai-buttons button")].map((b) => b.textContent).join("/") + "]");
      p.querySelector('[data-k="retry"]')?.click();
    }
    document.querySelector(".e-ai-x")?.click();
  } finally {
    await mygo.call("Settings.Save", s);
    await wait(700);
    for (const n of (await mygo.call("Notes.List")).notes) if (n.body.includes("测试笔记：AI 失败")) await mygo.call("Notes.DeleteNote", n.id);
    if (view) document.querySelector(`.n-tabs button[data-view="${view}"]`)?.click();
    if (tool) document.querySelector(`.nav-item[data-id="${tool}"]`)?.click();
  }
  out.restored = (await mygo.call("Settings.Get")).ai.baseUrl === s.ai.baseUrl;
  return out;
})()
