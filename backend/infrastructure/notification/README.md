# Notification Infrastructure

## 页面内提醒（In-App Reminders）

页面打开期间通过 HTTP 轮询领取并展示日程提醒。

### 架构

- **服务端**: `POST /api/reminders/claim-due` 在 SQLite 事务内原子领取到期提醒，标记 `reminderTriggered`。
- **轮询调度**: `frontend/hooks/useInAppReminders.ts` — 挂载时立即请求，每 30 秒轮询一次，`visibilitychange` 变为 `visible` 时触发，同一时刻最多一个请求。
- **应用内 toast**: `frontend/components/ReminderToastHost.tsx` — 提醒队列依次展示，每条停留 8 秒或手动关闭。
- **浏览器 Notification**: `frontend/infrastructure/notification/browserNotification.ts` — 可选增强，需用户主动点击开启。

### 边界

- 只支持页面打开期间提醒。
- 使用 HTTP 轮询，不使用 WebSocket。
- 不做 Service Worker、Push API 或离线提醒。
- 不承诺页面关闭后通知。
- toast 是基础能力，Notification API 是可选增强。
- Notification 未授权或被拒绝时 toast 仍然正常工作。
- 不新增独立提醒表或 Reminder 实体。
