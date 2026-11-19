// Adds sample todos and notes for screenshots; notes-clean.js removes them.
(async () => {
  const c = (m, ...a) => mygo.call(m, ...a);
  const pad = (n) => String(n).padStart(2, "0");
  const day = (n, t) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` + (t ? "T" + t : ""); };
  const todos = [
    ["样例 续费服务器", day(-1), true, ""], ["样例 给客户回邮件", day(0, "18:00"), false, "附上报价单"], ["样例 交周报", day(2), true, ""],
    ["样例 体检", day(5, "09:30"), false, ""], ["样例 整理桌面快捷方式", "", false, ""], ["样例 买咖啡豆", "", false, ""],
  ];
  for (const [text, due, important, detail] of todos) await c("Notes.SaveTodo", { id: "", text, due, important, detail, created: 0 });
  const done = await c("Notes.SaveTodo", { id: "", text: "样例 备份 D 盘", created: 0 });
  await c("Notes.SaveTodo", { ...done, done: true });
  await c("Notes.SaveNote", { id: "", body: "样例 服务器信息\n117.x.x.x 端口 8080\n面板：1Panel", pinned: true });
  await c("Notes.SaveNote", { id: "", body: "样例 读书笔记\n《置身事内》第三章：土地财政……" });
  await c("Notes.SaveNote", { id: "", body: "样例 周末清单\n- 洗车\n- 换路由器" });
  document.querySelector('.nav-item[data-id="notes"]').click();
  return "ok";
})()
