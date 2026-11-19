// Deletes the todo todo-images.js added.
(async () => {
  const t = (await mygo.call("Notes.List")).todos.find((t) => t.text === "测试图片待办");
  if (t) await mygo.call("Notes.DeleteTodo", t.id);
  return !!t;
})();
