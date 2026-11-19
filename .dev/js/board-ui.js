// The kanban: new issue with C, drag between and within columns, the side
// panel (priority, checklist, comment, description), list view, delete
// and undo. Leaves the issues named 测试-看板… for board-clean.js.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const list = () => mygo.call("Board.List");
  document.querySelector('.nav-item[data-id="board"]').click();
  await wait(400);
  localStorage.removeItem("board-view");
  out.columns = [...document.querySelectorAll(".bd-col .bd-col-name")].map((e) => e.textContent).join(",");

  // C opens the new issue dialog.
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
  await wait(200);
  const dlg = document.querySelector("dialog.bd-dialog");
  out.dialog = !!dlg;
  dlg.querySelector(".bd-new-title").value = "测试-看板 一";
  dlg.querySelector("form").requestSubmit();
  await wait(600);
  out.dialogClosed = !document.querySelector("dialog.bd-dialog");
  let d = await list();
  const one = d.issues.find((x) => x.title === "测试-看板 一");
  out.created = one && [one.status, one.num > 0];
  const p = await mygo.call("Board.SaveProject", { id: "", name: "测试-看板项目", color: "#22c55e" });
  const two = await mygo.call("Board.Create", { id: "", num: 0, title: "测试-看板 二", status: "todo", priority: "urgent", project: p.id, labels: [d.labels[0].id], due: "2026-11-10", created: 0, updated: 0 });
  const three = await mygo.call("Board.Create", { id: "", num: 0, title: "测试-看板 三", status: "in_progress", created: 0, updated: 0 });
  await wait(400);
  out.todoCards = [...document.querySelectorAll('.bd-col[data-status="todo"] .bd-card-title')].map((e) => e.textContent);
  out.lateChip = !!document.querySelector(`.bd-card[data-id="${two.id}"] .bd-due.late`);

  // Drag 一 onto the in-progress column, in front of 三.
  const drag = async (id, targetCard, colStatus, after) => {
    const dt = new DataTransfer();
    const card = document.querySelector(`.bd-card[data-id="${id}"]`);
    card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    const col = document.querySelector(`.bd-col[data-status="${colStatus}"]`);
    const t = targetCard ? document.querySelector(`.bd-card[data-id="${targetCard}"]`) : col.querySelector(".bd-cards");
    const r = t.getBoundingClientRect();
    const y = targetCard ? (after ? r.bottom - 3 : r.top + 3) : r.bottom - 5;
    t.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 10, clientY: y }));
    t.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 10, clientY: y }));
    card.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    await wait(600);
  };
  await drag(one.id, three.id, "in_progress", false);
  d = await list();
  out.afterDrag = d.issues.filter((x) => x.status === "in_progress").map((x) => x.title).join(",");
  out.afterDragDom = [...document.querySelectorAll('.bd-col[data-status="in_progress"] .bd-card-title')].map((e) => e.textContent).join(",");
  await drag(one.id, three.id, "in_progress", true);
  d = await list();
  out.afterDrag2 = d.issues.filter((x) => x.status === "in_progress").map((x) => x.title).join(",");
  await drag(three.id, null, "done");
  d = await list();
  out.done = d.issues.find((x) => x.id === three.id).status + " " + (d.issues.find((x) => x.id === three.id).done > 0);

  // The side panel.
  document.querySelector(`.bd-card[data-id="${one.id}"]`).click();
  await wait(200);
  const peek = document.querySelector(".bd-peek");
  out.peek = !peek.hidden && peek.querySelector(".bd-peek-key").textContent;
  peek.querySelector('[data-pick="priority"]').click();
  await wait(100);
  [...document.querySelectorAll(".bd-menu button")].find((b) => b.textContent.includes("高")).click();
  peek.querySelector('[data-pick="labels"]').click();
  await wait(100);
  // The menu draws itself anew after each pick.
  document.querySelectorAll(".bd-menu button")[0].click();
  document.querySelectorAll(".bd-menu button")[1].click();
  out.menuStays = !!document.querySelector(".bd-menu");
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  const sub = peek.querySelector(".bd-sub-add input");
  sub.value = "子任务甲";
  sub.form.requestSubmit();
  sub.value = "子任务乙";
  sub.form.requestSubmit();
  const desc = peek.querySelector(".bd-desc");
  desc.focus();
  desc.value = "描述 第一行\n第二行";
  desc.dispatchEvent(new Event("input", { bubbles: true }));
  const c = peek.querySelector(".bd-comment textarea");
  c.value = "一条评论";
  c.form.requestSubmit();
  await wait(1200);
  d = await list();
  const o = d.issues.find((x) => x.id === one.id);
  out.peeked = [o.priority, o.labels?.length, o.subs?.map((s) => s.title).join("/"), o.desc, o.activity.map((e) => e.kind).join(",")];
  peek.querySelector(".bd-sub input[type=checkbox]").click();
  await wait(500);
  out.subDone = (await list()).issues.find((x) => x.id === one.id).subs[0].done;
  out.cardMeta = document.querySelector(`.bd-card[data-id="${one.id}"] .bd-card-foot`).textContent.replace(/\s+/g, " ").trim();

  // List view.
  document.querySelector('.bd-seg [data-layout="list"]').click();
  await wait(200);
  out.rows = document.querySelectorAll(".bd-row").length;
  out.groups = [...document.querySelectorAll(".bd-group-h")].map((e) => e.textContent.trim().replace(/\s+/g, "")).join(" ");
  document.querySelector('.bd-seg [data-layout="board"]').click();
  await wait(200);

  // Search by number and by pinyin initials.
  const s = document.querySelector(".bd-search input");
  s.value = "#" + two.num;
  s.dispatchEvent(new Event("input"));
  out.searchNum = document.querySelectorAll(".bd-card").length;
  s.value = "kb"; // 看板
  s.dispatchEvent(new Event("input"));
  out.searchPinyin = document.querySelectorAll(".bd-card").length;
  s.value = "";
  s.dispatchEvent(new Event("input"));

  // Delete from the panel, then undo.
  peek.querySelector('[data-act="delete"]').click();
  await wait(500);
  out.deleted = !(await list()).issues.some((x) => x.id === one.id) && peek.hidden;
  document.querySelector(".l-toast button").click();
  await wait(500);
  out.restored = (await list()).issues.find((x) => x.id === one.id)?.subs?.length;
  return JSON.stringify(out, null, 1);
})()
