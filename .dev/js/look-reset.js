(async () => {
  document.querySelector("#s-look-reset").click();
  await new Promise((r) => setTimeout(r, 700));
  return JSON.stringify({ saved: (await mygo.call("Settings.Get")).appearance, bg: getComputedStyle(document.body).backgroundColor, accent: getComputedStyle(document.documentElement).getPropertyValue("--accent") });
})()
