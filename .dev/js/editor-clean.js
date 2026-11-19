// Removes the notes editor-ui.js made.
(async () => {
  const d = await mygo.call("Notes.List");
  for (const n of d.notes) if (n.body.includes("测试笔记")) await mygo.call("Notes.DeleteNote", n.id);
  return "cleaned";
})()
