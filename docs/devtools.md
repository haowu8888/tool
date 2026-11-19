# 开发工具

从 CLAUDE.md 拆出来的细节：改这部分代码前先读。

## 实现

代码按需加载（`src/toolbox.ts` 的 `lazyTool` 第一次打开时才 `import("./devtools")`），别的模块别静态 import 它。

- `devtools.go` + `src/devtools.ts` + `src/calc.ts`：工具「开发工具」（2026-11-15 加；同日按用户要求去掉了编码转换和哈希）。标签页 JSON、时间戳、计算器、二维码、UUID/密码，当前标签记在 localStorage `dev-tab`，各框内容切走再回来还在（`kept`）。JSON：输入停 300ms 自动按上次的操作重算；结果默认是树形（`JSONTree`，`dev-json-view` 记树形/文本），对象数组可折叠（折叠的子节点第一次展开时才画，Alt+点击展开整支），超过 400 个节点时初始只展开两层，「展开到 1/2/3 层/全部展开/全部折叠」，点键名或下标复制路径（`$.a[0]`）；复制拿的是文本结果。时间戳：文本框旁边有 `datetime-local` 选择器和「现在」，两边互相同步。计算器：`calc.ts` 手写解析（CSP 不许 eval）：+−×÷、^（右结合，-2^2=-4）、mod、x%、x!、隐式乘（2π、3(1+2)）、0x/0b/0o、sin 等函数（角度/弧度，`dev-calc-deg`），`tidy` 去掉 0.1+0.2 的尾差；边输边算，回车或 = 记进历史（`dev-calc-hist`，50 条），整数结果另列十六/二/八进制。单测 `bun test ./.dev/test/calc.test.ts`。UUID 个数自己填（1–1000）。只有二维码和存图走 Go：生成和识别用 `github.com/makiuchi-d/gozxing`（纯 Go，小图放大一倍再认）；「从屏幕识别」和托盘「识别二维码」是截图的 `qr` 模式（`Shot.start("qr")`，松开鼠标直接 `readQR`，经 `shot.onQR` → `Dev.found` 打开本页，结果经 `devQRFound` 事件 + `Dev.TakeQR` 取一次）。单测 `devtools_test.go`，CDP `.dev/js/dev-ui.js`
