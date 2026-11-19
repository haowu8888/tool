// The service monitor's log and the "not on that network" state, with two
// quiet test services (no bubble): a dead local port goes down and is
// logged; a private address of another network is 连不到, not down, and
// does not count (192.168.77.77: on none of this computer's networks; 10.255.255.1
// answers here, from somewhere in the provider's network). Deletes the two services and their log entries' cause;
// the log itself is left to the user's, cleared only when it was empty
// before.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  document.querySelector('.nav-item[data-id="services"]').click();
  await wait(400);
  const before = (await mygo.call("Services.Incidents")).length;
  const dead = await mygo.call("Services.Save", { id: "", name: "测试-死端口", kind: "tcp", target: "127.0.0.1:1", interval: 30, quiet: true });
  const far = await mygo.call("Services.Save", { id: "", name: "测试-别的网络", kind: "ping", target: "192.168.77.77", interval: 30, quiet: true });
  try {
    let list;
    for (let i = 0; i < 40; i++) {
      await wait(1000);
      list = await mygo.call("Services.List");
      const d = list.find((v) => v.id === dead.id).state, f = list.find((v) => v.id === far.id).state;
      if (d.status === "down" && d.history.length >= 2 && f.status !== "pending") break;
    }
    const d = list.find((v) => v.id === dead.id).state, f = list.find((v) => v.id === far.id).state;
    out.dead = [d.status, d.alert ?? false, d.message];
    out.far = [f.status, f.alert ?? false, f.message, f.history.length];
    out.others = list.filter((v) => !v.name.startsWith("测试-")).map((v) => v.state.status).join(",");
    await wait(600);
    const log = await mygo.call("Services.Incidents");
    out.log = [log.length - before, log[0]?.name, log[0]?.to];
    out.summary = document.querySelector(".sv-summary").textContent;
    out.logShown = [!document.querySelector(".sv-log").hidden, document.querySelector(".sv-inc")?.textContent.replace(/\s+/g, " ").trim()];
    out.farRow = document.querySelector(`.sv-item[data-id="${far.id}"]`)?.className + " | " + document.querySelector(`.sv-item[data-id="${far.id}"] .sv-msg`)?.textContent;
    out.alerts = (await mygo.call("Services.Alerts")).length;
  } finally {
    await mygo.call("Services.Delete", dead.id);
    await mygo.call("Services.Delete", far.id);
    if (!before) await mygo.call("Services.ClearIncidents");
  }
  await wait(400);
  out.left = [(await mygo.call("Services.List")).length, (await mygo.call("Services.Incidents")).length, document.querySelector(".sv-log").hidden];
  return out;
})();
