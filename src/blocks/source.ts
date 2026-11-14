// Blocks written as source and shown rendered: math (LaTeX, by KaTeX). A
// click edits the source, with the result live below.
import { Node, nodeInputRule } from "@tiptap/core";
import katex from "katex";
import "katex/dist/katex.min.css";
import { esc } from "../ui";
import { ask, h, interactive, setAttrs, takeJustInserted } from "./util";

interface SourceKind {
  name: string;
  label: string;
  placeholder: string;
  render(source: string, into: HTMLElement): void | Promise<void>;
}

function sourceBlock(kind: SourceKind) {
  return Node.create({
    name: kind.name,
    group: "block",
    atom: true,
    draggable: true,
    addAttributes() {
      return { source: { default: "", parseHTML: (el) => el.getAttribute("data-source") ?? "", renderHTML: (a) => ({ "data-source": a.source }) } };
    },
    parseHTML() {
      return [{ tag: `div[data-${kind.name}]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, [`data-${kind.name}`]: "" }];
    },
    addNodeView() {
      return ({ node, getPos, editor }) => {
        const dom = h("div", `e-source e-${kind.name}`);
        const preview = h("div", "e-source-view");
        const edit = h("div", "e-source-edit");
        edit.innerHTML = `<div class="e-block-head">${kind.label}<span class="l-spacer"></span><span class="muted">Esc 或点外面完成</span></div><textarea spellcheck="false" placeholder="${esc(kind.placeholder)}"></textarea>`;
        const area = edit.querySelector("textarea")!;
        dom.append(preview, edit);
        let current = node;
        let editing = false;
        let timer = 0;
        const draw = (source: string) => {
          if (!source.trim()) {
            preview.innerHTML = `<span class="muted">${kind.label}：点这里编辑</span>`;
            return;
          }
          void kind.render(source, preview);
        };
        const open = () => {
          if (editing) return;
          editing = true;
          dom.classList.add("editing");
          area.value = current.attrs.source;
          area.style.height = "auto";
          area.style.height = `${Math.max(80, area.scrollHeight)}px`;
          setTimeout(() => area.focus(), 0);
        };
        const close = () => {
          if (!editing) return;
          editing = false;
          dom.classList.remove("editing");
          if (area.value !== current.attrs.source) setAttrs(editor, getPos, { source: area.value });
        };
        preview.addEventListener("click", open);
        area.addEventListener("input", () => {
          area.style.height = "auto";
          area.style.height = `${Math.max(80, area.scrollHeight)}px`;
          clearTimeout(timer);
          timer = setTimeout(() => draw(area.value), 250);
        });
        area.addEventListener("blur", close);
        area.addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
            editor.commands.focus();
          }
          if (e.key === "Tab") {
            e.preventDefault();
            area.setRangeText("  ", area.selectionStart, area.selectionEnd, "end");
          }
        });
        draw(current.attrs.source);
        // A block just inserted starts editing.
        if (takeJustInserted()) setTimeout(open, 0);
        return {
          dom,
          update(n) {
            if (n.type !== current.type) return false;
            const changed = n.attrs.source !== current.attrs.source;
            current = n;
            if (changed && !editing) draw(n.attrs.source);
            return true;
          },
          stopEvent: interactive,
          ignoreMutation: () => true,
          selectNode: () => dom.classList.add("selected"),
          deselectNode: () => dom.classList.remove("selected"),
        };
      };
    },
  });
}

function renderMath(source: string, into: HTMLElement, displayMode: boolean) {
  into.innerHTML = katex.renderToString(source, { displayMode, throwOnError: false, strict: false });
}

export const MathBlock = sourceBlock({
  name: "math",
  label: "数学块 (LaTeX)",
  placeholder: "例如 E = mc^2 或 \\int_0^1 x^2\\,dx",
  render: (s, into) => renderMath(s, into, true),
});

// InlineMath is a formula in a line, typed as $E=mc^2$.
export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { source: { default: "", parseHTML: (el) => el.getAttribute("data-source") ?? "", renderHTML: (a) => ({ "data-source": a.source }) } };
  },
  parseHTML() {
    return [{ tag: "span[data-inline-math]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", { ...HTMLAttributes, "data-inline-math": "" }];
  },
  addInputRules() {
    return [nodeInputRule({ find: /(?:^|\s)\$([^$\s][^$]*?)\$$/, type: this.type, getAttributes: (m) => ({ source: m[1] }) })];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = h("span", "e-inline-math");
      let current = node;
      const draw = () => renderMath(current.attrs.source || "?", dom, false);
      dom.title = "点击修改公式";
      dom.addEventListener("click", async () => {
        const v = await ask("修改公式 (LaTeX)", current.attrs.source);
        if (v !== null) setAttrs(editor, getPos, { source: v });
      });
      draw();
      return {
        dom,
        update(n) {
          if (n.type !== current.type) return false;
          current = n;
          draw();
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
});
