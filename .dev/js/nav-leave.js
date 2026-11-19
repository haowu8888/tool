// In and out of every tool a few times: the pages still fill in (their
// listeners go with them, see onLeave). Then, when the newest clipboard
// item is 来源测试… (set by setclip.ps1 right before), reports its source
// and puts the clipboard and the history back as they were.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const go = async (id) => {
    document.querySelector(`.nav-item[data-id="${id}"]`).click();
    await wait(350);
  };
  for (let i = 0; i < 3; i++) for (const id of ["services", "clips", "shot", "virtual-screen", "monitor", "notes"]) await go(id);
  await go("services");
  await wait(1500);
  out.services = [document.querySelectorAll(".sv-item").length, document.querySelector(".sv-summary").textContent, document.querySelector(".sv-ts-state").textContent];
  await go("clips");
  const list = await mygo.call("Clips.List");
  out.clipTop = [list[0].text, list[0].source];
  out.clipRows = document.querySelectorAll(".cl-item").length === list.length;
  if (list[0].text?.startsWith("来源测试")) {
    await mygo.call("Clips.Copy", list[1].id);
    await wait(900);
    await mygo.call("Clips.Delete", list[0].id);
    const after = await mygo.call("Clips.List");
    out.restored = [after[0].id === list[1].id, after[0].source === list[1].source];
  }
  await go("notes");
  return out;
})();
