(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.nav-item[data-id="flow"]').click();
  await wait(300);
  const name = await mygo.call("Flow.SetConfig", "http://127.0.0.1:18999", "fake", true);
  await wait(3000);
  return [name, document.querySelector(".fl-summary").textContent, document.querySelector(".fl-item .sv-meta")?.textContent];
})()
