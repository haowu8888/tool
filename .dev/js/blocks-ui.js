// Tests the editor's blocks: an image saved as a note file, a table and its
// toolbar, math, columns, an embed, the smart blocks and encryption. Leaves
// the test note; editor-clean.js removes it.
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
  ed.commands.insertContent("测试笔记：各种块");
  // A 2×2 red PNG, as a pasted screenshot would be saved.
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";
  const f = await mygo.call("Notes.SaveFile", "截图.png", png);
  out.file = f.url + " " + f.kind;
  ed.chain().focus("end").insertContent([
    { type: "image", attrs: { src: f.url } },
    { type: "attachment", attrs: { url: f.url, name: "报价单.png", size: f.size } },
  ]).run();
  ed.chain().focus("end").insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  await wait(200);
  out.tableBar = !document.querySelector(".e-table-bar").hidden;
  ed.chain().addColumnAfter().run();
  out.tableCols = pm.querySelector("table tr").children.length;
  ed.chain().focus("end").insertContent([
    { type: "math", attrs: { source: "E = mc^2" } },
    { type: "paragraph", content: [{ type: "text", text: "行内公式 " }, { type: "inlineMath", attrs: { source: "a^2+b^2=c^2" } }] },
    { type: "columns", content: [{ type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "左栏" }] }] }, { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "右栏" }] }] }] },
    { type: "embed", attrs: { url: "https://www.bilibili.com/video/BV1GJ411x7h7", src: "https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7&autoplay=0", height: 360 } },
    { type: "pageBreak" },
    { type: "smartBlock", attrs: { kind: "kanban" } },
    { type: "smartBlock", attrs: { kind: "calendar" } },
    { type: "smartBlock", attrs: { kind: "poll" } },
    { type: "smartBlock", attrs: { kind: "checkin" } },
    { type: "smartBlock", attrs: { kind: "encrypted" } },
    { type: "gallery", attrs: { images: JSON.stringify([f.url, f.url]) } },
  ]).run();
  await wait(2500);
  const img = pm.querySelector(".e-image img");
  out.imageLoaded = img.complete && img.naturalWidth;
  out.math = !!pm.querySelector(".e-math .katex-display");
  out.inlineMath = !!pm.querySelector(".e-inline-math .katex");
  out.columns = pm.querySelectorAll(".e-columns .e-column").length;
  out.embed = pm.querySelector(".e-embed iframe")?.src.slice(0, 40);
  out.smart = [...pm.querySelectorAll(".e-smart .e-block-head")].map((e) => e.textContent.replace("✕", "").trim());
  // Kanban: add a card to the first list.
  const add = pm.querySelector(".k-add");
  add.value = "写周报";
  add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await wait(200);
  out.kanbanCard = pm.querySelector(".k-card .k-text")?.textContent;
  // Poll: vote.
  pm.querySelector(".p-option").click();
  await wait(200);
  out.poll = pm.querySelector(".p-option .p-count")?.textContent;
  // Check-in today.
  pm.querySelector(".ck-btn").click();
  await wait(200);
  out.checkin = pm.querySelector(".ck-btn")?.textContent;
  // Encrypt, then unlock with the password.
  const x = pm.querySelector(".e-smart-encrypted");
  x.querySelector(".x-text").value = "银行卡密码 123456";
  x.querySelector(".x-text").dispatchEvent(new Event("input"));
  x.querySelector(".x-pw").value = "pw";
  x.querySelector(".x-pw2").value = "pw";
  x.querySelector("[data-act=seal]").click();
  await wait(1500);
  const x2 = pm.querySelector(".e-smart-encrypted");
  out.sealed = !!x2.querySelector(".x-locked") && !pm.innerHTML.includes("123456");
  x2.querySelector(".x-pw").value = "pw";
  x2.querySelector("[data-act=open]").click();
  await wait(1500);
  out.unlocked = pm.querySelector(".e-smart-encrypted .x-text")?.value;
  await wait(800);
  const types = []; ed.state.doc.forEach((n) => types.push(n.type.name + (n.attrs.kind ? ":" + n.attrs.kind : "")));
  out.top = types;
  await wait(800);
  const note = (await mygo.call("Notes.List")).notes.find((n) => n.body.includes("测试笔记：各种块"));
  out.savedLength = note?.body.length;
  out.savedHasBlocks = ["data-image", "data-attachment", "<table", "data-math", "data-columns", "data-embed", "data-smart", "data-gallery"].filter((k) => !note?.body.includes(k));
  return JSON.stringify(out, null, 1);
})()
