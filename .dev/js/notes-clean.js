// Removes the todos and notes that notes-sample.js added.
(async () => {
  const c = (m, ...a) => mygo.call(m, ...a);
  const d = await c("Notes.List");
  for (const t of d.todos) if (t.text.startsWith("样例")) await c("Notes.DeleteTodo", t.id);
  for (const n of d.notes) if (n.body.startsWith("样例")) await c("Notes.DeleteNote", n.id);
  return "cleaned";
})()
