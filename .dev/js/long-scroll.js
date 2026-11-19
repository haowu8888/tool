// Long screenshot test, step 3 (toolbox page): scrolls 设置 down 14 times by 110px; then Shot.ScrollState should be 14 steps taller.
(async () => {
  const el = window.__sc;
  for (let i = 0; i < 14; i++) {
    el.scrollTop += 110;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [el.scrollTop, el.scrollHeight, el.clientHeight];
})();
