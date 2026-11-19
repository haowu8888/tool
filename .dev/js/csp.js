// The page's Content-Security-Policy keeps script written into the page
// from running, as an onerror in HTML that a note or the AI brought.
//   node .dev/cdp.mjs @.dev/js/csp.js
(async () => {
  delete window.__ran;
  const box = document.createElement("div");
  box.innerHTML = `<img src="x:" onerror="window.__ran = 'onerror'"><a href="javascript:window.__ran = 'link'">x</a>`;
  document.body.append(box);
  box.querySelector("a").click();
  await new Promise((r) => setTimeout(r, 500));
  box.remove();
  return window.__ran ? "ran: " + window.__ran : "blocked";
})()
