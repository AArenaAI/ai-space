# AI Pool 待办

## 对话完成通知能力

### 背景

当前对话消息不支持“切屏后完成提醒”：例如用户在对话 A 发起问题后，切换到对话 B、AI 视频、AI 画图等页面，右上角不会收到“对话 A 已完成回复”的通知。

### 当前已有能力

1. **全局 Toast 基础设施已存在**
   - `frontend/app/layout.tsx` 已挂载 `sonner` 的 `<Toaster />`。
   - 当前主要用于上传、删除、复制、报错等普通操作提示。

2. **后端已有后台任务与任务事件流**
   - `ai_background_tasks`
   - `ai_background_task_events`
   - `/api/chat/tasks/:message_id`
   - `/api/chat/tasks/:message_id/events`
   - `/api/tasks/:task_id`
   - `/api/tasks/:task_id/stream`

3. **后端支持断线/切页后的任务恢复**
   - `AIBackgroundTaskEvent` 注释中明确说明：前端断线/切换页面后，可按 `assistant_message_id + sequence` 续流。
   - 说明生成任务本身已具备独立于当前页面继续运行的基础。

### 当前缺失

缺少一个前端全局通知中心 / 全局任务监听器。

目前 `useChat.ts` 中的监听和轮询都挂在当前聊天页面 hook 内：

- 当前聊天页面生成时会监听 SSE / task events。
- 切换对话时，部分 task stream 可以继续。
- 但如果切到 AI 视频、AI 画图、模板页等非聊天页面，聊天页面组件会卸载。
- 卸载时会清理本页轮询和 task stream：

```ts
Object.values(backgroundPollersRef.current).forEach(clearInterval)
Object.values(taskStreamsRef.current).forEach(controller => controller.abort())
```

因此系统不会在全站范围内继续监听“对话 A 已完成”。

### 目标体验

用户在对话 A 发起生成后，即使切换到其他页面，也能在任务完成时收到右上角通知：

> 对话已完成，点击查看回复

点击通知后跳转回对应对话。

### 推荐实现方案

第一版先做轻量全局任务通知，不引入复杂通知系统。

#### 1. 新增全局 Chat Task Store

保存正在生成的聊天任务：

```ts
type ActiveChatTask = {
  conversationId: number;
  serverMessageId?: number;
  taskId?: number;
  title?: string;
  createdAt: number;
  notified?: boolean;
};
```

职责：

- 注册正在生成的对话任务。
- 标记任务完成 / 失败 / 已通知。
- 支持刷新页面后的最小恢复，可选持久化到 `localStorage`。

#### 2. 在 `useChat.sendMessage` 中注册任务

当发送消息成功并拿到以下信息时，注册到全局任务 store：

- `conversationId`
- `serverMessageId`
- `generationTaskId` / `taskId`
- conversation title

注意：注册任务不应影响当前页面原有流式渲染逻辑。

#### 3. 新增全局 `ChatTaskNotifier`

挂载位置建议在主布局或全局 layout 内，保证切到聊天外页面时仍然存在。

职责：

- 读取 active chat tasks。
- 定时检查任务状态，或订阅 task stream。
- 发现任务进入终态时触发 toast。

终态包括：

- `completed`
- `failed`
- `cancelled`
- `incomplete`

#### 4. 第一版推荐使用 Polling

优先用已有接口轮询，降低改动风险：

- `/api/chat/tasks/:message_id`
- 或 `/api/conversations/:id/messages/:message_id`

轮询间隔建议：

- 2 秒一次。
- 任务终态后停止轮询。
- 最长保活时间可设置为 10-30 分钟，避免异常任务永久留存。

#### 5. 通知触发条件

只有当用户不在对应对话页时才弹通知。

判断逻辑：

```ts
const isCurrentConversation =
  pathname.includes('/chat') && currentConversationId === task.conversationId;
```

如果当前就在对应对话页：

- 不弹 toast。
- 只清理任务状态。

如果当前不在对应对话页：

- 弹 toast。
- 点击后跳转到对应 conversation。

#### 6. Toast 交互

通知文案：

```txt
对话已完成，点击查看回复
```

可附带对话标题：

```txt
「{title}」已完成回复
```

点击行为：

```ts
router.push(`/chat?conversation_id=${conversationId}`)
```

如果当前路由实际使用不同参数名，以现有聊天页路由为准。

#### 7. Toaster 位置

当前全局 Toaster 是：

```tsx
<Toaster position="top-center" />
```

如果只想对“对话完成通知”放右上角，有两种方案：

1. 将全局 Toaster 改为 `top-right`。
2. 保持现有 Toaster，不改其他 toast；新增独立通知容器或使用 sonner 的配置实现右上角通知。

第一版建议先改为右上角，成本最低；如果影响其他页面体验，再拆独立通知容器。

### 数据流

```txt
用户在对话 A 发送消息
  ↓
useChat 创建 assistant message / background task
  ↓
注册 ActiveChatTask 到全局 store
  ↓
用户切换到对话 B / AI 视频 / AI 画图页面
  ↓
ChatTaskNotifier 仍在全局布局中运行
  ↓
轮询任务状态
  ↓
任务 completed / failed / cancelled / incomplete
  ↓
如果当前不在对话 A：弹出右上角通知
  ↓
用户点击通知
  ↓
跳回对话 A
```

### 注意事项

1. 不要把通知逻辑继续塞进 `useChat.ts` 的页面生命周期里。
2. 不要依赖当前聊天页面组件存在，否则切到视频/图片页后仍会失效。
3. 通知只负责提醒，不要接管当前流式渲染状态。
4. 当前页面仍由 `useChat` 负责实时流式展示。
5. 全局通知层只需要判断任务终态并提示用户。
6. 要防止重复通知，同一个 task 只提示一次。
7. 任务异常或接口失败时要自动清理，避免本地 store 积累脏数据。

### 后续增强

- 增加顶部铃铛通知中心。
- 增加未读对话红点。
- 支持浏览器系统通知 `Notification API`。
- 支持多任务并发完成后的合并通知。
- 支持图片 / 视频生成任务完成通知复用同一套通知中心。
