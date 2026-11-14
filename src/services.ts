// The service monitor: the user's web pages, ports and hosts, checked
// every little while, with the ones that go down popping up beside the
// floating ball; and the Tailscale network's devices.
import { icons } from "./icons";
import { Services, events, type Service, type ServiceIncident, type ServiceView, type TailscaleStatus } from "./mygo";
import { esc, onLeave, openDialog, showError, toast } from "./ui";

const kinds: Record<string, string> = { http: "网址", tcp: "端口", ping: "Ping" };
const intervals: [number, string][] = [
  [30, "30 秒"],
  [60, "1 分钟"],
  [300, "5 分钟"],
  [600, "10 分钟"],
];

function ago(ms?: number) {
  if (!ms) return "";
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

// clock is a time as 03:12, with 11-14 before it when not today.
function clock(ms: number) {
  const d = new Date(ms);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth() + 1}-${d.getDate()} ${hm}`;
}

// lasted is how long, as 40 秒, 12 分钟 or 3 小时 5 分钟.
function lasted(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${Math.max(s, 1)} 秒`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟`;
  if (m < 1440) return `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分钟` : ""}`;
  return `${Math.floor(m / 1440)} 天${Math.floor((m % 1440) / 60) ? ` ${Math.floor((m % 1440) / 60)} 小时` : ""}`;
}

// uptime is the share of the kept checks that went well.
function uptime(h: number[]) {
  if (!h.length) return "";
  const ok = h.filter((v) => v >= 0).length;
  const pct = (ok / h.length) * 100;
  return `${pct === 100 ? "100" : pct.toFixed(1)}%`;
}

// spark draws the last checks as bars: higher for slower, red for failed.
function spark(h: number[]) {
  const max = Math.max(100, ...h);
  const pad = Array(Math.max(0, 60 - h.length)).fill(null) as (number | null)[];
  return `<span class="sv-spark" title="最近 ${h.length} 次检查">${[...pad, ...h]
    .map((v) => (v === null ? `<i class="none"></i>` : v < 0 ? `<i class="bad"></i>` : `<i style="height:${Math.max(18, Math.round((v / max) * 100))}%"></i>`))
    .join("")}</span>`;
}

export const servicesTool = {
  id: "services",
  name: "服务监控",
  icon: icons.services,
  render(p: HTMLElement) {
    p.innerHTML = `
      <div class="sv-top">
        <h1>服务监控</h1>
        <span class="l-spacer"></span>
        <button class="sv-check-all">全部检查</button>
        <button class="primary sv-add">添加</button>
      </div>
      <p class="muted">定时检查网站、端口和主机是否在线。连续两次失败算掉线：悬浮球亮红点，旁边弹出提醒。</p>
      <p class="sv-summary"></p>
      <div class="sv-list"></div>
      <section class="s-group sv-log" hidden>
        <h2>掉线记录<span class="sv-log-n muted"></span><span class="l-spacer"></span><button class="sv-log-clear">清空</button></h2>
        <div class="s-card sv-log-list"></div>
      </section>
      <section class="s-group sv-ts">
        <h2>Tailscale<span class="sv-ts-state muted"></span><span class="l-spacer"></span><button class="sv-ts-refresh">刷新</button></h2>
        <div class="s-card sv-ts-list"><div class="s-row muted">正在读取…</div></div>
      </section>`;
    const list = p.querySelector<HTMLElement>(".sv-list")!;
    let views: ServiceView[] = [];

    const render = () => {
      if (!list.isConnected) return;
      const down = views.filter((v) => !v.paused && v.state.status === "down").length;
      const up = views.filter((v) => !v.paused && v.state.status === "up").length;
      const away = views.filter((v) => !v.paused && v.state.status === "away").length;
      p.querySelector(".sv-summary")!.innerHTML = views.length
        ? `${views.length} 个服务：<span class="sv-ok">${up} 正常</span>${down ? ` · <span class="sv-bad">${down} 掉线</span>` : ""}${away ? ` · ${away} 连不到（本机网络）` : ""}${views.some((v) => v.paused) ? ` · ${views.filter((v) => v.paused).length} 暂停` : ""}`
        : "";
      list.innerHTML = views.length
        ? views
            .map((v, i) => {
              const st = v.state;
              const status = v.paused ? "paused" : st.status;
              const label = { up: "正常", down: "掉线", pending: "检查中", paused: "已暂停", away: "连不到" }[status] ?? status;
              return `
          <div class="sv-item ${status}" data-id="${v.id}">
            <span class="sv-dot" title="${label}"></span>
            <div class="sv-main">
              <div class="sv-name">${esc(v.name)}<span class="sv-kind">${kinds[v.kind] ?? v.kind}</span>${v.quiet ? `<span class="sv-kind" title="掉线时不弹提醒">静默</span>` : ""}</div>
              <div class="sv-meta muted"><span class="sv-target" title="${esc(v.target)}">${esc(v.target)}</span> · 每 ${intervals.find(([s]) => s === v.interval)?.[1] ?? v.interval + " 秒"}${st.checked ? ` · ${ago(st.checked)}检查` : ""}${st.status !== "pending" && st.since ? ` · ${label} ${ago(st.since).replace("前", "")}` : ""}</div>
              ${st.message && !v.paused ? `<div class="sv-msg">${esc(st.message)}${status === "away" ? "，不算掉线，回到能连上的网络后接着检查" : ""}</div>` : ""}
            </div>
            ${spark(st.history)}
            <div class="sv-num"><b>${st.latency >= 0 && st.status === "up" ? `${st.latency} ms` : "—"}</b><span class="muted">${uptime(st.history)}</span></div>
            <div class="sv-acts">
              <button data-act="check" title="立即检查">检查</button>
              <button data-act="edit" title="编辑">编辑</button>
              <button data-act="pause" title="${v.paused ? "恢复检查" : "暂停检查"}">${v.paused ? "恢复" : "暂停"}</button>
              <button data-act="up" title="上移"${i === 0 ? " disabled" : ""}>↑</button>
              <button data-act="down" title="下移"${i === views.length - 1 ? " disabled" : ""}>↓</button>
              <button data-act="del" class="sv-del" title="删除">✕</button>
            </div>
          </div>`;
            })
            .join("")
        : `<div class="l-empty"><p>还没有要监控的服务。</p><p class="muted">点右上角「添加」，填网址（如 https://outline.haowu.fun）、主机:端口（如 192.168.1.209:3000）或 IP。也可以在下面的 Tailscale 设备旁点「监控」。</p></div>`;
    };

    list.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      const id = b?.closest<HTMLElement>(".sv-item")?.dataset.id;
      const v = views.find((v) => v.id === id);
      if (!b || !v) return;
      const svc: Service = { ...v };
      switch (b.dataset.act) {
        case "check":
          void Services.check(v.id);
          toast("正在检查…");
          break;
        case "edit":
          editService(svc);
          break;
        case "pause":
          void Services.save({ ...svc, paused: !v.paused }).catch(showError);
          break;
        case "up":
        case "down":
          void Services.move(v.id, b.dataset.act === "up" ? -1 : 1);
          break;
        case "del":
          void Services.delete(v.id).then(() => toast(`已删除「${v.name}」`, { label: "撤销", run: () => void Services.save({ ...svc, id: "" }).catch(showError) }));
          break;
      }
    });
    p.querySelector(".sv-add")!.addEventListener("click", () => editService(null));
    p.querySelector(".sv-check-all")!.addEventListener("click", () => {
      void Services.check("");
      toast("正在检查全部…");
    });

    // ---- The log of the times a service was down ----
    const logBox = p.querySelector<HTMLElement>(".sv-log")!;
    const logShown = 20;
    let incidents: ServiceIncident[] = [];
    const renderLog = () => {
      logBox.hidden = !incidents.length;
      p.querySelector(".sv-log-n")!.textContent = incidents.length > logShown ? `最近 ${logShown} 次，共 ${incidents.length} 次` : `${incidents.length} 次`;
      p.querySelector(".sv-log-list")!.innerHTML = incidents
        .slice(0, logShown)
        .map((i) => {
          const end = i.to > 0 ? `${clock(i.to)} 恢复，掉线 ${lasted(i.to - i.from)}` : i.to === 0 ? `<span class="sv-bad">还没恢复，已经 ${lasted(Date.now() - i.from)}</span>` : "之后工具箱关了，不知道什么时候恢复的";
          return `<div class="s-row sv-inc"><span><b>${esc(i.name)}</b><small class="muted">${esc(i.message ?? "")}</small></span><span class="sv-inc-when">${clock(i.from)} 掉线 · ${end}</span></div>`;
        })
        .join("");
    };
    const loadLog = () =>
      void Services.incidents().then((list) => {
        incidents = list ?? [];
        renderLog();
      }, showError);
    p.querySelector(".sv-log-clear")!.addEventListener("click", () => void Services.clearIncidents().catch(showError));

    onLeave(
      events.servicesChanged.on((list) => {
        views = list ?? [];
        render();
        loadLog();
      }),
    );
    void Services.list().then((list) => {
      views = list ?? [];
      render();
      loadLog();
    }, showError);
    // The times say 刚刚 and 3 分钟前: they move on.
    const tick = setInterval(() => {
      render();
      renderLog();
    }, 30000);
    onLeave(() => clearInterval(tick));

    // ---- Tailscale ----
    const tsList = p.querySelector<HTMLElement>(".sv-ts-list")!;
    const tsState = p.querySelector<HTMLElement>(".sv-ts-state")!;
    let ts: TailscaleStatus | null = null;
    const renderTS = () => {
      if (!ts) return;
      if (!ts.installed) {
        p.querySelector<HTMLElement>(".sv-ts")!.hidden = true;
        return;
      }
      const online = ts.peers.filter((d) => d.online && !d.self).length;
      tsState.textContent = ts.error ? "" : `${{ Running: "已连接", Stopped: "已断开", NeedsLogin: "需要登录", Starting: "正在连接" }[ts.state] ?? ts.state} · ${online}/${ts.peers.length - 1} 台在线`;
      const watched = new Set(views.map((v) => v.target));
      tsList.innerHTML = ts.error
        ? `<div class="s-row s-bad">${esc(ts.error)}</div>`
        : ts.peers
            .map(
              (d) => `
          <div class="s-row sv-peer${d.online ? " on" : ""}">
            <span><b class="sv-peer-name"><span class="sv-dot"></span>${esc(d.name)}${d.self ? `<span class="sv-kind">本机</span>` : ""}</b><small class="muted">${esc(d.os)} · ${esc(d.ip)}</small></span>
            <span class="sv-peer-r">${d.online ? "在线" : `<span class="muted">离线</span>`}${
              d.self || !d.ip ? "" : watched.has(d.ip) ? `<button disabled>已监控</button>` : `<button data-watch="${esc(d.ip)}" data-name="${esc(d.name)}">监控</button>`
            }</span>
          </div>`,
            )
            .join("");
    };
    tsList.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-watch]");
      if (!b) return;
      void Services.save({ id: "", name: `${b.dataset.name}（Tailscale）`, kind: "ping", target: b.dataset.watch!, interval: 60 })
        .then(() => toast("已加到监控列表"))
        .catch(showError);
    });
    const loadTS = () =>
      void Services.tailscale().then((s) => {
        ts = s;
        renderTS();
      }, showError);
    p.querySelector(".sv-ts-refresh")!.addEventListener("click", loadTS);
    onLeave(events.servicesChanged.on(() => renderTS()));
    loadTS();
    const tsTick = setInterval(loadTS, 30000);
    onLeave(() => clearInterval(tsTick));
  },
};

// editService adds a service, for null, or edits one.
function editService(svc: Service | null) {
  const dlg = openDialog(`
    <form method="dialog">
      <h2>${svc ? "编辑服务" : "添加服务"}</h2>
      <label>类型<span class="s-seg sv-kinds">${Object.entries(kinds)
        .map(([k, n]) => `<button type="button" data-kind="${k}">${n}</button>`)
        .join("")}</span></label>
      <label>地址<input name="target" required spellcheck="false" autocomplete="off" /></label>
      <p class="muted n-tip sv-hint"></p>
      <label>名称<input name="name" placeholder="可选，不填用地址" maxlength="60" /></label>
      <label>检查间隔<select name="interval">${intervals.map(([s, n]) => `<option value="${s}">${n}</option>`).join("")}</select></label>
      <label class="sv-http">页面要包含的文字<input name="keyword" placeholder="可选，如 Outline；页面没有它就算掉线" /></label>
      <label class="l-check sv-http"><input type="checkbox" name="insecure" /> 忽略证书错误（自签名证书，如 NAS）</label>
      <label class="l-check"><input type="checkbox" name="quiet" /> 掉线时不弹提醒（只在这里显示）</label>
      <p class="l-error" hidden></p>
      <div class="l-buttons"><span class="l-spacer"></span><button type="button" data-close>取消</button><button class="primary" type="submit">保存</button></div>
    </form>`);
  const form = dlg.querySelector("form")!;
  const field = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
  let kind = svc?.kind ?? "http";
  const hints: Record<string, [string, string]> = {
    http: ["https://outline.haowu.fun", "打开网页，返回 400 以上的状态码或连不上算失败；会跟随跳转"],
    tcp: ["192.168.1.209:3000", "连接这个端口，连得上就算在线（数据库、SSH、内网服务都行）"],
    ping: ["192.168.1.209", "Ping 这台主机（有的服务器或防火墙会不回 Ping）"],
  };
  const renderKind = () => {
    dlg.querySelectorAll<HTMLElement>(".sv-kinds button").forEach((b) => b.classList.toggle("on", b.dataset.kind === kind));
    dlg.querySelectorAll<HTMLElement>(".sv-http").forEach((el) => (el.hidden = kind !== "http"));
    field("target").placeholder = hints[kind]![0];
    dlg.querySelector(".sv-hint")!.textContent = hints[kind]![1];
  };
  dlg.querySelectorAll<HTMLElement>(".sv-kinds button").forEach((b) =>
    b.addEventListener("click", () => {
      kind = b.dataset.kind!;
      renderKind();
    }),
  );
  field("target").value = svc?.target ?? "";
  field("name").value = svc?.name ?? "";
  (form.elements.namedItem("interval") as HTMLSelectElement).value = String(svc?.interval ?? 60);
  field("keyword").value = svc?.keyword ?? "";
  field("insecure").checked = !!svc?.insecure;
  field("quiet").checked = !!svc?.quiet;
  renderKind();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await Services.save({
        ...(svc ?? { id: "" }),
        kind,
        target: field("target").value,
        name: field("name").value,
        interval: Number((form.elements.namedItem("interval") as HTMLSelectElement).value),
        keyword: kind === "http" ? field("keyword").value : "",
        insecure: kind === "http" && field("insecure").checked,
        quiet: field("quiet").checked,
      } as Service);
      dlg.close();
    } catch (err) {
      const p = dlg.querySelector<HTMLElement>(".l-error")!;
      p.textContent = err instanceof Error ? err.message : String(err);
      p.hidden = false;
    }
  });
}
