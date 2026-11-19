// 图片编辑: a pasted picture opens; crop 1:1, turn, 黑白, warm (the SVG
// filter on the canvas), sharpen, a drawn rectangle, a frame, half the
// size, the save dialog's size, copy, undo back to the start, and a file
// served by the imgedit scheme read back from a canvas.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const errs = [];
  addEventListener("error", (e) => errs.push(e.message));
  document.querySelector('.nav-item[data-id="image"]').click();
  await wait(300);
  // A 400×300 picture: red left half, blue right half, a gray band.
  const c = document.createElement("canvas");
  c.width = 400;
  c.height = 300;
  const g = c.getContext("2d");
  g.fillStyle = "#c83232";
  g.fillRect(0, 0, 200, 300);
  g.fillStyle = "#3250c8";
  g.fillRect(200, 0, 200, 300);
  g.fillStyle = "#808080";
  g.fillRect(0, 140, 400, 20);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "t.png", { type: "image/png" }));
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  await wait(400);
  const view = () => document.querySelector(".ie-view");
  const dims = () => `${view().width}x${view().height}`;
  const px = (x, y) => [...view().getContext("2d").getImageData(x, y, 1, 1).data];
  const click = async (sel, ms = 150) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error("no " + sel);
    el.click();
    await wait(ms);
  };
  const slide = async (sel, v) => {
    const el = document.querySelector(sel);
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(100);
  };
  out.opened = dims();
  out.name = document.querySelector(".ie-name b")?.textContent;
  out.emptyHidden = document.querySelector(".ie-empty").hidden;

  await click('[data-mode="crop"]');
  await click('[data-ratio="1"]');
  out.cropBox = document.querySelector(".ie-crop-size").textContent;
  await click('[data-do="crop"]');
  out.cropped = dims(); // 300x300 from the middle
  out.cropPx = [px(10, 10), px(290, 10)];
  await click('[data-do="rot-r"]');
  out.turned = dims();
  out.turnedPx = px(10, 10); // red's left top went to the right top: blue here

  await click('[data-mode="adjust"]');
  out.presets = document.querySelectorAll(".ie-presets img[src^='data:']").length;
  await click('[data-preset="2"]'); // 黑白
  out.cssFilter = view().style.filter;
  await click('[data-do="adj-apply"]');
  const bw = px(10, 10);
  out.gray = bw[0] === bw[1] && bw[1] === bw[2];
  await click("[data-act=undo]");
  await slide('[data-adj="temp"]', 100);
  out.tempFilter = view().style.filter;
  await click('[data-do="adj-apply"]');
  out.warm = [px(10, 150), "was", "~128 gray"];
  await slide('[data-adj="sharpen"]', 100);
  await click('[data-do="adj-apply"]');
  out.sharpened = px(150, 150);

  await click('[data-mode="mark"]');
  await click('[data-mark="rect"]');
  await click('[data-color="#52c41a"]');
  const stage = document.querySelector(".ie-stage");
  const vr = view().getBoundingClientRect();
  const pt = (fx, fy) => ({ clientX: vr.left + vr.width * fx, clientY: vr.top + vr.height * fy, bubbles: true, pointerId: 1, button: 0, buttons: 1 });
  stage.dispatchEvent(new PointerEvent("pointerdown", pt(0.2, 0.2)));
  stage.dispatchEvent(new PointerEvent("pointermove", pt(0.5, 0.5)));
  stage.dispatchEvent(new PointerEvent("pointermove", pt(0.8, 0.8)));
  stage.dispatchEvent(new PointerEvent("pointerup", pt(0.8, 0.8)));
  await wait(100);
  out.rectEdge = px(Math.round(view().width * 0.2), Math.round(view().height * 0.5)); // green line

  await click('[data-mode="frame"]');
  await click('[data-bg="#a1c4fd,#c2e9fb"]');
  await slide('[data-fr="radius"]', 6);
  await slide('[data-fr="shadow"]', 60);
  out.framePreview = dims();
  await click('[data-do="fr-apply"]');
  out.framed = dims();
  out.frameCorner = px(1, 1);

  await click('[data-mode="resize"]');
  await click('[data-pct="50"]');
  await click('[data-do="resize"]');
  out.half = dims();

  await click('[data-act="export"]', 900);
  out.exportSize = document.querySelector(".ie-ex-size")?.textContent;
  document.querySelector('.ie-ex-fmt [data-f="jpeg"]').click();
  await wait(900);
  out.exportJpg = document.querySelector(".ie-ex-size")?.textContent;
  out.overHidden = document.querySelector(".ie-ex-over").hidden;
  document.querySelector("dialog[open]").close();
  await wait(100);

  await click('[data-act="copy"]', 800);
  out.copyToast = document.querySelector(".l-toast")?.textContent;

  out.dirtyMark = document.querySelector(".ie-name b").textContent.startsWith("•");
  for (let i = 0; i < 20 && !document.querySelector("[data-act=undo]").disabled; i++) await click("[data-act=undo]", 60);
  out.undone = dims();
  await click("[data-act=redo]");
  out.redone = dims();

  // A file through the imgedit scheme, read back from a canvas.
  const f = await mygo.call("ImageEdit.OpenPath", "D:\\AI\\claude-docker\\workspace\\tool\\testdata\\ocr-en.png");
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = f.url;
  await img.decode();
  const k = document.createElement("canvas");
  k.width = img.naturalWidth;
  k.height = img.naturalHeight;
  k.getContext("2d").drawImage(img, 0, 0);
  out.file = [f.name, f.size, k.width, k.height, k.getContext("2d").getImageData(0, 0, 1, 1).data.length];
  try {
    await mygo.call("ImageEdit.Overwrite", "C:\\Windows\\win.ini", "aGk=", "png");
    out.overwriteGuard = "WROTE";
  } catch (e) {
    out.overwriteGuard = String(e.message || e);
  }
  out.errs = errs;
  return out;
})()
