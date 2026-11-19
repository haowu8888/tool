// In the selection window: a click (no drag) selects the whole screen in
// record mode; then 开始录制.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = document.querySelector("#app");
  const fire = (type) => app.dispatchEvent(new PointerEvent(type, { clientX: 300, clientY: 300, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 1, bubbles: true }));
  const tip = document.querySelector(".sh-tip").textContent;
  fire("pointerdown");
  fire("pointerup");
  await wait(100);
  const bar = document.querySelector(".sh-bar");
  const shown = [...bar.children].filter((b) => getComputedStyle(b).display !== "none").map((b) => b.textContent.trim() || b.title);
  const out = { tip, size: document.querySelector(".sh-size").textContent, rec: bar.classList.contains("rec"), shown };
  bar.querySelector(".sh-rec-go").click();
  return out;
})();
