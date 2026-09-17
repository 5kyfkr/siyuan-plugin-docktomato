## Usage Instructions

- After enabling the plugin, click Start in the bottom-right status bar to begin timing.
- Right-click the timer area to open the timer menu panel.
- During timing, right-click and hold the bottom area to stop the timer.
- After enabling the sync feature, the timer state will persist even after closing and restarting SiYuan; recommended to enable.

## Third-party focus API

Dock Tomato exposes an optional versioned facade at `window.__dockTomato.focus`. Consumers must require `version === 1`, inspect the frozen `capabilities` list when present, handle `DOCK_TOMATO_NOT_READY` / `DOCK_TOMATO_TIMER_BUSY` without replacing the active session, and listen for `tomato:focus-api-availability-changed` so either plugin may load first. The current capabilities are `status`, `start`, `pause`, `completion-event`, and `history-context`.

`start({context})` uses the configured default tomato duration unless `durationMinutes` is supplied. A supplied context that cannot be safely normalized is rejected with `DOCK_TOMATO_INVALID_CONTEXT` rather than silently losing correlation. Safe primitive context is bound to the newly allocated focus session and echoed by `tomato:focus-session-completed` only after that focus history transaction is durable. The completion payload includes a stable `sessionId` for idempotency and the actual duration. Breaks, partial segments, later manual sessions and abandoned sessions are not reported as that external completion. `pause()` pauses non-destructively so the user can resume or abandon the timer in Dock Tomato.

The facade is consumer-neutral and does not expose internal storage or mutable timer state. Completion is delivered as a live browser event rather than a durable message queue; consumers should deduplicate by `sessionId`, and must not assume an event can be replayed after their own reload. The persisted history context is reserved for a future explicit reconciliation API.

## 1.7.6

- Fixed: Timeline toggle could re-appear after sleep/background sync; disabling now stays disabled.

## 1.7.3

- Added: integration with Task Horizon (task manager) plugin
- Fixed: Dock panel may become blank after PC sleep/resume; auto-recover on wake
- Fixed: “Today” filter in reminders incorrectly shows next occurrences (e.g., next week)
- Fixed: QYL theme status bar hide misalignment in fullscreen; keep status bar visible

For detailed feature descriptions, see the post below. 

[\[js\] 底部状态栏番茄钟【V9.0 多端状态同步 / 移动端 / 数据库联动 / 块绑定 / 历史记录】 - 链滴](https://ld246.com/article/1767077931114)
