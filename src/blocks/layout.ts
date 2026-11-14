// Columns (两栏/三栏), page breaks and embedded pages (视频、地图、设计稿…).
import { Node, mergeAttributes } from "@tiptap/core";
import { Notes } from "../mygo";
import { esc, showError } from "../ui";
import { ask, h, interactive, removeNode, setAttrs } from "./util";

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,3}",
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-columns": "", class: "e-columns" }), 0];
  },
});

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column": "", class: "e-column" }), 0];
  },
});

// columnsContent makes n empty columns.
export function columnsContent(n: number) {
  return { type: "columns", content: Array.from({ length: n }, () => ({ type: "column", content: [{ type: "paragraph" }] })) };
}

// PageBreak starts a new page when the note is printed.
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },
  renderHTML() {
    return ["div", { "data-page-break": "", class: "e-page-break" }];
  },
});

// A service whose links embed: what its page link looks like and its
// player's address.
interface Provider {
  name: string;
  match: RegExp;
  src(m: RegExpMatchArray, url: string): string;
  height?: number;
}

export const providers: Provider[] = [
  { name: "哔哩哔哩", match: /bilibili\.com\/video\/(BV\w+)/i, src: (m) => `https://player.bilibili.com/player.html?bvid=${m[1]}&autoplay=0&high_quality=1` },
  { name: "YouTube", match: /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/, src: (m) => `https://www.youtube.com/embed/${m[1]}` },
  { name: "腾讯视频", match: /v\.qq\.com\/x\/(?:cover\/\w+|page)\/(\w+)\.html/, src: (m) => `https://v.qq.com/txp/iframe/player.html?vid=${m[1]}` },
  { name: "优酷", match: /youku\.com\/v_show\/id_([\w=]+)\.html/, src: (m) => `https://player.youku.com/embed/${m[1]}` },
  { name: "网易云音乐", match: /music\.163\.com\/.*song\?id=(\d+)/, src: (m) => `https://music.163.com/outchain/player?type=2&id=${m[1]}&auto=0&height=66`, height: 90 },
  { name: "Figma", match: /figma\.com\/(file|design|proto)\//, src: (_m, url) => `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url)}` },
  { name: "Vimeo", match: /vimeo\.com\/(\d+)/, src: (m) => `https://player.vimeo.com/video/${m[1]}` },
  { name: "Loom", match: /loom\.com\/share\/(\w+)/, src: (m) => `https://www.loom.com/embed/${m[1]}` },
  { name: "CodePen", match: /codepen\.io\/([\w-]+)\/pen\/(\w+)/, src: (m) => `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result` },
  { name: "Google 地图", match: /google\.[^/]+\/maps/, src: (_m, url) => url.replace("/maps/", "/maps/embed/") },
];

// embedSource finds the player of a link, or the link itself.
export function embedSource(url: string): { src: string; provider: string; height: number } {
  for (const p of providers) {
    const m = url.match(p.match);
    if (m) return { src: p.src(m, url), provider: p.name, height: p.height ?? 400 };
  }
  return { src: url, provider: "", height: 400 };
}

// embedURL is a web address to embed, as typed: with https:// when it names
// no scheme, and "" for nothing or for another scheme, as javascript:.
export function embedURL(input: string) {
  const url = input.trim();
  if (!url || /^https?:\/\//i.test(url)) return url;
  // example.com:8080 has a port, not a scheme.
  return /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(url) ? "" : `https://${url}`;
}

// embeddable tells whether a frame may show src: a page of the web, and not
// this app's own, which could call into the app.
function embeddable(src: string) {
  try {
    const u = new URL(src);
    return (u.protocol === "https:" || u.protocol === "http:") && u.host !== location.host;
  } catch {
    return false;
  }
}

// Embed shows another site's page in the note, as a video player.
export const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      url: { default: "" },
      src: { default: "" },
      height: { default: 400, parseHTML: (el) => Number(el.getAttribute("data-height")) || 400, renderHTML: (a) => ({ "data-height": a.height }) },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-embed]", getAttrs: (el) => ({ url: el.getAttribute("data-url") ?? "", src: el.getAttribute("data-src") ?? "" }) }];
  },
  renderHTML({ node }) {
    return ["div", { "data-embed": "", "data-url": node.attrs.url, "data-src": node.attrs.src, "data-height": node.attrs.height }];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = h("div", "e-embed");
      let current = node;
      const draw = () => {
        const { url, src, height } = current.attrs;
        const host = (() => {
          try {
            return new URL(url).hostname;
          } catch {
            return url;
          }
        })();
        dom.innerHTML = `
          <div class="e-block-head">🔗 <span class="e-embed-host">${esc(host)}</span><span class="l-spacer"></span><button data-act="open">浏览器打开</button><button data-act="edit">换链接</button><button data-act="remove" title="删除">✕</button></div>
          ${
            // The page runs in a sandbox: its scripts and player work, but it
            // cannot take the whole window to another address.
            embeddable(src)
              ? `<iframe src="${esc(src)}" style="height:${Number(height) || 400}px" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation" allowfullscreen allow="autoplay; fullscreen; encrypted-media; picture-in-picture" referrerpolicy="no-referrer-when-downgrade"></iframe>
                 <span class="e-resize-y" title="拖动调整高度"></span>`
              : `<p class="muted e-embed-none">这个链接不能嵌入，只支持 http 和 https 的网页。</p>`
          }`;
      };
      dom.addEventListener("click", async (e) => {
        const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
        if (act === "open") void Notes.openURL(current.attrs.url).catch(showError);
        else if (act === "remove") removeNode(editor, getPos);
        else if (act === "edit") {
          const url = embedURL((await ask("嵌入的链接", current.attrs.url, "https://…")) ?? "");
          if (url) {
            const e2 = embedSource(url);
            setAttrs(editor, getPos, { url, src: e2.src, height: e2.height });
          }
        }
      });
      dom.addEventListener("pointerdown", (e) => {
        if (!(e.target as HTMLElement).classList.contains("e-resize-y")) return;
        e.preventDefault();
        const frame = dom.querySelector("iframe");
        if (!frame) return;
        const startY = e.clientY;
        const startH = frame.offsetHeight;
        frame.style.pointerEvents = "none";
        const move = (ev: PointerEvent) => (frame.style.height = `${Math.max(80, startH + ev.clientY - startY)}px`);
        const up = () => {
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", up);
          frame.style.pointerEvents = "";
          setAttrs(editor, getPos, { height: frame.offsetHeight });
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
      });
      draw();
      return {
        dom,
        update(n) {
          if (n.type !== current.type) return false;
          const same = n.attrs.src === current.attrs.src && n.attrs.height === current.attrs.height;
          current = n;
          if (!same) draw();
          return true;
        },
        stopEvent: (e) => interactive(e) || (e.target as HTMLElement).classList?.contains("e-resize-y"),
        ignoreMutation: () => true,
        selectNode: () => dom.classList.add("selected"),
        deselectNode: () => dom.classList.remove("selected"),
      };
    };
  },
});
