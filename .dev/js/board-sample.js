// Sample issues for a screenshot; board-sample-clean.js removes them.
(async () => {
  document.querySelector('.nav-item[data-id="board"]').click();
  const d = await mygo.call("Board.List");
  const L = Object.fromEntries(d.labels.map((l) => [l.name, l.id]));
  const p1 = await mygo.call("Board.SaveProject", { id: "", name: "示例·工具箱", color: "#6366f1" });
  const p2 = await mygo.call("Board.SaveProject", { id: "", name: "示例·博客", color: "#f97316" });
  window.__bdSample = { projects: [p1.id, p2.id], issues: [] };
  const mk = async (title, status, priority, project, labels, due, subs) => {
    const is = await mygo.call("Board.Create", { id: "", num: 0, title, status, priority, project, labels, due, subs, created: 0, updated: 0 });
    window.__bdSample.issues.push(is.id);
    return is;
  };
  const day = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
  await mk("录屏支持选择窗口", "backlog", "low", p1.id, [L["功能"]], "", []);
  await mk("调研 WebView2 打印 API", "backlog", "", "", [], "", []);
  await mk("看板支持拖动排序", "todo", "high", p1.id, [L["功能"]], day(2), [{ id: "", title: "列间拖动", done: true }, { id: "", title: "列内排序" }]);
  await mk("写一篇 MyGo 入门文章", "todo", "medium", p2.id, [], day(-1), []);
  const a = await mk("截图翻译偶尔漏行", "in_progress", "urgent", p1.id, [L["Bug"]], day(0), []);
  await mk("服务监控加 HTTPS 证书到期提醒", "in_progress", "medium", p1.id, [L["改进"]], "", [{ id: "", title: "读证书", done: true }, { id: "", title: "提醒", done: false }, { id: "", title: "设置项" }]);
  await mk("首页改版", "in_review", "high", p2.id, [L["改进"]], "", []);
  await mk("RustDesk 隐私模式冲突", "blocked", "high", p1.id, [L["Bug"]], "", []);
  await mk("剪贴板历史", "done", "medium", p1.id, [L["功能"]], "", []);
  await mk("迁移到新服务器", "done", "", p2.id, [], "", []);
  await mygo.call("Board.Comment", a.id, "复现了：多列排版时第二列最后一行没识别出来。");
  return a.id;
})()
