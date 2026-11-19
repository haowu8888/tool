// Scrolls the test note's embed into view, for a screenshot of its player
// in the sandboxed frame; tells the frame's sandbox and size.
(async () => {
  const e = document.querySelector(".e-embed");
  if (!e) return "no embed: run blocks-ui.js first";
  e.scrollIntoView({ block: "center" });
  await new Promise((r) => setTimeout(r, 6000));
  const f = e.querySelector("iframe");
  return { sandbox: f?.getAttribute("sandbox"), src: f?.src.slice(0, 60), height: f?.offsetHeight };
})()
