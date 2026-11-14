// Flow's pipelines (https://flow.haowu.fun): their last runs, a run's
// jobs, steps, outputs and logs; run, cancel or retry one. A run that
// fails pops up beside the floating ball.
import { icons } from "./icons";
import { Flow, events, type FlowJob, type FlowPipeline, type FlowRun, type FlowRunDetail, type FlowState } from "./mygo";
import { ago, lasted } from "./services";
import { esc, onLeave, openDialog, showError, toast } from "./ui";

const statusNames: Record<string, string> = {
  pending: "等待",
  queued: "排队中",
  running: "运行中",
  waiting: "待审批",
  success: "成功",
  failed: "失败",
  skipped: "跳过",
  canceled: "已取消",
};
const triggerNames: Record<string, string> = { manual: "手动", webhook: "代码推送", cron: "定时", api: "接口", rollback: "回滚" };

// Outputs worth a name of their own; the rest show as they are.
const outputNames: [RegExp, string][] = [
  [/^CLOUDREVE_SHARE_URL$/, "云盘分享链接"],
  [/^CLOUDREVE_URL$/, "云盘目录"],
  [/^ARTIFACT_.+_URL$/, "产物下载"],
];

const done = (status: string) => ["success", "failed", "skipped", "canceled"].includes(status);

// took is how long a run or job took, or has taken so far.
function took(started?: number, finished?: number) {
  if (!started) return "";
  return lasted((finished || Date.now()) - started);
}

function runMeta(r: FlowRun) {
  return [
    `<b class="fl-s-${r.status}">${statusNames[r.status] ?? r.status}</b>`,
    `${triggerNames[r.trigger] ?? r.trigger}${r.createdBy ? ` ${esc(r.createdBy)}` : ""}`,
    ago(r.created),
    r.started ? `${done(r.status) ? "用时" : "已运行"} ${took(r.started, r.finished)}` : "",
    r.commit ? `<code>${esc(r.commit.slice(0, 7))}</code>` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// sync keeps box's children one per item, in order, reusing the element
// of each key: what is open inside one, as a log scrolled halfway, stays.
function sync<T>(box: HTMLElement, items: T[], key: (t: T) => string, make: (t: T) => HTMLElement, fill: (el: HTMLElement, t: T) => void) {
  const kids = [...box.children] as HTMLElement[];
  if (kids.length !== items.length || items.some((t, i) => kids[i]!.dataset.key !== key(t))) {
    const old = new Map(kids.map((el) => [el.dataset.key!, el]));
    box.replaceChildren(
      ...items.map((t) => {
        const el = old.get(key(t)) ?? make(t);
        el.dataset.key = key(t);
        return el;
      }),
    );
  }
  items.forEach((t, i) => fill(box.children[i] as HTMLElement, t));
}

// setHTML replaces el's content only when it changed, so that a button
// under the pointer is not swapped for an equal one every few seconds.
function setHTML(el: Element, html: string) {
  const e = el as Element & { _html?: string };
  if (e._html !== html) {
    e._html = html;
    el.innerHTML = html;
  }
}

export const flowTool = {
  id: "flow",
  name: "Flow 流水线",
  icon: icons.flow,
  render(p: HTMLElement) {
    p.innerHTML = `
      <div class="sv-top">
        <h1>Flow 流水线</h1>
        <span class="l-spacer"></span>
        <input class="fl-search" type="search" placeholder="搜索流水线" />
        <button class="fl-btn fl-refresh">刷新</button>
        <button class="fl-btn fl-web">打开 Flow</button>
        <button class="fl-btn fl-cfg">连接</button>
      </div>
      <p class="sv-summary fl-summary"></p>
      <div class="fl-list"></div>`;
    const list = p.querySelector<HTMLElement>(".fl-list")!;
    const search = p.querySelector<HTMLInputElement>(".fl-search")!;
    let state: FlowState = { configured: false, pipelines: [], alerts: [] } as unknown as FlowState;
    // What is open: one pipeline's run, and one of its jobs' log.
    let openPipe = "";
    let openRun = "";
    let detail: FlowRunDetail | null = null;
    let openJob = "";
    let logNext = 0;
    let logBusy = false;

    const shown = () => {
      const q = search.value.trim().toLowerCase();
      const ps = state.pipelines.filter((pl) => !q || [pl.name, pl.description ?? "", pl.group ?? ""].some((s) => s.toLowerCase().includes(q)));
      // Favorites first, archived last, otherwise as Flow lists them.
      const rank = (pl: FlowPipeline) => (pl.favorite ? 0 : pl.archived ? 2 : 1);
      return ps.map((pl, i) => [pl, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([pl]) => pl);
    };

    const render = () => {
      if (!list.isConnected) return;
      p.querySelector<HTMLElement>(".fl-refresh")!.hidden = !state.configured;
      p.querySelector<HTMLElement>(".fl-search")!.hidden = !state.configured || state.pipelines.length < 6;
      const summary = p.querySelector<HTMLElement>(".fl-summary")!;
      if (!state.configured) {
        summary.textContent = "";
        list.innerHTML = `
          <div class="l-empty">
            <p>连接 Flow 后，在这里看各条流水线最近的运行、日志和产物链接，一键运行；运行失败时悬浮球亮红点，旁边弹出提醒。</p>
            <p class="muted">需要一个 API 令牌：Flow → 右上角头像 → API 令牌 → 新建。</p>
            <p><button class="primary fl-connect">连接 Flow</button></p>
          </div>`;
        list.querySelector(".fl-connect")!.addEventListener("click", () => void configure());
        return;
      }
      const running = state.pipelines.filter((pl) => pl.runs[0] && !done(pl.runs[0].status)).length;
      const failed = state.pipelines.filter((pl) => pl.runs[0]?.status === "failed" && !pl.archived).length;
      summary.innerHTML = state.error
        ? `<span class="sv-bad">${esc(state.error)}</span>${state.pipelines.length ? "（下面是上次取到的）" : ""}`
        : `${state.pipelines.length} 条流水线${running ? ` · <span class="fl-s-running">${running} 条正在运行</span>` : ""}${failed ? ` · <span class="sv-bad">${failed} 条最近一次失败</span>` : ""}${state.checked ? ` · ${ago(state.checked)}更新` : ""}`;
      const ps = shown();
      if (!ps.length) {
        list.innerHTML = `<div class="l-empty"><p class="muted">${state.pipelines.length ? "没有匹配的流水线。" : state.error ? "" : "正在读取…"}</p></div>`;
        return;
      }
      if (list.querySelector(".l-empty")) list.innerHTML = "";
      sync(
        list,
        ps,
        (pl) => pl.id,
        () => {
          const el = document.createElement("div");
          el.className = "fl-item";
          el.innerHTML = `<div class="fl-row"></div><div class="fl-detail" hidden><div class="fl-d-head"></div><div class="fl-jobs"></div></div>`;
          return el;
        },
        (el, pl) => fillItem(el, pl),
      );
    };

    const fillItem = (el: HTMLElement, pl: FlowPipeline) => {
      const last = pl.runs[0];
      const status = last?.status ?? "none";
      el.className = `fl-item ${status}${pl.archived ? " archived" : ""}${pl.id === openPipe ? " open" : ""}`;
      setHTML(
        el.querySelector(".fl-row")!,
        `
        <span class="sv-dot" title="${last ? statusNames[status] ?? status : "还没运行过"}"></span>
        <div class="sv-main">
          <div class="sv-name">${pl.favorite ? `<span class="fl-fav" title="已收藏">★</span>` : ""}${esc(pl.name)}${pl.group ? `<span class="sv-kind">${esc(pl.group)}</span>` : ""}${pl.archived ? `<span class="sv-kind">已归档</span>` : ""}</div>
          <div class="sv-meta muted">${last ? `#${last.number} ${runMeta(last)}` : "还没运行过"}${pl.description ? ` · ${esc(pl.description)}` : ""}</div>
          ${last?.remark ? `<div class="fl-remark muted">备注：${esc(last.remark)}</div>` : ""}
        </div>
        <span class="fl-runs" title="最近 ${pl.runs.length} 次运行，点一下看详情">${[...pl.runs]
          .reverse()
          .map((r) => `<i class="fl-s-${r.status}${r.id === openRun ? " on" : ""}" data-run="${esc(r.id)}" title="#${r.number} ${statusNames[r.status] ?? r.status} · ${ago(r.created)}"></i>`)
          .join("")}</span>
        <div class="sv-acts">
          ${pl.canRun ? `<button data-act="run" title="运行这条流水线">运行</button>` : ""}
          ${pl.canRun && last && !done(last.status) ? `<button data-act="cancel" title="取消最近一次运行">取消</button>` : ""}
          ${pl.canRun && last?.status === "failed" ? `<button data-act="retry" title="重跑最近一次运行失败的任务">重试</button>` : ""}
          <button data-act="web" title="在浏览器里打开">↗</button>
        </div>`,
      );
      const box = el.querySelector<HTMLElement>(".fl-detail")!;
      box.hidden = pl.id !== openPipe;
      if (pl.id === openPipe) renderDetail(box, pl);
    };

    // ---- The open run ----
    const renderDetail = (box: HTMLElement, pl: FlowPipeline) => {
      const head = box.querySelector<HTMLElement>(".fl-d-head")!;
      const jobs = box.querySelector<HTMLElement>(".fl-jobs")!;
      if (!openRun) {
        setHTML(head, `<span class="muted">还没运行过。</span>`);
        jobs.replaceChildren();
        return;
      }
      if (!detail || detail.run.id !== openRun) {
        setHTML(head, `<span class="muted">正在读取…</span>`);
        jobs.replaceChildren();
        return;
      }
      const r = detail.run;
      setHTML(
        head,
        `<span><b>#${r.number}</b> ${runMeta(r)}${r.remark ? ` · 备注：${esc(r.remark)}` : ""}</span>
        <span class="l-spacer"></span>
        ${pl.canRun && !done(r.status) ? `<button class="fl-btn" data-act="cancel-run">取消</button>` : ""}
        ${pl.canRun && r.status === "failed" ? `<button class="fl-btn" data-act="retry-run">重试</button>` : ""}
        <button class="fl-btn" data-act="web-run">在 Flow 里看</button>`,
      );
      sync(
        jobs,
        detail.jobs,
        (j) => j.id,
        () => {
          const el = document.createElement("div");
          el.className = "fl-job";
          el.innerHTML = `<div class="fl-job-row"></div><div class="fl-outs"></div><div class="fl-logbox" hidden><div class="fl-log-bar"></div><pre class="fl-log"></pre></div>`;
          return el;
        },
        (el, j) => fillJob(el, j),
      );
    };

    const fillJob = (el: HTMLElement, j: FlowJob) => {
      el.className = `fl-job ${j.status}${j.id === openJob ? " open" : ""}`;
      setHTML(
        el.querySelector(".fl-job-row")!,
        `
        <span class="fl-caret">${j.id === openJob ? "▾" : "▸"}</span>
        <span class="sv-dot fl-s-${j.status}"></span>
        <span class="fl-job-name">${esc(j.name)}${j.stage ? `<span class="sv-kind">${esc(j.stage)}</span>` : ""}</span>
        <span class="fl-steps">${j.steps
          .map((s, i) => `<i class="fl-s-${s.status}" title="${i + 1}. ${esc(s.name)} · ${statusNames[s.status] ?? s.status}${s.started ? ` · ${took(s.started, s.finished)}` : ""}"></i>`)
          .join("")}</span>
        <span class="fl-job-st muted"><b class="fl-s-${j.status}">${statusNames[j.status] ?? j.status}</b>${j.status === "failed" && j.exitCode ? ` (退出码 ${j.exitCode})` : ""}${j.started ? ` · ${took(j.started, j.finished)}` : ""}</span>`,
      );
      // The outputs with a name of their own first, in its order; the rest
      // folded away.
      const rank = (k: string) => outputNames.findIndex(([re]) => re.test(k));
      const outs = Object.entries(j.outputs ?? {});
      const named = outs.filter(([k]) => rank(k) >= 0).sort(([a], [b]) => rank(a) - rank(b));
      const rest = outs.filter(([k]) => rank(k) < 0);
      const out = ([k, v]: [string, string]) =>
        `<div class="fl-out${rank(k) >= 0 ? " named" : ""}"><span class="fl-out-k" title="${esc(k)}">${esc(rank(k) >= 0 ? outputNames[rank(k)]![1] : k)}</span>${
          /^https?:\/\//.test(v)
            ? `<a class="fl-out-v" data-link="${esc(v)}" title="${esc(v)}">${esc(v)}</a><button data-copy="${esc(v)}">复制</button>`
            : `<span class="fl-out-v" title="${esc(v)}">${esc(v)}</span>`
        }</div>`;
      setHTML(
        el.querySelector(".fl-outs")!,
        named.map(out).join("") + (rest.length ? `<details class="fl-more"><summary class="muted">${named.length ? "其他输出" : "输出"} ${rest.length} 项</summary>${rest.map(out).join("")}</details>` : ""),
      );
      const box = el.querySelector<HTMLElement>(".fl-logbox")!;
      box.hidden = j.id !== openJob;
      if (j.id === openJob) {
        setHTML(box.querySelector(".fl-log-bar")!, `<span class="muted">${done(j.status) ? "日志" : "日志 · 正在运行，自动刷新"}</span><span class="l-spacer"></span><button data-copy-log>复制日志</button>`);
      }
    };

    // loadDetail fetches the open run, and the open log's new lines.
    const loadDetail = async () => {
      if (!openRun) return;
      const id = openRun;
      try {
        const d = await Flow.detail(id);
        if (id !== openRun) return;
        const first = !detail || detail.run.id !== id;
        detail = d;
        // A failed run opens on the log of the job that failed.
        if (first && !openJob) openJob = d.jobs.find((j) => j.status === "failed")?.id ?? "";
        if (first && openJob) logNext = 0;
        render();
        void loadLog();
      } catch (e) {
        showError(e);
      }
    };

    const loadLog = async () => {
      if (!openJob || logBusy) return;
      const job = openJob;
      const pre = list.querySelector<HTMLElement>(`.fl-job[data-key="${CSS.escape(job)}"] .fl-log`);
      if (!pre) return;
      logBusy = true;
      try {
        const from = logNext;
        const l = await Flow.log(job, from);
        if (job !== openJob) return;
        const stick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 24;
        if (from === 0) pre.textContent = l.cut ? "……前面的日志太长，只显示最后一段，完整日志在 Flow 里看\n" : "";
        if (l.text) pre.append(l.text);
        if (from === 0 && !pre.textContent) pre.textContent = "（还没有日志）";
        // A long log keeps its end.
        if ((pre.textContent?.length ?? 0) > 2_000_000) pre.textContent = pre.textContent!.slice(-1_000_000);
        logNext = l.next;
        if (stick || from === 0) pre.scrollTop = pre.scrollHeight;
      } catch (e) {
        showError(e);
      } finally {
        logBusy = false;
      }
    };

    const openRunOf = (pipe: string, run: string) => {
      if (openPipe === pipe && openRun === run) {
        openPipe = openRun = openJob = "";
        detail = null;
      } else {
        openPipe = pipe;
        openRun = run;
        openJob = "";
        detail = null;
      }
      render();
      void loadDetail();
    };

    // showRun opens a run, as the bubble's 看日志 asks.
    const showRun = async (id: string) => {
      if (!id) return;
      try {
        const d = await Flow.detail(id);
        openPipe = d.run.pipelineId;
        openRun = id;
        openJob = d.jobs.find((j) => j.status === "failed")?.id ?? "";
        logNext = 0;
        detail = d;
        render();
        list.querySelector<HTMLElement>(`.fl-item[data-key="${CSS.escape(openPipe)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
        void loadLog();
      } catch (e) {
        showError(e);
      }
    };

    list.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const item = t.closest<HTMLElement>(".fl-item");
      const pl = state.pipelines.find((pl) => pl.id === item?.dataset.key);
      if (!item || !pl) return;
      const copy = t.closest<HTMLElement>("[data-copy]");
      if (copy) {
        void navigator.clipboard.writeText(copy.dataset.copy!).then(() => toast("已复制"), showError);
        return;
      }
      if (t.closest("[data-copy-log]")) {
        const text = item.querySelector(".fl-job.open .fl-log")?.textContent ?? "";
        void navigator.clipboard.writeText(text).then(() => toast("已复制日志"), showError);
        return;
      }
      const link = t.closest<HTMLElement>("[data-link]");
      if (link) {
        void Flow.open(link.dataset.link!).catch(showError);
        return;
      }
      const dot = t.closest<HTMLElement>("[data-run]");
      if (dot) {
        openRunOf(pl.id, dot.dataset.run!);
        return;
      }
      const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
      const last = pl.runs[0];
      switch (act) {
        case "run":
          runPipeline(pl);
          return;
        case "cancel":
          if (last) void Flow.cancel(last.id).then(() => toast(`已取消 #${last.number}`), showError);
          return;
        case "retry":
          if (last) void Flow.retry(last.id).then(() => toast(`正在重试 #${last.number}`), showError);
          return;
        case "web":
          void Flow.open(`#/pipelines/${pl.id}`).catch(showError);
          return;
        case "cancel-run":
          void Flow.cancel(openRun).then(() => void loadDetail(), showError);
          return;
        case "retry-run":
          void Flow.retry(openRun).then(() => void loadDetail(), showError);
          return;
        case "web-run":
          void Flow.open(`#/runs/${openRun}`).catch(showError);
          return;
      }
      // A job's row opens or closes its log.
      const job = t.closest<HTMLElement>(".fl-job-row")?.parentElement?.dataset.key;
      if (job) {
        openJob = openJob === job ? "" : job;
        logNext = 0;
        render();
        void loadLog();
        return;
      }
      // The row opens the last run, or closes it.
      if (t.closest(".fl-row")) openRunOf(pl.id, pl.id === openPipe ? openRun : (last?.id ?? ""));
    });

    const runPipeline = (pl: FlowPipeline) => {
      const dlg = openDialog(`
        <form method="dialog">
          <h2>运行「${esc(pl.name)}」</h2>
          <label>备注<input name="remark" placeholder="可选，如 修复截图翻译" maxlength="200" /></label>
          <p class="muted n-tip">参数都用默认值；要改参数请在 Flow 里运行。</p>
          <p class="l-error" hidden></p>
          <div class="l-buttons"><span class="l-spacer"></span><button type="button" data-close>取消</button><button class="primary" type="submit">运行</button></div>
        </form>`);
      const form = dlg.querySelector("form")!;
      (form.elements.namedItem("remark") as HTMLInputElement).focus();
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const run = await Flow.trigger(pl.id, (form.elements.namedItem("remark") as HTMLInputElement).value);
          dlg.close();
          toast(`已开始 #${run.number}`);
          openPipe = pl.id;
          openRun = run.id;
          openJob = "";
          detail = null;
          render();
          void loadDetail();
        } catch (err) {
          const el = dlg.querySelector<HTMLElement>(".l-error")!;
          el.textContent = err instanceof Error ? err.message : String(err);
          el.hidden = false;
        }
      });
    };

    p.querySelector(".fl-refresh")!.addEventListener("click", () => {
      void Flow.refresh();
      void loadDetail();
    });
    p.querySelector(".fl-web")!.addEventListener("click", () => void Flow.open("").catch(showError));
    p.querySelector(".fl-cfg")!.addEventListener("click", () => void configure());
    search.addEventListener("input", render);

    onLeave(
      events.flowChanged.on((s) => {
        state = s;
        render();
        // The open run moved on: its jobs too.
        const r = state.pipelines.find((pl) => pl.id === openPipe)?.runs.find((r) => r.id === openRun);
        if (r && detail?.run.id === openRun && r.status !== detail.run.status) void loadDetail();
      }),
    );
    onLeave(events.flowFocus.on((id) => void Flow.takeFocus().then((f) => void showRun(f || id))));
    void Flow.state().then((s) => {
      state = s;
      render();
      void Flow.takeFocus().then(showRun);
    }, showError);
    void Flow.watch(true);
    onLeave(() => void Flow.watch(false));
    // A run that goes on: its jobs, steps and log move.
    const tick = setInterval(() => {
      if (detail && !done(detail.run.status)) void loadDetail();
      else if (openJob && detail?.jobs.some((j) => j.id === openJob && !done(j.status))) void loadLog();
    }, 3000);
    // The times say 3 分钟前: they move on.
    const slow = setInterval(render, 30000);
    onLeave(() => {
      clearInterval(tick);
      clearInterval(slow);
    });
  },
};

// configure asks for Flow's address and an API token.
async function configure() {
  const cfg = await Flow.config();
  const dlg = openDialog(`
    <form method="dialog">
      <h2>连接 Flow</h2>
      <label>地址<input name="url" required spellcheck="false" placeholder="https://flow.haowu.fun" /></label>
      <label>API 令牌<input name="token" type="password" autocomplete="off" spellcheck="false" placeholder="${cfg.hasToken ? "已保存，不改就留空" : "粘贴令牌"}" /></label>
      <p class="muted n-tip">在 Flow 里新建：右上角头像 → API 令牌 → 新建（有效期可选永不过期）。<a href="#" class="fl-mk">去 Flow 新建</a></p>
      <label class="l-check"><input type="checkbox" name="notify" /> 运行失败时在悬浮球旁提醒</label>
      <p class="l-error" hidden></p>
      <div class="l-buttons">${cfg.hasToken ? `<button type="button" class="fl-off">断开</button>` : ""}<span class="l-spacer"></span><button type="button" data-close>取消</button><button class="primary" type="submit">测试并保存</button></div>
    </form>`);
  const form = dlg.querySelector("form")!;
  const field = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
  field("url").value = cfg.url;
  field("notify").checked = cfg.notify;
  (cfg.hasToken ? field("url") : field("token")).focus();
  const error = (e: unknown) => {
    const el = dlg.querySelector<HTMLElement>(".l-error")!;
    el.textContent = e instanceof Error ? e.message : String(e);
    el.hidden = false;
  };
  dlg.querySelector(".fl-mk")!.addEventListener("click", (e) => {
    e.preventDefault();
    const base = field("url").value.trim().replace(/\/+$/, "");
    void Flow.open(`${/^https?:\/\//.test(base) ? base : "https://" + base}/#/tokens`).catch(error);
  });
  dlg.querySelector(".fl-off")?.addEventListener("click", () => {
    void Flow.disconnect().then(() => dlg.close(), error);
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    submit.disabled = true;
    try {
      const name = await Flow.setConfig(field("url").value, field("token").value, field("notify").checked);
      dlg.close();
      toast(`已连接，用户 ${name}`);
    } catch (err) {
      error(err);
    } finally {
      submit.disabled = false;
    }
  });
}
