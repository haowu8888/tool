// Removes what board-ui.js left: issues and projects named 测试-看板….
(async () => {
  const d = await mygo.call("Board.List");
  for (const is of d.issues.filter((x) => x.title.startsWith("测试-看板"))) await mygo.call("Board.Delete", is.id);
  for (const p of d.projects.filter((x) => x.name.startsWith("测试-看板"))) await mygo.call("Board.DeleteProject", p.id);
  const left = await mygo.call("Board.List");
  return JSON.stringify({ issues: left.issues.length, projects: left.projects.length });
})()
