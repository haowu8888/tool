// A 6000×4000 picture: how long opening, a color change, a mosaic stroke,
// a frame and undo take, and the PNG export.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = {};
  const time = async (name, fn) => {
    const s = performance.now();
    await fn();
    t[name] = Math.round(performance.now() - s);
  };
  document.querySelector('.nav-item[data-id="image"]').click();
  await wait(200);
  document.querySelector('[data-act="close"]')?.click();
  await wait(100);
  document.querySelector("dialog[open] [data-ok]")?.click();
  const c = document.createElement("canvas");
  c.width = 6000;
  c.height = 4000;
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 6000, 4000);
  gr.addColorStop(0, "#f80");
  gr.addColorStop(1, "#08f");
  g.fillStyle = gr;
  g.fillRect(0, 0, 6000, 4000);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `hsl(${i * 7},70%,50%)`;
    g.fillRect(Math.random() * 6000, Math.random() * 4000, 200, 120);
  }
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  await time("open", async () => {
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "big.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    for (let i = 0; i < 100 && !document.querySelector(".ie-view"); i++) await wait(50);
  });
  const click = (sel) => document.querySelector(sel).click();
  click('[data-mode="adjust"]');
  await wait(300);
  click('[data-preset="4"]');
  await time("adjust", async () => click('[data-do="adj-apply"]'));
  click('[data-mode="mark"]');
  await wait(50);
  click('[data-mark="mosaic"]');
  const stage = document.querySelector(".ie-stage");
  const vr = document.querySelector(".ie-view").getBoundingClientRect();
  const pt = (fx, fy) => ({ clientX: vr.left + vr.width * fx, clientY: vr.top + vr.height * fy, bubbles: true, pointerId: 1, button: 0, buttons: 1 });
  await time("mosaicDown", async () => stage.dispatchEvent(new PointerEvent("pointerdown", pt(0.2, 0.5))));
  await time("mosaicMoves", async () => {
    for (let i = 1; i <= 20; i++) stage.dispatchEvent(new PointerEvent("pointermove", pt(0.2 + i * 0.02, 0.5)));
  });
  await time("mosaicUp", async () => stage.dispatchEvent(new PointerEvent("pointerup", pt(0.6, 0.5))));
  click('[data-mode="frame"]');
  await wait(50);
  const slide = (sel, v) => {
    const el = document.querySelector(sel);
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await time("framePreview", async () => slide('[data-fr="shadow"]', 50));
  await time("frameApply", async () => click('[data-do="fr-apply"]'));
  await time("undo3", async () => {
    for (let i = 0; i < 3; i++) click("[data-act=undo]");
  });
  await time("png", async () => {
    const v = document.querySelector(".ie-view");
    const b = await new Promise((r) => v.toBlob(r, "image/png"));
    t.pngMB = +(b.size / 1048576).toFixed(1);
  });
  t.dims = document.querySelector(".ie-name span").textContent;
  return t;
})()
