// 开发工具「HTML 运行」: the page runs in the sandboxed frame, the
// console shows logs, objects and an error with its line, the frame
// cannot call Go or reach the app's page, and the code is kept. Puts the
// user's code back afterwards.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const errs = [];
  addEventListener("error", (e) => errs.push(e.message));
  const was = localStorage.getItem("dev-html");
  document.querySelector('.nav-item[data-id="dev"]').click();
  await wait(300);
  document.querySelector('.dv-tabs [data-tab="html"]').click();
  await wait(800);
  const set = (v) => {
    const el = document.querySelector(".dv-code");
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const logs = () => [...document.querySelectorAll(".dv-log-l")].map((l) => `${l.className.replace("dv-log-l ", "")}: ${l.textContent}`);
  set(
    [
      "<!doctype html>",
      "<style>p { color: rgb(1, 2, 3); }</style>",
      '<p id="p">hi</p>',
      "<script>",
      'console.log("文字", 1, { a: [1, "x"], m: new Map([[1, 2]]) }, document.getElementById("p"));',
      'console.warn("w");',
      'console.log("color", getComputedStyle(document.getElementById("p")).color);',
      'console.log("go", typeof window.mygo, typeof (window.chrome && window.chrome.webview));',
      'try { parent.document.title; console.log("parent: reachable"); } catch (e) { console.log("parent: blocked"); }',
      'try { localStorage.length; console.log("storage: yes"); } catch (e) { console.log("storage: blocked"); }',
      'fetch("http://mygo.localhost/").then(() => console.log("app fetch: ok"), () => console.log("app fetch: blocked"));',
      "undefinedFn(); // line 12",
      "</script>",
    ].join("\n"),
  );
  document.querySelector('.dv-run [data-do="run"]').click();
  await wait(1500);
  out.logs = logs();
  out.frame = document.querySelector(".dv-frame").src;
  out.saved = JSON.parse(localStorage.getItem("dev-html")).html.length;
  // Auto run after typing.
  set('<script>console.log("auto")</script>');
  await wait(1800);
  out.auto = logs();
  if (was === null) localStorage.removeItem("dev-html");
  else localStorage.setItem("dev-html", was);
  out.errs = errs;
  return JSON.stringify(out, null, 1);
})()
