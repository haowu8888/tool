// Shows the 屏幕录制 tool and reports what it lists.
(async () => {
  document.querySelector('.nav-item[data-id="record"]').click();
  await new Promise((r) => setTimeout(r, 800));
  const p = document.querySelector(".panel") || document.body;
  return {
    title: document.querySelector("h1")?.textContent,
    dir: document.querySelector(".rc-dir")?.textContent,
    fps: [...document.querySelectorAll(".rc-fps button.on")].map((b) => b.textContent),
    checks: [...document.querySelectorAll(".rc-cursor,.rc-sound,.rc-mic")].map((c) => c.checked),
    list: document.querySelector(".rc-list")?.textContent.trim().slice(0, 200),
    state: await mygo.call("Record.State"),
  };
})();
