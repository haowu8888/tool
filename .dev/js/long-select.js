// Long screenshot test, step 2 (shot page): selects the content area of the toolbox window and presses 长截图.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = document.querySelector("#app");
  const fire = (type, cx, cy) => app.dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 1, bubbles: true }));
  fire("pointerdown", 330, 260);
  fire("pointermove", 700, 500);
  fire("pointermove", 1000, 700);
  fire("pointerup", 1000, 700);
  await wait(100);
  document.querySelector('.sh-bar [data-act="long"]').click();
  await wait(600);
  return document.querySelector(".sh-tip").hidden ? "ok" : document.querySelector(".sh-tip").textContent;
})();
