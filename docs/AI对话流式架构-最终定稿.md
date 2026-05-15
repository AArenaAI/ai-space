# AI 对话流式架构 — 最终定稿

> **范围**：`Chat` / `CompareChat` handler 流式管线重构
> **定稿轮次**：第 5 轮
> **核心目标**：两条独立流式支线 → 一条统一流式管线，前端协议零改动

---

## 一、设计目标

将 `Chat` handler 中**两条独立的流式支线**（`StreamOpenAIResponses` vs `SSEParser`）合并为**一条统一流式管线**，同时：

1. **保留当前所有前端可见行为**（格式、标签、提示文案）
2. **不丢失** reasoning / search / error 等业务逻辑
3. **集中资源管理和错误处理**（body close、超时、兜底）
4. **协议解析与业务状态机分离**（decoder vs handler）

---

## 二、架构总览

```
Frontend (Next.js)
       │ POST /api/chat
       ▼
┌──────────────────────────────────────────────────────────────────┐
│                        API Layer (Gin)                           │
│  Chat handler                                                    │
│  ├─ recoverHTTPHandler (panic recovery)                          │
│  ├─ IP Rate Limiter                                              │
│  ├─ req validation                                               │
│  └─ call AIService.ChatCompletion()                              │
│       ├─ returns AICompletionResponse {Body, StreamFormat}       │
│       └─ defer closeLogged()                                     │
│                                                                  │
│  ┌─ 非流式 (stream=false)                                        │
│  │   writeNonStreamChatResponse()                                │
│  │   ├─ io.LimitReader 防巨包                                    │
│  │   └─ 保存 assistant message                                   │
│  │                                                               │
│  └─ 流式 (stream=true) ───→ forwardUnifiedStream()               │
│       ├─ NewAIStreamDecoder(format, body)                        │
│       │    ├─ "responses" → OpenAIResponsesDecoder               │
│       │    └─ "chat-sse"  → ChatSSEDecoder                       │
│       │                                                          │
│       ├─ 状态机: thinkOpened / textStarted / webSearchCount      │
│       ├─ for { decoder.Next(ctx) }                               │
│       │    ├─ ReasoningDelta  → ensureThinkOpen() → writeDelta   │
│       │    ├─ SearchStart     → ensureThinkOpen() → writeDelta   │
│       │    ├─ SearchDone      → ensureThinkOpen() → writeDelta   │
│       │    ├─ TextDelta       → closeThink() → writeDelta        │
│       │    ├─ Error           → writeDelta("❌ ...") → return    │
│       │    └─ Done            → sendDone() → save → return       │
│       └─ defer sendDone() 兜底                                   │
│                                                                  │
│  CompareChat handler                                             │
│  └─ runCompareModels()                                           │
│       ├─ 双层 timeout (outer + per-model)                        │
│       ├─ goroutine recover                                       │
│       └─ 非阻塞 send + 504/200 状态码区分                        │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Service Layer                               │
│  AI HTTP 层 (ai_http.go)                                         │
│  ├─ 统一 httpClient / streamHTTPClient (sync.Once)              │
│  ├─ doAIJSON(): 超时控制 + cancelOnCloseReadCloser              │
│  ├─ 共享 Transport                                               │
│  └─ 错误响应截断 (LimitReader 10KB)                              │
│                                                                  │
│  Provider 发送层 (ai_service.go)                                 │
│  ├─ callOpenAIResponses()  → 返回 StreamFormat="responses"       │
│  ├─ callAnthropic()       → 返回 StreamFormat="chat-sse"         │
│  ├─ callDeepSeek()        → 返回 StreamFormat="chat-sse"         │
│  ├─ callMoonshot()        → 返回 StreamFormat="chat-sse"         │
│  └─ json.Marshal 错误全部显式处理                                │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
External AI APIs
  ├─ OpenAI Responses API (gpt-5.4-mini)
  ├─ Anthropic Messages API
  ├─ DeepSeek Chat API
  └─ Moonshot API
```

---

## 三、文件变更清单

### 3.1 新增文件（9 个）

| 文件 | 职责 |
|------|------|
| `internal/services/ai_http.go` | 统一 AI 上游 HTTP 层：超时控制、`cancelOnCloseReadCloser`、共享 Transport、错误响应截断 |
| `internal/services/stream_event.go` | 统一流事件定义：`AIStreamEventType`、`AIStreamEvent` |
| `internal/services/stream_decoder.go` | Decoder 接口 + Factory：`AIStreamDecoder`、`NewAIStreamDecoder` |
| `internal/services/stream_decoder_openai_responses.go` | OpenAI Responses API decoder：6 种语义事件映射 |
| `internal/services/stream_decoder_chat_sse.go` | 普通 Chat Completions SSE decoder：3 种语义事件映射 |
| `internal/api/handler_guard.go` | `recoverHTTPHandler` + `closeLogged` |
| `internal/api/compare_executor.go` | `runCompareModels`：双层 timeout + goroutine recover + 非阻塞 send |
| `internal/database/sqlite_tuning.go` | SQLite WAL + 连接池调优 |
| `internal/middleware/ip_rate_limiter.go` | IP 级别令牌桶限流 |

### 3.2 修改文件

| 文件 | 改动要点 |
|------|---------|
| `internal/services/ai_service.go` | 新增 httpClient、4 个 provider 改为 doAIJSON、ChatCompletion 返回 `*AICompletionResponse`、**删除** `StreamOpenAIResponses` |
| `internal/api/chat.go` | Chat handler 统一走 `forwardUnifiedStream`、CompareChat 改为 `runCompareModels`、双事务保存、新增 4 个 helper |
| `internal/api/router.go` | `/api/chat` 和 `/api/chat/compare` 挂载 IP 限流中间件 |
| `internal/models/db.go` | `InitDB` 中调用 `database.ConfigureSQLite(db)` |

---

## 四、核心数据结构

### 4.1 统一流事件

```go
// internal/services/stream_event.go

type AIStreamEventType int

const (
	AIStreamEventTextDelta AIStreamEventType = iota      // 正文增量
	AIStreamEventReasoningDelta                           // 推理过程增量
	AIStreamEventSearchStart                              // 搜索开始
	AIStreamEventSearchDone                               // 搜索完成
	AIStreamEventError                                    // API 错误
	AIStreamEventDone                                     // 流结束
)

type AIStreamEvent struct {
	Type    AIStreamEventType
	Delta   string // TextDelta / ReasoningDelta
	Message string // SearchStart / SearchDone 文案（由 handler 决定）
	Error   string // Error 文案
}
```

### 4.2 Decoder 接口

```go
// internal/services/stream_decoder.go

type AIStreamDecoder interface {
	Next(ctx context.Context) (AIStreamEvent, error)
}

func NewAIStreamDecoder(format string, body io.Reader) AIStreamDecoder
// format = "responses"  → OpenAIResponsesDecoder
// format = "chat-sse"   → ChatSSEDecoder
```

### 4.3 ChatCompletion 返回结构

```go
// internal/services/ai_service.go

type AICompletionResponse struct {
	Body         io.ReadCloser
	StreamFormat string // "responses" | "chat-sse"
}
```

### 4.4 Handler 状态机

```go
// internal/api/chat.go forwardUnifiedStream

type streamState struct {
	thinkOpened     bool   // 是否已输出 <think>
	textStarted     bool   // 正文是否已开始
	webSearchCount  int    // 搜索次数计数
	doneSent        bool   // 是否已发送 [DONE]
}
```

---

## 五、核心流程：forwardUnifiedStream

```
Chat handler 收到 resp (AICompletionResponse)
  │
  ├─ defer closeLogged("chat upstream response body", resp.Body)
  │
  ├─ stream=false
  │    writeNonStreamChatResponse(c, resp.Body, req, conversationID)
  │    ├─ io.LimitReader(resp.Body, 10MB) 防巨包
  │    ├─ json.NewDecoder 读取 body
  │    ├─ 转换为用户可见格式
  │    └─ 保存 assistant message（事务 B）
  │
  └─ stream=true
       forwardUnifiedStream(c, decoder, req, conversationID)
       │
       ├─ 设置 SSE headers (Content-Type: text/event-stream)
       ├─ decoder := NewAIStreamDecoder(resp.StreamFormat, resp.Body)
       │
       ├─ 初始化状态机
       │    thinkOpened   = false
       │    textStarted   = false
       │    webSearchCount = 0
       │    doneSent      = false
       │
       ├─ defer sendDone()  // 兜底：任何路径退出都发 [DONE]
       │
       ├─ for {
       │      event, err := decoder.Next(c.Request.Context())
       │      if err != nil { break }
       │      if doneSent { continue }
       │
       │      switch event.Type {
       │      │
       │      ├─ ReasoningDelta
       │      │    if textStarted → continue (丢弃)
       │      │    ensureThinkOpen()
       │      │    writeDelta(event.Delta)
       │      │
       │      ├─ SearchStart
       │      │    if textStarted → continue (丢弃)
       │      │    ensureThinkOpen()
       │      │    webSearchCount++
       │      │    if count == 1:
       │      │         writeDelta("🔍 正在搜索相关信息...\n\n")
       │      │    else:
       │      │         writeDelta("🔍 补充搜索...\n\n")
       │      │
       │      ├─ SearchDone
       │      │    if textStarted → continue (丢弃)
       │      │    ensureThinkOpen()
       │      │    writeDelta("✅ 搜索完成，正在分析结果...\n\n")
       │      │
       │      ├─ TextDelta
       │      │    if !textStarted {
       │      │         closeThink()   // 输出 </think>
       │      │         textStarted = true
       │      │    }
       │      │    writeDelta(event.Delta)
       │      │
       │      ├─ Error
       │      │    writeDelta(fmt.Sprintf("❌ API 错误: %s - %s", code, message))
       │      │    return fmt.Errorf(...)
       │      │
       │      └─ Done
       │           sendDone()
       │           saveAssistantMessageAfterStream(c, req, conversationID, accumulatedContent)
       │           return nil
       │      }
       │   }
       │
       └─ return (触发 defer sendDone())
```

### 5.1 辅助函数语义

```go
ensureThinkOpen()
  if !thinkOpened {
    thinkOpened = true
    writeDelta("<think>")
  }

closeThink()
  if thinkOpened {
    thinkOpened = false
    writeDelta("</think>")
  }

writeDelta(delta)
  payload := struct{
    Choices []struct{
      Index int `json:"index"`
      Delta struct{ Content string `json:"content"` } `json:"delta"`
    } `json:"choices"`
  }{{Index:0, Delta:{Content:delta}}}
  data, _ := json.Marshal(payload)
  fmt.Fprintf(c.Writer, "data: %s\n\n", data)
  c.Writer.Flush()

sendDone()
  if !doneSent {
    doneSent = true
    io.WriteString(c.Writer, "data: [DONE]\n\n")
    c.Writer.Flush()
  }
```

---

## 六、Decoder 实现

### 6.1 OpenAIResponsesDecoder

```go
// internal/services/stream_decoder_openai_responses.go

// 解析 OpenAI Responses API 的 streaming JSON Lines
// 事件映射：
// "response.output_text.delta"     → AIStreamEventTextDelta{Delta: text}
// "response.reasoning_summary_text.delta" → AIStreamEventReasoningDelta{Delta: text}
// "response.reasoning_summary.delta"      → AIStreamEventReasoningDelta{Delta: text}
// "response.reasoning.delta"              → AIStreamEventReasoningDelta{Delta: text}
// "response.web_search_call.in_progress"  → AIStreamEventSearchStart
// "response.web_search_call.completed"    → AIStreamEventSearchDone
// "response.completed"                    → AIStreamEventDone
// 其他错误字段                            → AIStreamEventError{Error: ...}
```

### 6.2 ChatSSEDecoder

```go
// internal/services/stream_decoder_chat_sse.go

// 解析标准 SSE 格式：
// data: {"choices":[{"delta":{"content":"..."}}]}
// data: {"choices":[{"delta":{"reasoning_content":"..."}}]}  // DeepSeek
// data: [DONE]
//
// 事件映射：
// choices[0].delta.content             → AIStreamEventTextDelta{Delta: content}
// choices[0].delta.reasoning_content   → AIStreamEventReasoningDelta{Delta: reasoning_content}
// data: [DONE]                         → AIStreamEventDone
// 错误 JSON                             → AIStreamEventError{Error: ...}
```

---

## 七、CompareChat 执行器

```
CompareChat handler
  │
  ├─ save user message（事务 A）
  │
  ├─ runCompareModels(models, query, timeout)
  │    ├─ outerCtx, outerCancel := context.WithTimeout(ctx, 2min)
  │    ├─ results := make(chan compareResult, len(models))
  │    ├─ var wg sync.WaitGroup
  │    │
  │    ├─ for each model:
  │    │    wg.Add(1)
  │    │    go func() {
  │    │       defer wg.Done()
  │    │       defer recover() // goroutine panic recovery
  ��       │
  │    │       perCtx, cancel := context.WithTimeout(outerCtx, 90s)
  │    │       defer cancel()
  │    │
  │    │       resp, err := callModel(perCtx, model, query)
  │    │       if err != nil {
  │    │          results <- {model, error}
  │    │          return
  │    │       }
  │    │
  │    │       // 流式读取每个模型响应
  │    │       decoder := NewAIStreamDecoder(resp.StreamFormat, resp.Body)
  │    │       var acc strings.Builder
  │    │       for {
  │    │          ev, err := decoder.Next(perCtx)
  │    │          if err != nil || ev.Type == AIStreamEventDone { break }
  │    │          if ev.Type == AIStreamEventTextDelta {
  │    │             acc.WriteString(ev.Delta)
  │    │          }
  │    │       }
  │    │       results <- {model, content: acc.String()}
  │    │    }()
  │    │
  │    ├─ go func() { wg.Wait(); close(results) }()
  │    │
  │    ├─ responseSent := false
  │    ├─ for result := range results {
  │    │    // 非阻塞发送（前端已建立 SSE 连接）
  │    │    writeCompareDelta(result.model, result.content)
  │    │    responseSent = true
  │    │ }
  │    │
  │    ├─ outerCancel()
  │    │
  │    ├─ if !responseSent {
  │    │    return 504 // Gateway Timeout
  ��    │ }
  │    └─ return 200
  │
  └─ save assistant messages（多个模型结果分别保存，事务 B）
```

---

## 八、前端输出格式

```go
// 统一 SSE 输出格式，前端 useChat.ts 无需改动

// 数据块
func writeFrontendDelta(w io.Writer, delta string) error {
    payload := struct {
        Choices []struct {
            Index int `json:"index"`
            Delta struct {
                Content string `json:"content"`
            } `json:"delta"`
        } `json:"choices"`
    }{
        {Index: 0, Delta: {Content: delta}},
    }
    data, _ := json.Marshal(payload)
    fmt.Fprintf(w, "data: %s\n\n", data)
    return nil
}

// 结束标记
func writeFrontendDone(w io.Writer) error {
    _, err := io.WriteString(w, "data: [DONE]\n\n")
    return err
}
```

**前端 `useChat.ts` 兼容读取**：
```ts
const parsed = JSON.parse(line.replace(/^data: /, ""));
const delta = parsed.choices?.[0]?.delta?.content || "";
// 直接拼接到消息内容
```

---

## 九、定稿行为表

| 项目 | 定稿行为 |
|------|---------|
| 流式完成事件 | `response.done` (Responses API) / `data: [DONE]` (SSE) |
| Reasoning 事件 | `response.reasoning_summary_text.delta`、`response.reasoning_summary.delta`、`response.reasoning.delta` |
| SSE Parser 返回值 | `*SSEEvent`（内部结构）→ 统一转为 `AIStreamEvent` |
| `[DONE]` 处理位置 | JSON 解析前识别，转为 `AIStreamEventDone` |
| 前端 delta 格式 | `choices[0].delta.content` |
| 搜索提示换行 | 字面量 `\n\n`（两个换行符） |
| 第一次搜索提示 | `🔍 正在搜索相关信息...\n\n` |
| 补充搜索提示 | `🔍 补充搜索...\n\n` |
| 搜索完成提示 | `✅ 搜索完成，正在分析结果...\n\n` |
| 搜索提示包裹位置 | `<think>` 内部 |
| 正文开始后 reasoning | **丢弃**，不再重新打开 `<think>` |
| 正文开始后搜索事件 | **丢弃** |
| Error 输出格式 | `❌ API 错误: {code} - {message}` |
| Error 前缀 | 不额外加 `[错误]` 前缀 |
| Error 位置 | 不强制移出 `<think>` |
| Handler 流式分支 | **统一一条** `forwardUnifiedStream`，无 format 判断 |
| Decoder 实现 | `OpenAIResponsesDecoder` / `ChatSSEDecoder` 两个独立实现 |
| `[DONE]` 兜底 | `defer sendDone()`，任何退出路径都发 |
| 保存 assistant 时机 | 流结束后 `saveAssistantMessageAfterStream`，失败只 log 不中断用户 |
| `json.Marshal` 错误 | 全部显式处理，不再 `_` 忽略 |
| 事务边界 | 双事务：user message 先保存（A），assistant + file 后保存（B） |
| `models.Message` 加 Error 字段 | ❌ 否 |
| IP 限流 | `/api/chat` 和 `/api/chat/compare` 挂载令牌桶限流 |
| SQLite 优化 | WAL 模式 + 连接池调优 |

---

## 十、关键设计决策

| 决策 | 结论 | 理由 |
|------|------|------|
| 是否保留 `StreamOpenAIResponses` | ❌ **否** | 拆分为 `OpenAIResponsesDecoder` + `forwardUnifiedStream` 状态机，协议解析与业务逻辑解耦 |
| 是否改动前端协议 | ❌ **否** | 继续输出 `choices[0].delta.content`，前端 `useChat.ts` 零改动 |
| 是否改动 reasoning/search 语义 | ❌ **否** | 保留当前 `<think>` 包裹和正文开始后丢弃逻辑 |
| `json.Marshal` 错误处理 | ✅ **全部显式处理** | 消除静默失败风险 |
| 事务边界 | ✅ **双事务** | user message 先保存确保不丢用户输入，assistant 后保存不影响响应 |
| `models.Message` 是否加 `Error` 字段 | ❌ **否** | error 仅体现在流式输出中，不持久化到 DB |
| 图片/文件在 compare 中 | ❌ **暂不支持** | compare 仅支持纯文本 query，文件关联在单模型 Chat 中处理 |
| SSE 连接异常中断 | ✅ **cancelOnCloseReadCloser** | 客户端断开时自动取消上游 HTTP 请求，释放连接 |
| goroutine panic | ✅ **recoverHTTPHandler** + **goroutine recover** | handler 层和 compare 并发层都有 recover |
| 超时策略 | ✅ **双层 timeout** | Compare 外层 2min + 单模型 90s，单 Chat 走 request context |

---

## 十一、与旧架构对比

| 维度 | 旧架构 | 新架构（本定稿） |
|------|--------|-----------------|
| 流式分支 | 2 条：`StreamOpenAIResponses` + `SSEParser` | 1 条：`forwardUnifiedStream` + Decoder Factory |
| 协议解析 | 内嵌在 handler / service 中 | 独立 Decoder 包，与业务状态机分离 |
| Body 关闭 | 分散在各处，容易遗漏 | `closeLogged` 集中管理，defer 兜底 |
| 错误处理 | panic 可能导致服务崩溃 | `recoverHTTPHandler` + 错误事件透传 |
| Compare 并发 | 裸 goroutine + 阻塞收集 | `runCompareModels`：双层 timeout + recover + 非阻塞 |
| HTTP 客户端 | 每次新建或全局无管理 | `sync.Once` 初始化 + 共享 Transport |
| SQLite | 默认配置 | WAL + 连接池调优 |
| 限流 | 无 | IP 令牌桶 |
