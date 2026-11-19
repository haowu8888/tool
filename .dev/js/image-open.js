// Opens .dev/dev.png in the image editor, as a pasted picture, in the mode
// written below (sed replaces MODE).
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.nav-item[data-id="image"]').click();
  await wait(200);
  if (!document.querySelector(".ie-view")) {
    const f = await mygo.call("ImageEdit.OpenPath", "D:\\AI\\claude-docker\\workspace\\tool\\.dev\\dev.png");
    const blob = await (await fetch(f.url)).blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "dev.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    await wait(500);
  }
  document.querySelector('[data-mode="MODE"]')?.click();
  await wait(300);
  return document.querySelector(".ie-name")?.textContent;
})()
