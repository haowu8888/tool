// Pictures in todos: paste one into the add box, add the todo, see its
// thumbnail and open it full size; in the edit dialog paste another and
// take the first out. Deletes the test todo afterwards (window.__imgTodo
// keeps its ID when --keep is wanted for a screenshot: run with the
// todo left, then todo-images-clean.js).
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const picture = (color) =>
    new Promise((resolve) => {
      const c = document.createElement("canvas");
      c.width = 160;
      c.height = 100;
      const g = c.getContext("2d");
      g.fillStyle = color;
      g.fillRect(0, 0, 160, 100);
      g.fillStyle = "#fff";
      g.font = "28px sans-serif";
      g.fillText("测试", 50, 60);
      c.toBlob((b) => resolve(new File([b], "", { type: "image/png" })), "image/png");
    });
  const paste = async (el, color) => {
    const dt = new DataTransfer();
    dt.items.add(await picture(color));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  };
  document.querySelector('.nav-item[data-id="notes"]').click();
  await wait(300);
  document.querySelector('.n-tabs button[data-view="todos"]').click();
  await wait(300);
  const input = document.querySelector(".n-add input");
  await paste(input, "#2563eb");
  await wait(800);
  out.addThumbs = document.querySelectorAll(".n-add-imgs .n-thumb").length;
  input.value = "测试图片待办";
  document.querySelector(".n-add").requestSubmit();
  await wait(800);
  out.addCleared = document.querySelectorAll(".n-add-imgs .n-thumb").length === 0;
  const data = await mygo.call("Notes.List");
  const t = data.todos.find((t) => t.text === "测试图片待办");
  window.__imgTodo = t?.id;
  out.saved = t?.images?.length;
  const row = document.querySelector(`.n-todo[data-id="${t.id}"]`);
  const img = row.querySelector(".n-imgs img");
  await wait(300);
  out.cardImg = img ? img.naturalWidth : 0;
  row.querySelector(".n-thumb").click();
  await wait(200);
  out.lightbox = !!document.querySelector(".e-lightbox img");
  document.querySelector(".e-lightbox").click();
  out.lightboxClosed = !document.querySelector(".e-lightbox");
  row.querySelector(".n-body").click();
  await wait(300);
  const dlg = document.querySelector("dialog[open]");
  out.dlgThumbs = dlg.querySelectorAll(".n-edit-imgs .n-thumb").length;
  await paste(dlg.querySelector("input[name=text]"), "#16a34a");
  await wait(800);
  out.dlgAfterPaste = dlg.querySelectorAll(".n-edit-imgs .n-thumb").length;
  dlg.querySelector(".n-edit-imgs .n-thumb img").click();
  await wait(200);
  out.lightboxInDialog = !!dlg.querySelector(".e-lightbox");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(100);
  out.dialogStillOpen = dlg.open && !dlg.querySelector(".e-lightbox");
  dlg.querySelector(".n-edit-imgs .n-thumb-del").click();
  out.dlgAfterDel = dlg.querySelectorAll(".n-edit-imgs .n-thumb").length;
  dlg.querySelector("form").requestSubmit();
  await wait(600);
  const t2 = (await mygo.call("Notes.List")).todos.find((x) => x.id === t.id);
  out.afterEdit = [t2.images.length, t2.images[0] !== t.images[0]];
  return out;
})();
