// The look beyond light and dark: the style's colors, the accent color and
// the main window's background picture.
import type { AppearanceSettings } from "./mygo";

interface Palette {
  bg: string;
  fg: string;
  card: string;
  line: string;
  muted: string;
}

// styles are the choices of 风格, each with its light and dark colors;
// default's are the stylesheet's own.
export const styles: { id: string; name: string; light: Palette; dark: Palette }[] = [
  {
    id: "default",
    name: "默认",
    light: { bg: "#f6f7f9", fg: "#16181d", card: "#ffffff", line: "#e5e7eb", muted: "#6b7280" },
    dark: { bg: "#0f1115", fg: "#e8eaed", card: "#1a1d23", line: "#2a2e36", muted: "#9aa0a6" },
  },
  {
    id: "warm",
    name: "暖纸",
    light: { bg: "#f4efe6", fg: "#2b2419", card: "#fffcf6", line: "#e6ddcc", muted: "#7c705e" },
    dark: { bg: "#16130e", fg: "#ece4d6", card: "#211d16", line: "#353026", muted: "#a99f8e" },
  },
  {
    id: "cool",
    name: "雾蓝",
    light: { bg: "#eef2f8", fg: "#0f172a", card: "#ffffff", line: "#dae2ee", muted: "#64748b" },
    dark: { bg: "#0b1120", fg: "#e2e8f0", card: "#131b2e", line: "#22304a", muted: "#94a3b8" },
  },
  {
    id: "mint",
    name: "薄荷",
    light: { bg: "#edf5f1", fg: "#13221c", card: "#fbfefc", line: "#d3e6dc", muted: "#5d776c" },
    dark: { bg: "#0b1411", fg: "#e2efe9", card: "#13201b", line: "#22362e", muted: "#8eaa9e" },
  },
  {
    id: "pure",
    name: "纯色",
    light: { bg: "#ffffff", fg: "#09090b", card: "#ffffff", line: "#e4e4e7", muted: "#71717a" },
    dark: { bg: "#000000", fg: "#fafafa", card: "#0c0c0e", line: "#232326", muted: "#a1a1aa" },
  },
];

export const defaultAccent = "#3b82f6";

export const accents: [string, string][] = [
  ["#3b82f6", "蓝"],
  ["#6366f1", "靛"],
  ["#8b5cf6", "紫"],
  ["#ec4899", "粉"],
  ["#ef4444", "红"],
  ["#f97316", "橙"],
  ["#d97706", "琥珀"],
  ["#10b981", "绿"],
  ["#14b8a6", "青"],
  ["#64748b", "石板"],
];

export const backgroundURL = (name: string) => `http://appearance.localhost/${encodeURIComponent(name)}`;

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
let current: AppearanceSettings | undefined;
// Only the toolbox window shows the picture: the others are see-through.
let main = false;

darkQuery.addEventListener("change", () => current && applyAppearance(current));

export function isDark() {
  const theme = document.documentElement.dataset.theme;
  return theme ? theme === "dark" : darkQuery.matches;
}

// applyAppearance sets the colors and the picture on the page; call it
// after the theme attribute is set.
export function applyAppearance(a: AppearanceSettings) {
  current = a;
  const root = document.documentElement.style;
  const style = styles.find((s) => s.id === a.style);
  const p = style && style.id !== "default" ? (isDark() ? style.dark : style.light) : undefined;
  for (const k of ["bg", "fg", "card", "line", "muted"] as const) {
    if (p) root.setProperty(`--${k}`, p[k]);
    else root.removeProperty(`--${k}`);
  }
  if (a.accent && a.accent !== defaultAccent) root.setProperty("--accent", a.accent);
  else root.removeProperty("--accent");

  const bg = main && a.background ? a.background : "";
  if (bg) {
    document.documentElement.dataset.bg = "";
    root.setProperty("--bg-image", `url("${backgroundURL(bg)}")`);
    root.setProperty("--bg-opacity", `${a.opacity / 100}`);
    root.setProperty("--bg-dim", `${a.dim}%`);
    root.setProperty("--bg-blur", `${a.blur}px`);
    root.setProperty("--card-alpha", `${a.cards}%`);
  } else {
    delete document.documentElement.dataset.bg;
    for (const k of ["--bg-image", "--bg-opacity", "--bg-dim", "--bg-blur", "--card-alpha"]) root.removeProperty(k);
  }
}

// markMainWindow says this page is the toolbox window's.
export function markMainWindow() {
  main = true;
  document.body.classList.add("main-window");
  if (current) applyAppearance(current);
}
