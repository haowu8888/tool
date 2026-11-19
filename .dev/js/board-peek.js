(async () => {
  const id = window.__bdSample.issues[4];
  document.querySelector(`.bd-card[data-id="${id}"]`).click();
  await new Promise((r) => setTimeout(r, 300));
  return document.querySelector(".bd-peek").hidden;
})()
