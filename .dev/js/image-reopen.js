// Closes the picture in the image editor, throwing its edits away, and
// opens .dev/dev.png as a pasted picture.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.nav-item[data-id="image"]').click();
  await wait(200);
  if (document.querySelector(".ie-view")) {
    document.querySelector('[data-act="close"]').click();
    await wait(150);
    document.querySelector("dialog[open] [data-ok]")?.click();
    await wait(150);
  }
  const f = await mygo.call("ImageEdit.OpenPath", "D:\\AI\\claude-docker\\workspace\\tool\\.dev\\dev.png");
  const blob = await (await fetch(f.url)).blob();
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "dev.png", { type: "image/png" }));
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  await wait(500);
  return document.querySelector(".ie-name")?.textContent;
})()
