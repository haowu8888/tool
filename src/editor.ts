// The notes' editor, after the user's Outline: Markdown shortcuts as one
// types, a menu of blocks and AI writing on "/", a toolbar over selected
// text, and an AI writing panel that streams its answer.
import { Editor, Extension, Node, mergeAttributes, type Range } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import OrderedList from "@tiptap/extension-ordered-list";
import StarterKit from "@tiptap/starter-kit";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { Marked } from "marked";
import { Columns, Column, Embed, PageBreak, columnsContent, embedSource, embedURL } from "./blocks/layout";
import { Attachment, Gallery, Image, Video, insertFiles, pasteFiles, pickAndInsert } from "./blocks/media";
import { SmartBlock } from "./blocks/smart";
import { InlineMath, MathBlock } from "./blocks/source";
import { TableToolbar, tableExtensions } from "./blocks/table";
import { TrailingParagraph, ask, insertBlocks, justInserted } from "./blocks/util";
import { AI, Notes, events, type AIChunkEvent, type NoteFile } from "./mygo";
import { errorText, esc } from "./ui";

// ---- Icons: lines on a 24×24 grid, as the sidebar's ----

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const icon = {
  bold: svg(`<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>`),
  italic: svg(`<path d="M10 5h8M6 19h8M14 5l-4 14"/>`),
  strike: svg(`<path d="M5 12h14M16 6.5C15 5.5 13.6 5 12 5c-2.5 0-4 1.3-4 3 0 1.2.8 2.2 2.5 2.8M8 17.5c1 1 2.5 1.5 4 1.5 2.5 0 4-1.3 4-3 0-.6-.2-1.2-.5-1.6"/>`),
  highlight: svg(`<path d="m9 11-4 4v3h3l4-4M9 11l5-5 4 4-5 5M9 11l4 4M4 21h16"/>`),
  code: svg(`<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>`),
  quote: svg(`<path d="M5 18h4v-5H6c0-3 1-5 3-6M15 18h4v-5h-3c0-3 1-5 3-6"/>`),
  task: svg(`<rect x="3.5" y="4.5" width="5" height="5" rx="1"/><path d="m4.5 16 1.5 1.5L9 14.5M12 7h8.5M12 16h8.5"/>`),
  bullet: svg(`<circle cx="5" cy="7" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="17" r="1"/><path d="M9.5 7h10M9.5 12h10M9.5 17h10"/>`),
  ordered: svg(`<path d="M4 5h1.5v4M4 9h3M4 14.5c0-1 2.5-1 2.5.2 0 .9-2.5 1.8-2.5 3.3h2.6M10 7h10M10 12h10M10 17h10"/>`),
  link: svg(`<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`),
  sparkle: svg(`<path d="M10 3.5 11.6 8a2 2 0 0 0 1.4 1.4l4.5 1.6-4.5 1.6A2 2 0 0 0 11.6 14L10 18.5 8.4 14A2 2 0 0 0 7 12.6L2.5 11 7 9.4A2 2 0 0 0 8.4 8zM18 3v4M16 5h4M18.5 16v3M17 17.5h3"/>`),
  hr: svg(`<path d="M3 12h18M7 7h10M7 17h10" opacity=".9"/>`),
  codeBlock: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m9 10-2 2 2 2M15 10l2 2-2 2"/>`),
  info: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`),
  success: svg(`<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>`),
  warning: svg(`<path d="M12 4 2.8 19.5h18.4zM12 10v4M12 17h.01"/>`),
  calendar: svg(`<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`),
  clock: svg(`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`),
  close: svg(`<path d="M6 6l12 12M18 6 6 18"/>`),
  image: svg(`<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5L5 19.5"/>`),
  video: svg(`<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>`),
  file: svg(`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5"/>`),
  gallery: svg(`<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>`),
  table: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>`),
  math: svg(`<path d="M5 5h10l-6 7 6 7H5M17 9l4 6M21 9l-4 6"/>`),
  pageBreak: svg(`<path d="M5 3v5h14V3M5 21v-5h14v5M3 12h2M8 12h2M13 12h2M18 12h3"/>`),
  columns2: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>`),
  columns3: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>`),
  kanban: svg(`<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>`),
  poll: svg(`<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>`),
  checkin: svg(`<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/>`),
  lock: svg(`<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`),
  embed: svg(`<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`),
};

const heading = (n: number) => `<b class="e-h">H${n}</b>`;

// ---- Blocks ----

// Callout is a notice block, as Outline's 提示信息, 成功通知 and 警告信息.
const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: "info",
        parseHTML: (el) => el.getAttribute("data-callout") ?? "info",
        renderHTML: (a) => ({ "data-callout": a.kind }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "e-callout" }), 0];
  },
});

// OutlineKeys gives the blocks Outline's shortcuts: Ctrl+Shift+1 to 4 the
// headings, 7 a task list, 8 a bulleted and 9 a numbered one.
const OutlineKeys = Extension.create({
  name: "outlineKeys",
  addKeyboardShortcuts() {
    const e = this.editor;
    return {
      "Mod-Shift-1": () => e.commands.toggleHeading({ level: 1 }),
      "Mod-Shift-2": () => e.commands.toggleHeading({ level: 2 }),
      "Mod-Shift-3": () => e.commands.toggleHeading({ level: 3 }),
      "Mod-Shift-4": () => e.commands.toggleHeading({ level: 4 }),
      "Mod-Shift-8": () => e.commands.toggleBulletList(),
      "Mod-]": () => e.commands.toggleBlockquote(),
      "Mod-Shift-c": () => e.commands.toggleCodeBlock(),
      "Mod-_": () => e.commands.setHorizontalRule(),
      "Mod-h": () => e.commands.toggleHighlight(),
    };
  },
});

const TaskListKeys = TaskList.extend({
  addKeyboardShortcuts() {
    return { "Mod-Shift-7": () => this.editor.commands.toggleTaskList() };
  },
});

const OrderedListKeys = OrderedList.extend({
  addKeyboardShortcuts() {
    return { "Mod-Shift-9": () => this.editor.commands.toggleOrderedList() };
  },
});

// ---- The "/" menu ----

interface SlashItem {
  title: string;
  icon: string;
  keys?: string; // the shortcut, as Outline lists it
  search: string; // more words it matches, as pinyin initials
  group: string;
  run(editor: Editor, range: Range): void;
}

const pad = (n: number) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const now = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function slashItems(ai: AIWriting): SlashItem[] {
  const block = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => (e: Editor, r: Range) => fn(e.chain().focus().deleteRange(r)).run();
  const callout = (kind: string) => block((c) => c.wrapIn("callout", { kind }));
  const insert = (content: object, opens = false) => (e: Editor, r: Range) => {
    e.chain().focus().deleteRange(r).run();
    justInserted.flag = opens;
    insertBlocks(e, content as never);
    justInserted.flag = false;
  };
  const smart = (kind: string) => insert({ type: "smartBlock", attrs: { kind } });
  const embed = (title: string) => (e: Editor, r: Range) => {
    e.chain().focus().deleteRange(r).run();
    void ask(title, "", "https://…").then((answer) => {
      const url = embedURL(answer ?? "");
      if (!url) return;
      const { src, height } = embedSource(url);
      insertBlocks(e, { type: "embed", attrs: { url, src, height } });
    });
  };
  return [
    { group: "AI", title: "续写", icon: icon.sparkle, search: "ai xx continue", run: (e, r) => (e.chain().focus().deleteRange(r).run(), ai.start("continue")) },
    { group: "AI", title: "让 AI 写…", icon: icon.sparkle, search: "ai rxx write ask", run: (e, r) => (e.chain().focus().deleteRange(r).run(), ai.start("custom")) },
    { group: "标题", title: "主标题", icon: heading(1), keys: "Ctrl ⇧ 1", search: "h1 zbt heading title", run: block((c) => c.setNode("heading", { level: 1 })) },
    { group: "标题", title: "次标题", icon: heading(2), keys: "Ctrl ⇧ 2", search: "h2 cbt heading", run: block((c) => c.setNode("heading", { level: 2 })) },
    { group: "标题", title: "小标题", icon: heading(3), keys: "Ctrl ⇧ 3", search: "h3 xbt heading", run: block((c) => c.setNode("heading", { level: 3 })) },
    { group: "标题", title: "附加小标题", icon: heading(4), keys: "Ctrl ⇧ 4", search: "h4 fjxbt heading", run: block((c) => c.setNode("heading", { level: 4 })) },
    { group: "列表", title: "任务列表", icon: icon.task, keys: "Ctrl ⇧ 7", search: "rwlb todo task checkbox dblb", run: block((c) => c.toggleTaskList()) },
    { group: "列表", title: "无序列表", icon: icon.bullet, keys: "Ctrl ⇧ 8", search: "wxlb bullet list ul", run: block((c) => c.toggleBulletList()) },
    { group: "列表", title: "有序列表", icon: icon.ordered, keys: "Ctrl ⇧ 9", search: "yxlb ordered number list ol", run: block((c) => c.toggleOrderedList()) },
    { group: "块", title: "引用", icon: icon.quote, keys: "Ctrl ]", search: "yy quote blockquote", run: block((c) => c.toggleBlockquote()) },
    { group: "块", title: "代码块", icon: icon.codeBlock, keys: "Ctrl ⇧ C", search: "dmk code", run: block((c) => c.toggleCodeBlock()) },
    { group: "块", title: "分割线", icon: icon.hr, keys: "Ctrl _", search: "fgx hr divider line", run: block((c) => c.setHorizontalRule()) },
    { group: "提示", title: "提示信息", icon: icon.info, search: "tsxx info notice callout", run: callout("info") },
    { group: "提示", title: "成功通知", icon: icon.success, search: "cgtz success notice callout", run: callout("success") },
    { group: "提示", title: "警告信息", icon: icon.warning, search: "jgxx warning notice callout", run: callout("warning") },
    { group: "插入", title: "当前日期", icon: icon.calendar, search: "dqrq date today", run: (e, r) => e.chain().focus().insertContentAt(r, today() + " ").run() },
    { group: "插入", title: "当前时间", icon: icon.clock, search: "dqsj time now", run: (e, r) => e.chain().focus().insertContentAt(r, now() + " ").run() },
    { group: "插入", title: "当前日期和时间", icon: icon.calendar, search: "dqrqhsj datetime", run: (e, r) => e.chain().focus().insertContentAt(r, `${today()} ${now()} `).run() },
    { group: "媒体", title: "图片", icon: icon.image, search: "tp image picture", run: (e, r) => (e.chain().focus().deleteRange(r).run(), void pickAndInsert(e, "image")) },
    { group: "媒体", title: "视频", icon: icon.video, search: "sp video", run: (e, r) => (e.chain().focus().deleteRange(r).run(), void pickAndInsert(e, "video")) },
    { group: "媒体", title: "附件", icon: icon.file, search: "fj file attachment", run: (e, r) => (e.chain().focus().deleteRange(r).run(), void pickAndInsert(e, "file")) },
    { group: "媒体", title: "画册", icon: icon.gallery, search: "hc gallery album", run: insert({ type: "gallery" }) },
    { group: "高级", title: "表格", icon: icon.table, search: "bg table", run: block((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true })) },
    { group: "高级", title: "数学块 (LaTeX)", icon: icon.math, search: "sxk math latex gs formula", run: insert({ type: "math" }, true) },
    { group: "高级", title: "分页符", icon: icon.pageBreak, search: "fyf page break", run: insert({ type: "pageBreak" }) },
    { group: "应用", title: "两栏", icon: icon.columns2, search: "ll columns", run: insert(columnsContent(2)) },
    { group: "应用", title: "三栏", icon: icon.columns3, search: "sl columns", run: insert(columnsContent(3)) },
    { group: "应用", title: "看板", icon: icon.kanban, search: "kb kanban board", run: smart("kanban") },
    { group: "应用", title: "日历", icon: icon.calendar, search: "rl calendar", run: smart("calendar") },
    { group: "应用", title: "投票", icon: icon.poll, search: "tp poll vote", run: smart("poll") },
    { group: "应用", title: "打卡", icon: icon.checkin, search: "dk checkin habit", run: smart("checkin") },
    { group: "应用", title: "加密文本", icon: icon.lock, search: "jmwb encrypt secret password", run: smart("encrypted") },
    ...["哔哩哔哩", "YouTube", "腾讯视频", "优酷", "网易云音乐", "Figma"].map((name) => ({
      group: "嵌入",
      title: name,
      icon: icon.embed,
      search: `qr embed ${name.toLowerCase()} ${({ 哔哩哔哩: "bilibili blbl b站", 腾讯视频: "txsp qq", 优酷: "yk youku", 网易云音乐: "wyyyy music" } as Record<string, string>)[name] ?? ""}`,
      run: embed(`${name}链接`),
    })),
    { group: "嵌入", title: "嵌入链接", icon: icon.embed, search: "qr embed iframe link url", run: embed("要嵌入的网页链接") },
  ];
}

function slashExtension(ai: AIWriting) {
  return Extension.create({
    name: "slash",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem>({
          editor: this.editor,
          char: "/",
          allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== "codeBlock",
          items: ({ query }) => {
            const q = query.trim().toLowerCase();
            return slashItems(ai).filter((i) => !q || i.title.toLowerCase().includes(q) || i.search.split(" ").some((w) => w.startsWith(q)));
          },
          command: ({ editor, range, props }) => props.run(editor, range),
          render: slashMenu,
        }),
      ];
    },
  });
}

// slashMenu draws the "/" menu by the cursor and moves through it with the
// arrow keys.
function slashMenu() {
  let menu: HTMLElement | null = null;
  let props: SuggestionProps<SlashItem> | null = null;
  let selected = 0;
  const draw = () => {
    if (!menu || !props) return;
    const items = props.items;
    if (!items.length) {
      menu.innerHTML = `<div class="e-empty">没有匹配的命令</div>`;
    } else {
      let group = "";
      menu.innerHTML = items
        .map((it, i) => {
          const sep = group && it.group !== group ? `<hr />` : "";
          group = it.group;
          return `${sep}<button class="e-item${i === selected ? " on" : ""}" data-i="${i}"><span class="e-icon">${it.icon}</span><span class="e-title">${esc(it.title)}</span>${it.keys ? `<span class="e-keys">${it.keys}</span>` : ""}</button>`;
        })
        .join("");
    }
    menu.querySelector(".e-item.on")?.scrollIntoView({ block: "nearest" });
    place();
  };
  const place = () => {
    const rect = props?.clientRect?.();
    if (!menu || !rect) return;
    const h = menu.offsetHeight;
    const below = rect.bottom + 6 + h < innerHeight;
    menu.style.left = `${Math.min(rect.left, innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${below ? rect.bottom + 6 : Math.max(8, rect.top - h - 6)}px`;
  };
  return {
    onStart(p: SuggestionProps<SlashItem>) {
      props = p;
      selected = 0;
      menu = document.createElement("div");
      menu.className = "e-menu e-slash";
      // Clicking keeps the editor's focus.
      menu.addEventListener("mousedown", (e) => e.preventDefault());
      menu.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>(".e-item");
        if (b && props) props.command(props.items[Number(b.dataset.i)]!);
      });
      document.body.append(menu);
      draw();
    },
    onUpdate(p: SuggestionProps<SlashItem>) {
      props = p;
      selected = Math.min(selected, Math.max(0, p.items.length - 1));
      draw();
    },
    onKeyDown({ event }: { event: KeyboardEvent }) {
      if (!props) return false;
      const n = props.items.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (n) selected = (selected + (event.key === "ArrowDown" ? 1 : n - 1)) % n;
        draw();
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        if (!n) return false;
        props.command(props.items[selected]!);
        return true;
      }
      if (event.key === "Escape") {
        menu?.remove();
        menu = null;
        return true;
      }
      return false;
    },
    onExit() {
      menu?.remove();
      menu = null;
      props = null;
    },
  };
}

// ---- The toolbar over selected text ----

const aiActions: [string, string][] = [
  ["polish", "润色"],
  ["fix", "修正错别字和语法"],
  ["expand", "展开"],
  ["shorten", "缩写"],
  ["summarize", "总结要点"],
  ["continue", "续写"],
  ["", ""],
  ["translate_en", "翻译成英文"],
  ["translate_zh", "翻译成中文"],
  ["", ""],
  ["custom", "让 AI 写…"],
];

// SelectionToolbar formats the selected text, links it, or asks the AI to
// rewrite it.
class SelectionToolbar {
  bar = document.createElement("div");
  private aiMenu: HTMLElement | null = null;
  private pointerDown = false;
  private linking = false;

  constructor(
    private editor: Editor,
    private ai: AIWriting,
  ) {
    this.bar.className = "e-toolbar";
    this.bar.hidden = true;
    this.bar.addEventListener("mousedown", (e) => {
      if (!(e.target as HTMLElement).closest("input")) e.preventDefault();
    });
    document.body.append(this.bar);
    const dom = editor.view.dom;
    dom.addEventListener("pointerdown", () => {
      this.pointerDown = true;
      this.hide();
    });
    document.addEventListener("pointerup", this.onPointerUp);
    editor.on("selectionUpdate", this.update);
    editor.on("transaction", this.refresh);
    editor.on("blur", this.onBlur);
  }

  destroy() {
    document.removeEventListener("pointerup", this.onPointerUp);
    this.editor.off("selectionUpdate", this.update);
    this.editor.off("transaction", this.refresh);
    this.editor.off("blur", this.onBlur);
    this.closeAIMenu();
    this.bar.remove();
  }

  private onPointerUp = () => {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    // After the selection settles.
    setTimeout(this.update, 0);
  };

  private onBlur = ({ event }: { event: FocusEvent }) => {
    const to = event.relatedTarget as HTMLElement | null;
    if (to && (this.bar.contains(to) || this.aiMenu?.contains(to))) return;
    if (!this.linking) this.hide();
  };

  private refresh = () => {
    if (!this.bar.hidden && !this.linking) this.draw();
  };

  private update = () => {
    const { state, view } = this.editor;
    const { empty, from, to } = state.selection;
    if (this.pointerDown || this.linking) return;
    if (empty || !view.hasFocus() || !state.doc.textBetween(from, to).trim()) return this.hide();
    this.draw();
    this.bar.hidden = false;
    // Centered over the selection, below it when there is no room above.
    const a = view.coordsAtPos(from);
    const b = view.coordsAtPos(to);
    const w = this.bar.offsetWidth;
    const h = this.bar.offsetHeight;
    const left = Math.min(Math.max(8, (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2 - w / 2), innerWidth - w - 8);
    const top = a.top - h - 8 < 8 ? b.bottom + 8 : a.top - h - 8;
    this.bar.style.left = `${left}px`;
    this.bar.style.top = `${top}px`;
  };

  hide() {
    this.bar.hidden = true;
    this.linking = false;
    this.closeAIMenu();
  }

  private draw() {
    const e = this.editor;
    const b = (name: string, html: string, title: string, active = false) =>
      `<button data-cmd="${name}" title="${title}" class="${active ? "on" : ""}">${html}</button>`;
    this.bar.innerHTML = [
      b("bold", icon.bold, "粗体 Ctrl+B", e.isActive("bold")),
      b("italic", icon.italic, "斜体 Ctrl+I", e.isActive("italic")),
      b("strike", icon.strike, "删除线 Ctrl+Shift+S", e.isActive("strike")),
      b("highlight", icon.highlight, "高亮 Ctrl+H", e.isActive("highlight")),
      b("code", icon.code, "行内代码 Ctrl+E", e.isActive("code")),
      `<span class="e-sep"></span>`,
      b("h1", "H1", "主标题", e.isActive("heading", { level: 1 })),
      b("h2", "H2", "次标题", e.isActive("heading", { level: 2 })),
      b("h3", "H3", "小标题", e.isActive("heading", { level: 3 })),
      b("quote", icon.quote, "引用", e.isActive("blockquote")),
      `<span class="e-sep"></span>`,
      b("task", icon.task, "任务列表", e.isActive("taskList")),
      b("bullet", icon.bullet, "无序列表", e.isActive("bulletList")),
      b("ordered", icon.ordered, "有序列表", e.isActive("orderedList")),
      `<span class="e-sep"></span>`,
      b("link", icon.link, "链接", e.isActive("link")),
      `<span class="e-sep"></span>`,
      b("ai", icon.sparkle, "AI 写作", !!this.aiMenu),
    ].join("");
    this.bar.querySelectorAll<HTMLElement>("[data-cmd]").forEach((btn) => btn.addEventListener("click", () => this.run(btn.dataset.cmd!, btn)));
  }

  private run(cmd: string, btn: HTMLElement) {
    const c = this.editor.chain().focus();
    const done: Record<string, () => unknown> = {
      bold: () => c.toggleBold().run(),
      italic: () => c.toggleItalic().run(),
      strike: () => c.toggleStrike().run(),
      highlight: () => c.toggleHighlight().run(),
      code: () => c.toggleCode().run(),
      h1: () => c.toggleHeading({ level: 1 }).run(),
      h2: () => c.toggleHeading({ level: 2 }).run(),
      h3: () => c.toggleHeading({ level: 3 }).run(),
      quote: () => c.toggleBlockquote().run(),
      task: () => c.toggleTaskList().run(),
      bullet: () => c.toggleBulletList().run(),
      ordered: () => c.toggleOrderedList().run(),
      link: () => this.editLink(),
      ai: () => (this.aiMenu ? this.closeAIMenu() : this.openAIMenu(btn)),
    };
    done[cmd]?.();
    if (cmd !== "link" && cmd !== "ai") this.draw();
  }

  // editLink turns the toolbar into a box for the link's address.
  private editLink() {
    this.linking = true;
    this.closeAIMenu();
    const href = (this.editor.getAttributes("link").href as string | undefined) ?? "";
    this.bar.innerHTML = `<input class="e-link" placeholder="粘贴或输入链接，回车确定，清空回车取消链接" value="${esc(href)}" />`;
    const input = this.bar.querySelector("input")!;
    input.focus();
    input.select();
    const finish = (apply: boolean) => {
      this.linking = false;
      const url = input.value.trim();
      const c = this.editor.chain().focus().extendMarkRange("link");
      if (apply) (url ? c.setLink({ href: /^[a-z]+:/i.test(url) ? url : `https://${url}` }) : c.unsetLink()).run();
      else c.run();
      this.update();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => {
      if (this.linking) {
        this.linking = false;
        this.hide();
      }
    });
  }

  private openAIMenu(btn: HTMLElement) {
    const menu = document.createElement("div");
    menu.className = "e-menu e-ai-menu";
    menu.innerHTML = aiActions.map(([a, label]) => (a ? `<button class="e-item" data-a="${a}"><span class="e-title">${label}</span></button>` : `<hr />`)).join("");
    menu.addEventListener("mousedown", (e) => e.preventDefault());
    menu.addEventListener("click", (e) => {
      const it = (e.target as HTMLElement).closest<HTMLElement>("[data-a]");
      if (!it) return;
      this.hide();
      this.ai.start(it.dataset.a!);
    });
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    menu.style.left = `${Math.min(r.left, innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${r.bottom + 6 + menu.offsetHeight < innerHeight ? r.bottom + 6 : Math.max(8, r.top - menu.offsetHeight - 6)}px`;
    this.aiMenu = menu;
    btn.classList.add("on");
  }

  private closeAIMenu() {
    this.aiMenu?.remove();
    this.aiMenu = null;
  }
}

// ---- AI writing ----

const aiTitles: Record<string, string> = {
  continue: "续写",
  polish: "润色",
  expand: "展开",
  shorten: "缩写",
  summarize: "总结要点",
  translate_en: "翻译成英文",
  translate_zh: "翻译成中文",
  fix: "修正错别字和语法",
  custom: "让 AI 写",
};

// AIWriting asks the AI about the selected text, or the text before the
// cursor, and shows its answer streaming in a panel, to replace the
// selection with or insert below it.
class AIWriting {
  editor!: Editor;
  private panel: HTMLElement | null = null;
  private action = "";
  private range = { from: 0, to: 0 };
  private request = "";
  private output = "";
  private status: "idle" | "streaming" | "done" | "error" = "idle";
  private error = "";
  private off: (() => void) | null = null;

  constructor(
    private host: HTMLElement,
    private title: () => string,
  ) {}

  // start opens the panel for an action, and runs it unless the user has
  // to say what to write first.
  start(action: string) {
    const { from, to } = this.editor.state.selection;
    this.cancel();
    this.action = action;
    this.range = { from, to };
    this.output = "";
    this.error = "";
    this.status = "idle";
    this.open();
    if (action !== "custom") void this.run();
  }

  // sourceText is the selected text, or without a selection, as for a
  // continuation, the text before the cursor, as much as is useful.
  private sourceText() {
    const doc = this.editor.state.doc;
    const { from, to } = this.range;
    if (this.action === "continue" || from === to) return doc.textBetween(Math.max(0, from - 4000), from, "\n\n");
    return doc.textBetween(from, to, "\n\n");
  }

  private async run(instruction?: string) {
    this.cancel();
    this.output = "";
    this.error = "";
    this.status = "streaming";
    this.draw();
    const take = (c: AIChunkEvent) => {
      if (c.text) this.output += c.text;
      if (c.done) {
        this.status = c.error ? "error" : "done";
        this.error = c.error ?? "";
        this.off?.();
        this.off = null;
        this.request = "";
      }
      this.draw();
    };
    // Listening before asking: a request that fails at once ends before
    // its ID is back, and its pieces wait for the ID.
    let id = "";
    const early: AIChunkEvent[] = [];
    const off = events.aiChunk.on((c: AIChunkEvent) => {
      if (!id) early.push(c);
      else if (c.id === id) take(c);
    });
    this.off = off;
    try {
      id = await AI.write({ action: this.action, text: this.sourceText(), instruction, title: this.title() });
    } catch (e) {
      if (this.off !== off) return;
      off();
      this.off = null;
      this.status = "error";
      this.error = errorText(e);
      this.draw();
      return;
    }
    // Stopped or asked again meanwhile: cancel had no ID to stop it by.
    if (this.off !== off) return void AI.cancel(id);
    this.request = id;
    for (const c of early) if (c.id === id && this.off === off) take(c);
  }

  private cancel() {
    if (this.request) void AI.cancel(this.request);
    this.request = "";
    this.off?.();
    this.off = null;
  }

  close() {
    this.cancel();
    this.panel?.remove();
    this.panel = null;
    this.status = "idle";
  }

  private open() {
    if (!this.panel) {
      this.panel = document.createElement("div");
      this.panel.className = "e-ai";
      this.host.append(this.panel);
      this.panel.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          this.close();
          this.editor.commands.focus();
        }
      });
    }
    this.panel.innerHTML = `
      <div class="e-ai-head"><span class="e-ai-icon">${icon.sparkle}</span><b>AI 写作 · ${aiTitles[this.action] ?? ""}</b><span class="l-spacer"></span><button class="e-ai-x" title="关闭 Esc">${icon.close}</button></div>
      ${
        this.action === "custom"
          ? `<form class="e-ai-ask"><input placeholder="${this.range.from === this.range.to ? "告诉 AI 要写什么，比如：写一段周报开头" : "告诉 AI 怎么改选中的文字，比如：改成更正式的语气"}" /><button class="primary">生成</button></form>`
          : ""
      }
      <div class="e-ai-out" hidden></div>
      <p class="l-error" hidden></p>
      <div class="e-ai-buttons"></div>`;
    this.panel.querySelector(".e-ai-x")!.addEventListener("click", () => {
      this.close();
      this.editor.commands.focus();
    });
    const form = this.panel.querySelector<HTMLFormElement>(".e-ai-ask");
    if (form) {
      const input = form.querySelector("input")!;
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (input.value.trim() && this.status !== "streaming") void this.run(input.value.trim());
      });
      setTimeout(() => input.focus(), 0);
    }
    this.draw();
  }

  private draw() {
    const p = this.panel;
    if (!p) return;
    const out = p.querySelector<HTMLElement>(".e-ai-out")!;
    const streaming = this.status === "streaming";
    out.hidden = !this.output && !streaming;
    out.innerHTML = this.output ? toHTML(this.output) : `<span class="muted">${streaming ? "AI 正在写…（慢的模型要等几十秒）" : ""}</span>`;
    out.scrollTop = out.scrollHeight;
    const err = p.querySelector<HTMLElement>(".l-error")!;
    err.hidden = this.status !== "error";
    err.textContent = `AI 写作失败：${this.error}`;
    const done = this.status === "done" && !!this.output.trim();
    const hasSelection = this.range.from !== this.range.to;
    const buttons: [string, string, boolean?][] = [];
    if (streaming) buttons.push(["stop", "停止"]);
    if ((done || this.status === "error") && this.action !== "custom") buttons.push(["retry", "重试"]);
    if (done && hasSelection && this.action !== "continue") buttons.push(["replace", "替换选中内容"]);
    if (done) buttons.push(["insert", this.action === "continue" || !hasSelection ? "插入" : "插入到下方", true]);
    const box = p.querySelector<HTMLElement>(".e-ai-buttons")!;
    box.innerHTML = buttons.map(([k, label, primary]) => `<button data-k="${k}"${primary ? ` class="primary"` : ""}>${label}</button>`).join("");
    box.querySelectorAll<HTMLElement>("[data-k]").forEach((b) =>
      b.addEventListener("click", () => {
        const k = b.dataset.k;
        if (k === "stop") {
          this.cancel();
          this.status = this.output ? "done" : "idle";
          this.draw();
        } else if (k === "retry") void this.run();
        else if (k === "replace") this.apply(true);
        else if (k === "insert") this.apply(false);
      }),
    );
  }

  // apply puts the answer in place of the selection, or below it: at the
  // cursor for a continuation.
  private apply(replace: boolean) {
    const html = toHTML(this.output);
    const size = this.editor.state.doc.content.size;
    const from = Math.min(this.range.from, size);
    const to = Math.min(this.range.to, size);
    const c = this.editor.chain().focus();
    if (replace) c.insertContentAt({ from, to }, html).run();
    else if (this.action === "continue" || from === to) c.insertContentAt(to, html).run();
    else {
      const $to = this.editor.state.doc.resolve(to);
      c.insertContentAt($to.depth > 0 ? $to.after(1) : to, html).run();
    }
    this.close();
  }
}

// The AI's answer is not the user's own writing, and this page can start
// programs: HTML in it shows as the text it is, but for a line break, and
// its links and pictures are the web's only, none a script.
const markdown = new Marked({
  gfm: true,
  breaks: false,
  renderer: { html: ({ text }) => (/^<br\s*\/?>$/i.test(text.trim()) ? "<br>" : esc(text)) },
  walkTokens(token) {
    if ((token.type === "link" || token.type === "image") && !/^(https?:|mailto:)/i.test(token.href.trim())) token.href = "";
  },
});

// toHTML turns the AI's Markdown into the editor's HTML.
function toHTML(md: string) {
  return markdown.parse(md, { async: false }) as string;
}

// ---- The editor ----

export interface NoteEditor {
  editor: Editor;
  insertFiles(files: NoteFile[]): void;
  destroy(): void;
}

// createEditor makes an editor in el with an HTML document. onChange gets
// the document after each change; title gives the note's for the AI.
export function createEditor(el: HTMLElement, html: string, onChange: (html: string, text: string) => void, title: () => string): NoteEditor {
  // The AI panel floats over the editor's pane rather than scrolls with it.
  const ai = new AIWriting(el.parentElement ?? el, title);
  const editor = new Editor({
    element: el,
    content: html,
    extensions: [
      StarterKit.configure({ orderedList: false, heading: { levels: [1, 2, 3, 4] } }),
      OrderedListKeys,
      TaskListKeys,
      TaskItem.configure({ nested: true }),
      Highlight,
      Underline,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener", target: null } }),
      Placeholder.configure({
        placeholder: ({ editor, pos }) => (pos === 0 && editor.isEmpty ? "标题" : "输入 / 调出命令，或者直接开始写…"),
      }),
      Callout,
      OutlineKeys,
      slashExtension(ai),
      Image,
      Video,
      Attachment,
      Gallery,
      ...tableExtensions,
      MathBlock,
      InlineMath,
      Columns,
      Column,
      PageBreak,
      Embed,
      SmartBlock,
      TrailingParagraph,
    ],
    editorProps: {
      attributes: { spellcheck: "false" },
      // Ctrl+click opens a link in the browser.
      handleClick(_view, _pos, event) {
        const a = (event.target as HTMLElement).closest("a");
        if (a && (event.ctrlKey || event.metaKey)) {
          void Notes.openURL(a.getAttribute("href") ?? "");
          return true;
        }
        return false;
      },
      // Pasted screenshots and files are kept with the note; a pasted
      // video or design link embeds.
      handlePaste(_view, event) {
        if (pasteFiles(editor, event.clipboardData?.files)) return true;
        const text = event.clipboardData?.getData("text/plain").trim() ?? "";
        if (/^https?:\/\/\S+$/.test(text) && embedSource(text).provider && editor.state.selection.$from.parent.textContent === "") {
          const { src, height } = embedSource(text);
          insertBlocks(editor, { type: "embed", attrs: { url: text, src, height } });
          return true;
        }
        return false;
      },
      handleDrop(_view, event) {
        return pasteFiles(editor, event.dataTransfer?.files);
      },
    },
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? "" : editor.getHTML(), editor.getText()),
  });
  ai.editor = editor;
  const toolbar = new SelectionToolbar(editor, ai);
  const tableBar = new TableToolbar(editor);
  return {
    editor,
    // insertFiles puts files dropped on the window in the note.
    insertFiles: (files: NoteFile[]) => insertFiles(editor, files),
    destroy() {
      ai.close();
      toolbar.destroy();
      tableBar.destroy();
      editor.destroy();
    },
  };
}

// noteHTML is a note's body as the editor's HTML: notes written before
// the editor are plain text, a paragraph a line.
export function noteHTML(body: string) {
  if (!body.trim() || /^\s*</.test(body)) return body;
  return body
    .split("\n")
    .map((line) => `<p>${esc(line)}</p>`)
    .join("");
}
