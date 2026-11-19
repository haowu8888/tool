# 看板

从 CLAUDE.md 拆出来的细节：改这部分代码前先读。

## 实现

代码按需加载（`src/toolbox.ts` 的 `lazyTool` 第一次打开时才 `import("./board")`），别的模块别静态 import 它。

- `board.go` + `src/board.ts`：工具「看板」（2026-11-16 加，侧栏在笔记待办后面，仿 https://multica.ai 的任务看板 / Linear）。数据在 `board.json`：任务（`#编号`、标题、描述、状态、优先级、项目、多个标签、截止日期、子任务、动态）、项目、标签（第一次打开建 Bug/功能/改进 三个），`Issues` 数组里的顺序就是列内顺序，每次修改广播 `boardChanged` 带全部数据。状态固定 6 列：待规划/待办/进行中/审核中/已阻塞/已完成（`boardStatuses`），优先级 紧急/高/中/低/无。`Create` 放到所在列最上面；`Update` 拿页面发来的整条任务改可编辑字段，标题/状态/优先级/项目/截止日期的变化记进 `activity`（评论也在里面，最多 200 条），评论和编号不从页面取；`Move(id, status, before)` 同快捷启动；`change` 在深拷贝上改，出错不留半截。页面：左栏视图（全部/未完成/紧急和高优先级/到期和逾期（3 天内）/最近更新）+ 项目 + 标签（可多选叠加筛选，右键编辑），顶栏搜索（标题、描述、`#编号`、拼音首字母，复用 `launcher.ts` 的 `initialsIndex`）、排序、看板/列表切换（状态记在 localStorage `board-view`）；卡片 HTML5 拖放换列和排序（不是手动排序时只换状态），列可收起；点卡片右侧滑出详情（属性用 `menu` 弹出菜单选，描述停 600ms 自动保存，子任务、评论 Ctrl+Enter）；右键卡片菜单；快捷键 C 新建、/ 搜索、Esc 关详情。页面的修改先改本地 `data` 立刻重画，再经 `send` 排队依次发给 Go，期间不理会广播，最后一个完成后 `Board.list()` 取回（同设置页的做法，否则连续两次修改后一次会带着旧值把前一次盖掉）。单测 `board_test.go`，CDP `.dev/js/board-ui.js`（测完 `board-clean.js`），截图样例 `board-sample.js` / `board-sample-clean.js`（同一个页面里跑，ID 记在 `window.__bdSample`）
