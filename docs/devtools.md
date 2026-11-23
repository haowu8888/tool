# 开发工具

从 CLAUDE.md 拆出来的细节：改这部分代码前先读。

## 实现

代码按需加载（`src/toolbox.ts` 的 `lazyTool` 第一次打开时才 `import("./devtools")`），别的模块别静态 import 它。

- `devtools.go` + `src/devtools.ts` + `src/calc.ts`：工具「开发工具」（2026-11-15 加；同日按用户要求去掉了编码转换和哈希）。标签页 JSON、时间戳、计算器、二维码、UUID/密码、HTML 运行、金价，当前标签记在 localStorage `dev-tab`，各框内容切走再回来还在（`kept`）。JSON：输入停 300ms 自动按上次的操作重算；结果默认是树形（`JSONTree`，`dev-json-view` 记树形/文本），对象数组可折叠（折叠的子节点第一次展开时才画，Alt+点击展开整支），超过 400 个节点时初始只展开两层，「展开到 1/2/3 层/全部展开/全部折叠」，点键名或下标复制路径（`$.a[0]`）；复制拿的是文本结果。时间戳：文本框旁边有 `datetime-local` 选择器和「现在」，两边互相同步。计算器：`calc.ts` 手写解析（CSP 不许 eval）：+−×÷、^（右结合，-2^2=-4）、mod、x%、x!、隐式乘（2π、3(1+2)）、0x/0b/0o、sin 等函数（角度/弧度，`dev-calc-deg`），`tidy` 去掉 0.1+0.2 的尾差；边输边算，回车或 = 记进历史（`dev-calc-hist`，50 条），整数结果另列十六/二/八进制。单测 `bun test ./.dev/test/calc.test.ts`。UUID 个数自己填（1–1000）。只有二维码和存图走 Go：生成和识别用 `github.com/makiuchi-d/gozxing`（纯 Go，小图放大一倍再认）；「从屏幕识别」和托盘「识别二维码」是截图的 `qr` 模式（`Shot.start("qr")`，松开鼠标直接 `readQR`，经 `shot.onQR` → `Dev.found` 打开本页，结果经 `devQRFound` 事件 + `Dev.TakeQR` 取一次）。单测 `devtools_test.go`，CDP `.dev/js/dev-ui.js`

## HTML 运行

2026-11-19 加。一个 HTML 框（一开始做成 HTML/CSS/JS 三个框，用户要单个 HTML；旧的三框内容读出时并进 HTML），Tab 缩进、回车保持缩进、Ctrl+Enter 运行；内容和「自动运行」（停止输入 800ms 后运行）存在 localStorage `dev-html`。`withBridge` 在页面前面加 `<!doctype html>` 和桥脚本（去掉框里自己的 doctype，行号不变）。

- 不能用 `srcdoc`/blob/data：这些 iframe 继承页面的 CSP（`script-src 'self'`），内联脚本不执行。所以页面交给 Go 的 `Dev.RunHTML`，经 `mygo.Protocol` 的 `devrun` scheme 从 `http://devrun.localhost/<序号>` 提供（只留最近 3 页）
- 隔离：iframe `sandbox="allow-scripts allow-modals allow-forms"`（没有 allow-same-origin，是不透明源），响应头还带 `Content-Security-Policy: sandbox …`，单独打开也是沙箱。实测框里读不到 `parent.document`、`localStorage`，fetch 应用地址被 CORS 挡住，`window.mygo` 不存在（框里有 `chrome.webview`，但 MyGo 的桥只认带窗口密钥前缀的消息，且顶层的 WebMessageReceived 收不到 iframe 的消息）
- 控制台：桥脚本包装 `console.log/info/warn/error/debug/clear`，加上 `error`/`unhandledrejection`，把值格式化成文字（对象、数组、Map/Set、元素、循环引用、深度 3 截断）后 `parent.postMessage`；页面只收 `e.source === frame.contentWindow` 的消息，用 `textContent` 显示，最多 500 行。页面里内联脚本的报错换算成框里的「第 N 行」（`withBridge` 算出框从第几行开始，桥脚本的行数和数字无关）
- **每次运行换一个新的 iframe**：沙箱 iframe 加载过 devrun 页之后再改 `src`（换到另一个 devrun 页）WebView2 显示错误页 `chrome-error://chromewebdata/`，从空白页第一次加载正常
- 单测 `TestRunHTML`，CDP `.dev/js/dev-html.js`（日志、对象、CSS 生效、报错行号、隔离、自动运行，测完还原 `dev-html`）


## 金价

2026-11-23 加。`devgold.go`（方法挂在 `Dev` 上）+ `src/devtools.ts` 的 `renderGold`。行情从新浪财经取（不要密钥，国内直连；要带 `Referer: https://finance.sina.com.cn/`，否则 403）：

- 报价 `Dev.Gold`：`https://hq.sinajs.cn/list=fx_susdcny,hf_XAU,gds_AU9999,gds_AUTD,hf_GC,hf_XAG`，每行 `var hq_str_<代码>="…";`。`hf_`/`gds_` 字段：0 现价、4 高、5 低、6 时间、7 昨收、8 开盘、12 日期；`fx_susdcny` 第 8 个是美元兑人民币。返回的名字是 GBK，不解析，用 `goldMarkets` 里自己的名字。开盘前现价是 0，用昨收
- 走势 `Dev.GoldChart(span)`：今日是 `GlobalFuturesService.getGlobalFuturesMinLine?symbol=XAU`（每行倒数第 5 个是价格、最后一个是时间，第一行第 2 个是昨收，画成虚线）；1 月/3 月/1 年/5 年取 `getGlobalFuturesDailyKLine?symbol=XAU`（20 年日线约 0.7MB，Go 里缓存 10 分钟）按日期截
- 页面：标签在时才每 30 秒刷新（窗口藏到托盘时 `document.hidden` 跳过），涨红跌绿；美元/盎司的卡片下面折算成元/克（÷31.1034768×汇率），走势可切美元/盎司、元/克（按当前汇率折算），选择记在 localStorage `dev-gold-span`、`dev-gold-unit`。点价格复制
- 单测 `TestParseGold*`（`devgold_test.go`），CDP `.dev/js/dev-gold.js`（打开金价页，读卡片、今日/1 年走势、切单位）
