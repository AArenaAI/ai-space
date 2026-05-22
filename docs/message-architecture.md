# AI Pool 消息架构分析

## 一、整体链路概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              上层模型厂商层                                   │
│  OpenAI Responses API    Anthropic Messages    Gemini        DeepSeek       │
│  (SDK typed stream)      (HTTP SSE)            (HTTP SSE)    (HTTP SSE)     │
│       │                        │                    │            │          │
│       ▼                        ▼                    ▼            ▼          │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐               │
│  │ OpenAI SDK   │     │ ChatSSE      │     │ GeminiDecoder│  ChatSSE      │
│  │ TypedDecoder │     │ Decoder      │     │              │  Decoder      │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘  └──────┬──────┘
│         │                    │                    │                 │       │
│         └────────────────────┴────────────────────┴─────────────────┘       │
│                                   │                                          │
│                                   ▼                                          │
│                           AIStreamEvent (统一事件)                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              后端服务层 (Go/Gin)                              │
│                                                                              │
│   ┌─────────────┐    ┌────────────────────┐    ┌─────────────────────────┐  │
│   │  ChatHandler│    │   AIService        │    │  ProviderAdapter        │  │
│   │  (api/)     │◄───│   (services/)      │◄───│  (ai_adapter.go)        │  │
│   │             │    │  ChatCompletion()  │    │  UnifiedAIRequest       │  │
│   └──────┬──────┘    └────────────────────┘    └─────────────────────────┘  │
│          │                                                                  │
│          ├─ stream=true  → runGenerationTask() → forwardUnifiedStream()    │
│          │                    │                    │                         │
│          │                    │                    ▼                         │
│          │                    │         上游 SSE → AIStreamEvent              │
│          │                    │                    │                         │
│          │                    │                    ▼                         │
│          │                    │         持久化到 DB + SSE 写前端              │
│          │                    │         (ai_background_task_events)           │
│          │                    │                    │                         │
│          │                    │                    ▼                         │
│          │                    │         streamGenerationTaskEvents()         │
│          │                    │         轮询 DB → 按 sequence 发送 SSE        │
│          │                    │                    │                         │
│          │                    └────────────────────┘                         │
│          │                                                                  │
│          ├─ stream=false → 直接调用 ChatCompletion → 返回 JSON              │
│          │                                                                  │
│          ├─ background=true → handleBackgroundResponse()                    │
│          │                    → 创建 task → 前端轮询 + Webhook 回调          │
│          │                                                                  │
│          └─ /chat/compare → 并行 callModel() → 收集结果 → JSON              │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         数据持久化                                   │   │
│   │  ai_background_tasks (任务元数据)                                    │   │
│   │  ai_background_task_events (事件序列，支持断线续流)                   │   │
│   │  messages (最终消息内容)                                             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              前端层 (React/Next.js)                           │
│                                                                              │
│   ┌─────────────────┐    ┌─────────────────────┐    ┌───────────────────┐   │
│   │  useChat.ts     │    │  lib/streaming.ts   │    │  MessageList.tsx  │   │
│   │                 │    │                     │    │                   │   │
│   │ streamResponse()│◄───│ streamAppend()      │    │ streamSubscribe() │   │
│   │ (直连 /api/chat │    │ streamGet()         │    │ (实时渲染)        │   │
│   │  SSE 解析)      │    │ realtimeUpdate()    │    │                   │   │
│   │                 │    │ (全局 Map + rAF)    │    │                   │   │
│   │ startTaskEvent  │    │                     │    │                   │   │
│   │ Stream()        │    │                     │    │                   │   │
│   │ (订阅 task      │    │                     │    │                   │   │
│   │  events)        │    │                     │    │                   │   │
│   └─────────────────┘    └─────────────────────┘    └───────────────────┘   │
│                                                                              │
│   请求发起:                                                                  │
│   - 普通聊天: sendMessage() → fetch POST /api/chat (stream=true)           │
│   - 对比模式: handleSend() → 并行 fetch (每个模型一个请求)                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、后端架构详解

### 2.1 Adapter 模式：统一多厂商差异

**文件**: `backend/internal/services/ai_adapter.go`

```go
type ProviderAdapter interface {
    ChatCompletion(ctx context.Context, req UnifiedAIRequest) (io.ReadCloser, error)
}
```

| Adapter | 模型 | 调用方式 |
|---------|------|---------|
| `openaiAdapter` | gpt-4o, o3, gpt-5.5-pro 等 | `openai-go` SDK |
| `anthropicAdapter` | claude-3.7-sonnet 等 | HTTP POST |
| `geminiAdapter` | gemini-2.5-pro 等 | HTTP POST (SSE) |
| `deepseekAdapter` | deepseek-chat 等 | HTTP POST |
| `moonshotAdapter` | kimi-k2.6 等 | HTTP POST |

`AIService.ChatCompletion()` 根据 `model` 字段路由到对应 adapter，所有 adapter 返回统一的 `io.ReadCloser` (SSE body)。

### 2.2 流式解码器：厂商格式 → 统一事件

**文件**: `backend/internal/services/stream_*.go`

```
NewDecoder(modelType, body) → Decoder
    ├── "openai_responses" → error (强制用 SDK typed decoder)
    ├── "anthropic" / "deepseek" / "moonshot" → ChatSSEDecoder
    └── "gemini" → GeminiDecoder
```

**统一事件类型** (`AIStreamEvent`):

| 事件类型 | 用途 |
|---------|------|
| `EventTextDelta` | 文本增量 |
| `EventReasoningDelta` | 推理过程增量 (o3/gemini-thinking) |
| `EventSearchStart/Done` | 网页搜索状态 |
| `EventFileSearchStart/Done` | 文件搜索状态 |
| `EventToolCallStart/Done` | 工具调用状态 |
| `EventResponseCreated` | 响应创建 (OpenAI Responses API) |
| `EventUsage` | Token 用量 |
| `EventError` | 错误 |
| `EventDone` | 流结束 |

**特殊处理**:
- **OpenAI Responses API**: 使用 `openai-go` SDK 的 typed stream decoder，避免自行解析 JSON 的脆弱性
- **Gemini**: 额外处理 `groundingMetadata` 中的引用来源，流结束前 flush 为 Markdown 链接列表
- **SSE 解析**: 自定义 `SSEParser`，支持 8MB 单行、16MB 单事件（应对 GPT-5x 超长响应）

### 2.3 ChatHandler.Chat() — 流式路径

**文件**: `backend/internal/api/chat.go` (L519+)

```
1. 参数校验 → 限流检查 → 构建 system prompt + RAG 上下文
2. 创建空的 assistant 占位消息 (messages 表)
3. 创建 AIBackgroundTask (ai_background_tasks 表)
4. 启动 goroutine: runGenerationTask()
   ├── 调用 aiService.ChatCompletion(ctx, ..., stream=true)
   ├── adapter 调用上游模型，返回 SSE body
   ├── forwardUnifiedStream():
   │   ├── decoder.Next() 读取 AIStreamEvent
   │   ├── 转换为 SSE data: {...} 格式
   │   ├── persistTaskEvent() → DB (ai_background_task_events)
   │   └── 每 2s flush 增量内容到 messages 表
   └── goroutine 退出时标记 task 完成
5. HTTP handler 通过 streamGenerationTaskEvents() 返回 SSE
   ├── 轮询 DB 读取 ai_background_task_events
   ├── 按 sequence 顺序发送 (id: <seq>\ndata: {...}\n\n)
   └── 支持 after=<seq> 参数断线续流
```

**关键设计**: HTTP handler 不直接持有上游 SSE 连接，而是通过 DB 轮询解耦。这意味着：
- 前端断线后可以重连，从断点续接
- 页面刷新后可以从 DB 恢复历史事件
- 后台任务（background=true）也能通过同一套机制推送结果

### 2.4 ChatHandler.Chat() — 非流式路径

```
1. 参数校验 → 限流检查 → 构建上下文
2. 直接调用 aiService.ChatCompletion(ctx, ..., stream=false)
3. 读取完整 body
4. 如果是 background 任务:
   ├── handleBackgroundResponse() → 创建 AIBackgroundTask
   ├── 返回 {task_id, status: "queued"}
   └── 前端轮询 /api/tasks/{id} 或等 Webhook
5. 否则:
   ├── 解析 usage
   ├── 保存 assistant 消息到 messages 表
   └── 返回 JSON {content, usage, model}
```

### 2.5 对比模式 CompareChat

**文件**: `backend/internal/api/chat.go` (L1692+)

```
1. 并行调用多个模型 (callModel())
2. 每个 callModel() 内部:
   ├── 调用 aiService.ChatCompletion(ctx, ..., stream=false)
   ├── 读取完整 body
   └── 解析结果
3. 收集所有结果 → 返回 JSON
   {
     "results": [
       { "model_id": "gpt-4o", "content": "...", "elapsed_ms": 1234 },
       { "model_id": "claude-3.7", "content": "...", "elapsed_ms": 2345 }
     ]
   }
```

**特点**: 纯非流式，没有实时反馈。每个模型独立超时（30s）。

### 2.6 Background 任务模式

**触发条件**: `ShouldUseOpenAIBackground(model, reasoningEffort)` — 当 model 为 gpt-5.5-pro 且 reasoningEffort 为 "high" 时。

**流程**:
```
1. 调用 OpenAI Responses API (background=true, stream=true)
2. 返回的是任务创建响应，不是最终答案
3. 后端创建 AIBackgroundTask，记录 response_id
4. 前端收到 _background_task 元数据，开始轮询
5. OpenAI 完成推理后，调用 Webhook (/api/openai/webhook)
6. Webhook handler:
   ├── 验证签名
   ├── 调用 RetrieveOpenAIResponse(response_id) 获取结果
   └── 更新 AIBackgroundTask + messages 表
7. 前端轮询到 completed 状态，显示结果
```

---

## 三、前端架构详解

### 3.1 Streaming Store — 全局实时数据管理

**文件**: `frontend/lib/streaming.ts`

```typescript
// 全局 Map，key = localMessageId
const store = new Map<string, RealtimeData>();

// 订阅机制：requestAnimationFrame 批量触发
let scheduled = false;
function scheduleFlush() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    // 遍历所有订阅者，发送 delta + full
    for (const [id, subs] of subscribers) {
      const data = store.get(id);
      if (!data) continue;
      const delta = data._pending;
      data._pending = "";
      if (delta) {
        for (const cb of subs) cb(delta, data.content, data);
      }
    }
  });
}
```

**特点**:
- 独立于 React state，避免 setState 高频触发
- 通过 rAF 批量合并增量，减少渲染次数
- `streamAppend()` 追加增量，`streamGet()` 获取当前内容
- `realtimeUpdate()` 更新元数据（activityStatus、searchStatus 等）

### 3.2 useChat.ts — 请求发起与流式处理

**文件**: `frontend/hooks/useChat.ts`

#### 普通聊天 — sendMessage()

```typescript
const response = await fetch(`${API_BASE_URL}/api/chat`, {
  method: "POST",
  body: JSON.stringify({
    model: selectedModel.id,
    messages: contextMessages,
    stream: true,              // ← 流式请求
    conversation_id: convId,
    reasoning: reasoning.enabled,
    search: search,
    // ...
  }),
});
await streamResponse(response, assistantMsg, controller, convId);
```

#### 对比模式 — handleSend()

```typescript
// 并行发起多个请求
await Promise.all(assistantMsgs.map((assistantMsg, index) => runModel(assistantMsg, index)));

// 每个 runModel() 内部
const response = await fetch(`${API_BASE_URL}/api/chat`, {
  method: "POST",
  body: JSON.stringify({
    model: assistantMsg.model,
    messages: contextMessages,
    stream: true,
    skip_save_user_msg: index > 0,  // 第二个模型起不重复保存 user 消息
  }),
});
await streamResponse(response, assistantMsg, controller, convId);
```

**对比模式实际是并行流式**，每个模型独立 SSE。但后端 `CompareChat` 是纯非流式，这里前端走的是普通 `/api/chat` 端点（只是并行调用多次）。

### 3.3 streamResponse() — 直连 SSE 解析

**文件**: `frontend/hooks/useChat.ts` (L664+)

```typescript
const reader = response.body?.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  
  // 按 \n\n 分割 SSE event
  while ((idx = buffer.indexOf("\n\n")) >= 0) {
    const eventText = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    processEvent(eventText);
  }
}
```

**processEvent 处理的事件类型**:

| 后端事件 | 前端处理 |
|---------|---------|
| `_chat_meta` | 提取 request_id |
| `_generation_task` | 提取 task_id + assistant_message_id，后续切换到 task event stream |
| `_background_task` | 标记为后台任务，开始轮询 |
| `_error` / `_error_meta` | 显示错误，停止渲染 |
| `_activity_meta` | 更新 activityStatus（如"正在搜索"） |
| `_search_meta` | 更新 searchStatus + searchSources |
| `choices[0].delta.content` | 追加文本到 streaming store |
| `choices[0].delta.reasoning_content` | 追加 `<think>` 标签包裹的推理内容 |
| `[DONE]` | 标记完成，清理 streaming store |

**推理内容处理**:
```typescript
if (reasoningDelta) {
  if (!inReasoningBlock) {
    delta += "<think>";
    inReasoningBlock = true;
  }
  delta += reasoningDelta;
} else if (contentDelta) {
  if (inReasoningBlock) {
    delta += "</think>";
    inReasoningBlock = false;
  }
  delta += contentDelta;
}
```

### 3.4 startTaskEventStream() — 断线续流

**文件**: `frontend/hooks/useChat.ts` (L244+)

当 `streamResponse()` 收到 `_generation_task` 后，前端会创建一个新的 SSE 连接，订阅后端 task events：

```typescript
const streamUrl = generationTaskId
  ? `${API_BASE_URL}/api/tasks/${generationTaskId}/stream?after=${after}`
  : `${API_BASE_URL}/api/chat/tasks/${serverMessageId}/events?after=${after}`;

const res = await fetch(streamUrl, { headers, signal: controller.signal });
// 同样的 SSE 解析逻辑...
```

**断线续流机制**:
- `after=<seq>` 参数告诉后端从哪个 sequence 开始发送
- 前端维护 `latestSequence` 和 `accumulated` 内容
- 断线后重连，从断点续接，不会丢失增量

**fallback**: 如果 SSE 连接失败，切换到 `startBackgroundPolling()` 轮询模式。

### 3.5 前端状态同步

**问题**: streaming store 是独立于 React state 的，需要手动同步。

**同步点**:
1. `streamResponse() finally` 中:
   ```typescript
   const finalData = realtimeGet(assistantMsg.id);
   setMessages(prev => prev.map(m => {
     if (m.id !== assistantMsg.id) return m;
     return { ...m, content: finalData?.content || accumulated, ...finalData };
   }));
   streamClear(assistantMsg.id);
   realtimeClear(assistantMsg.id);
   ```

2. `startTaskEventStream() finally` 中:
   ```typescript
   const finalData = realtimeGet(localMessageId);
   setMessages(prev => prev.map(m => {
     if (m.id !== localMessageId) return m;
     return { ...m, content: finalData?.content || accumulated, lastSequence: Math.max(m.lastSequence || 0, latestSequence) };
   }));
   ```

---

## 四、关键设计决策与权衡

### 4.1 为什么后端要做任务事件持久化？

**收益**:
- ✅ 支持断线续流（网络抖动、页面刷新）
- ✅ 支持后台任务（background=true 时前端可以关闭页面）
- ✅ 支持历史回放（可以从任意 sequence 开始重播）

**成本**:
- ❌ 增加 DB 写入压力（每 2s flush 一次）
- ❌ 增加延迟（DB 轮询而非直接透传）
- ❌ 增加复杂度（goroutine + DB + SSE 三层）

### 4.2 为什么前端要两层流式处理？

| 模式 | 路径 | 用途 |
|------|------|------|
| 直连 SSE | `/api/chat` → streamResponse() | 初始连接，低延迟 |
| Task Event Stream | `/api/tasks/{id}/stream` → startTaskEventStream() | 断线续流、后台恢复 |
| 轮询 | `/api/tasks/{id}` → startBackgroundPolling() | SSE 不可用时的 fallback |

**设计意图**: 初始请求走直连（最低延迟），一旦拿到 task_id 就切换到 task event stream（支持续流）。

### 4.3 为什么对比模式是纯非流式？

当前实现: `CompareChat` 是并行非流式，但前端 `handleSend()` 实际上是并行调用多个 `/api/chat`（流式）。

**不一致点**:
- 后端 `/chat/compare`：非流式，一次性返回所有结果
- 前端对比模式：不走 `/chat/compare`，而是并行调用 `/api/chat`（流式）

这意味着对比模式的实时反馈是通过并行流式请求实现的，而不是通过 `/chat/compare` 端点。

---

## 五、数据表结构

### 5.1 ai_background_tasks

```sql
CREATE TABLE ai_background_tasks (
  id                 BIGINT PRIMARY KEY AUTO_INCREMENT,
  response_id        VARCHAR(128) NOT NULL UNIQUE,  -- OpenAI response ID
  user_id            BIGINT,
  guest_id           VARCHAR(64),
  conversation_id    BIGINT NOT NULL,
  assistant_message_id BIGINT,
  model              VARCHAR(128),
  provider           VARCHAR(32),
  status             VARCHAR(32),  -- running | streaming | completed | failed | cancelled | incomplete
  last_sequence_number BIGINT,
  result             TEXT,
  error_message      TEXT,
  created_at         TIMESTAMP,
  updated_at         TIMESTAMP,
  completed_at       TIMESTAMP,
  deleted_at         TIMESTAMP
);
```

### 5.2 ai_background_task_events

```sql
CREATE TABLE ai_background_task_events (
  id         BIGINT PRIMARY KEY AUTO_INCREMENT,
  task_id    BIGINT NOT NULL,
  sequence   BIGINT NOT NULL,
  event_type VARCHAR(32),
  data       JSON,
  created_at TIMESTAMP,
  INDEX (task_id, sequence)
);
```

---

## 六、潜在问题与改进方向

### 6.1 对比模式架构不一致

**问题**: 后端 `CompareChat` 是纯非流式，但前端对比模式实际走的是并行 `/api/chat`（流式）。这导致：
- 后端 `/chat/compare` 端点几乎不被前端使用
- 前端对比模式的实现逻辑散落在 `handleSend()` 中

**建议**: 统一为后端流式对比模式，或前端直接调用 `/chat/compare`。

### 6.2 前端 streaming store 与 React state 同步

**问题**: 当前是手动在 `finally` 中同步，容易遗漏。

**建议**: 考虑使用 zustand 等状态管理库，或自定义 hook 自动同步。

### 6.3 DB 轮询压力

**问题**: `streamGenerationTaskEvents()` 每 200ms 轮询一次 DB。

**建议**: 高并发时可考虑 Redis Pub/Sub 或 PostgreSQL LISTEN/NOTIFY 替代轮询。

### 6.4 推理内容展示

**问题**: 当前用 `<think>` 标签包裹推理内容，前端需要手动解析。

**建议**: 后端 `AIStreamEvent` 中已区分 `EventTextDelta` 和 `EventReasoningDelta`，前端可直接利用，无需标签 hack。
