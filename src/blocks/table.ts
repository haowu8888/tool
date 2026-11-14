// Tables, with a toolbar over the table the cursor is in for its rows,
// columns and cells.
import type { Editor } from "@tiptap/core";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { h } from "./util";

export const tableExtensions = [Table.configure({ resizable: true, lastColumnResizable: false }), TableRow, TableHeader, TableCell];

const actions: [string, string, (e: Editor) => boolean][] = [
  ["上方插入行", "↥ 行", (e) => e.chain().focus().addRowBefore().run()],
  ["下方插入行", "↧ 行", (e) => e.chain().focus().addRowAfter().run()],
  ["左侧插入列", "↤ 列", (e) => e.chain().focus().addColumnBefore().run()],
  ["右侧插入列", "↦ 列", (e) => e.chain().focus().addColumnAfter().run()],
  ["", "", () => true],
  ["删除行", "删行", (e) => e.chain().focus().deleteRow().run()],
  ["删除列", "删列", (e) => e.chain().focus().deleteColumn().run()],
  ["", "", () => true],
  ["第一行作为表头", "表头", (e) => e.chain().focus().toggleHeaderRow().run()],
  ["合并或拆分单元格", "合并/拆分", (e) => e.chain().focus().mergeOrSplit().run()],
  ["", "", () => true],
  ["删除整个表格", "删除表格", (e) => e.chain().focus().deleteTable().run()],
];

// TableToolbar follows the cursor into tables.
export class TableToolbar {
  bar = h("div", "e-toolbar e-table-bar");

  constructor(private editor: Editor) {
    this.bar.hidden = true;
    this.bar.innerHTML = actions
      .map(([title, label], i) => (title ? `<button data-i="${i}" title="${title}"${title.startsWith("删除整个") ? ` class="danger"` : ""}>${label}</button>` : `<span class="e-sep"></span>`))
      .join("");
    this.bar.addEventListener("mousedown", (e) => e.preventDefault());
    this.bar.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      if (b) actions[Number(b.dataset.i)]![2](this.editor);
    });
    document.body.append(this.bar);
    editor.on("selectionUpdate", this.update);
    editor.on("transaction", this.update);
    editor.on("blur", this.hide);
    editor.view.dom.closest(".n-doc")?.addEventListener("scroll", this.update);
  }

  private hide = () => {
    this.bar.hidden = true;
  };

  private update = () => {
    const { view, state } = this.editor;
    if (!this.editor.isActive("table") || !view.hasFocus() || !state.selection.empty) return this.hide();
    const at = view.domAtPos(state.selection.from).node;
    const table = (at instanceof HTMLElement ? at : at.parentElement)?.closest("table");
    if (!table) return this.hide();
    this.bar.hidden = false;
    const r = table.getBoundingClientRect();
    const top = r.top - this.bar.offsetHeight - 6;
    this.bar.style.left = `${Math.max(8, Math.min(r.left, innerWidth - this.bar.offsetWidth - 8))}px`;
    this.bar.style.top = `${top < 8 ? r.bottom + 6 : top}px`;
  };

  destroy() {
    this.editor.off("selectionUpdate", this.update);
    this.editor.off("transaction", this.update);
    this.editor.off("blur", this.hide);
    this.bar.remove();
  }
}
