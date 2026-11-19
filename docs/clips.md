# 剪贴板

从 CLAUDE.md 拆出来的细节：改这部分代码前先读。

## 实现

- `clips.go` + `clips_windows.go` + `src/clips.ts`：工具「剪贴板」（2026-11-14 加）。MyGo 没有剪贴板变化事件，`Clips.watch` 每 400ms 看 `GetClipboardSequenceNumber`，变了等 100ms 再读：有文件列表记文件，否则有文字记文字（Excel 复制单元格也带图片，文字才是本意），否则记图片（MyGo 读的时候把 DIB 转成 PNG）。带 `ExcludeClipboardContentFromMonitorProcessing` / `Clipboard Viewer Ignore` / `CanIncludeInClipboardHistory` 格式的（密码管理器）不记。同样内容再复制只是移到最前；来源程序名取剪贴板所有者（`GetClipboardOwner`）的进程名，没有才取前台窗口的。数据在 `clipboard.json`（文字全文在 `full`，页面只拿前 2000 字的 `text`），图片在 `clip-files/<id>.png` 经 `clip` scheme（`http://clip.localhost/`）显示；最多保留 `settings.clipboard.max`（100/300/1000，置顶的不算），`pause` 暂停记录。只记纯文字。2026-11-14 审查后改的：`clipboard.json` 用 `writeJSONOnce` 写、不留 `.bak`（删掉/清空的内容不能还留在备份里，`load` 会删旧版本留下的 `.bak`/`.broken` 和没有条目引用的图片文件）；应用自己从历史写回剪贴板后记下 `own`（当时的序号），`watch` 看到这个序号只把条目移到最前、不改来源；没置顶的图片总共最多 200MB（`maxClipImages`，`size` 字段），超出的从旧的删；`settings.clipboard.days`（0/7/30/90）天没再复制过的自动删（`expire` 每 10 分钟看一次），`exclude` 里的程序名（不分大小写、去掉 .exe）复制的不记，两项都在工具页的设置卡片里。全局快捷键 `Ctrl+Alt+V`（action `clipboard`）在鼠标处调出置顶小窗 `/?clips`（第一次调出时创建，之后隐藏复用；回调里要 `go`，建窗口要等主线程），调出前记下前台窗口 `prev`；回车 `Clips.Paste`：写剪贴板、藏窗口、`SetForegroundWindow(prev)`、120ms 后等 Alt/Shift/Win 松开（`waitModifiersUp`：Alt+数字 选的时候 Alt 还按着，Ctrl+V 会变成 Ctrl+Alt+V 把小窗又调出来）再 `SendInput` Ctrl+V。小窗开着时再按快捷键是收起并把焦点还给 `prev`；`summon`/`Hide` 用 `popupMu` 串行。窗口失去焦点就藏起来：但再次显示时页面会先收到一个隐藏前遗留的 blur、紧接着才是 focus（2026-11-14 用户遇到一按就闪掉），所以 blur 150ms 后 `document.hasFocus()` 仍为假才藏；显示 60ms 后还不是前台就 `forceFocus`（`AttachThreadInput` 到前台窗口的线程再 `SetForegroundWindow`）。工具页点一下只复制；工具页的列表在自己的框里滚动（搜索框和分类留在上面，下方「共 N 条」「回到顶部」），全部显示不截断；卡片按类型的类名是 `cl-k-<kind>`（以前写成 `cl-text` 和文字预览的类撞了，整张卡被多行截断）

## 调试

- `clip.ps1`（任务 `ToolboxClip`）：把桌面剪贴板里的内容（图片尺寸或文字）写进 `.dev/clip.log`。SSH 会话的剪贴板和桌面不是同一个，测「复制」要用它
- `setclip.ps1`（任务 `ToolboxSetClip`）：按 `.dev/setclip.txt`（`text:…` / `image:<png>` / `files:<a>|<b>`）设置桌面剪贴板，像别的程序复制一样；页面里的 `navigator.clipboard` 没焦点用不了。`clips-ui.js` 在依次复制「工具箱剪贴板测试 A」「…B」「…A」、`testdata/ocr-en.png`、`go.mod|go.sum` 之后跑
- `pastetarget.ps1`（任务 `ToolboxPasteTarget`）：开一个带文本框的置顶小窗，自己按 Ctrl+Alt+V 调出剪贴板历史（这样前台窗口才是它；`hotmsg` 发的 WM_HOTKEY 不给前台权限，`hotkey.ps1` 的前台是计划任务自己的隐藏控制台，都测不了粘贴），之后 `clips-paste.js`（clips 页）按回车，8 秒后把文本框内容写进 `.dev/pastetarget.log`。`.dev/pastetarget.txt` 写 `alt1` 时脚本自己按 Alt+1（Alt 按住 300ms）选第一条，日志里 `popupAfter` 是之后小窗是否又弹出来。注意：前台不是测试窗口时会粘到用户正在用的窗口里
- `clipsrepro.ps1`（任务 `ToolboxClipsRepro`）：在测试窗口上像人一样按 Ctrl+Alt+V（`.dev/clipsrepro.txt` 设按住 Ctrl+Alt 的毫秒数，默认 400），每 40ms 记录小窗是否可见、谁在前台到 `.dev/clipsrepro.log`；有 `.dev/clipsrepro-away.txt` 时 1.5 秒后把前台抢回来，小窗应收起；有 `.dev/clipsrepro-again.txt` 时 1 秒后再按一次快捷键，小窗应收起、前台回到测试窗口。测试窗口的脚本不能用 `Start-Sleep` 卡住消息循环，否则前台换不过去
