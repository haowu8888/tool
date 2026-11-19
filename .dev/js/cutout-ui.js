// 去背景 on a picture of FILE (sed): the edges' white goes, the figure
// stays; a larger tolerance; erase and restore strokes; apply; undo. The
// pet is not changed here (see cutout-pet.js).
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
  const blob = await (await fetch(f.url)).blob();
  const dt = new DataTransfer();
  dt.items.add(new File([blob], f.name, { type: "image/png" }));
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  await wait(600);
  const t0 = performance.now();
  q('[data-mode="cutout"]').click();
  await wait(100);
  out.enterMs = Math.round(performance.now() - t0);
  const view = () => q(".ie-view");
  const alpha = (fx, fy) => view().getContext("2d").getImageData(Math.round(view().width * fx), Math.round(view().height * fy), 1, 1).data[3];
  const share = () => {
    const c = view();
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let t = 0;
    for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 20) t++;
    return Math.round((100 * t) / (d.length / 28));
  };
  out.dims = `${view().width}x${view().height}`;
  out.corner = alpha(0.01, 0.01);
  out.transparentPct = share();
  out.bg = q(".ie-cut-bg")?.style.background;
  const slide = async (v) => {
    const el = q('[data-cut="tol"]');
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(400);
  };
  await slide(60);
  out.tol60Pct = share();
  await slide(30);
  // Erase a stroke across the middle, then restore half of it.
  const stage = q(".ie-stage");
  const vr = () => view().getBoundingClientRect();
  const ev = (type, fx, fy) => stage.dispatchEvent(new PointerEvent(type, { clientX: vr().left + vr().width * fx, clientY: vr().top + vr().height * fy, bubbles: true, pointerId: 1, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
  const stroke = async (tool, a, b) => {
    q(`[data-cuttool="${tool}"]`).click();
    await wait(50);
    ev("pointerdown", ...a);
    for (let i = 1; i <= 10; i++) ev("pointermove", a[0] + ((b[0] - a[0]) * i) / 10, a[1] + ((b[1] - a[1]) * i) / 10);
    ev("pointerup", ...b);
    await wait(80);
  };
  out.centerBefore = alpha(0.5, 0.4);
  await stroke("erase", [0.3, 0.4], [0.7, 0.4]);
  out.centerErased = alpha(0.5, 0.4);
  await stroke("restore", [0.45, 0.4], [0.55, 0.4]);
  out.centerRestored = alpha(0.5, 0.4);
  out.sideStillErased = alpha(0.35, 0.4);
  q('[data-do="cut-apply"]').click();
  await wait(200);
  out.ops = q(".ie-name b").textContent.startsWith("•");
  out.afterApplyCorner = alpha(0.01, 0.01);
  q("[data-act=undo]").click();
  await wait(300);
  out.undoCorner = alpha(0.01, 0.01);
  out.errs = errs;
  return out;
})()
