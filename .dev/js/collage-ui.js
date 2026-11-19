// 创造拼图: pasted pictures fill the cells in order; a template keeps them;
// a cell splits and joins; a divider drags; a picture swaps cells; marks
// are layers that move, hide and change order; undo; the save dialog.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const errs = [];
  addEventListener("error", (e) => errs.push(e.message));
  document.querySelector('.nav-item[data-id="image"]').click();
  await wait(200);
  document.querySelector('.iv-tabs [data-view="collage"]').click();
  await wait(300);
  out.tabOn = document.querySelector(".iv-tabs .on")?.textContent;
  const q = (s) => document.querySelector(s);
  const click = async (s, ms = 120) => {
    const el = q(s);
    if (!el) throw new Error("no " + s);
    el.click();
    await wait(ms);
  };
  // Start clean: 四宫格, nothing in it.
  await click('.cg-side [data-tab="layout"]');
  await click('[data-tpl="5"]');
  if (q('.cg-top [data-act="clear"]')) await click('.cg-top [data-act="clear"]');
  const paste = async (color) => {
    const c = document.createElement("canvas");
    c.width = 300;
    c.height = 200;
    const g = c.getContext("2d");
    g.fillStyle = color;
    g.fillRect(0, 0, 300, 200);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "c.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    await wait(250);
  };
  for (const c of ["#ff0000", "#00c000", "#0000ff"]) await paste(c);
  const view = () => q(".cg-view");
  const px = (fx, fy) => [...view().getContext("2d").getImageData(Math.round(view().width * fx), Math.round(view().height * fy), 1, 1).data].slice(0, 3);
  await wait(100);
  out.size = `${view().width}x${view().height}`;
  out.cells = [px(0.25, 0.25), px(0.75, 0.25), px(0.25, 0.75), px(0.75, 0.75)]; // red green / blue empty

  // 左一右二 keeps the three in order.
  await click('[data-tpl="6"]');
  out.template = [px(0.25, 0.5), px(0.75, 0.25), px(0.75, 0.75)];

  const stage = q(".cg-stage");
  const vr = () => view().getBoundingClientRect();
  const ev = (type, fx, fy, extra = {}) =>
    stage.dispatchEvent(new PointerEvent(type, { clientX: vr().left + vr().width * fx, clientY: vr().top + vr().height * fy, bubbles: true, pointerId: 1, button: 0, buttons: type === "pointerup" ? 0 : 1, ...extra }));
  const drag = async (a, b, steps = 6) => {
    ev("pointerdown", ...a);
    for (let i = 1; i <= steps; i++) ev("pointermove", a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps);
    ev("pointerup", ...b);
    await wait(120);
  };
  // The divider between left and right, dragged from the middle to 30%.
  await drag([0.5, 0.5], [0.3, 0.5]);
  out.divider = [px(0.2, 0.5), px(0.4, 0.5)]; // red, then green/blue
  // Swap: the left (red) picture dragged onto the top right (green).
  await drag([0.15, 0.5], [0.7, 0.25]);
  out.swapped = [px(0.15, 0.5), px(0.7, 0.25)];
  // Select the top right cell, split it left and right, join it again.
  ev("pointerdown", 0.7, 0.25);
  ev("pointerup", 0.7, 0.25);
  await wait(150);
  out.cellPanel = !!q('[data-do="split-x"]');
  await click('[data-do="split-x"]');
  out.afterSplit = px(0.92, 0.25); // the new empty cell: placeholder gray-ish
  await click('[data-do="join"]');
  out.afterJoin = px(0.92, 0.25);

  // Marks: a rectangle and an arrow, as layers.
  await click('.cg-rail [data-tool="rect"]');
  await click('[data-color="#ffffff"]');
  await drag([0.1, 0.1], [0.5, 0.5]);
  await click('.cg-rail [data-tool="arrow"]');
  await click('[data-color="#000000"]');
  await drag([0.05, 0.9], [0.3, 0.6]);
  await click('.cg-rail [data-tool="move"]');
  await click('.cg-side [data-tab="layers"]');
  out.layers = [...document.querySelectorAll(".cg-layer-name")].map((e) => e.textContent);
  // Pick the rectangle on its edge, move it, send it to the bottom.
  ev("pointerdown", 0.1, 0.3);
  ev("pointermove", 0.15, 0.3);
  ev("pointerup", 0.15, 0.3);
  await wait(150);
  out.selected = q(".cg-layer.on .cg-layer-name")?.textContent;
  out.movedEdge = px(0.15, 0.3); // white: the rectangle's left edge moved here
  await click('[data-order="bottom"]');
  out.layersAfter = [...document.querySelectorAll(".cg-layer-name")].map((e) => e.textContent);
  await click(".cg-layer.on [data-eye]");
  out.hidden = q(".cg-layer.off .cg-layer-name")?.textContent;
  out.hiddenEdge = px(0.15, 0.3);
  // Undo all the way back to the four pasted pictures' 四宫格? Three steps
  // back shows the rectangle again.
  await click('.cg-top [data-act="undo"]');
  out.undoEdge = px(0.15, 0.3);
  // The save dialog measures the file.
  await click('.cg-top [data-act="export"]', 900);
  out.exportSize = q(".ie-ex-size")?.textContent;
  q("dialog[open]")?.close();
  // 送去编辑 opens it in the editor.
  await click('.cg-top [data-act="edit"]', 400);
  out.toEditor = [q(".iv-tabs .on")?.textContent, q(".ie-name")?.textContent];
  document.querySelector('.iv-tabs [data-view="collage"]').click();
  await wait(300);
  out.back = q(".cg-layer") ? "layers kept" : q(".cg-size")?.textContent;
  out.errs = errs;
  return out;
})()
