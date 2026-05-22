# SSE 解析体系现状分析

## 概述

后端目前存在 **4 套并行的 SSE/流式解析体系**，按演进顺序排列如下。各体系之间互不通用的核心原因是：数据源形态不同（HTTP raw body vs SDK stream object），以及不同 Provider 的 SSE 方言差异。

---

## 体系 1：通用 Decoder 体系（最早期）

**文件：**
- `internal/services/stream_decoder.go` — 工厂函数 `NewDecoder`
- `internal/services/chat_sse_decoder.go` — `ChatSSEDecoder`（标准 OpenAI 兼容 SSE）
- `internal/services/gemini_decoder.go` — `GeminiDecoder`（Gemini 原生 JSON 流）
- `internal/services/openai_responses_decoder.go` — `OpenAIResponsesStreamDecoder`（Responses API 原生 SSE）

**设计意图：** 一套统一的 `StreamDecoder` 接口，按 `modelType` 分发不同实现。所有 Provider 都走 HTTP raw body → `bufio.Scanner` 解析。

**当前使用方：**

| modelType | 对应实现 | 实际仍在使用的 Provider |
|-----------|---------|----------------------|
| `anthropic` / `deepseek` / `moonshot` | `ChatSSEDecoder` | **Anthropic、Moonshot**（DeepSeek 已不用） |
| `gemini` | `GeminiDecoder` | **已废弃**（被 Gemini SDK 体系替代） |
| `openai_responses` | 报错回退 | **已废弃**（被 OpenAI SDK 体系替代） |
| `openai` | `ChatSSEDecoder` | 无（OpenAI 已走 SDK） |

**遗留状态：** `NewDecoder` 现在是一个"兜底回退"机制。`chat.go` 的 `forwardUnifiedStream` 只有在 `resp.Decoder == nil` 时才调用它。Anthropic 和 Moonshot 仍走这条老路。

---

## 体系 2：OpenAI SDK Typed Decoder（引入 openai-go SDK 后独立）

**文件：** `internal/services/openai_typed_stream_decoder.go`

**核心设计：** 不碰 raw HTTP body，直接消费 SDK 提供的 `ssestream.Stream[responses.ResponseStreamEvent]` 对象，把 SDK 事件映射为 `AIStreamEvent`。

```go
type OpenAIResponsesTypedDecoder struct {
    stream  *ssestream.Stream[responses.ResponseStreamEvent]
    // ...
}
```

**使用方：** OpenAI gpt-5.x 系列（`callOpenAIResponsesSDK` 的 `stream=true` 分支）

**关键包装：** `sdkStreamBody`（`Read` 永远返回 `io.EOF`，`Close` 释放限流器），因为 `AICompletionResponse` 要求有 `Body`，但实际数据从 SDK stream 取。

---

## 体系 3：Gemini SDK Typed Decoder（引入 Google GenAI SDK 后独立）

**文件：** `internal/services/gemini_sdk.go` + `internal/services/gemini_sdk_stream_decoder.go`

**核心设计：** 不碰 raw HTTP body，直接消费 Google GenAI SDK 的 `genai.GenerateContentStream`。

```go
type GeminiSDKStreamDecoder struct {
    ctx context.Context
    seq *genai.GenerateContentStream
    // ...
}
```

**使用方：** Gemini 系列（`callGeminiSDK` 的 `stream=true` 分支）

**关键包装：** `geminiSDKStreamBody`（同样 `Read` 返回 `io.EOF`）

---

## 体系 4：DeepSeek Typed Decoder（为解决 openai-go SDK ssestream fatal error 而独立）

**文件：** `internal/services/deepseek_typed_stream_decoder.go`

**核心设计：** 手动发 HTTP 请求获取 raw body，用 `bufio.Scanner` 自己解析 SSE，跳过空 `data` 事件。用自定义的 `deepSeekSSEChunk` struct 反序列化 JSON。

```go
type DeepSeekTypedStreamDecoder struct {
    scanner *bufio.Scanner
    body    io.ReadCloser
    // ...
}
```

**背景：** DeepSeek 流里会出现空 `data:` 行，openai-go SDK 的 `ssestream` 遇到空 data 会 fatal error 终止整个流。所以 DeepSeek 没法直接用体系 2（OpenAI SDK typed decoder），也没法用体系 1 的 `ChatSSEDecoder`（它只解析标准 SSE 事件类型，不处理 DeepSeek 特有的 `reasoning_content` 等字段）。

**使用方：** DeepSeek 系列（`callDeepSeek` 的 `stream=true` 分支）

---

## 实际数据流全景图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ChatHandler.forwardUnifiedStream                    │
│                              (统一输出 SSE 给前端)                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                       ▲
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    │                  │                  │
            ┌───────┴───────┐  ┌──────┴──────┐  ┌──────┴──────┐
            │   OpenAI SDK  │  │ Gemini SDK  │  │   DeepSeek  │
            │   Responses   │  │  Generate   │  │   HTTP raw  │
            │   NewStreaming│  │ ContentStream│  │    body     │
            └───────┬───────┘  └──────┬──────┘  └──────┬──────┘
                    │                 │                 │
        ┌───────────┴────────┐ ┌─────┴──────┐  ┌──────┴──────┐
        │ OpenAIResponses    │ │GeminiSDK   │  │DeepSeekTyped│
        │ TypedDecoder       │ │StreamDecoder│  │StreamDecoder│
        │ (体系2)            │ │ (体系3)    │  │  (体系4)    │
        └────────────────────┘ └────────────┘  └─────────────┘

        ┌─────────────────────────────────────────────────────────┐
        │   Anthropic / Moonshot —— 仍走体系1的 NewDecoder 兜底    │
        │   → ChatSSEDecoder (通用OpenAI兼容SSE解析)              │
        └─────────────────────────────────────────────────────────┘
```

---

## 各 Provider 当前实际使用的 Decoder 汇总

| Provider | 调用函数 | 流式数据来源 | 实际 Decoder | 所属体系 |
|---------|---------|------------|------------|---------|
| **OpenAI (gpt-5.x)** | `callOpenAIResponsesSDK` | `openai-go` SDK stream | `OpenAIResponsesTypedDecoder` | 体系 2 |
| **Anthropic** | `callAnthropic` | HTTP raw body | `ChatSSEDecoder`（`NewDecoder` 兜底） | 体系 1 |
| **Gemini** | `callGeminiSDK` | Google GenAI SDK stream | `GeminiSDKStreamDecoder` | 体系 3 |
| **DeepSeek** | `callDeepSeek` | HTTP raw body | `DeepSeekTypedStreamDecoder` | 体系 4 |
| **Moonshot** | `callMoonshot` | HTTP raw body | `ChatSSEDecoder`（`NewDecoder` 兜底） | 体系 1 |

---

## 核心问题总结

### 1. 体系 1 已部分废弃但仍在服务 Anthropic/Moonshot

`stream_decoder.go` 的分支里 `gemini` 和 `openai_responses` 实际上已无流量（都被 SDK 体系替代），但 `NewDecoder` 工厂函数仍保留这些分支作为"保险"。

### 2. 体系 2 和体系 4 的数据源矛盾

体系 2（OpenAI SDK）和体系 4（DeepSeek）底层都是 OpenAI 兼容格式，但 DeepSeek 因为空 data 事件不能用 openai-go SDK 的 `ssestream`，导致同一套协议需要两套独立实现。

### 3. Gemini 有两套解析但只用一套

体系 1 里的 `GeminiDecoder`（HTTP SSE wrapper）已无流量，全部走了体系 3 的 SDK stream。

### 4. Decoder 和 Body 的绑定关系混乱

- 体系 2/3 的 `Body` 是假 body（`Read` 返回 `io.EOF`），因为数据从 SDK stream 取
- 体系 1/4 的 `Body` 是真 HTTP body，但体系 4 的 `Decoder` 自己读 body，体系 1 的 `Decoder` 也是自己读 body
- `forwardUnifiedStream` 里 `resp.Body.Close()` 和 `decoder.Close()` 存在双重关闭风险（虽然 `closeHookReadCloser` 做了保护）

---

## 潜在优化方向

**核心方向：把体系 2 和体系 4 统一回一套 OpenAI 兼容的 Typed Decoder。**

因为 DeepSeek 的问题本质上是 openai-go SDK `ssestream` 的空 data 处理 bug，修复/绕过这个点后，OpenAI SDK 的 `ssestream` 完全能解析 DeepSeek 的流，体系 4 可以合并到体系 2。

Gemini 和 Anthropic/Moonshot 则保持现状（各走各的 SDK/HTTP 路径），因为协议差异较大，强行统一反而增加复杂度。
