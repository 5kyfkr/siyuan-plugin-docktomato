## Usage Instructions

Optional focus integration is available on this development branch. Enable **第三方专注联动（小驴打卡等）** under Settings → Main → Switches. It is off by default; disabling it leaves the current timer running. Existing statistics and task integrations remain independent.

When enabled, `window.__dockTomato.focus` exposes version `1` with `getStatus()`, `start({durationMinutes?, context?})`, and `pause({sessionId})`. Start commits the final session ID and consumer context together. Scoped pause validates the enabled setting, focus phase, and session ID under the timer writer lock. A stale facade cannot issue new commands after disable/re-enable.

`tomato:focus-api-availability-changed` includes `{available, ready}`. `tomato:focus-session-completed` is emitted after durable completion with `sessionId`, `recordId`, ISO `completedAt`, actual cumulative `durationMinutes` (excluding pauses/breaks), `plannedDurationMinutes`, and `context`. Consumers must deduplicate by session ID and persist received notifications themselves; these browser events are not a durable cross-process queue. Use completion events for automatic check-ins and the stats facade for read-only queries.

See the [Chinese API contract](README_zh_CN.md#第三方专注联动开发分支) for capabilities, payload limits and error codes. The protocol builds on [PR #5 by ai68298100](https://github.com/5kyfkr/siyuan-plugin-docktomato/pull/5), with revised transactions, opt-in settings and lifecycle handling.

- After enabling the plugin, click Start in the bottom-right status bar to begin timing.
- Right-click the timer area to open the timer menu panel.
- Right-click and hold the bottom timer or timeline for 0.5 seconds to complete the current focus session using its actual accumulated time. Enabled integrations receive the completion; during a break, this ends the break instead.
- After enabling the sync feature, the timer state will persist even after closing and restarting SiYuan; recommended to enable.

## 1.7.6

- Fixed: Timeline toggle could re-appear after sleep/background sync; disabling now stays disabled.

## 1.7.3

- Added: integration with Task Horizon (task manager) plugin
- Fixed: Dock panel may become blank after PC sleep/resume; auto-recover on wake
- Fixed: “Today” filter in reminders incorrectly shows next occurrences (e.g., next week)
- Fixed: QYL theme status bar hide misalignment in fullscreen; keep status bar visible

For detailed feature descriptions, see the post below. 

[\[js\] 底部状态栏番茄钟【V9.0 多端状态同步 / 移动端 / 数据库联动 / 块绑定 / 历史记录】 - 链滴](https://ld246.com/article/1767077931114)
