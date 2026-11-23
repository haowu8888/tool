# Toolbox 工具箱

Toolbox 是一个面向 Windows 的桌面工具箱，在同一个应用里提供截图录屏、剪贴板历史、快捷启动、笔记待办和系统监控。常用操作可用全局快捷键或托盘菜单打开。

## 主要功能

| 工具 | 用途 |
| --- | --- |
| [截图与翻译](docs/shot.md) | 区域截图、标注、贴图、长截图、OCR 和截图翻译 |
| [屏幕录制](docs/record.md) | 录制选区或整屏，可选系统声音和麦克风 |
| [图片编辑](docs/imageedit.md) | 裁剪、调色、标注、去背景、拼图和合并文档 |
| [剪贴板历史](docs/clips.md) | 搜索文本和图片历史，打开快捷面板粘贴 |
| [快捷启动](docs/launcher.md) | 搜索并打开常用程序，支持拼音首字母搜索 |
| [笔记与待办](docs/notes.md)、[看板](docs/board.md) | 编辑富文本笔记，管理带提醒和重复规则的待办，用看板整理事项 |
| [系统监控](docs/monitor.md)、[服务监控](docs/services.md) | 查看系统资源和端口占用，跟踪服务状态 |
| [开发工具](docs/devtools.md)、[Flow 流水线](docs/flow.md) | 使用开发小工具，连接 Flow 后查看和运行流水线 |
| [虚拟显示器](docs/virtualscreen.md)、[桌宠](docs/widget.md) | 使用兼容驱动切换虚拟显示器，或用桌面悬浮球打开常用工具 |

AI 写作可在设置中连接 OpenAI 兼容接口。截图翻译可使用内置的在线翻译服务，也可以单独配置 AI 翻译接口。

## 常用快捷键

| 默认按键 | 操作 |
| --- | --- |
| `Ctrl+Alt+Space` | 调出快捷启动 |
| `Ctrl+Alt+N` | 快速记一条待办 |
| `Ctrl+Alt+A` | 截图 |
| `Ctrl+Alt+T` | 截图翻译 |
| `Ctrl+Alt+V` | 打开剪贴板历史 |
| `Ctrl+Alt+R` | 开始或停止录屏 |
| `Ctrl+Alt+M` | 显示或隐藏监控悬浮窗 |

可以在「设置」里更改或禁用快捷键。应用设置、笔记和其他本机数据默认保存在 `%APPDATA%\Toolbox`。

## 从源码运行

在 Windows 上准备 Go 1.27.3 或更高版本、Bun 和 WebView2 Runtime。生成 Windows 安装包还需要 NSIS。

```bash
git clone https://github.com/haowu8888/tool.git
cd tool
bun install
bun run dev
```

## 检查与构建

```bash
bun run typecheck
bun test ./.dev/test/calc.test.ts ./.dev/test/image.test.ts
bun run build -- -platform windows/amd64
```

Windows x64 构建产物在 `build/windows-amd64/`。部分 Windows 集成测试需要交互式桌面会话，运行条件见相应功能文档。

应用用 Go 和 MyGo 提供原生窗口与系统功能，界面使用 TypeScript 和 Vite 构建。应用入口和本地数据说明见 [应用文档](docs/app.md)，各模块的实现索引见 [开发笔记](CLAUDE.md)。
