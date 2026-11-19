// 设置 → AI 翻译: filled from the AI writing's with the button, and kept
// apart from it; 截图翻译's 「去设置」 opens it. Puts the translation's AI
// back afterwards.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const before = await mygo.call("Settings.Get");
  const out = {};
  document.querySelector('.nav-item[data-id="shot"]').click();
  await wait(300);
  const go = document.querySelector(".sh-ai-go");
  out.goButton = !!go || before.shot.engine !== "ai";
  if (go) go.click();
  else document.querySelector('.nav-item[data-id="settings"]').click();
  await wait(300);
  const sec = document.querySelector("#s-tr-ai");
  out.section = !!sec;
  out.inView = sec.getBoundingClientRect().top < innerHeight;
  document.querySelector(".s-tr-copy").click();
  await wait(400);
  const s = await mygo.call("Settings.Get");
  out.copied = JSON.stringify(s.shot.ai) === JSON.stringify(s.ai);
  out.field = document.querySelector("#s-tr-ai-url").value === (s.ai.baseUrl || "");
  document.querySelector("#s-tr-ai-model").value = "test-model";
  document.querySelector("#s-tr-ai-model").dispatchEvent(new Event("change"));
  await wait(400);
  const s2 = await mygo.call("Settings.Get");
  out.separate = s2.shot.ai.model === "test-model" && s2.ai.model === before.ai.model;
  await mygo.call("Settings.Save", { ...s2, shot: before.shot });
  document.querySelector("#s-tr-ai-model").value = before.shot.ai.model;
  return out;
})();
