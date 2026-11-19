// 合并文档: three pasted pictures, reordered by dragging, one turned and
// one removed and brought back; the options; then the export starts with
// the kind below (sed replaces KIND: pdf, pptx or image) and waits for
// its save dialog, which .dev/desktest.ps1 fills in (TestDeskSaveDialog).
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const q = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  document.querySelector('.nav-item[data-id="image"]').click();
  await wait(200);
  q('.iv-tabs [data-view="merge"]').click();
  await wait(300);
  if (q('.mg-top [data-act="clear"]:not(:disabled)')) {
    q('.mg-top [data-act="clear"]').click();
    await wait(100);
  }
  const paste = async (color, w, h, label) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#fff";
    g.font = `${Math.round(h / 4)}px sans-serif`;
    g.fillText(label, w * 0.1, h * 0.6);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "p.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    await wait(300);
  };
  await paste("#d33", 800, 600, "1 红");
  await paste("#3a3", 600, 900, "2 绿");
  await paste("#33d", 1200, 500, "3 蓝");
  const names = () => all(".mg-card").map((c) => c.querySelector("img").src.length > 0 && c.dataset.id);
  out.count = all(".mg-card").length;
  out.go = q(".mg-go").textContent;
  // Drag the third card before the first.
  const cards = all(".mg-card");
  const ids = cards.map((c) => c.dataset.id);
  const dt = new DataTransfer();
  const r0 = cards[0].getBoundingClientRect();
  cards[2].dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
  cards[0].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r0.left + 5, clientY: r0.top + 20 }));
  cards[0].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r0.left + 5, clientY: r0.top + 20 }));
  cards[2].dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  await wait(100);
  out.order = all(".mg-card").map((c) => ids.indexOf(c.dataset.id) + 1).join(","); // 3,1,2
  // Turn the (now) second card, the red one.
  all(".mg-card")[1].querySelector('[data-do="rot"]').click();
  await wait(50);
  out.rotated = all(".mg-card")[1].querySelector("img").style.transform;
  // Remove the last and bring it back.
  all(".mg-card")[2].querySelector('[data-do="del"]').click();
  await wait(50);
  out.afterDel = all(".mg-card").length;
  q(".l-toast button")?.click();
  await wait(50);
  out.afterUndo = all(".mg-card").length;
  // WebP is only for the long picture.
  q('[data-o="kind"] [data-v="pdf"]').click();
  await wait(30);
  out.webpForPdf = q('[data-o="format"] [data-v="webp"]').disabled;
  q('[data-o="kind"] [data-v="image"]').click();
  await wait(30);
  out.webpForImage = q('[data-o="format"] [data-v="webp"]').disabled;
  out.pageHidden = q(".mg-docopts").hidden;
  // The export to test.
  q('[data-o="kind"] [data-v="KIND"]').click();
  q('[data-o="margin"] [data-v="1"]').click();
  q(`[data-o="format"] [data-v="${"KIND" === "image" ? "webp" : "jpeg"}"]`).click();
  if ("KIND" !== "image") q('[data-o="page"] [data-v="a4"]').click();
  await wait(30);
  q(".mg-go").click();
  await wait(200);
  out.started = q(".mg-go").textContent;
  return out;
})()
