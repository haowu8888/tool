// The service monitor: a dead port goes down after two checks (about 10
// seconds), alerts, and the bubble lists it; 知道了 stops the alert. A
// working page shows up. Deletes its services afterwards.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  document.querySelector('.nav-item[data-id="services"]').click();
  await wait(300);
  const ok = await mygo.call("Services.Save", { id: "", name: "测试-本机页面", kind: "http", target: "https://www.baidu.com", keyword: "baidu", interval: 60 });
  const dead = await mygo.call("Services.Save", { id: "", name: "测试-死端口", kind: "tcp", target: "127.0.0.1:1", interval: 30 });
  await wait(3000);
  let list = await mygo.call("Services.List");
  const st = (id) => list.find((v) => v.id === id)?.state;
  out.okUp = st(ok.id)?.status === "up";
  out.deadFirst = [st(dead.id)?.status, st(dead.id)?.alert, st(dead.id)?.message];
  await wait(11000);
  list = await mygo.call("Services.List");
  out.deadAfter = [st(dead.id)?.status, st(dead.id)?.alert];
  out.alerts = (await mygo.call("Services.Alerts")).map((v) => v.name);
  out.rows = document.querySelectorAll(".sv-item").length;
  out.summary = document.querySelector(".sv-summary").textContent;
  out.ts = document.querySelector(".sv-ts-state").textContent;
  await mygo.call("Services.Ack", dead.id);
  await mygo.call("Services.AckAll");
  out.acked = (await mygo.call("Services.Alerts")).length === 0;
  window.__svc = [ok.id, dead.id];
  return out;
})();
