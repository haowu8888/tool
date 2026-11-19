// A fake Flow API on 127.0.0.1:18999 for the toolbox's Flow tool: one
// pipeline whose run goes from running to failed 15 seconds after start.
import http from "node:http";
const t0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const run = () => {
  const failed = Date.now() - t0 > 15000;
  return { id: "fr1", pipeline_id: "fp1", number: 42, status: failed ? "failed" : "running", trigger: "manual", created_by: "admin", created_at: iso(t0), started_at: iso(t0), ...(failed ? { finished_at: iso(t0 + 15000) } : {}) };
};
http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const json = (v) => (res.setHeader("Content-Type", "application/json"), res.end(JSON.stringify(v)));
    if (req.headers.authorization !== "Bearer fake") return (res.statusCode = 401), json({ error: "unauthenticated" });
    if (u.pathname === "/api/me") return json({ user: { username: "tester" } });
    if (u.pathname === "/api/pipelines/summary") return json([{ id: "fp1", name: "测试流水线", permissions: ["view"], recent_runs: [run()] }]);
    if (u.pathname === "/api/runs/fr1") {
      const r = run();
      return json({ run: r, jobs: [{ id: "fj1", name: "构建", stage: "build", status: r.status, exit_code: r.status === "failed" ? 1 : 0, started_at: r.started_at, finished_at: r.finished_at, steps: [{ name: "拉取" }, { name: "编译" }], step_states: [{ status: "success" }, { status: r.status }], outputs: {} }] });
    }
    if (u.pathname === "/api/jobs/fj1/logs") {
      const text = "$ go build\nmain.go:12: undefined: foo\n==> failed: exit status 1\n";
      const off = Number(u.searchParams.get("offset") || 0);
      res.setHeader("X-Next-Offset", String(Buffer.byteLength(text)));
      return res.end(Buffer.from(text).subarray(off));
    }
    res.statusCode = 404;
    json({ error: "not found" });
  })
  .listen(18999, "127.0.0.1");
setTimeout(() => process.exit(0), 180000);
