// Evaluates a JS expression in the app's page over the WebView2 debug port:
//   node .dev/cdp.mjs '<expression>' [url-substring]
// An expression of "@file" is read from that file, which spares the shells'
// quoting.
// The default page is the toolbox's, not a black window's about:blank. `mygo.call`
// reaches the Go services, e.g. mygo.call("Blackout.Start").
// "--shot <file.png>" saves a screenshot of the page instead; the url
// substring "widget" picks the floating ball's page.
import { readFileSync, writeFileSync } from "node:fs";

let [expr, match] = process.argv.slice(2);
const shot = expr === "--shot";
if (shot) match = process.argv[4];
if (expr?.startsWith("@")) expr = readFileSync(expr.slice(1), "utf8");
const targets = await (await fetch("http://127.0.0.1:9224/json")).json();
const pages = targets.filter((t) => t.type === "page");
if (!expr) {
  for (const t of pages) console.log(t.url);
  process.exit(0);
}
const page = pages.find((t) => (match ? t.url.includes(match) : t.url.includes("mygo.localhost") && !t.url.includes("?")));
if (!page) throw new Error("no page; pages: " + pages.map((t) => t.url).join(", "));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
ws.send(JSON.stringify(shot
  ? { id: 1, method: "Page.captureScreenshot", params: { format: "png" } }
  : { id: 1, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }));
const msg = await new Promise((r) => ws.addEventListener("message", (e) => r(JSON.parse(e.data)), { once: true }));
if (shot) {
  writeFileSync(process.argv[3], Buffer.from(msg.result.data, "base64"));
  console.log("saved", process.argv[3]);
} else {
  console.log(JSON.stringify(msg.result?.result?.value ?? msg.result?.exceptionDetails ?? msg));
}
ws.close();
