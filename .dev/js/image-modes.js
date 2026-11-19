// Sets the image editor up for a screenshot of the mode written below (sed
// replaces MODE): a frame, a few marks, or a preset.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('[data-mode="MODE"]')?.click();
  await wait(200);
  const slide = async (sel, v) => {
    const el = document.querySelector(sel);
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(80);
  };
  if ("MODE" === "frame") {
    document.querySelector('[data-bg="#fbc2eb,#a6c1ee"]').click();
    await slide('[data-fr="pad"]', 10);
    await slide('[data-fr="radius"]', 3);
    await slide('[data-fr="shadow"]', 70);
  }
  if ("MODE" === "mark") {
    const stage = document.querySelector(".ie-stage");
    const vr = document.querySelector(".ie-view").getBoundingClientRect();
    const pt = (fx, fy) => ({ clientX: vr.left + vr.width * fx, clientY: vr.top + vr.height * fy, bubbles: true, pointerId: 1, button: 0, buttons: 1 });
    const drag = async (tool, a, b) => {
      document.querySelector(`[data-mark="${tool}"]`).click();
      stage.dispatchEvent(new PointerEvent("pointerdown", pt(...a)));
      for (let i = 1; i <= 8; i++) stage.dispatchEvent(new PointerEvent("pointermove", pt(a[0] + ((b[0] - a[0]) * i) / 8, a[1] + ((b[1] - a[1]) * i) / 8 + (tool === "mosaic" ? 0 : 0))));
      stage.dispatchEvent(new PointerEvent("pointerup", pt(...b)));
      await wait(80);
    };
    await drag("rect", [0.05, 0.1], [0.45, 0.4]);
    await drag("arrow", [0.7, 0.7], [0.48, 0.42]);
    await drag("mosaic", [0.55, 0.15], [0.9, 0.15]);
    await drag("mosaic", [0.55, 0.22], [0.9, 0.22]);
    document.querySelector('[data-mark="text"]').click();
    stage.dispatchEvent(new PointerEvent("pointerdown", pt(0.6, 0.78)));
    await wait(100);
    const ta = document.querySelector(".ie-text");
    ta.value = "这里改一下";
    ta.dispatchEvent(new Event("input"));
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(100);
  }
  return document.querySelector(".ie-name")?.textContent;
})()
