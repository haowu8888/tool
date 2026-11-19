// Empties what the image tests left in the three views of 图片编辑.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => document.querySelector(s);
  document.querySelector('.nav-item[data-id="image"]').click();
  await wait(200);
  q('.iv-tabs [data-view="merge"]').click();
  await wait(200);
  q('.mg-top [data-act="clear"]:not(:disabled)')?.click();
  q('.iv-tabs [data-view="collage"]').click();
  await wait(200);
  q('.cg-top [data-act="clear"]')?.click();
  q('.iv-tabs [data-view="edit"]').click();
  await wait(200);
  q('.ie-top [data-act="close"]:not(:disabled)')?.click();
  await wait(150);
  q("dialog[open] [data-ok]")?.click();
  await wait(100);
  document.querySelector(".l-toast")?.remove();
  return [document.querySelectorAll(".ie-view").length, q(".iv-tabs .on")?.textContent];
})()
