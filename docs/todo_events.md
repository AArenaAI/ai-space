# AI Pool 消息动作事件后续优化方案

## 目标

把当前消息框的动作状态从：

> 前端实时状态 + 少量后端字段 + 局部 UI 判断

升级为：

> 后端统一事件协议 → 可持久化事件/来源 → 前端统一 reducer 渲染 → 刷新/分享/历史一致

---

## 当前状态

已完成的体验修复：

- 推理状态不再出现在顶部动作标签，只保留思考块。
- 搜索完成显示：`已联网搜索 · 引用X个来源`。
- 报错时清理残留动作标签。
- 工具/文件搜索完成后保留静态完成态。
- 搜索来源开始落库，刷新后能恢复。
- `sources_count` 优先级高于 `sources.length`。

这些修复解决了当前体验问题，但底层仍然是“消息字段扩展 + 前端状态拼装”。后续继续扩展工具、文件搜索、MCP、联网来源验证时，建议升级为统一事件架构。

---

# 后续优化方案

## P0：定义统一的消息动作事件协议

当前状态来源比较分散：

- `_activity_meta`
- `_search_meta`
- `_error_meta`
- `activityStatus`
- `searchStatus`
- `searchSources`
- `completedAt`
- 前端 `realtimeStore`

建议统一成一套事件协议。

### 建议事件类型

```ts
type MessageEventType =
  | "generation_started"
  | "generation_delta"
  | "reasoning_started"
  | "reasoning_delta"
  | "reasoning_completed"
  | "web_search_started"
  | "web_search_completed"
  | "file_search_started"
  | "file_search_completed"
  | "tool_call_started"
  | "tool_call_completed"
  | "error"
  | "completed";
```

### 统一事件结构

```ts
interface MessageEvent {
  id: string;
  messageId: number | string;
  type: MessageEventType;
  status?: "running" | "completed" | "failed";
  label?: string;
  sequence: number;
  createdAt: string;
  payload?: Record<string, any>;
}
```

### 收益

- 前端不再猜“现在应该显示什么标签”。
- 刷新历史消息后，动作状态可以完整恢复。
- 分享页、历史页、对比页可以共用同一套状态逻辑。
- 未来工具调用、文件搜索、多轮搜索、MCP 工具都可以继续扩展。

### 涉及文件

后端：

- `backend/internal/api/chat.go`
- `backend/internal/models/conversation.go`
- 可新增：
  - `backend/internal/models/message_event.go`
  - `backend/internal/services/message_event_service.go`

前端：

- `frontend/hooks/useChat.ts`
- `frontend/components/chat/AssistantMessageMeta.tsx`
- 可新增：
  - `frontend/lib/messageEvents.ts`
  - `frontend/lib/messageStatusReducer.ts`

---

## P1：新增独立表 `message_events`

不要继续往 `messages` 表无限追加动作字段。后续动作状态会越来越多，独立事件表更合适。

### 表结构建议

```go
type MessageEvent struct {
    ID        uint           `gorm:"primarykey" json:"id"`
    MessageID uint          `gorm:"not null;index" json:"message_id"`
    Type      string        `gorm:"not null;index" json:"type"`
    Status    string        `gorm:"index" json:"status"`
    Label     string        `json:"label"`
    Sequence  int64         `gorm:"index" json:"sequence"`
    Payload   string        `gorm:"type:text" json:"payload,omitempty"`
    CreatedAt time.Time     `json:"created_at"`
    DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}
```

### `messages` 表保留核心字段

`messages` 只保留核心内容：

- `content`
- `role`
- `model`
- `completed_at`
- `group_id`
- `group_index`

### 渐进迁移策略

阶段一：

- 保留 `search_sources`。
- 保留 `search_sources_count`。
- 新增 `message_events`。
- 新消息双写：既写旧字段，也写 `message_events`。

阶段二：

- 前端优先读 `message_events`。
- 旧字段作为 fallback。

阶段三：

- 稳定后再考虑清理旧字段。

---

## P1：新增独立表 `message_sources`

当前 `search_sources` 是 JSON 字符串，够用但不利于统计、去重和质量校验。

建议拆表：

```go
type MessageSource struct {
    ID          uint      `gorm:"primarykey" json:"id"`
    MessageID   uint     `gorm:"not null;index" json:"message_id"`
    URL         string   `gorm:"type:text;index" json:"url"`
    Title       string   `json:"title"`
    Description string   `gorm:"type:text" json:"description"`
    Provider    string   `json:"provider"`
    Rank        int      `json:"rank"`
    Cited       bool     `gorm:"default:false" json:"cited"`
    Verified    bool     `gorm:"default:false" json:"verified"`
    HTTPStatus  int      `json:"http_status,omitempty"`
    CreatedAt   time.Time `json:"created_at"`
}
```

### 收益

可以区分：

- 找到几个来源。
- 实际引用几个来源。
- 有几个 URL 可访问。
- 有几个被正文引用。
- 来源来自哪个搜索 provider。
- 哪些来源重复。
- 哪些来源质量低。

UI 文案也可以更准确：

- `已联网搜索 · 找到8个来源`
- `已联网搜索 · 引用6个来源`
- `已联网搜索 · 验证5个来源`

避免所有情况都叫“引用X个来源”。

---

## P1：前端统一状态 reducer

当前前端状态逻辑散落在：

- `useChat.ts`
- `AssistantMessageMeta.tsx`
- realtime store
- message 字段

建议集中为一个纯函数：

```ts
deriveMessageStatuses({
  message,
  realtimeEvents,
  persistedEvents,
  sources,
  isStreaming,
});
```

输出统一结构：

```ts
interface DerivedMessageStatus {
  key: string;
  kind: "web_search" | "file_search" | "tool_call" | "generating" | "error";
  label: string;
  tone: "blue" | "green" | "amber" | "red";
  active: boolean;
  priority: number;
}
```

### 状态优先级建议

1. `error`
2. `web_search running`
3. `file_search running`
4. `tool_call running`
5. `generating`
6. `web_search completed`
7. `file_search completed`
8. `tool_call completed`

推理状态不进入顶部标签，只进入思考块。

### 收益

- `AssistantMessageMeta.tsx` 只负责展示。
- `useChat.ts` 只负责接收事件。
- 逻辑可测试。
- 对比模式和普通模式不会再出现标签不一致。

---

## P2：把 SSE 事件和落库事件统一

当前 SSE 给前端一套 meta，后端落库又是另一套逻辑。

建议后端每产生一个动作，统一调用：

```go
emitMessageEvent(messageID, event)
```

这个函数同时做两件事：

1. 通过 SSE 发给前端。
2. 写入 `message_events`。

这样可以保证：

- 实时看到的状态。
- 刷新后的状态。
- 分享页看到的状态。

三者一致。

### 关键约束

- `DONE` 必须最后。
- 最终 `message.content` 落库后再发完成事件。
- 错误事件必须终止当前 running 状态。

---

## P2：来源数量语义优化

现在显示：

> 已联网搜索 · 引用8个来源

但严格来说，`8` 是 sources 数量，不一定等于“正文实际引用8处”。

建议拆成三个数字：

```ts
{
  foundCount: 8,
  citedCount: 6,
  verifiedCount: 5,
}
```

### UI 文案建议

普通情况：

> 已联网搜索 · 找到8个来源

如果正文明确引用了来源：

> 已联网搜索 · 引用6个来源

如果做了 URL 校验：

> 已联网搜索 · 验证5个来源

不要在没有正文引用检测时直接叫“引用”。

---

## P2：来源去重和 URL 标准化

如果搜索服务返回重复 URL，前端可能会显示重复来源。

建议后端统一处理：

- 去除 `utm_*`。
- 去除尾部 `/`。
- 统一 http/https。
- 同域同 path 去重。
- title 为空时用域名兜底。
- description 为空时隐藏摘要。

建议新增函数：

```go
NormalizeSearchSources(sources []SearchResult) []SearchResult
```

可放在：

- `backend/internal/services/search_service.go`
- 或新增 `backend/internal/services/source_normalizer.go`

---

## P2：动作状态详情面板

顶部标签只展示摘要，不要塞太多信息。

可以支持点击标签展开详情。

### 搜索详情

- 搜索 query。
- 来源列表。
- 来源标题。
- URL。
- 是否已引用。
- 是否已验证。

### 工具详情

- 工具名称。
- 调用参数摘要。
- 调用耗时。
- 是否成功。
- 错误原因。

### 文件搜索详情

- 搜索关键词。
- 命中文件。
- 命中片段。
- 分数。

---

## P3：分享页和历史页统一消息渲染

需要确认这些页面是否都吃到了新字段：

- `frontend/components/share/ShareContent.tsx`
- `frontend/components/share/ShareView.tsx`
- `frontend/components/chat/MessageList.tsx`
- `frontend/components/chat/ChatMessageItem.tsx`

后续最好让分享页也使用同一个：

```tsx
<AssistantMessageMeta />
```

并输入同一套：

- `message.events`
- `message.sources`
- `message.activityStatus`

否则聊天页修好了，分享页仍可能显示不一致。

---

## P3：测试补齐

至少补四类测试。

### 1. 状态 reducer 单测

覆盖：

- 正在搜索。
- 搜索完成。
- 搜索完成 + 生成中。
- 工具调用完成。
- 报错后清理 running 状态。
- 推理不显示顶部标签。

### 2. SSE 顺序测试

保证：

```txt
search_started
search_completed
generation_delta
completed
DONE
```

不能出现：

```txt
DONE
completed
```

### 3. 历史恢复测试

创建一条带 sources/events 的消息，重新加载 conversation，确认：

- 标签还在。
- 来源数量还在。
- 分享页也一致。

### 4. 对比模式测试

确认普通聊天和 compare 分支一致。

---

# 推荐实施顺序

## Phase 1：稳定当前逻辑

优先级最高，风险低。

任务：

- 抽 `deriveMessageStatuses`。
- 给状态派生逻辑加单测。
- 普通模式 / 对比模式共用同一套状态转换。
- 分享页复用同一展示逻辑。

产出：

- 前端状态逻辑稳定。
- 减少重复判断。

---

## Phase 2：后端事件表

中等风险，但收益最大。

任务：

- 新增 `message_events`。
- 后端流式过程写事件。
- 前端加载历史消息时读取 events。
- 保留旧字段 fallback。

产出：

- 刷新 / 分享 / 历史一致。
- 后续工具状态、搜索状态不用继续扩 `messages`。

---

## Phase 3：来源表

适合跟搜索体验一起做。

任务：

- 新增 `message_sources`。
- 搜索结果去重。
- URL 标准化。
- 区分 found / cited / verified。
- UI 文案从“引用X个来源”升级为更准确的语义。

产出：

- 搜索来源可信度更高。
- 以后可以做统计和质量分析。

---

## Phase 4：状态详情 UI

等事件和来源结构稳定后再做。

任务：

- 点击动作标签打开详情。
- 搜索来源列表。
- 工具调用详情。
- 文件搜索命中详情。

产出：

- 用户能理解模型正在做什么、做过什么。
- 适合高阶用户排查结果可靠性。

---

# 推荐最终架构

```txt
后端模型调用
   ↓
统一 MessageEvent
   ↓
SSE 实时下发  ─────→ 前端 realtime events
   ↓
message_events 落库
   ↓
历史/分享加载
   ↓
前端 deriveMessageStatuses()
   ↓
AssistantMessageMeta 渲染标签
```

来源单独走：

```txt
搜索服务返回 sources
   ↓
Normalize / Dedup / Verify
   ↓
message_sources 落库
   ↓
derive source count
   ↓
UI 显示：找到 / 引用 / 验证
```

---

# 最推荐先做的 3 件事

1. 先抽前端 `deriveMessageStatuses`
   - 风险最低。
   - 立刻减少状态分叉。
   - 以后后端改事件表，前端不用大改 UI。

2. 再加 `message_events` 表
   - 解决动作状态不可持久化的问题。
   - 是长期正确架构。

3. 最后拆 `message_sources` 表
   - 解决“引用X个来源”的语义准确性。
   - 支持后续统计、分享、质量校验。
