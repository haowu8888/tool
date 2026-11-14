// Images, videos, attachments and galleries (画册). Their files live in
// the app's data folder; the notes keep their notefile URLs.
import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { Notes, type NoteFile } from "../mygo";
import { esc, lightbox, showError } from "../ui";
import { formatSize, h, insertBlocks, interactive, json, removeNode, setAttrs } from "./util";

// Image is a picture as wide as the user drags it, with a caption.
export const Image = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: "" },
      caption: { default: "" },
      width: { default: 100, parseHTML: (el) => Number(el.getAttribute("data-width")) || 100, renderHTML: (a) => ({ "data-width": a.width }) },
    };
  },
  parseHTML() {
    return [
      { tag: "figure[data-image]", getAttrs: (el) => ({ src: el.querySelector("img")?.getAttribute("src") ?? "", caption: el.querySelector("figcaption")?.textContent ?? "" }) },
      { tag: "img[src]", getAttrs: (el) => ({ src: el.getAttribute("src") }) },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["figure", mergeAttributes({ "data-image": "", "data-width": node.attrs.width }), ["img", { src: HTMLAttributes.src, style: `width:${node.attrs.width}%` }], ["figcaption", {}, node.attrs.caption]];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = h("figure", "e-image");
      const frame = h("div", "e-image-frame");
      const img = h("img");
      const handle = h("span", "e-resize");
      handle.title = "拖动调整宽度";
      const caption = h("input", "e-caption") as HTMLInputElement;
      caption.placeholder = "添加图片说明";
      frame.append(img, handle);
      dom.append(frame, caption);
      let current = node;
      const draw = () => {
        img.src = current.attrs.src;
        frame.style.width = `${current.attrs.width}%`;
        if (document.activeElement !== caption) caption.value = current.attrs.caption;
        caption.classList.toggle("empty", !current.attrs.caption);
      };
      img.addEventListener("dblclick", () => lightbox([current.attrs.src]));
      caption.addEventListener("change", () => setAttrs(editor, getPos, { caption: caption.value }));
      caption.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          caption.blur();
          editor.commands.focus();
        }
      });
      handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = frame.offsetWidth;
        const full = dom.offsetWidth;
        const move = (ev: PointerEvent) => {
          frame.style.width = `${Math.min(100, Math.max(10, ((startW + ev.clientX - startX) / full) * 100))}%`;
        };
        const up = () => {
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", up);
          setAttrs(editor, getPos, { width: Math.round(parseFloat(frame.style.width)) });
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
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
        stopEvent: (e) => interactive(e) || (e.target as HTMLElement).classList?.contains("e-resize"),
        ignoreMutation: () => true,
        selectNode: () => dom.classList.add("selected"),
        deselectNode: () => dom.classList.remove("selected"),
      };
    };
  },
});

// Video is a video file the note plays.
export const Video = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: "" }, name: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "video[src]", getAttrs: (el) => ({ src: el.getAttribute("src"), name: el.getAttribute("title") ?? "" }) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["video", { src: HTMLAttributes.src, title: HTMLAttributes.name, controls: "" }];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = h("div", "e-video");
      const v = h("video") as HTMLVideoElement;
      v.src = node.attrs.src;
      v.controls = true;
      v.preload = "metadata";
      dom.append(v);
      return {
        dom,
        stopEvent: (e) => e.target === v,
        ignoreMutation: () => true,
        selectNode: () => dom.classList.add("selected"),
        deselectNode: () => dom.classList.remove("selected"),
      };
    };
  },
});

const fileIcon = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["pdf"].includes(ext)) return "📕";
  if (["doc", "docx", "txt", "md", "rtf"].includes(ext)) return "📄";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (["ppt", "pptx"].includes(ext)) return "📽";
  if (["zip", "rar", "7z", "gz", "tar"].includes(ext)) return "🗜";
  if (["mp3", "wav", "flac", "m4a", "aac"].includes(ext)) return "🎵";
  return "📎";
};

// Attachment is a file the note links to, opened with its application.
export const Attachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: "" }, name: { default: "" }, size: { default: 0 } };
  },
  parseHTML() {
    // Before the link mark, which would take the <a> for a link.
    return [{ tag: "a[data-attachment]", priority: 1001, getAttrs: (el) => ({ url: el.getAttribute("href"), name: el.textContent, size: Number(el.getAttribute("data-size")) || 0 }) }];
  },
  renderHTML({ node }) {
    return ["a", { "data-attachment": "", href: node.attrs.url, "data-size": node.attrs.size }, node.attrs.name];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = h("div", "e-attachment");
      dom.innerHTML = `<span class="e-att-icon">${fileIcon(node.attrs.name)}</span><span class="e-att-name">${esc(node.attrs.name)}</span><span class="e-att-size">${formatSize(node.attrs.size)}</span><button data-act="open">打开</button><button data-act="reveal">所在位置</button>`;
      dom.addEventListener("click", (e) => {
        const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
        if (act === "open") void Notes.openFile(node.attrs.url).catch(showError);
        if (act === "reveal") void Notes.revealFile(node.attrs.url).catch(showError);
      });
      dom.addEventListener("dblclick", () => void Notes.openFile(node.attrs.url).catch(showError));
      return {
        dom,
        stopEvent: interactive,
        ignoreMutation: () => true,
        selectNode: () => dom.classList.add("selected"),
        deselectNode: () => dom.classList.remove("selected"),
      };
    };
  },
});

// Gallery (画册) is a grid of pictures to go through.
export const Gallery = Node.create({
  name: "gallery",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { images: { default: "[]", parseHTML: (el) => el.getAttribute("data-images") ?? "[]", renderHTML: (a) => ({ "data-images": a.images }) } };
  },
  parseHTML() {
    return [{ tag: "div[data-gallery]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-gallery": "" })];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = h("div", "e-gallery");
      let current = node;
      const draw = () => {
        const srcs = json<string[]>(current, "images", []);
        dom.innerHTML =
          `<div class="e-block-head">🖼 画册<span class="muted">${srcs.length} 张 · 双击图片放大</span><span class="l-spacer"></span><button data-act="add">添加图片</button><button data-act="remove" title="删除画册">✕</button></div>` +
          `<div class="e-gallery-grid">${srcs.map((s, i) => `<div class="e-gallery-item"><img src="${s}" data-i="${i}" alt="" /><button data-del="${i}" title="移除">✕</button></div>`).join("")}${srcs.length ? "" : `<p class="muted">还没有图片：点「添加图片」，或把图片拖进来</p>`}</div>`;
      };
      dom.addEventListener("click", async (e) => {
        const t = e.target as HTMLElement;
        const srcs = json<string[]>(current, "images", []);
        if (t.closest("[data-act=add]")) {
          const files = await Notes.pickFiles("image", true).catch(showError);
          if (files?.length) setAttrs(editor, getPos, { images: JSON.stringify([...srcs, ...files.map((f) => f.url)]) });
        } else if (t.closest("[data-act=remove]")) removeNode(editor, getPos);
        else if (t.dataset.del) setAttrs(editor, getPos, { images: JSON.stringify(srcs.filter((_, i) => i !== Number(t.dataset.del))) });
      });
      dom.addEventListener("dblclick", (e) => {
        const i = (e.target as HTMLElement).dataset.i;
        if (i) lightbox(json<string[]>(current, "images", []), Number(i));
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
        stopEvent: interactive,
        ignoreMutation: () => true,
        selectNode: () => dom.classList.add("selected"),
        deselectNode: () => dom.classList.remove("selected"),
      };
    };
  },
});

// insertFiles puts files in the note at the cursor: pictures and videos to
// see, other files as attachments.
export function insertFiles(editor: Editor, files: NoteFile[]) {
  const nodes = files.map((f) =>
    f.kind === "image"
      ? { type: "image", attrs: { src: f.url } }
      : f.kind === "video"
        ? { type: "video", attrs: { src: f.url, name: f.name } }
        : { type: "attachment", attrs: { url: f.url, name: f.name, size: f.size } },
  );
  if (nodes.length) insertBlocks(editor, nodes);
}

// pasteFiles keeps the files of a paste, as a screenshot, and inserts them.
// It reports whether the paste had any.
export function pasteFiles(editor: Editor, list: FileList | null | undefined) {
  const files = [...(list ?? [])];
  if (!files.length) return false;
  void (async () => {
    try {
      const saved: NoteFile[] = [];
      for (const f of files) {
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
          r.onerror = () => reject(r.error);
          r.readAsDataURL(f);
        });
        saved.push(await Notes.saveFile(f.name || `粘贴的图片.${f.type.split("/")[1] ?? "png"}`, data));
      }
      insertFiles(editor, saved);
    } catch (e) {
      showError(e);
    }
  })();
  return true;
}

// pickAndInsert asks for files of a kind and inserts them.
export async function pickAndInsert(editor: Editor, kind: "image" | "video" | "file") {
  try {
    insertFiles(editor, (await Notes.pickFiles(kind, true)) ?? []);
  } catch (e) {
    showError(e);
  }
}
