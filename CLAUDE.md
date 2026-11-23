# Toolbox 工具箱

基于 [MyGo](https://mygo.egoist.dev)（Go + 系统 WebView2）的桌面工具箱，每个工具是侧栏里的一项。

## 结构

每个工具的实现细节、踩过的坑和调试脚本在 `docs/<名字>.md`，**改哪个工具先读哪个**（原先都写在这里，80KB，拆开了）：

| 文件 | 是什么 | 细节 |
|---|---|---|
| `main.go`、`settings.go`、`appearance.go`、`updater.go`、`shortcuts.go`、`ai.go`、`applog.go` | 启动、单实例、托盘、窗口关闭/退出、显示器变化后重摆小窗；设置与外观；检查更新与签名；全局快捷键；AI 写作接口 | [docs/app.md](docs/app.md) |
| `virtualscreen.go` + `vdisplay_windows.go` | 断开物理屏（usbmmidd 虚拟屏、保持、锁屏唤回、和 RustDesk 的配合） | [docs/virtualscreen.md](docs/virtualscreen.md) |
| `launcher*.go` + `src/launcher.ts` | 快捷启动（拼音首字母搜索） | [docs/launcher.md](docs/launcher.md) |
| `notes.go` + `reminder.go` + `notefiles.go` + `src/notes.ts`/`editor.ts`/`blocks/`/`bubble.ts` | 笔记待办、重复/子项/图片、提醒气泡、TipTap 编辑器和各种块 | [docs/notes.md](docs/notes.md) |
| `board.go` + `src/board.ts` | 看板 | [docs/board.md](docs/board.md) |
| `shot*.go` + `translate.go` + `scrollshot.go` + `stitch.go` + `src/shot.ts` | 截图、标注、贴图、OCR、翻译、长截图 | [docs/shot.md](docs/shot.md) |
| `record*.go` + `src/record.ts` | 屏幕录制（GDI + WASAPI + Media Foundation） | [docs/record.md](docs/record.md) |
| `imageedit.go` + `imagedoc.go` + `src/imageedit.ts`/`collage.ts`/`merge.ts`/`cutout.ts`/`inpaint.ts`/`marks.ts`/`imgutil.ts` | 图片编辑、创造拼图、合并文档 | [docs/imageedit.md](docs/imageedit.md) |
| `clips*.go` + `src/clips.ts` | 剪贴板历史和 Ctrl+Alt+V 小窗 | [docs/clips.md](docs/clips.md) |
| `services*.go` + `src/services.ts` | 服务监控、Tailscale | [docs/services.md](docs/services.md) |
| `flow.go` + `src/flow.ts` | Flow 流水线 | [docs/flow.md](docs/flow.md) |
| `devtools.go` + `devgold.go` + `src/devtools.ts` + `src/calc.ts` | 开发工具（含金价） | [docs/devtools.md](docs/devtools.md) |
| `monitor*.go` + `ports*.go` + `overlay.go` + `src/monitor.ts`/`overlay.ts` | 系统监控、端口占用、监控悬浮窗 | [docs/monitor.md](docs/monitor.md) |
| `widget*.go` + `petchat.go` + `src/widget.ts`/`pets.ts`/`petchat.ts` | 悬浮球（桌宠）和聊天小窗 | [docs/widget.md](docs/widget.md) |

各处都要遵守的：

- 单实例：`main.go` 最先 `RequestSingleInstanceLock()`，第二次启动只把第一个实例的窗口调出来。开发时重启应用要先 `stop.ps1`
- 「关闭=隐藏」的窗口（截图选区、剪贴板小窗、长截图/录屏面板、聊天窗）的 `OnClose` 要先看 `appQuitting`，退出时放行，否则托盘「退出」会被拦下
- 快捷键、托盘菜单、锁屏等回调都在主线程，而改显示器、创建/销毁窗口要等主线程：回调里要 `go`，否则死锁
- 数据文件都在 `%APPDATA%\Toolbox`，用 `settings.go` 的 `writeJSON`/`readJSON`（先写 `.tmp` + fsync 再改名、每日 `.bak`、损坏时读 `.bak`）；不该留备份的用 `writeJSONOnce`。设置改一项用 `Settings.update(fn)`；页面「先改本地、排队发给 Go、期间不理广播、最后取回」的做法见 docs/app.md
- 日志：`log` 同时写进 `%APPDATA%\Toolbox\toolbox.log`（超过 1MB 留成 `.old`）
- 样式（2026-11-18 按窗口拆开）：`index.html` 只链接 `src/css/base.css`（颜色变量、主题、底色、几样共用按钮），`main.ts` 按窗口依次 `await import` 该窗口的样式、最后 `css/controls.css`（通用控件，排在最后，主窗口里的先后关系和拆之前一样）：主窗口 `src/style.css`（所有工具页）+ `css/pets.css`（设置里选形象）+ `css/clips.css`；悬浮球 `widget.css` + `pets.css`；聊天 `petchat.css` + `pets.css`（头像是桌宠）；气泡 `bubble.css`、监控悬浮窗 `overlay.css`、截图选区/长截图/贴图 `shot.css`、剪贴板小窗 `clips.css`、录屏面板 `recpanel.css`（录制红点和工具页共用，两边各一份）。小窗口的 CSS 从 114KB 降到 3–9KB。一个类只在某个小窗口用就放那个窗口的文件，工具页也用的要放 style.css（拆的时候 `.sh-inline` 放错过，截图翻译和录屏页的说明里图标撑满了一页）。改样式后用 `node .dev/css-shots.mjs <名字>` 截所有工具页和开着的小窗口，前后两次逐像素比较（实时数据的页面——系统监控、服务、Flow、剪贴板的时间——本来就会变）
- `src/main.ts`：每个窗口都加载的入口（约 3KB），`loadSettings` 后按查询参数 `import()` 该窗口自己的页面（`?widget`/`?bubble`/`?petchat`/`?clips`/`?shot`… ，没有参数是主窗口 `src/toolbox.ts`），所以悬浮球、气泡、小窗不带上全部工具的代码（2026-11-17 拆，以前入口 246KB）。小窗口的页面别再 import 工具页面模块（`launcher.ts`、`notes.ts`、`monitor.ts` 顶层就订阅事件），共用的小函数放 `ui.ts`（`baseName`）或单独文件（`due.ts`：待办的 `dueInfo`、`REPEATS`，提醒气泡用）
- `src/toolbox.ts`：工具箱界面；新工具加到 `tools` 数组；大的工具（看板、图片编辑、开发工具）用 `lazyTool` 包一层，第一次打开才 `import()`，主窗口入口从 223KB 降到约 46KB。图标在 `src/icons.ts`，统一用 24×24 线条 SVG：用字符（⚡◼☾）当图标宽度各不相同，侧栏文字对不齐。侧栏可收起成只剩图标（`.nav.collapsed`，状态存 localStorage `nav-collapsed`）
- `resources/icon.png`（exe 图标，1024×1024）和 `assets/tray.png`（托盘图标，32×32，嵌入 exe）都由 `python3 .dev/icon.py resources/icon.png assets/tray.png` 生成（需要 Pillow）
- `src/ui.ts`：各工具页面共用的 `esc`、`openDialog`、`toast`（可带「撤销」按钮）、`showError`、`lightbox`、`onLeave`。弹窗样式（2026-11-17 改）：`.l-dialog` 用 `--card` 底色、背景模糊，自己滚动；第一个子元素是 `h2` 时它粘在顶部，`openDialog` 在 `showModal` 之后给它加 ✕（之前加会抢走第一个输入框的自动焦点），最后一个子元素是 `.l-buttons` 时它粘在底部成一条底栏（两者靠 `--dlg-px/--dlg-py` 负边距贴边，自定义内边距的弹窗改这两个变量，别直接写 `padding`）；弹窗和设置行里的下拉框、复选框是自绘的，滚动条全局细圆角（`src/css/controls.css`「通用控件」）。工具的 `render` 每次切到它都会跑一遍：在里面订阅事件、`onSettings`、`setInterval` 都要包一层 `onLeave(...)`（`events.x.on` 和 `onSettings` 都返回取消函数），`main.ts` 的 `select` 切走时调 `leave()` 统一清掉，否则每进一次多一个监听、旧页面的 DOM 释放不掉
- `src/mygo.ts`：`mygo generate` 生成，不要手改

## 新增一个工具

1. Go 里写服务并在 `main.go` 里 `mygo.Bind`
2. `src/toolbox.ts` 的 `tools` 里加一项（`id`、`name`、`icon`、`render`），图标加到 `src/icons.ts`；代码大的用 `lazyTool`
3. 细节写进 `docs/<名字>.md`，在上面的表里加一行

## 安全

页面能调 Go（快捷启动能运行程序），所以不是自己写的 HTML 不能当脚本跑：

- `index.html` 的 CSP `script-src 'self'`：只运行应用自己的脚本文件，写进页面的 `onerror=`、`javascript:` 链接都不执行。所以页面里不要写内联事件属性，也不要用 `eval`
- AI 的回复（`editor.ts` 的 `toHTML`）：Markdown 里夹的 HTML 当文字显示（`<br>` 除外），链接和图片只留 http/https/mailto
- 拼进 `innerHTML` 的外来文字（文件名、模型名、错误信息、程序名）都要过 `esc`

## 开发与构建（在 Windows 宿主机上）

- Go 1.27+（`%LOCALAPPDATA%\Programs\go`）、Bun、WebView2；依赖只在宿主机装（容器的 bun lockfile 宿主机读不了）
- `bun run dev` 热重载；`bun run build -- -platform windows/amd64` 产物在 `build/windows-amd64/`（exe + 安装包）
- `vite.config.ts` 的 `katexWoff2Only` 把 KaTeX 样式里的 woff/ttf 字体去掉只留 woff2（少打 0.8MB 进 exe）；页面分成入口（约 3KB）、各窗口自己的页面（主窗口 `toolbox` 约 46KB，另有各工具的分块）、按需加载的工具（图片编辑约 95KB、看板约 33KB、开发工具约 25KB）和编辑器（约 720KB）
- 发布：Flow（https://flow.haowu.fun）流水线 `toolbox`（id `0b0ec7f68cd0ab621f406b6b`，2026-11-18 起配置第 8 版，加了「签名」步骤），配置副本在 `deploy/flow.yaml`（改了要 PUT 到 Flow：`PUT /api/pipelines/<id>?base_version=<当前版本>`，正文是 YAML，先 `POST /api/pipelines/validate`；令牌在 `%APPDATA%\Toolbox\flow.json`；PowerShell 的 Invoke-RestMethod 读回的中文是按 Latin-1 解的乱码，比较前要转回 UTF-8）。手动运行：在构建节点（老服务器，Linux）的 `golang:1.27.3` 里从 GitHub `haowu8888/tool` main 拉代码（直连常断，经 ghfast/gh-proxy 下载并核对提交号）→「安装系统软件包」装 nsis/zip → `mygo build -platform windows/amd64`（purego 不要 cgo，Linux 能交叉编译）→ 版本号改成 `0.1.<运行号>` →产物包 `toolbox` + 上传 Cloudreve `/builds/toolbox`（先清空，只留最新的安装包和免安装 zip，分享链接固定为 https://cloudreve.haowu.fun/s/qLux）。所以要先把代码推到 GitHub。Windows 专属单测不在流水线里跑
- `.gitattributes`：仓库里统一 LF，`.cmd`/`.bat` 工作区是 CRLF（宿主机 `core.autocrlf=true`，不加的话容器里的 git 总把 `.dev/push.cmd` 算成改过）
- Go module 名是 `toolbox`：`tool` 会和 go.mod 的 `tool` 指令冲突

## 调试 `.dev/`

SSH 会话（session 0）看不到桌面，所以界面相关的操作都通过交互式计划任务跑：

- `launch.cmd`（任务 `ToolboxDev`）：带 WebView2 调试端口 9224 启动已构建的 exe
- `node .dev/cdp.mjs '<js 表达式>' [url 片段]`：在页面里执行 JS，`@文件` 从文件读表达式；不带参数列出页面。默认选工具箱页（不带查询参数的那个），url 片段写 `widget` 选悬浮球页、`bubble` 选提醒气泡页、`overlay` 选监控悬浮窗；`--shot <文件.png> [url 片段]` 截页面（不受其他窗口遮挡）
- `close.ps1`（任务 `ToolboxClose`）：给主窗口发 WM_CLOSE，2 秒后把进程是否还在写进 `.dev/close.log`，测「关闭时隐藏/退出」
- `run-task.ps1 <任务> <日志>`：运行计划任务并等它的脚本写出日志。脚本里的 `Add-Type` 要编译好几秒，固定 sleep 会让结果错位
- `desktop.ps1`（任务 `ToolboxShot`）：截整个虚拟桌面到 `.dev/desktop.png`。会被你的其他窗口挡住，只看工具箱界面用 `cdp.mjs --shot`
- `props.ps1`（任务 `ToolboxProps`）：列出应用窗口的位置、置顶/穿透样式和 display affinity
- `click.ps1`（任务 `ToolboxClick`）：在工具箱窗口客户区坐标（`.dev/click.txt`，DIP）上用注入鼠标点击，模拟远端操作
- `tray.ps1`（任务 `ToolboxTray`）：先发 WM_CLOSE 把窗口隐藏到托盘，再用 UI 自动化左键点托盘图标（会自动展开折叠区），日志在 `.dev/tray.log`。`.dev/tray.txt` 写菜单项名时改成右键再点该项（这条还没跑通）。MyGo 在 Windows 上只有右键弹菜单，左键只触发 `Tray.OnClick`
- `hotkey.ps1`（任务 `ToolboxKey`）：真实按下 `Ctrl+Alt+B`，或 `.dev/hotkey.txt` 里写的虚拟键码（如 `0x11 0x12 0x20`），测全局快捷键。RustDesk 隐私模式开着时它会屏蔽本机注入的键鼠，这时按键和 `tray.ps1` 的右键都不生效
- `hotmsg.ps1`（任务 `ToolboxHotMsg`）：直接给应用的 `MyGoApp` 窗口发 `WM_HOTKEY`，ID 写在 `.dev/hotmsg.txt`。MyGo 按注册顺序编号：启动时 1 是 `Ctrl+Alt+B`，2 是 `Ctrl+Alt+Space`，3 是 `Ctrl+Alt+N`，4 是 `Ctrl+Alt+M`，5 是 `Ctrl+Alt+A`，6 是 `Ctrl+Alt+T`，7 是 `Ctrl+Alt+V`，8 是 `Ctrl+Alt+R`；在设置里改过的键拿下一个编号。不受键鼠屏蔽影响
- `probe.ps1`（任务 `ToolboxProbe`）：试着注册几组快捷键（含 `Ctrl+Alt+N/J`），看哪些被占用（1409 表示已被占用，也就是应用注册上了），顺便写出当前前台窗口
- `.dev/js/quick-add.js`（快速添加对「今晚8点」等的解析，只看提示不添加）、`monitor-ui.js`（系统信息「刷新」后还在、各程序 CPU 占用）、`monitor-hidden.js`（窗口藏到托盘后停止采样、再显示后恢复）、`ai-fail.js`（AI 请求立刻失败时面板显示错误而不是卡在「正在写」，临时改接口地址、测完还原）、`audio-state.js`（页面没被点过时能否出声）、`hide-main.js`（把主窗口关到托盘，之后再启动一次 exe 应把窗口调出来且只有一个进程）、`csp.js`（写进页面的脚本不执行）、`editor-loaded.js`（页面有没有加载编辑器的代码，悬浮球页应为 false）、`embed-view.js`（把测试笔记的嵌入块滚到可见，再 `--shot` 看播放器）、`lazy-tools.js`（看板/图片编辑/开发工具启动时没加载、点开能显示、加载途中切走不串页）。传给 `cdp.mjs` 的表达式带 `>`（如箭头函数）时不要经 `cmd /c`，会被当成重定向在项目根目录生成垃圾文件，写成 `@文件`
- `.dev/gotest.cmd <-run 的正则>`：gofmt -l、go vet ./...、按名字跑 Go 测试，只留 PASS/FAIL 行（host-exec 经 PowerShell 传带引号和 | 的参数会被拆坏，`|` 写成 `^|`）
- 经 `host-exec` 构建要写成 `cmd /c "bun run build -- -platform windows/amd64 > .dev\build.log 2>&1"`：PowerShell 里 bun 写到 stderr 的那行会让整个脚本中止，exe 其实没重新构建
- 含中文的 `.ps1` 要存成带 BOM 的 UTF-8，Windows PowerShell 5 才能读对；给 Win32 的 string 参数传空要用 `[NullString]::Value`，`$null` 会变成空字符串
- `subs-ui.js`：子项的 CDP 测试；`subs-typing.js`：子项打到一半时别的待办变化不丢字、回车后留空框；`nav-leave.js`：各工具来回切几遍后页面照常（前一步用 `setclip.ps1` 复制「来源测试…」时顺带报告它的来源并还原剪贴板）；`services-ui.js`：服务监控（本机死端口约 12 秒后掉线并提醒、百度正常、知道了），测完 `services-clean.js` 删掉全部服务（会删用户自己加的；2026-11-14 已加上用户的 Outline、Flow、NAS 等 6 个服务，别再跑它，改成只删测试加的 ID）
- `desktest.ps1`（任务 `ToolboxTest`）：在桌面会话里运行 `.dev\desktest.exe`（`go test -c -o .dev\desktest.exe .` 编出来），参数写在 `.dev/desktest.txt`（如 `-test.run TestRecord -test.v -test.count=1`），输出到 `.dev/desktest.log`，用 `run-task.ps1 ToolboxTest desktest.log` 等结果；录屏测试的视频留在 `.dev/rec-out/`（`TOOLBOX_RECORD_OUT`），可以用宿主机的 `ffprobe` 看轨道。也设了 WebView2 调试端口，把 Toolbox.exe 拷成 desktest.exe 就能带日志跑应用（单实例：先 `stop.ps1`）。录屏 CDP 脚本在 `.dev/js/rec-*.js`（`rec-full.js` 在选区页单击整屏并开始，`rec-panel.js`/`rec-click.js` 读、点面板）；测完删掉 `视频\工具箱录屏` 里的测试视频（录的是用户的真实屏幕）
- `mem.ps1`：列出 Toolbox 和它的各个 WebView2 进程的内存、CPU 时间（经 `host-exec` 直接跑，不用计划任务）
- `stop.ps1`：结束应用（强杀，不会恢复显示器；断开物理屏时先点恢复，或下次启动自动恢复）
- 各工具自己的 CDP 测试（`.dev/js/*.js`）和桌面实测步骤写在对应的 `docs/<名字>.md` 的「调试」里。`.dev/js/` 在仓库里，`sed` 生成的临时脚本叫 `tmp-*.js`（不进仓库）
