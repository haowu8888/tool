// 模拟已选背景图（bg-test.jpg 已放进 %APPDATA%\Toolbox\appearance）
(async () => {
  const r = document.documentElement;
  r.dataset.bg = "";
  r.style.setProperty("--bg-image", 'url("http://appearance.localhost/bg-test.jpg")');
  r.style.setProperty("--bg-opacity", "0.5");
  r.style.setProperty("--bg-dim", "40%");
  r.style.setProperty("--bg-blur", "0px");
  r.style.setProperty("--card-alpha", "80%");
  await new Promise((res) => setTimeout(res, 800));
  const ok = await fetch("http://appearance.localhost/bg-test.jpg").then((x) => x.status);
  return JSON.stringify({ ok, before: getComputedStyle(document.body, "::before").backgroundImage.slice(0, 60), card: getComputedStyle(document.querySelector(".s-card")).backgroundColor });
})()
