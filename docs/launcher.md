# 快捷启动

从 CLAUDE.md 拆出来的细节：改这部分代码前先读。

## 实现

- `launcher.go` + `launcher_windows.go` + `src/launcher.ts`：工具「快捷启动」（侧栏第一项）。分类和条目存在 `%APPDATA%\Toolbox\launcher.json`（先写 `.tmp` 再改名），条目在数组里的顺序就是显示顺序，每次修改都广播 `launcherChanged` 把完整数据发给页面。运行用 `ShellExecuteW`（管理员用 `runas` 动词，用户取消 UAC 不算错误；没填起始位置时用文件所在目录），图标用 `mygo.Shell.FileIcon`（也支持 `shell:AppsFolder\<AUMID>` 形式的商店应用），`Icons` 按路径缓存并记下文件的修改时间和大小，文件换过（程序出了新版）就重新取，页面每次显示也都向 Go 要一遍（2026-11-16：QuickOpen.exe 补上图标后工具箱一直显示空白文件图标，要重启才好）；`FileIcon` 要等应用主线程，单测里调会卡死。「从已装软件添加」会扫开始菜单和桌面上的快捷方式，商店应用用 `Get-StartApps` 补，只取 AppID 带 `!` 的。`Ctrl+Alt+Space` 会设 `summoned` 标记，这之后按 Esc 会把窗口再藏起来；用托盘或关窗口打开就清掉这个标记。运行软件后是否藏窗口由设置「快捷启动 → 启动软件后隐藏窗口」（`settings.launcher.hideAfterLaunch`，默认开）决定，不管窗口是怎么打开的；`summoned` 只管 Esc。Go 的 `omitempty` 会让未分类条目没有 `category` 字段，页面在 `setData` 里补成 `""`。搜索支持拼音首字母：不加依赖，用 `Intl.Collator("zh-Hans-CN-u-co-pinyin")` 拿每个汉字和 ICU 的索引边界字（阿八嚓…帀）比较得出首字母，多音字查 `POLYPHONES` 表（几个读音都能匹配），英文名按单词首字母匹配；测试脚本是 `.dev/js/pinyin-search.js`

## 调试

- `.dev/js/launcher-*.js`：快捷启动的 CDP 测试（`launcher-reset.js` 准备数据，`launcher-ui.js` 测添加，`launcher-ops.js` 测运行、搜索、拖动、分类和删除），会启动并删除记事本条目
