// In the clipboard history's popup (?clips), after the shortcut brought it
// up: picks the first item, as Enter does, which pastes it where the user
// was. Returns what the popup listed.
(async () => {
  await new Promise((r) => setTimeout(r, 400));
  const first = document.querySelector(".cp-item.sel .cl-text")?.textContent;
  const focused = document.activeElement?.className;
  dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return { first, focused, rows: document.querySelectorAll(".cp-item").length };
})();
