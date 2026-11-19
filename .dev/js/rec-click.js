// Clicks a button of the recording panel: set ACT.
(async () => {
  document.querySelector('[data-act="ACT"]').click();
  await new Promise((r) => setTimeout(r, 1500));
  return { state: await mygo.call("Record.State"), text: document.querySelector("#app").innerText.replace(/\s+/g, " "), size: [innerWidth, innerHeight] };
})();
