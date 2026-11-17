// The chat with the floating ball's pet, in a small window beside it: a long
// press on the pet brings it up, and the AI of the settings answers as the
// pet. The chat stays in this browser's storage, the last turns of it.
import { AI, Notes, PetChat, events, type AIChatMessage, type AIChunkEvent, type WidgetSettings } from "./mygo";
import { backgroundURL } from "./appearance";
import { isDrawn, petSVG, pets } from "./pets";
import { onSettings, settings } from "./settings";
import { esc } from "./ui";
import ballIcon from "./assets/widget.png";

const storeKey = "pet-chat";
const keepTurns = 60;

type Turn = AIChatMessage & { error?: boolean };

function load(): Turn[] {
  try {
    const list = JSON.parse(localStorage.getItem(storeKey) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function store(turns: Turn[]) {
  try {
    localStorage.setItem(storeKey, JSON.stringify(turns.filter((t) => !t.error).slice(-keepTurns)));
  } catch {}
}

const suggestions = ["今天适合做点什么？", "帮我列一份周报提纲", "用一句话解释什么是 Docker", "讲个冷笑话"];

export function showPetChat(app: HTMLElement) {
  document.documentElement.classList.add("petchat");
  document.title = "和桌宠聊天";
  app.innerHTML = `
    <header class="pc-head">
      <span class="pc-avatar"></span>
      <span class="pc-name"></span>
      <span class="pc-model muted"></span>
      <button type="button" class="pc-clear" title="清空聊天">清空</button>
      <button type="button" class="pc-close" title="收起（Esc）"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="m4 4 8 8M12 4l-8 8"/></svg></button>
    </header>
    <div class="pc-list"></div>
    <form class="pc-input">
      <textarea rows="1" placeholder="说点什么…（Enter 发送）" title="Enter 发送，Shift+Enter 换行" maxlength="8000"></textarea>
      <button type="submit" class="primary pc-send">发送</button>
    </form>`;
  const list = app.querySelector<HTMLElement>(".pc-list")!;
  const input = app.querySelector<HTMLTextAreaElement>("textarea")!;
  const send = app.querySelector<HTMLButtonElement>(".pc-send")!;

  let turns = load();
  let pet = "ball";
  let busy: { id: string; turn: Turn } | null = null;

  // The header shows the pet the ball shows.
  const setPet = (w: WidgetSettings) => {
    pet = w.pet;
    const avatar = app.querySelector<HTMLElement>(".pc-avatar")!;
    avatar.innerHTML = isDrawn(w.pet)
      ? petSVG(w.pet, "idle")
      : w.pet === "custom" && w.image
      ? `<img src="${backgroundURL(w.image)}" alt="" />`
      : `<img class="pc-ball" src="${ballIcon}" alt="" />`;
    app.querySelector(".pc-name")!.textContent = isDrawn(w.pet) ? pets.find((p) => p.id === w.pet)!.name : "小助手";
    app.querySelector(".pc-model")!.textContent = settings.ai.model;
    if (!turns.length) render();
  };

  const render = () => {
    if (!turns.length) {
      list.innerHTML = `
        <div class="pc-empty">
          <div class="pc-empty-pet">${app.querySelector(".pc-avatar")!.innerHTML}</div>
          <p>有什么想聊的？<br /><span class="muted">长按桌面上的我，随时都能来找我</span></p>
          <div class="pc-sugs">${suggestions.map((s) => `<button type="button">${esc(s)}</button>`).join("")}</div>
        </div>`;
      return;
    }
    list.innerHTML = turns.map((t, i) => bubble(t, i)).join("");
    list.scrollTop = list.scrollHeight;
  };

  const bubble = (t: Turn, i: number) => {
    if (t.role === "user") return `<div class="pc-msg pc-user"><div class="pc-text">${esc(t.content)}</div></div>`;
    const waiting = busy?.turn === t && !t.content;
    const body = t.error
      ? `${esc(t.content)}${t.content.includes("设置") ? `<button type="button" class="pc-settings">去设置</button>` : ""}`
      : waiting
      ? `<span class="pc-dots"><i></i><i></i><i></i></span>`
      : markdown(t.content);
    const tools = !t.error && !waiting && busy?.turn !== t ? `<div class="pc-tools"><button type="button" data-copy="${i}">复制</button></div>` : "";
    return `<div class="pc-msg pc-ai${t.error ? " pc-error" : ""}"><div class="pc-text">${body}</div>${tools}</div>`;
  };

  // A chunk redraws only the last bubble, so that a long chat stays quick.
  const redrawLast = () => {
    const last = list.lastElementChild;
    const at = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    if (last) last.outerHTML = bubble(turns[turns.length - 1]!, turns.length - 1);
    if (at) list.scrollTop = list.scrollHeight;
  };

  const setBusy = () => {
    send.textContent = busy ? "停止" : "发送";
    send.classList.toggle("pc-stop", !!busy);
  };

  const ask = async (text: string) => {
    text = text.trim();
    if (!text || busy) return;
    turns.push({ role: "user", content: text });
    const turn: Turn = { role: "assistant", content: "" };
    turns.push(turn);
    busy = { id: "", turn };
    setBusy();
    render();
    input.value = "";
    fit();
    try {
      const id = await AI.chat({ messages: turns.slice(0, -1).filter((t) => !t.error).map(({ role, content }) => ({ role, content })), pet });
      if (busy?.turn === turn) busy.id = id;
    } catch (e) {
      finish(turn, e instanceof Error ? e.message : String(e));
    }
  };

  const finish = (turn: Turn, error?: string) => {
    if (error && turn.content) {
      turn.content += `\n\n（出错了：${error}）`;
    } else if (error) {
      turn.content = error;
      turn.error = true;
    } else if (!turn.content) {
      turn.content = "（没有回答）";
    }
    if (busy?.turn === turn) busy = null;
    setBusy();
    redrawLast();
    store(turns);
  };

  events.aiChunk.on((c: AIChunkEvent) => {
    if (!busy || c.id !== busy.id) return;
    const turn = busy.turn;
    if (c.text) {
      turn.content += c.text;
      redrawLast();
    }
    if (c.done) finish(turn, c.error);
  });

  // The input grows with what is typed, up to a few lines.
  const fit = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  };
  input.addEventListener("input", fit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void ask(input.value);
    }
  });
  app.querySelector("form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) {
      if (busy.id) void AI.cancel(busy.id);
      finish(busy.turn);
    } else void ask(input.value);
  });

  list.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const sug = el.closest<HTMLElement>(".pc-sugs button");
    if (sug) return void ask(sug.textContent ?? "");
    const copy = el.closest<HTMLElement>("[data-copy]");
    if (copy) {
      void navigator.clipboard.writeText(turns[+copy.dataset.copy!]?.content ?? "").then(() => {
        copy.textContent = "已复制";
        setTimeout(() => (copy.textContent = "复制"), 1200);
      });
      return;
    }
    if (el.closest(".pc-settings")) return void PetChat.openSettings();
    const a = el.closest<HTMLAnchorElement>("a[data-url]");
    if (a) {
      e.preventDefault();
      void Notes.openURL(a.dataset.url!);
    }
  });

  app.querySelector(".pc-clear")!.addEventListener("click", () => {
    if (busy?.id) void AI.cancel(busy.id);
    busy = null;
    setBusy();
    turns = [];
    store(turns);
    render();
    input.focus();
  });
  app.querySelector(".pc-close")!.addEventListener("click", () => void PetChat.hide());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") void PetChat.hide();
  });
  // The header moves the window.
  app.querySelector(".pc-head")!.addEventListener("pointerdown", (e) => {
    const ev = e as PointerEvent;
    if (ev.button === 0 && !(ev.target as HTMLElement).closest("button")) void PetChat.drag();
  });
  events.petChatOpened.on(() => {
    input.focus();
    list.scrollTop = list.scrollHeight;
  });

  setPet(settings.widget);
  onSettings((s) => setPet(s.widget));
  render();
  input.focus();
}

// markdown turns the AI's answer into HTML: code blocks, inline code, bold,
// headings, lists and links. Everything else is text, escaped.
export function markdown(src: string) {
  return src
    .split("```")
    .map((part, i) => (i % 2 ? `<pre><code>${esc(part.replace(/^[^\n]*\n?/, "").replace(/\n$/, ""))}</code></pre>` : inline(part)))
    .join("");
}

function inline(text: string) {
  return text
    .split("\n")
    .map((line) => {
      let h = esc(line)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, `<a href="$2" data-url="$2">$1</a>`);
      const head = /^#{1,6}\s+(.*)$/.exec(h);
      if (head) return `<b class="pc-h">${head[1]}</b>`;
      h = h.replace(/^\s*[-*]\s+/, "• ");
      return h;
    })
    .join("<br>")
    .replace(/^(<br>)+|(<br>)+$/g, "");
}
