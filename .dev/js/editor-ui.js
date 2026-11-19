// Tests the notes' editor: Markdown shortcuts, the "/" menu, the toolbar
// over a selection, the AI panel and saving as HTML. Leaves the test note
// for a screenshot; editor-clean.js removes it.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  document.querySelector('.nav-item[data-id="notes"]').click();
  await wait(300);
  document.querySelector('.n-tabs button[data-view="notes"]').click();
  await wait(200);
  document.querySelector("#n-new").click();
  await wait(600);
  const pm = document.querySelector(".n-doc .ProseMirror");
  const ed = pm.editor;
  out.placeholder = pm.querySelector(".is-empty")?.dataset.placeholder;
  // Typing: the title, then Markdown shortcuts as one types them.
  ed.commands.focus();
  ed.commands.insertContent("测试笔记：编辑器");
  ed.commands.enter();
  for (const ch of "## 小节标题") ed.commands.insertContent(ch);
  ed.commands.enter();
  for (const ch of "[ ] 待办一") ed.commands.insertContent(ch);
  ed.commands.enter();
  ed.commands.enter();
  ed.commands.insertContent("这是一段正文，用来测试选中文字后的工具栏。");
  await wait(100);
  out.blocks = [...pm.children].map((e) => e.tagName + (e.dataset.type ? ":" + e.dataset.type : ""));
  // The "/" menu, filtered.
  ed.commands.enter();
  ed.commands.insertContent("/");
  await wait(300);
  out.slashAll = document.querySelectorAll(".e-slash .e-item").length;
  out.slashFirst = [...document.querySelectorAll(".e-slash .e-item .e-title")].slice(0, 3).map((e) => e.textContent);
  ed.commands.insertContent("jg");
  await wait(200);
  out.slashJg = [...document.querySelectorAll(".e-slash .e-item .e-title")].map((e) => e.textContent);
  pm.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await wait(200);
  out.callout = !!pm.querySelector('.e-callout[data-callout="warning"]');
  ed.commands.insertContent("警告内容");
  // The toolbar over a selection.
  const para = [...pm.querySelectorAll("p")].find((p) => p.textContent.startsWith("这是一段正文"));
  const pos = ed.view.posAtDOM(para, 0);
  ed.commands.setTextSelection({ from: pos, to: pos + 6 });
  ed.commands.focus();
  document.dispatchEvent(new PointerEvent("pointerup"));
  await wait(200);
  const bar = document.querySelector(".e-toolbar");
  out.toolbar = !bar.hidden && bar.querySelectorAll("button").length;
  bar.querySelector('[data-cmd="bold"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await wait(100);
  out.bold = !!para.querySelector("strong") || !!pm.querySelector("strong");
  bar.querySelector('[data-cmd="ai"]').click();
  await wait(200);
  out.aiMenu = [...document.querySelectorAll(".e-ai-menu .e-item")].map((e) => e.textContent);
  document.querySelector('.e-ai-menu [data-a="polish"]').click();
  await wait(1500);
  out.aiPanel = document.querySelector(".e-ai")?.innerText.replace(/\s+/g, " ").slice(0, 120);
  document.querySelector(".e-ai-x")?.click();
  await wait(800);
  const note = (await mygo.call("Notes.List")).notes.find((n) => n.body.includes("测试笔记"));
  out.saved = note?.body.slice(0, 300);
  out.list = document.querySelector(".n-item.active .n-title")?.textContent;
  return JSON.stringify(out, null, 1);
})()
