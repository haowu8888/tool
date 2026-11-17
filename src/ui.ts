// Helpers the tools' pages share: escaping, dialogs and toasts.

// openDialog shows a modal dialog and removes it once closed.
export function openDialog(html: string) {
  const dlg = document.createElement("dialog");
  dlg.className = "l-dialog";
  dlg.innerHTML = html;
  document.body.append(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dlg.close()));
  dlg.showModal();
  // A titled dialog gets a ✕ beside its title, which stays put as it
  // scrolls; added once open, so the first field still takes the focus.
  const x = document.createElement("button");
  x.type = "button";
  x.className = "l-dlg-x";
  x.title = "关闭（Esc）";
  x.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>`;
  x.addEventListener("click", () => dlg.close());
  dlg.querySelector("h2:first-child")?.append(x);
  return dlg;
}

// onLeave runs fn when the toolbox shows another tool: a tool's page
// takes its listeners away with it, or every visit would leave one more
// behind, holding on to a page that is gone.
const leaving: (() => void)[] = [];

export function onLeave(fn: () => void) {
  leaving.push(fn);
}

export function leave() {
  for (const fn of leaving.splice(0)) fn();
}

// toast shows a short message at the bottom, with a button such as 撤销
// when given an action.
export function toast(text: string, action?: { label: string; run: () => void }) {
  document.querySelector(".l-toast")?.remove();
  const t = document.createElement("div");
  t.className = "l-toast";
  t.textContent = text;
  if (action) {
    const b = document.createElement("button");
    b.textContent = action.label;
    b.addEventListener("click", () => {
      t.remove();
      action.run();
    });
    t.append(b);
  }
  document.body.append(t);
  setTimeout(() => t.remove(), action ? 5000 : 2200);
}

export function showError(e: unknown) {
  toast(errorText(e));
}

export function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// chime plays two soft notes, should the browser let a page without a click
// make sounds.
export function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      const at = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.18, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(at);
      o.stop(at + 0.65);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch {}
}

// lightbox shows images full size, with the arrow keys going through them.
export function lightbox(srcs: string[], at = 0) {
  const box = document.createElement("div");
  box.className = "e-lightbox";
  const show = () => {
    box.innerHTML = srcs.length > 1 ? `<span class="e-lb-count">${at + 1} / ${srcs.length}</span>` : "";
    const img = document.createElement("img");
    img.src = srcs[at] ?? "";
    img.alt = "";
    box.prepend(img);
  };
  const close = () => {
    box.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault(); // a dialog under it stays open
      close();
    }
    else if (e.key === "ArrowRight") (at = (at + 1) % srcs.length), show();
    else if (e.key === "ArrowLeft") (at = (at + srcs.length - 1) % srcs.length), show();
  };
  box.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);
  // Over a dialog, it goes in it: a modal dialog is above everything else.
  (document.querySelector("dialog[open]") ?? document.body).append(box);
  show();
}

// baseName returns a path's file name without its extension, or a URL's
// host.
export function baseName(path: string) {
  if (path.includes("://")) {
    try {
      return new URL(path).hostname;
    } catch {}
  }
  const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
  return name.replace(/(\.exe)?\.(exe|lnk|url|bat|cmd|appref-ms|msc)$/i, "") || path;
}
