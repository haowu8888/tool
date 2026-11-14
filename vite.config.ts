import { defineConfig, type Plugin } from "vite";

// KaTeX's style sheet names every font three times, as woff2, woff and
// ttf. WebView2 takes the woff2, so the other two only add to the app.
function katexWoff2Only(): Plugin {
  return {
    name: "katex-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!/katex[^/\\]*\.css/.test(id)) return;
      return code.replace(/,\s*url\([^)]+\.(?:woff|ttf)\)\s*format\(["'](?:woff|truetype)["']\)/g, "");
    },
  };
}

export default defineConfig({
  plugins: [katexWoff2Only()],
  server: {
    // The app loads this address during `mygo dev` (devUrl in mygo.json).
    port: 5173,
    strictPort: true,
    // The development app and the packaged builds are not the page's.
    watch: { ignored: ["**/.mygo/**", "**/build/**"] },
  },
});
