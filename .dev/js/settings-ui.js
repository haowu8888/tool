(async () => {
  const out = {};
  const s0 = await mygo.call("Settings.Get");
  // Without the API keys: what this prints stays in logs.
  out.initial = { theme: s0.theme, closeAction: s0.closeAction, tools: s0.tools, homeTool: s0.homeTool };
  document.querySelector('.nav-item[data-id="settings"]').click();
  await new Promise((r) => setTimeout(r, 300));
  out.nav = [...document.querySelectorAll(".nav-item")].map((b) => b.textContent.trim());
  out.keys = [...document.querySelectorAll(".s-keys .s-row")].map((r) => r.innerText.replace(/\s+/g, " "));
  out.about = document.querySelector("#s-version").textContent + " " + document.querySelector("#s-dir").textContent;
  // theme
  document.querySelector('.s-seg[data-key=theme] button[data-value=dark]').click();
  await new Promise((r) => setTimeout(r, 500));
  out.dark = [document.documentElement.dataset.theme, matchMedia("(prefers-color-scheme: dark)").matches, getComputedStyle(document.body).backgroundColor];
  document.querySelector('.s-seg[data-key=theme] button[data-value=light]').click();
  await new Promise((r) => setTimeout(r, 500));
  out.light = [document.documentElement.dataset.theme, matchMedia("(prefers-color-scheme: dark)").matches, getComputedStyle(document.body).backgroundColor];
  // hide a tool and move one
  document.querySelector('.s-tools li[data-id="virtual-screen"] button[data-move=up]').click();
  await new Promise((r) => setTimeout(r, 400));
  const box = document.querySelector('.s-tools li[data-id="launcher"] input');
  box.checked = false; box.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  out.navAfter = [...document.querySelectorAll(".nav-item")].map((b) => b.textContent.trim());
  out.toolsList = [...document.querySelectorAll(".s-tools li")].map((li) => li.dataset.id + (li.querySelector("input").checked ? "" : "(hidden)"));
  out.saved = (await mygo.call("Settings.Get")).tools;
  // put things back
  await mygo.call("Settings.Save", Object.assign(await mygo.call("Settings.Get"), { theme: s0.theme, tools: s0.tools }));
  return JSON.stringify(out, null, 1);
})()
