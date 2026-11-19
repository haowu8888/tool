// Fills 创造拼图 and 合并文档 with pictures of .dev for screenshots; VIEW
// (sed) is the one left showing.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => document.querySelector(s);
  const files = ["flow.png", "dev.png", "ports.png", "dv-time.png"].map((f) => "D:\\AI\\claude-docker\\workspace\\tool\\.dev\\" + f);
  const paste = async (path) => {
    const f = await mygo.call("ImageEdit.OpenPath", path);
    const blob = await (await fetch(f.url)).blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], path.replace(/^.*\\/, ""), { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    await wait(500);
  };
  document.querySelector('.nav-item[data-id="image"]').click();
  await wait(200);
  q('.iv-tabs [data-view="merge"]').click();
  await wait(200);
  if (!document.querySelectorAll(".mg-card").length || document.querySelectorAll(".mg-card").length === 3) {
    q('.mg-top [data-act="clear"]')?.click();
    for (const f of files) await paste(f);
  }
  q('.iv-tabs [data-view="collage"]').click();
  await wait(300);
  q('.cg-side [data-tab="layout"]')?.click();
  await wait(50);
  q('[data-tpl="6"]').click();
  q('.cg-top [data-act="clear"]').click();
  await wait(100);
  for (const f of files.slice(0, 3)) await paste(f);
  const slide = (sel, v) => {
    const el = q(sel);
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  slide('[data-st="radius"]', 24);
  slide('[data-st="gap"]', 20);
  slide('[data-st="pad"]', 30);
  q('[data-bg="#a1c4fd,#c2e9fb"]').click();
  await wait(100);
  const stage = q(".cg-stage");
  const vr = () => q(".cg-view").getBoundingClientRect();
  const ev = (type, fx, fy) => stage.dispatchEvent(new PointerEvent(type, { clientX: vr().left + vr().width * fx, clientY: vr().top + vr().height * fy, bubbles: true, pointerId: 1, button: 0, buttons: 1 }));
  q('.cg-rail [data-tool="arrow"]').click();
  q('[data-color="#f5222d"]')?.click();
  ev("pointerdown", 0.35, 0.8);
  for (let i = 1; i <= 6; i++) ev("pointermove", 0.35 + i * 0.04, 0.8 - i * 0.06);
  ev("pointerup", 0.59, 0.44);
  await wait(100);
  q('.cg-rail [data-tool="move"]').click();
  await wait(50);
  ev("pointerdown", 0.75, 0.3);
  ev("pointerup", 0.75, 0.3);
  await wait(200);
  if ("VIEW" === "merge") q('.iv-tabs [data-view="merge"]').click();
  if ("VIEW" === "layers") {
    q('.cg-side [data-tab="layers"]').click();
  }
  await wait(300);
  return document.querySelectorAll(".mg-card").length || document.querySelectorAll(".cg-layer").length;
})()
