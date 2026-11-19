// 剪贴板历史's 编辑 on its first picture opens it in the image editor,
// through Go (Clips.Edit → ImageEdit.edit → showTool + imageEditOpened).
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const items = await mygo.call("Clips.List");
  const pic = items.find((c) => c.kind === "image");
  if (!pic) return "no picture in the clipboard history";
  document.querySelector('[data-act="close"]')?.click();
  await wait(150);
  document.querySelector("dialog[open] [data-ok]")?.click();
  document.querySelector('.nav-item[data-id="clips"]').click();
  await wait(300);
  const btn = document.querySelector(`.cl-item[data-id="${pic.id}"] [data-act="edit"]`);
  const hasButton = !!btn;
  btn?.click();
  await wait(1200);
  return {
    hasButton,
    tool: document.querySelector(".nav-item.active")?.dataset.id,
    name: document.querySelector(".ie-name")?.textContent,
    want: `${pic.w} × ${pic.h}`,
  };
})()
