// The clipboard history after .dev/setclip.ps1 copied, in this order, the
// texts "<stamp> A", "<stamp> B", "<stamp> A" again, testdata/ocr-en.png and
// the files go.mod|go.sum (see CLAUDE.md): a second copy moves an item up,
// pictures and files are kept, the 剪贴板 page lists and filters them, and
// Clips.Copy puts an older one back. Deletes what the test added.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const stamp = "工具箱剪贴板测试";
  const out = {};
  let list = await mygo.call("Clips.List");
  out.order = list.slice(0, 4).map((c) => c.kind + ":" + (c.text ?? "").slice(-20));
  out.files = list[0]?.kind === "files" && list[0].files.length === 2;
  out.image = list[1]?.kind === "image" && list[1].w === 520 && list[1].h === 120;
  out.text = list[2]?.text === stamp + " A" && list[3]?.text === stamp + " B" && list.filter((c) => c.text?.startsWith(stamp)).length === 2;
  out.source = list[2]?.source;
  out.imageLoads = await new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img.naturalWidth === 520);
    img.onerror = () => ok(false);
    img.src = list[1].image;
  });
  document.querySelector('.nav-item[data-id="clips"]').click();
  await wait(300);
  const search = document.querySelector(".cl-bar .l-search");
  search.value = stamp;
  search.dispatchEvent(new Event("input"));
  out.pageRows = document.querySelectorAll(".cl-item").length;
  search.value = "";
  search.dispatchEvent(new Event("input"));
  document.querySelector('.cl-filter [data-f="image"]').click();
  out.imageFilter = document.querySelectorAll(".cl-item").length > 0 && [...document.querySelectorAll(".cl-item")].every((r) => r.classList.contains("cl-image"));
  document.querySelector('.cl-filter [data-f="all"]').click();
  // Copying B again puts it first.
  await mygo.call("Clips.Copy", list[3].id);
  await wait(1200);
  list = await mygo.call("Clips.List");
  out.copyBack = list[0]?.text === stamp + " B";
  for (const c of list.slice(0, 4)) await mygo.call("Clips.Delete", c.id);
  out.cleaned = !(await mygo.call("Clips.List")).some((c) => c.text?.startsWith(stamp));
  out.shortcut = (await mygo.call("Settings.Shortcuts")).find((s) => s.id === "clipboard");
  return out;
})();
