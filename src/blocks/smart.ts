// Blocks with their own little app, as in the user's Outline: 看板,
// 日历, 投票, 打卡 and 加密文本. One node type, whose kind picks the app
// and whose JSON data the app reads and writes.
import { Node, mergeAttributes } from "@tiptap/core";
import { esc } from "../ui";
import { ask, h, interactive, json, removeNode, setAttrs, uid } from "./util";

type Save = (data: unknown) => void;

interface App {
  title: string;
  initial(): unknown;
  // draw fills root from data; save stores new data, which draws again.
  draw(root: HTMLElement, data: any, save: Save, state: Record<string, any>): void;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ---- 看板 ----

interface Card {
  id: string;
  text: string;
}
interface List {
  id: string;
  title: string;
  cards: Card[];
}

const kanban: App = {
  title: "📋 看板",
  initial: () => ({ lists: ["待办", "进行中", "已完成"].map((title) => ({ id: uid(), title, cards: [] })) }),
  draw(root, data: { lists: List[] }, save) {
    const lists = data.lists;
    root.innerHTML = `
      <div class="k-board">${lists
        .map(
          (l) => `
          <div class="k-list" data-l="${l.id}">
            <div class="k-list-head"><input class="k-title" value="${esc(l.title)}" data-ltitle="${l.id}" /><span class="muted">${l.cards.length}</span><button data-ldel="${l.id}" title="删除这一列">✕</button></div>
            <div class="k-cards" data-l="${l.id}">${l.cards
              .map((c) => `<div class="k-card" draggable="true" data-c="${c.id}" data-stop><span class="k-text">${esc(c.text)}</span><button data-cdel="${c.id}" title="删除">✕</button></div>`)
              .join("")}</div>
            <input class="k-add" placeholder="+ 添加卡片，回车" data-ladd="${l.id}" />
          </div>`,
        )
        .join("")}<button class="k-newlist" data-act="newlist">+ 新列</button></div>`;
    const clone = (): List[] => structuredClone(lists);
    root.querySelectorAll<HTMLInputElement>("[data-ltitle]").forEach((i) =>
      i.addEventListener("change", () => {
        const ls = clone();
        ls.find((l) => l.id === i.dataset.ltitle)!.title = i.value;
        save({ lists: ls });
      }),
    );
    root.querySelectorAll<HTMLInputElement>("[data-ladd]").forEach((i) =>
      i.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || !i.value.trim()) return;
        e.preventDefault();
        const ls = clone();
        ls.find((l) => l.id === i.dataset.ladd)!.cards.push({ id: uid(), text: i.value.trim() });
        save({ lists: ls });
        setTimeout(() => root.querySelector<HTMLInputElement>(`[data-ladd="${i.dataset.ladd}"]`)?.focus(), 0);
      }),
    );
    root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const ls = clone();
      if (t.dataset.ldel) {
        save({ lists: ls.filter((l) => l.id !== t.dataset.ldel) });
      } else if (t.dataset.cdel) {
        for (const l of ls) l.cards = l.cards.filter((c) => c.id !== t.dataset.cdel);
        save({ lists: ls });
      } else if (t.closest("[data-act=newlist]")) {
        ls.push({ id: uid(), title: "新列", cards: [] });
        save({ lists: ls });
      }
    });
    root.querySelectorAll<HTMLElement>(".k-text").forEach((span) =>
      span.addEventListener("dblclick", async () => {
        const id = span.closest<HTMLElement>("[data-c]")!.dataset.c;
        const v = await ask("修改卡片", span.textContent ?? "");
        if (v === null) return;
        const ls = clone();
        for (const l of ls) {
          const c = l.cards.find((c) => c.id === id);
          if (c) c.text = v.trim() || c.text;
        }
        save({ lists: ls });
      }),
    );
    // Cards move by dragging, between and within the lists.
    let dragged = "";
    root.querySelectorAll<HTMLElement>(".k-card").forEach((c) => {
      c.addEventListener("dragstart", (e) => {
        dragged = c.dataset.c!;
        e.dataTransfer!.effectAllowed = "move";
        e.dataTransfer!.setData("text/plain", dragged);
        c.classList.add("dragging");
      });
      c.addEventListener("dragend", () => c.classList.remove("dragging"));
    });
    root.querySelectorAll<HTMLElement>(".k-cards").forEach((zone) => {
      zone.addEventListener("dragover", (e) => {
        if (!dragged) return;
        e.preventDefault();
        zone.classList.add("drop");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("drop"));
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("drop");
        if (!dragged) return;
        const ls = clone();
        let card: Card | undefined;
        for (const l of ls) {
          const i = l.cards.findIndex((c) => c.id === dragged);
          if (i >= 0) card = l.cards.splice(i, 1)[0];
        }
        if (!card) return;
        const target = ls.find((l) => l.id === zone.dataset.l)!;
        const before = (e.target as HTMLElement).closest<HTMLElement>("[data-c]")?.dataset.c;
        const at = target.cards.findIndex((c) => c.id === before);
        target.cards.splice(at < 0 ? target.cards.length : at, 0, card);
        dragged = "";
        save({ lists: ls });
      });
    });
  },
};

// ---- 日历 ----

const calendar: App = {
  title: "📅 日历",
  initial: () => ({ events: {} }),
  draw(root, data: { events: Record<string, Card[]> }, save, state) {
    const now = new Date();
    state.month ??= new Date(now.getFullYear(), now.getMonth(), 1);
    const month: Date = state.month;
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7)); // from Monday
    const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const today = ymd(now);
    root.innerHTML = `
      <div class="c-head"><button data-act="prev">‹</button><b>${month.getFullYear()} 年 ${month.getMonth() + 1} 月</b><button data-act="next">›</button><button data-act="today">今天</button><span class="muted">点日期添加日程，点日程修改</span></div>
      <div class="c-grid">${"一二三四五六日"
        .split("")
        .map((d) => `<div class="c-wd">${d}</div>`)
        .join("")}${days
        .map((d) => {
          const key = ymd(d);
          const evs = data.events[key] ?? [];
          return `<div class="c-day${d.getMonth() !== month.getMonth() ? " other" : ""}${key === today ? " today" : ""}" data-day="${key}" data-stop><span class="c-num">${d.getDate()}</span>${evs.map((ev) => `<span class="c-ev" data-ev="${ev.id}">${esc(ev.text)}</span>`).join("")}</div>`;
        })
        .join("")}</div>`;
    root.querySelector(".c-head")!.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).dataset.act;
      if (!act) return;
      state.month = act === "today" ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(month.getFullYear(), month.getMonth() + (act === "next" ? 1 : -1), 1);
      calendar.draw(root, data, save, state);
    });
    root.querySelectorAll<HTMLElement>(".c-day").forEach((cell) =>
      cell.addEventListener("click", async (e) => {
        const key = cell.dataset.day!;
        const events = structuredClone(data.events);
        const evID = (e.target as HTMLElement).dataset.ev;
        if (evID) {
          const ev = events[key]!.find((x) => x.id === evID)!;
          const v = await ask(`${key} 的日程（清空即删除）`, ev.text);
          if (v === null) return;
          if (v.trim()) ev.text = v.trim();
          else events[key] = events[key]!.filter((x) => x.id !== evID);
        } else {
          const v = await ask(`在 ${key} 添加日程`, "", "例如：14:00 项目评审");
          if (!v?.trim()) return;
          (events[key] ??= []).push({ id: uid(), text: v.trim() });
        }
        if (!events[key]?.length) delete events[key];
        save({ events });
      }),
    );
  },
};

// ---- 投票 ----

interface Option {
  id: string;
  text: string;
  votes: number;
}

const poll: App = {
  title: "🗳 投票",
  initial: () => ({ question: "", options: [{ id: uid(), text: "选项一", votes: 0 }, { id: uid(), text: "选项二", votes: 0 }], voted: "" }),
  draw(root, data: { question: string; options: Option[]; voted: string }, save, state) {
    const total = data.options.reduce((n, o) => n + o.votes, 0);
    const editing = !!state.editing;
    root.innerHTML = `
      <input class="p-question" placeholder="投票的问题，例如：周五团建去哪？" value="${esc(data.question)}" />
      <div class="p-options">${data.options
        .map((o) => {
          const pct = total ? Math.round((o.votes / total) * 100) : 0;
          return editing
            ? `<div class="p-edit"><input value="${esc(o.text)}" data-otext="${o.id}" /><button data-odel="${o.id}">✕</button></div>`
            : `<button class="p-option${data.voted === o.id ? " voted" : ""}" data-vote="${o.id}"><span class="p-bar" style="width:${pct}%"></span><span class="p-text">${data.voted === o.id ? "✓ " : ""}${esc(o.text)}</span><span class="p-count">${o.votes} 票 · ${pct}%</span></button>`;
        })
        .join("")}</div>
      <div class="p-foot">${editing ? `<input class="p-add" placeholder="+ 添加选项，回车" /><button data-act="done">完成</button>` : `<span class="muted">共 ${total} 票${data.voted ? " · 再点一次取消投票" : ""}</span><span class="l-spacer"></span><button data-act="edit">编辑选项</button><button data-act="reset">清空票数</button>`}</div>`;
    root.querySelector<HTMLInputElement>(".p-question")!.addEventListener("change", (e) => save({ ...data, question: (e.target as HTMLInputElement).value }));
    root.querySelectorAll<HTMLInputElement>("[data-otext]").forEach((i) =>
      i.addEventListener("change", () => save({ ...data, options: data.options.map((o) => (o.id === i.dataset.otext ? { ...o, text: i.value } : o)) })),
    );
    root.querySelector<HTMLInputElement>(".p-add")?.addEventListener("keydown", (e) => {
      const i = e.target as HTMLInputElement;
      if (e.key !== "Enter" || !i.value.trim()) return;
      e.preventDefault();
      save({ ...data, options: [...data.options, { id: uid(), text: i.value.trim(), votes: 0 }] });
      setTimeout(() => root.querySelector<HTMLInputElement>(".p-add")?.focus(), 0);
    });
    root.querySelector(".p-options")!.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-vote], [data-odel]");
      if (!t) return;
      if (t.dataset.odel) return save({ ...data, options: data.options.filter((o) => o.id !== t.dataset.odel) });
      const id = t.dataset.vote!;
      const options = data.options.map((o) => ({ ...o, votes: o.votes - (o.id === data.voted ? 1 : 0) + (o.id === id && data.voted !== id ? 1 : 0) }));
      save({ ...data, options, voted: data.voted === id ? "" : id });
    });
    root.querySelector(".p-foot")!.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).dataset.act;
      if (act === "edit" || act === "done") {
        state.editing = act === "edit";
        poll.draw(root, data, save, state);
      } else if (act === "reset") save({ ...data, options: data.options.map((o) => ({ ...o, votes: 0 })), voted: "" });
    });
  },
};

// ---- 打卡 ----

const checkin: App = {
  title: "✅ 打卡",
  initial: () => ({ title: "", days: [] }),
  draw(root, data: { title: string; days: string[] }, save) {
    const days = new Set(data.days);
    const today = ymd(new Date());
    let streak = 0;
    for (let d = new Date(); days.has(ymd(d)) || (streak === 0 && ymd(d) === today); d.setDate(d.getDate() - 1)) {
      if (days.has(ymd(d))) streak++;
      else if (ymd(d) !== today) break;
    }
    // The last 12 weeks, a column a week from Monday.
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - ((end.getDay() + 6) % 7) - 7 * 11);
    const cells: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = ymd(d);
      cells.push(`<span class="ck-cell${days.has(key) ? " on" : ""}${key === today ? " today" : ""}" data-day="${key}" title="${key}"></span>`);
    }
    root.innerHTML = `
      <div class="ck-top">
        <input class="ck-title" placeholder="打卡的事，例如：跑步 3 公里" value="${esc(data.title)}" />
        <button class="ck-btn${days.has(today) ? " done" : ""}" data-act="today">${days.has(today) ? "✓ 今天已打卡" : "今日打卡"}</button>
      </div>
      <div class="ck-stats"><span>连续 <b>${streak}</b> 天</span><span>共 <b>${days.size}</b> 天</span><span class="muted">点格子可以补卡或取消</span></div>
      <div class="ck-grid">${cells.join("")}</div>`;
    root.querySelector<HTMLInputElement>(".ck-title")!.addEventListener("change", (e) => save({ ...data, title: (e.target as HTMLInputElement).value }));
    const toggle = (key: string) => {
      const next = new Set(days);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      save({ ...data, days: [...next].sort() });
    };
    root.querySelector("[data-act=today]")!.addEventListener("click", () => toggle(today));
    root.querySelectorAll<HTMLElement>(".ck-cell").forEach((c) => c.addEventListener("click", () => toggle(c.dataset.day!)));
  },
};

// ---- 加密文本 ----

const enc = new TextEncoder();
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

async function keyOf(password: string, salt: Uint8Array<ArrayBuffer>) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encrypt(text: string, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyOf(password, salt), enc.encode(text));
  return { salt: b64(salt), iv: b64(iv), data: b64(data) };
}

async function decrypt(box: { salt: string; iv: string; data: string }, password: string) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, await keyOf(password, unb64(box.salt)), unb64(box.data));
  return new TextDecoder().decode(plain);
}

const encrypted: App = {
  title: "🔒 加密文本",
  initial: () => ({}),
  draw(root, data: { salt?: string; iv?: string; data?: string }, save, state) {
    const sealed = !!data.data;
    const error = (msg: string) => {
      const p = root.querySelector<HTMLElement>(".x-error")!;
      p.textContent = msg;
      p.hidden = !msg;
    };
    if (!sealed || state.plain !== undefined) {
      // Writing: a new block, or one unlocked with its password.
      root.innerHTML = `
        <textarea class="x-text" placeholder="要加密的内容，只有知道密码的人能看到">${esc(state.plain ?? "")}</textarea>
        <div class="x-row">${
          sealed
            ? `<span class="muted">已解锁：编辑后点「锁上」用原密码重新加密</span><span class="l-spacer"></span><button data-act="lock" class="primary">锁上</button>`
            : `<input type="password" class="x-pw" placeholder="设置密码" /><input type="password" class="x-pw2" placeholder="再输一次" /><button data-act="seal" class="primary">加密</button>`
        }</div>
        <p class="x-error l-error" hidden></p>
        <p class="muted x-tip">AES-256 加密，密码不保存，忘了就打不开。</p>`;
      const text = root.querySelector<HTMLTextAreaElement>(".x-text")!;
      text.addEventListener("input", () => (state.plain = text.value));
      root.querySelector("[data-act=seal]")?.addEventListener("click", async () => {
        const pw = root.querySelector<HTMLInputElement>(".x-pw")!.value;
        if (!pw) return error("请设置密码");
        if (pw !== root.querySelector<HTMLInputElement>(".x-pw2")!.value) return error("两次输入的密码不一样");
        const box = await encrypt(text.value, pw);
        state.plain = undefined;
        state.password = undefined;
        save(box);
      });
      root.querySelector("[data-act=lock]")?.addEventListener("click", async () => {
        const box = await encrypt(text.value, state.password);
        state.plain = undefined;
        state.password = undefined;
        save(box);
      });
      return;
    }
    root.innerHTML = `
      <div class="x-row x-locked">🔒 内容已加密<input type="password" class="x-pw" placeholder="输入密码解锁" /><button data-act="open" class="primary">解锁</button></div>
      <p class="x-error l-error" hidden></p>`;
    const pw = root.querySelector<HTMLInputElement>(".x-pw")!;
    const open = async () => {
      try {
        state.plain = await decrypt(data as { salt: string; iv: string; data: string }, pw.value);
        state.password = pw.value;
        encrypted.draw(root, data, save, state);
      } catch {
        error("密码不对");
      }
    };
    pw.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void open();
      }
    });
    root.querySelector("[data-act=open]")!.addEventListener("click", () => void open());
  },
};

export const smartApps: Record<string, App> = { kanban, calendar, poll, checkin, encrypted };

export const SmartBlock = Node.create({
  name: "smartBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      kind: { default: "kanban", parseHTML: (el) => el.getAttribute("data-kind") ?? "kanban", renderHTML: (a) => ({ "data-kind": a.kind }) },
      data: { default: "", parseHTML: (el) => el.getAttribute("data-json") ?? "", renderHTML: (a) => ({ "data-json": a.data }) },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-smart]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-smart": "" })];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const app = smartApps[node.attrs.kind as string] ?? kanban;
      const dom = h("div", `e-smart e-smart-${node.attrs.kind}`);
      const head = h("div", "e-block-head", `${app.title}<span class="l-spacer"></span><button data-act="remove" title="删除这个块">✕</button>`);
      let body = h("div", "e-smart-body");
      dom.append(head, body);
      head.querySelector("[data-act=remove]")!.addEventListener("click", () => removeNode(editor, getPos));
      // What only this view keeps, as the month shown or an unlocked text.
      const state: Record<string, any> = {};
      let current = node;
      const save: Save = (data) => setAttrs(editor, getPos, { data: JSON.stringify(data) });
      const draw = () => {
        // A fresh body drops the listeners of the last one drawn.
        const fresh = h("div", "e-smart-body");
        body.replaceWith(fresh);
        body = fresh;
        app.draw(fresh, json(current, "data", app.initial()), save, state);
      };
      draw();
      return {
        dom,
        update(n) {
          if (n.type !== current.type || n.attrs.kind !== current.attrs.kind) return false;
          const changed = n.attrs.data !== current.attrs.data;
          current = n;
          if (changed) draw();
          return true;
        },
        stopEvent: (e) => interactive(e) || e.type.startsWith("drag") || e.type === "drop",
        ignoreMutation: () => true,
        selectNode: () => dom.classList.add("selected"),
        deselectNode: () => dom.classList.remove("selected"),
      };
    };
  },
});
