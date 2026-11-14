// Helpers of the editor's blocks that draw themselves (node views).
import { Extension, type Content, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin } from "@tiptap/pm/state";

export type GetPos = (() => number | undefined) | boolean;

// setAttrs changes attributes of the block at getPos, as one undoable step.
export function setAttrs(editor: Editor, getPos: GetPos, attrs: Record<string, unknown>) {
  if (typeof getPos !== "function") return;
  const pos = getPos();
  const node = pos === undefined ? null : editor.state.doc.nodeAt(pos);
  if (pos === undefined || !node) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
}

// removeNode deletes the block at getPos.
export function removeNode(editor: Editor, getPos: GetPos) {
  if (typeof getPos !== "function") return;
  const pos = getPos();
  const node = pos === undefined ? null : editor.state.doc.nodeAt(pos);
  if (pos === undefined || !node) return;
  editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
  editor.commands.focus();
}

// justInserted is set while the "/" menu inserts a block that opens its
// editor at once, as a math block: the block's view takes it, so that
// the block opens when inserted, not whenever its note shows.
export const justInserted = { flag: false };

export function takeJustInserted() {
  const was = justInserted.flag;
  justInserted.flag = false;
  return was;
}

// insertBlocks inserts blocks at the cursor and puts the cursor on the line
// after them, made if need be: left selected, a block would be replaced by
// the next one inserted.
export function insertBlocks(editor: Editor, content: Content) {
  editor.chain().focus().insertContent(content).run();
  const { selection, doc } = editor.state;
  if (!(selection instanceof NodeSelection) && selection.$from.parent.isTextblock) return;
  const after = selection.to;
  if (doc.resolve(after).nodeAfter?.isTextblock) editor.commands.setTextSelection(after + 1);
  else editor.chain().insertContentAt(after, { type: "paragraph" }).setTextSelection(after + 1).run();
}

// TrailingParagraph keeps an empty line after a last block, as a picture,
// for the cursor to go below it.
export const TrailingParagraph = Extension.create({
  name: "trailingParagraph",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (_trs, _old, state) => {
          const last = state.doc.lastChild;
          if (!last || last.type.name === "paragraph") return null;
          return state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph!.create());
        },
      }),
    ];
  },
});

// interactive tells whether an event belongs to a control of a block, which
// the editor must leave alone.
export function interactive(e: Event) {
  const t = e.target as HTMLElement | null;
  return !!t?.closest?.("input, textarea, select, button, [contenteditable=true], [data-stop]");
}

// json reads a block's JSON attribute, or the fallback.
export function json<T>(node: PMNode, name: string, fallback: T): T {
  try {
    const v = node.attrs[name];
    return v ? (JSON.parse(v as string) as T) : fallback;
  } catch {
    return fallback;
  }
}

// h makes an element with a class and HTML.
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = "") {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
}

// uid makes a short ID for the items of a block.
export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// prompt asks for a line of text in a small dialog of the page, as the
// webview's own prompt() looks out of place.
export function ask(title: string, value = "", placeholder = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const dlg = h("dialog", "l-dialog e-ask");
    dlg.innerHTML = `<form method="dialog"><h2></h2><input /><div class="l-buttons"><button type="button" data-close>取消</button><button class="primary">确定</button></div></form>`;
    dlg.querySelector("h2")!.textContent = title;
    const input = dlg.querySelector("input")!;
    input.value = value;
    input.placeholder = placeholder;
    let answer: string | null = null;
    dlg.querySelector("[data-close]")!.addEventListener("click", () => dlg.close());
    dlg.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      answer = input.value;
      dlg.close();
    });
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(answer);
    });
    document.body.append(dlg);
    dlg.showModal();
    input.select();
  });
}

export function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
