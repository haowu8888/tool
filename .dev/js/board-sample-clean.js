(async () => {
  const s = window.__bdSample;
  if (!s) return "nothing";
  for (const id of s.issues) await mygo.call("Board.Delete", id);
  for (const id of s.projects) await mygo.call("Board.DeleteProject", id);
  delete window.__bdSample;
  return "cleaned";
})()
