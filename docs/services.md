# 服务监控

从 CLAUDE.md 拆出来的细节：改这部分代码前先读。

## 实现

- `services.go` + `services_windows.go` + `src/services.ts`：工具「服务监控」（2026-11-14 加）。`services.json` 存列表（http 网址：400 以上或连不上算失败，可要求页面含关键字、忽略证书错误，不走代理；tcp 主机:端口；ping 用 `IcmpSendEcho`，不用管理员），间隔 30 秒/1/5/10 分钟。`watch` 每秒看哪个到点，失败一次 10 秒后再查，连续两次失败才算掉线并设 `alert`（`quiet` 的不提醒），恢复自动清掉；状态和最近 60 次延迟只在内存里。开机自启后、以及休眠唤醒后（`watch` 每秒看墙上时钟，跳了 10 秒以上算睡过）先等 20 秒（`hold`）再查，期间的失败不算数，免得网络还没连上就全部报掉线；手动「检查」不等。连不上时先分清是不是本机的问题（`whyAway`）：目标是内网 IP 而本机没有同网段的地址（笔记本不在家，`onLink` 看 `net.InterfaceAddrs`），或者目标不是内网而本机没网（`online`：223.5.5.5:53、119.29.29.29:53、baidu、qq 的 443 有一个连得上就算有，结果缓存 5 秒），状态记 `away`（页面显示「连不到」，灰色），不计失败、不提醒、不进历史。注意这台电脑开着 mihomo 的 TUN（网卡 Meta），10.255.255.1 这种地址 ping 得通、连任意公网 IP 的端口也可能成功，测「连不到」要用 192.168.77.77。掉线和恢复记进 `services-log.json`（`ServiceIncident`，留 200 条；`to` 为 0 是还没恢复，-1 是没恢复时工具箱关了），页面「掉线记录」显示最近 20 次、可清空。给气泡的通知经 `tell`（`tellMu` 串行，每次重新读当前掉线列表，不会旧的盖新的）。掉线的经 `Reminder.services` 进待办提醒同一个气泡（`bubble.ts` 两段：待办到时间 / 服务掉线，「重新检查」「知道了」=`Services.Ack`），悬浮球红点数 = 响铃待办 + 掉线服务，单击球没有待办时打开服务监控。页面下方 Tailscale：`tailscale status --json`（Program Files 里的 tailscale.exe，隐藏窗口），列设备在线情况，「监控」把它的 Tailscale IP 加成 ping。单测 `services_test.go`（httptest、自签名、关着的端口、ping 127.0.0.1、唤醒后的等待、同网段判断、掉线记录；会调 `check` 的测试必须先 `dataDir(t)`，否则掉线记录写进真的数据文件夹）

## 调试

- `services-away.js`：服务监控的掉线记录和「连不到」（加两个静默的测试服务，约 15 秒，测完删掉，不动用户的服务）；`undo-restore.js`：待办和快捷启动删除后的撤销（`Notes.RestoreTodo` / `Launcher.RestoreApp` 按原 ID、原位置放回）、剪贴板的自动删除和排除程序设置。`settings-ui.js` 的输出已去掉 API 密钥，别再把整份设置打出来
