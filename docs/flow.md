# Flow 流水线

从 CLAUDE.md 拆出来的细节：改这部分代码前先读。

## 实现

- `flow.go` + `src/flow.ts`：工具「Flow 流水线」（2026-11-14 加）。用 Flow 的 API 令牌（`Authorization: Bearer`，不用 Cookie 也就不用 `X-Flow-Request`）调 https://flow.haowu.fun：`/api/pipelines/summary?runs=10` 列流水线和最近 10 次运行，`/api/runs/{id}` 任务、步骤进度和输出（`CLOUDREVE_SHARE_URL` 等有名字的输出排前面，其余折起），`/api/jobs/{id}/logs?offset=` 增量日志（第一次只给最后 256KB），运行（只带备注，参数用默认值）/取消/重试。地址、令牌、是否提醒存在 `flow.json`（不放 `settings.json`：设置会广播给所有窗口），页面只拿 `hasToken`；当前令牌是在 Flow 里建的「工具箱」。`watch` 平时每分钟取一次，有运行在跑 10 秒，页面开着 15 秒/有运行 4 秒（窗口藏到托盘不算开着，`setHidden`）。运行从没结束变成 failed（或第一次见到就是一小时内失败的）设 `alert`，第一次取到的不算；经 `Reminder.flow` 进同一个提醒气泡（「构建失败」：看日志=`Flow.Show` 打开页面并定位到该运行和失败任务的日志、重试、知道了），悬浮球红点也算上；打开运行详情就清掉提醒。页面用 `sync` 按 ID 复用元素、`setHTML` 内容没变不替换，所以每几秒刷新不会把滚到一半的日志冲掉。单测 `flow_test.go`（httptest 假 Flow）

## 调试

- `flow-ui.js`：Flow 工具（打开 toolbox 流水线失败的运行看日志、成功运行的输出、运行对话框点取消，不真的运行）。测提醒气泡不要动真 Flow：`fake-flow.mjs`（127.0.0.1:18999 的假 API，运行 15 秒后失败，令牌 `fake`；要和 cdp 命令在同一个 `host-exec` 里启动，SSH 会话结束它就没了）+ `flow-fake-connect.js` 把工具连过去，测完用真令牌 `Flow.SetConfig` 连回 https://flow.haowu.fun
