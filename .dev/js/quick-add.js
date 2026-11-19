// The quick-add box's reading of times, through its hint; nothing is added.
// 今晚 and 明晚 make the hour the evening's, 明早 the morning's.
//   node .dev/cdp.mjs @.dev/js/quick-add.js
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.nav-item[data-id="notes"]').click();
  await wait(300);
  document.querySelector('.n-tabs button[data-view="todos"]').click();
  await wait(100);
  const input = document.querySelector(".n-add input");
  const hint = (text) => {
    input.value = text;
    input.dispatchEvent(new Event("input"));
    return document.querySelector(".n-hint").textContent.trim();
  };
  const want = {
    "今晚8点 开会": "今天 20:00",
    "明晚9点半 看电影": "明天 21:30",
    "今晚12点 抢票": "明天 00:00",
    "明早6点 起床": "明天 06:00",
    "明天下午3点 开会": "明天 15:00",
    "今晚 取快递": "今天 20:00",
  };
  const failed = [];
  for (const [text, label] of Object.entries(want)) {
    const got = hint(text);
    if (!got.startsWith(label + " ")) failed.push(`${text} → ${got}`);
  }
  hint("");
  return failed.length ? { failed } : "ok";
})()
