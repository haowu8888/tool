// A step half typed survives the todos being redrawn (another todo
// changing meanwhile), and Enter adds it and leaves an empty box for the
// next. Deletes its two test todos.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  document.querySelector('.nav-item[data-id="notes"]').click();
  await wait(300);
  document.querySelector('.n-tabs button[data-view="todos"]').click();
  await wait(200);
  const a = await mygo.call("Notes.SaveTodo", { id: "", text: "测试-子项输入" });
  const b = await mygo.call("Notes.SaveTodo", { id: "", text: "测试-另一条" });
  await wait(300);
  document.querySelector(`.n-todo[data-id="${a.id}"] .n-sub-open`).click();
  await wait(100);
  let input = document.querySelector(`.n-todo[data-id="${a.id}"] .n-sub-new`);
  input.value = "打了一半";
  input.setSelectionRange(2, 2);
  // Something else changes meanwhile, as a todo starting to ring.
  await mygo.call("Notes.SaveTodo", { ...b, important: true });
  await wait(300);
  const again = document.querySelector(`.n-todo[data-id="${a.id}"] .n-sub-new`);
  out.redrawn = again !== input;
  out.kept = [again?.value, again?.selectionStart, document.activeElement === again];
  // Enter adds it, and the box is empty for the next.
  again.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await wait(400);
  const next = document.querySelector(`.n-todo[data-id="${a.id}"] .n-sub-new`);
  out.afterEnter = [next?.value, document.activeElement === next, document.querySelectorAll(`.n-todo[data-id="${a.id}"] .n-sub`).length];
  next?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await mygo.call("Notes.DeleteTodo", a.id);
  await mygo.call("Notes.DeleteTodo", b.id);
  await wait(200);
  out.cleaned = !document.querySelector(`.n-todo[data-id="${a.id}"]`);
  return out;
})();
