// 去水印 and 打码 on a picture of FILE (sed) with a made-up watermark:
// the text "@AI 作品 · 水印" at the bottom right and a logo over the hair,
// each boxed and removed; then a box of mosaic and a stroke of blur. It
// returns the regions before and after as data URLs, and the times.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => document.querySelector(s);
  const out = {};
  const errs = [];
  addEventListener("error", (e) => errs.push(e.message));
  document.querySelector('.nav-item[data-id="image"]').click();
  await wait(200);
  q('.iv-tabs [data-view="edit"]').click();
  await wait(200);
  if (q(".ie-view")) {
    q('[data-act="close"]').click();
    await wait(150);
    q("dialog[open] [data-ok]")?.click();
    await wait(100);
  }
  const f = await mygo.call("ImageEdit.OpenPath", "FILE");
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = f.url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  // The watermarks.
  const W = c.width;
  const H = c.height;
  g.font = `bold ${Math.round(W * 0.045)}px "Microsoft YaHei"`;
  g.fillStyle = "rgba(255, 255, 255, 0.85)";
  g.strokeStyle = "rgba(0, 0, 0, 0.35)";
  g.lineWidth = 2;
  const text = "@AI 作品 · 水印";
  const tw = g.measureText(text).width;
  const t = { x: W - tw - W * 0.04, y: H - W * 0.05 };
  g.strokeText(text, t.x, t.y);
  g.fillText(text, t.x, t.y);
  g.fillStyle = "rgba(255, 255, 255, 0.7)";
  g.beginPath();
  g.arc(W * 0.3, H * 0.12, W * 0.04, 0, Math.PI * 2);
  g.fill();
  g.font = `bold ${Math.round(W * 0.03)}px sans-serif`;
  g.fillStyle = "rgba(80, 40, 120, 0.8)";
  g.fillText("LOGO", W * 0.3 - W * 0.035, H * 0.12 + W * 0.01);
  const boxes = [
    { x: t.x - 8, y: t.y - W * 0.045, w: tw + 16, h: W * 0.06 },
    { x: W * 0.3 - W * 0.045, y: H * 0.12 - W * 0.045, w: W * 0.09, h: W * 0.09 },
  ];
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "wm.png", { type: "image/png" }));
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  await wait(600);
  const view = () => q(".ie-view");
  // A region of the picture, larger than the box, as a data URL.
  const grab = (r) => {
    const m = r.w * 0.4;
    const x = Math.max(0, r.x - m);
    const y = Math.max(0, r.y - m);
    const w = Math.min(view().width - x, r.w + 2 * m);
    const h = Math.min(view().height - y, r.h + 2 * m);
    const k = document.createElement("canvas");
    k.width = w;
    k.height = h;
    k.getContext("2d").drawImage(view(), x, y, w, h, 0, 0, w, h);
    return k.toDataURL("image/png");
  };
  out.before = boxes.map(grab);
  q('[data-mode="watermark"]').click();
  await wait(150);
  q('[data-wmtool="box"]').click();
  await wait(50);
  const stage = q(".ie-stage");
  const vr = () => view().getBoundingClientRect();
  const at = (x, y) => ({ clientX: vr().left + (x / view().width) * vr().width, clientY: vr().top + (y / view().height) * vr().height, bubbles: true, pointerId: 1, button: 0, buttons: 1 });
  out.ms = [];
  for (const r of boxes) {
    stage.dispatchEvent(new PointerEvent("pointerdown", at(r.x, r.y)));
    stage.dispatchEvent(new PointerEvent("pointermove", at(r.x + r.w / 2, r.y + r.h / 2)));
    stage.dispatchEvent(new PointerEvent("pointermove", at(r.x + r.w, r.y + r.h)));
    stage.dispatchEvent(new PointerEvent("pointerup", { ...at(r.x + r.w, r.y + r.h), buttons: 0 }));
    await wait(80);
    const t0 = performance.now();
    q('[data-do="wm-go"]').click();
    for (let i = 0; i < 300 && (q('[data-do="wm-go"]').textContent !== "去除" || !q(".ie-name b").textContent.startsWith("•")); i++) await wait(50);
    await wait(100);
    out.ms.push(Math.round(performance.now() - t0));
  }
  out.after = boxes.map(grab);
  // 打码: a box of mosaic, a stroke of blur.
  q('[data-mode="censor"]').click();
  await wait(150);
  q('[data-cs="style"] [data-v="mosaic"]').click();
  q('[data-cs="shape"] [data-v="box"]').click();
  const face = { x: W * 0.38, y: H * 0.16, w: W * 0.22, h: W * 0.2 };
  stage.dispatchEvent(new PointerEvent("pointerdown", at(face.x, face.y)));
  stage.dispatchEvent(new PointerEvent("pointermove", at(face.x + face.w, face.y + face.h)));
  stage.dispatchEvent(new PointerEvent("pointerup", { ...at(face.x + face.w, face.y + face.h), buttons: 0 }));
  await wait(150);
  q('[data-cs="style"] [data-v="blur"]').click();
  q('[data-cs="shape"] [data-v="brush"]').click();
  q('[data-cssize="2"]').click();
  await wait(50);
  stage.dispatchEvent(new PointerEvent("pointerdown", at(W * 0.15, H * 0.7)));
  for (let i = 1; i <= 10; i++) stage.dispatchEvent(new PointerEvent("pointermove", at(W * (0.15 + i * 0.05), H * 0.7)));
  stage.dispatchEvent(new PointerEvent("pointerup", { ...at(W * 0.65, H * 0.7), buttons: 0 }));
  await wait(150);
  out.censor = grab({ x: W * 0.1, y: H * 0.14, w: W * 0.6, h: H * 0.6 });
  out.errs = errs;
  return out;
})()
