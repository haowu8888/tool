// Drags a selection in the screenshot window and presses one of its
// toolbar's buttons. Set the rectangle (page pixels) and the action in the
// first line; run after the shortcut brought the window up:
//   node .dev/cdp.mjs @.dev/js/shot-select.js shot
(async () => {
  const [x, y, w, h, action] = [RECT_AND_ACTION];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = document.querySelector("#app");
  const fire = (type, cx, cy) => app.dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 1, bubbles: true }));
  fire("pointerdown", x, y);
  fire("pointermove", x + w / 2, y + h / 2);
  fire("pointermove", x + w, y + h);
  fire("pointerup", x + w, y + h);
  await wait(100);
  const bar = document.querySelector(".sh-bar");
  const out = { size: document.querySelector(".sh-size").textContent, bar: !bar.hidden, barAt: [bar.style.left, bar.style.top], dim: getComputedStyle(document.querySelector(".sh-dim")).display };
  if (action) bar.querySelector(`[data-act="${action}"]`).click();
  return out;
})();
