// Long screenshot test, step 1 (toolbox page): opens 设置, whose panel scrolls, at its top.
(async () => {
  document.querySelector('.nav-item[data-id="settings"]').click();
  await new Promise((r) => setTimeout(r, 300));
  const els = [...document.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY));
  const el = els[0];
  el.scrollTop = 0;
  window.__sc = el;
  await mygo.call("Widget.Open");
  return els.map((e) => [e.className, e.scrollHeight, e.clientHeight]);
})();
