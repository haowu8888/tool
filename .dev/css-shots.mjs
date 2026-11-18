// Screenshots of every tool page and of the small windows that are open,
// for comparing the look before and after a change of the styles:
//   node .dev/css-shots.mjs <label>     → .dev/css-shots/<label>/<page>.png
// The windows are as they are: run it twice with the same windows open.
import { mkdirSync, writeFileSync } from "node:fs";

const label = process.argv[2] ?? "now";
const dir = new URL(`./css-shots/${label}/`, import.meta.url);
mkdirSync(dir, { recursive: true });
const targets = (await (await fetch("http://127.0.0.1:9224/json")).json()).filter((t) => t.type === "page");

async function open(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const call = (method, params = {}) =>
    new Promise((ok, fail) => {
      setTimeout(() => fail(new Error(`${method} timed out on ${t.url}`)), 8000);
      const n = ++id;
      const on = (e) => {
        const m = JSON.parse(e.data);
        if (m.id !== n) return;
        ws.removeEventListener("message", on);
        ok(m.result);
      };
      ws.addEventListener("message", on);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const run = (expr) => call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }).then((r) => r?.result?.value);
  // A capture sometimes never comes back while the window repaints: again.
  const shot = async (name) => {
    let r;
    for (let i = 0; !r; i++) r = await call("Page.captureScreenshot", { format: "png" }).catch((e) => (i < 3 ? null : Promise.reject(e)));
    writeFileSync(new URL(`${name}.png`, dir), Buffer.from(r.data, "base64"));
  };
  return { ws, run, shot };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const main = targets.find((t) => /mygo\.localhost\/$/.test(t.url));
const m = await open(main);
// Still things: no caret, no animation, no toasts.
await m.run(`document.head.insertAdjacentHTML("beforeend", "<style id=css-shot>*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}</style>")`);
const ids = await m.run(`[...document.querySelectorAll(".nav-item")].map((b) => b.dataset.id)`);
for (const id of ids) {
  console.log(id);
  await m.run(`document.querySelector('.nav-item[data-id="${id}"]').click()`);
  await wait(900);
  await m.run(`document.querySelectorAll(".l-toast").forEach((t) => t.remove())`);
  await m.shot(id);
  if (id === "image")
    for (const v of ["collage", "merge", "edit"]) {
      await m.run(`document.querySelector('.iv-tabs [data-view="${v}"]').click()`);
      await wait(500);
      await m.shot(`image-${v}`);
    }
  if (id === "settings") {
    const h = await m.run(`document.querySelector(".panel").scrollHeight`);
    for (let y = 700, i = 2; y < h; y += 700, i++) {
      await m.run(`document.querySelector(".panel").scrollTop = ${y}`);
      await wait(200);
      await m.shot(`settings-${i}`);
    }
    await m.run(`document.querySelector(".panel").scrollTop = 0`);
  }
}
// A dialog.
await m.run(`document.querySelector('.nav-item[data-id="launcher"]').click()`);
await wait(500);
await m.run(`document.querySelector("#l-add, [data-act='add'], .l-actions .primary")?.click()`);
await wait(400);
await m.shot("dialog");
await m.run(`document.querySelector("dialog[open]")?.close(); document.getElementById("css-shot")?.remove()`);
m.ws.close();
for (const t of targets) {
  const q = new URL(t.url).search.slice(1).split("=")[0];
  if (!q || q === "shot") continue; // the screenshot windows wait hidden
  const w = await open(t);
  await w.run(`document.head.insertAdjacentHTML("beforeend", "<style id=css-shot>*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}</style>")`);
  await wait(200);
  await w.shot(`win-${q}`).catch((e) => console.log(e.message));
  await w.run(`document.getElementById("css-shot")?.remove()`);
  w.ws.close();
}
console.log("saved", dir.pathname);
