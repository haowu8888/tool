// Draws every kind of mark on a selection in the screenshot window, then
// pins it, for the pinned picture to show what was drawn:
//   node .dev/cdp.mjs @.dev/js/shot-marks.js shot
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = document.querySelector("#app");
  const fire = (type, cx, cy, extra = {}) =>
    app.dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 1, bubbles: true, ...extra }));
  const drag = async (pts) => {
    fire("pointerdown", ...pts[0]);
    for (const p of pts.slice(1)) fire("pointermove", ...p);
    fire("pointerup", ...pts[pts.length - 1]);
    await wait(30);
  };
  const tool = (t) => document.querySelector(`.sh-bar [data-tool="${t}"]`).click();
  const [x, y, w, h] = [200, 150, 520, 320];
  await drag([[x, y], [x + w / 2, y + h / 2], [x + w, y + h]]);
  const out = {};
  tool("rect");
  document.querySelector('.sh-opts [data-color="#1677ff"]').click();
  await drag([[x + 20, y + 20], [x + 160, y + 110]]);
  tool("ellipse");
  document.querySelector('.sh-opts [data-color="#52c41a"]').click();
  await drag([[x + 190, y + 20], [x + 320, y + 110]]);
  tool("arrow");
  document.querySelector('.sh-opts [data-color="#f5222d"]').click();
  document.querySelector('.sh-opts [data-size="2"]').click();
  await drag([[x + 360, y + 140], [x + 480, y + 40]]);
  tool("pen");
  document.querySelector('.sh-opts [data-size="1"]').click();
  await drag(Array.from({ length: 30 }, (_, i) => [x + 30 + i * 8, y + 200 + Math.sin(i / 3) * 20]));
  tool("mosaic");
  await drag([[x + 300, y + 230], [x + 400, y + 250], [x + 480, y + 240]]);
  tool("text");
  fire("pointerdown", x + 30, y + 270);
  await wait(50);
  const ta = document.querySelector(".sh-text");
  out.editor = !!ta;
  ta.value = "标注文字 Text";
  ta.dispatchEvent(new Event("input"));
  ta.blur();
  await wait(30);
  // A slip of a shape is dropped; undo takes off the last mark.
  tool("rect");
  await drag([[x + 10, y + 10], [x + 11, y + 11]]);
  tool("rect");
  out.undoEnabled = !document.querySelector('.sh-bar [data-act="undo"]').disabled;
  out.opts = !document.querySelector(".sh-opts").hidden;
  // A click outside the selection keeps what was drawn.
  await drag([[20, 20], [60, 60]]);
  out.selKept = document.querySelector(".sh-size").textContent;
  out.bar = document.querySelector(".sh-bar").getBoundingClientRect().toJSON();
  await wait(100);
  if (!window.__noAct) document.querySelector('.sh-bar [data-act="pin"]').click();
  return out;
})();
