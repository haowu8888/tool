// 图片编辑的文字标注: typing, then a color and a size from the panel go
// to the text being typed; its dashed edge drags it; a click on a text
// with the text tool edits it again (one undo step), emptied it goes.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const errs = [];
  addEventListener("error", (e) => errs.push(e.message));
  document.querySelector('.nav-item[data-id="image"]').click();
  await wait(300);
  document.querySelector(".iv-tabs [data-view=\"edit\"]")?.click();
  await wait(200);
  const c = document.createElement("canvas");
  c.width = 400;
  c.height = 300;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 400, 300);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "t.png", { type: "image/png" }));
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  await wait(400);
  document.querySelector('[data-mode="mark"]').click();
  await wait(100);
  document.querySelector('[data-mark="text"]').click();
  await wait(100);
  document.querySelector('[data-act="actual"]').click();
  await wait(100);
  const stage = document.querySelector(".ie-stage");
  const view = () => document.querySelector(".ie-view");
  const vr = () => view().getBoundingClientRect();
  // A point of the picture on the screen (100%).
  const at = (x, y) => ({ clientX: vr().left + x, clientY: vr().top + y });
  const pe = (el, type, p, extra = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, buttons: 1, pointerId: 1, ...p, ...extra }));
  // Where some color is: the mean point of pixels near it.
  const find = (rgb) => {
    const d = view().getContext("2d").getImageData(0, 0, view().width, view().height).data;
    let n = 0, sx = 0, sy = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - rgb[0]) + Math.abs(d[i + 1] - rgb[1]) + Math.abs(d[i + 2] - rgb[2]) < 60) {
        n++;
        sx += (i / 4) % view().width;
        sy += Math.floor(i / 4 / view().width);
      }
    }
    return n ? { n, x: Math.round(sx / n), y: Math.round(sy / n) } : null;
  };
  const box = () => document.querySelector(".ie-text");

  pe(stage, "pointerdown", at(60, 60));
  await wait(150);
  out.opened = !!box();
  out.placeholder = box()?.placeholder;
  out.focused = document.activeElement === box();
  box().value = "测试文字";
  box().dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector('[data-color="#1677ff"]').click();
  await wait(100);
  out.colorLive = box().style.color;
  out.refocused = document.activeElement === box();
  document.querySelector('[data-size="2"]').click();
  await wait(100);
  out.sizeLive = box().style.fontSize;
  // Drag by the top edge 100 right, 80 down.
  const r = box().getBoundingClientRect();
  const from = { clientX: r.left + r.width / 2, clientY: r.top + 2 };
  pe(box(), "pointerdown", from);
  pe(box(), "pointermove", { clientX: from.clientX + 50, clientY: from.clientY + 40 });
  pe(box(), "pointermove", { clientX: from.clientX + 100, clientY: from.clientY + 80 });
  pe(box(), "pointerup", { clientX: from.clientX + 100, clientY: from.clientY + 80 });
  const r2 = box().getBoundingClientRect();
  out.moved = [Math.round(r2.left - r.left), Math.round(r2.top - r.top)];
  out.valueKept = box().value;
  // A click elsewhere keeps it.
  pe(stage, "pointerdown", at(380, 280));
  await wait(150);
  out.closed = !box();
  out.blueAt = find([22, 119, 255]);

  // Again: a click on it opens it with its text; green, then kept.
  pe(stage, "pointerdown", at(out.blueAt.x, out.blueAt.y));
  await wait(150);
  out.againValue = box()?.value;
  out.hiddenWhileEditing = !find([22, 119, 255]);
  document.querySelector('[data-color="#52c41a"]').click();
  await wait(100);
  pe(stage, "pointerdown", at(380, 280));
  await wait(150);
  out.greenAt = find([82, 196, 26]);
  out.blueGone = !find([22, 119, 255]);
  document.querySelector('[data-act="undo"]').click();
  await wait(150);
  out.undoBlue = !!find([22, 119, 255]) && !find([82, 196, 26]);
  document.querySelector('[data-act="redo"]').click();
  await wait(150);
  out.redoGreen = !!find([82, 196, 26]) && !find([22, 119, 255]);
  // Emptied, it goes.
  pe(stage, "pointerdown", at(out.greenAt.x, out.greenAt.y));
  await wait(150);
  box().value = "";
  pe(stage, "pointerdown", at(380, 280));
  await wait(150);
  out.emptiedGone = !find([82, 196, 26]);
  // A click on nothing opens a new box.
  pe(stage, "pointerdown", at(30, 250));
  await wait(150);
  out.newBoxEmpty = box()?.value === "";
  box().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(100);
  out.escClosed = !box();
  out.errs = errs;
  return JSON.stringify(out);
})()
