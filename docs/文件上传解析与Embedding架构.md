# AI Pool 文件上传、解析、Direct-First 与 RAG 架构

> 版本：v2.0  
> 更新日期：2026-05-25  
> 状态：当前实现文档；以代码 `backend/internal/services/file_context_orchestrator.go`、`backend/internal/api/chat.go`、`backend/internal/services/ai_service.go`、`openai_sdk.go`、`gemini_sdk.go` 为准。

---

## 1. 当前结论

AI Pool 当前文件架构不是“只做解析后塞文本”，也不是“所有文件都无条件原文件直传”。当前是 **Direct-First + 解析文本兜底 + 历史文件 RAG** 的混合架构：

| 场景 | 当前处理方式 | 目的 |
|---|---|---|
| 本轮刚上传/附加的当前文件 `current_files` | 优先原生直传给支持的模型；同时注入解析后的 `<file_context>` | 最大化模型直接理解文件的能力，避免复杂文件只靠粗解析 |
| 历史文件 / 已挂载上下文文件 `historical_files` | 走 chunks / RAG / overview 选择后注入 `<file_context>` | 控制 token、支持历史文件复用、避免上下文爆炸 |
| 不支持原生文件输入的模型 | 只走解析文本 / chunks / RAG 兜底 | 保证 DeepSeek 等文本模型也能回答文件内容 |
| 图片文件 | 支持 vision 的模型可原图直传；同时保留 `image_caption` chunk | 原生视觉优先，caption 兜底 |
| 文件未解析完成 | 不猜内容，生成 warning，不参与回答 | 避免幻觉 |

一句话：

> **当前文件：能直传就直传；解析文本同时兜底。历史文件：继续 RAG。**

---

## 2. 总体数据流

```text
用户上传文件
  ↓
POST /api/files/upload
  ↓
FileService.UploadAndParse()
  ├─ 原文件保存到磁盘 uploads/...
  ├─ 创建 files 表记录 public_id / storage_path / parse_status
  └─ 后台异步解析
       ↓
     FileParser.Parse()
       ├─ text/code/md/csv → 文本/代码 chunks
       ├─ pdf → 文本页/段落 chunks，必要时视觉描述 chunks
       ├─ docx/pptx/xlsx → Office XML 解析为结构化 chunks
       └─ image → vision/caption → image_caption chunk
       ↓
     写入 files.content + file_chunks
       ↓
     可选 Embedding job / file_embeddings

聊天时
  ↓
chat.go 根据 file_ids / current file ids 查出文件
  ↓
FileContextOrchestrator.Build()
  ├─ current_files:
  │    ├─ buildCurrentNativeParts()：原文件 / 原图直传 native parts
  │    └─ buildDirectCurrentContext()：按顺序加载 chunks，作为解析文本兜底
  └─ historical_files:
       └─ buildHistoricalContext()：RAG / overview / image_caption 检索
  ↓
applyFileContextPackage()
  ├─ SystemPrompt 注入 <file_context>
  └─ NativeParts 注入最后一条 user message
       ├─ image → Message.Images
       └─ file  → Message.Files / NativeFile
  ↓
Provider Adapter
  ├─ OpenAI Responses: input_image / input_file(file_data, filename)
  ├─ Gemini SDK: NewPartFromBytes(data, mediaType)
  └─ 不支持 native 的模型：只使用 <file_context>
```

---

## 3. 上传与解析层

### 3.1 上传入口

核心入口：

```text
POST /api/files/upload
backend/internal/api/file_handler.go
backend/internal/services/file_service.go
```

上传阶段职责：

1. 接收 multipart 文件；
2. 校验用户 / guest / workspace；
3. 原文件落盘，保留 `storage_path`；
4. 创建 `files` 表记录，对外返回 `public_id`；
5. 后台 goroutine 异步解析；
6. 解析完成后写入 `files.content` 与 `file_chunks`；
7. 如启用 embedding，则创建并处理 embedding job。

### 3.2 解析产物

解析层主要产物：

| 表 / 字段 | 作用 |
|---|---|
| `files.public_id` | 对外文件 ID，如 `file_xxx` |
| `files.storage_path` | 原文件磁盘路径，供 direct-first 原文件读取 |
| `files.content` | 解析后的完整文本 / Markdown |
| `files.parse_status` | `pending / parsing / done / error / unsupported` |
| `files.embedding_status` | `pending / indexing / done / error / skipped / disabled` |
| `file_chunks` | 结构化文本块，供当前文件兜底和历史 RAG 使用 |
| `file_embeddings` | 可选向量索引 |
| `file_embedding_jobs` | 异步 embedding 任务 |

### 3.3 文件类型处理

| 类型 | 解析方式 | chunk 类型 |
|---|---|---|
| txt / md / csv | 文本读取，按结构切块 | `paragraph` / `heading` / `table` |
| code | 文本读取，保留代码块 | `code` |
| PDF | 文本提取，按页/块切分；复杂页面可生成视觉描述 | `paragraph` / `heading` / `table` / 视觉描述 |
| DOCX | 解压 Office XML，抽取段落/标题/表格 | `paragraph` / `heading` / `table` |
| PPTX | 读取 slides XML | `slide_title` / `slide_content` |
| XLSX | 读取 worksheets XML，转 Markdown 表格 | `table` |
| 图片 | vision/OCR/caption 文本化 | `image_caption` |

---

## 4. 聊天文件上下文编排

核心代码：

```text
backend/internal/services/file_context_orchestrator.go
```

关键结构：

```go
type FileContextPackage struct {
    SystemPrompt string
    NativeParts  []ModelPart
    Warnings     []string
    UsedFileIDs  []uint
}

type ModelPart struct {
    Type     string // image | file
    MimeType string
    DataURI  string
    FileID   uint
    Filename string
}
```

### 4.1 当前文件：Direct-First

当前文件指用户本轮上传/附加、随当前问题一起使用的文件。

处理顺序：

1. `filterReadyFiles()` 过滤 `parse_status != done` 的文件；
2. `buildCurrentNativeParts()` 尝试读取 `storage_path` 原文件；
3. 如果模型支持：
   - 图片 → 生成 `ModelPart{Type: "image", DataURI: ...}`；
   - 文档 → 生成 `ModelPart{Type: "file", DataURI: ...}`；
4. 文件大小超过限制或读取失败时，生成 warning，回退解析文本；
5. `buildDirectCurrentContext()` 仍然加载当前文件 chunks，作为 `<current_files>` 兜底上下文。

当前限制：

| 项 | 当前值 |
|---|---|
| 当前文件解析文本上限 | `DefaultCurrentFileContextChars = 100000` |
| 原文件直传大小上限 | `defaultNativeFileMaxBytes = 25MB` |
| 图片直传大小上限 | 由 `defaultNativeImageMaxBytes` 控制 |

### 4.2 历史文件：RAG / Overview

历史文件指已存在于会话、workspace 或 compare 上下文中的文件，不是本轮新附件。

处理方式：

1. 图片历史文件：直接取 `image_caption` chunks；
2. 文档历史文件：
   - 如果是 overview 类问题，按顺序选择概览 chunks；
   - 否则走 `RetrievalService.Search()` 检索相关 chunks；
3. 用 `ContextBuilder.BuildSection("historical_files", ...)` 拼进 `<file_context>`。

当前限制：

| 项 | 当前值 |
|---|---|
| 历史文件上下文上限 | `DefaultHistoricalFileContextChars = 40000` |
| TopK | `DynamicTopK(model)` 按模型动态调整 |

---

## 5. 模型能力判断

模型能力元数据在：

```text
backend/internal/modelmeta/modelmeta.go
```

语义：

| 字段 | 含义 |
|---|---|
| `Capabilities` | 模型能做什么：`chat / image / search / reasoning / video` |
| `SupportedInputs` | 模型原生支持什么输入：`text / image / pdf / word / excel / ppt / csv / txt / code / video / audio` |

当前聊天文件 native 输入判断：

```go
supportsNativeFileInput(model) = strings.HasPrefix(model, "gpt-") || strings.HasPrefix(model, "gemini-")
modelmeta.SupportsInput(model, inputType)
```

当前主要配置：

| 模型族 | SupportedInputs | Direct native 行为 |
|---|---|---|
| GPT 聊天模型 | `text,image,pdf,word,excel,ppt,csv,txt,code` | 图片 + 文件可 direct-first |
| Gemini 聊天模型 | `text,image,pdf,word,excel,ppt,csv,txt,code` | 图片 + 文件可 direct-first |
| DeepSeek | `text,pdf,word,excel,ppt,csv,txt,code` | 目前不原生直传，只走解析/RAG 文本兜底 |
| gpt-image-2 | `text` | 图片生成模型，不走聊天文件上下文链路 |
| Seedance | `text` | 视频生成模型，不走聊天文件上下文链路 |

---

## 6. Provider 适配层

### 6.1 OpenAI Responses

相关文件：

```text
backend/internal/services/openai_sdk.go
backend/internal/services/ai_service.go
```

当前支持：

```json
{
  "type": "input_image",
  "image_url": "data:image/png;base64,..."
}
```

```json
{
  "type": "input_file",
  "filename": "document.pdf",
  "file_data": "data:application/pdf;base64,..."
}
```

说明：

- 新 SDK 路径和旧 OpenAI Responses 路径都已支持 `input_file`；
- 当前文件 native parts 注入最后一条 user message；
- `<file_context>` 仍作为 system message 注入，提供解析文本兜底。

### 6.2 Gemini SDK

相关文件：

```text
backend/internal/services/gemini_sdk.go
```

当前支持：

```go
genai.NewPartFromBytes(data, mediaType)
```

说明：

- 图片和文档都会从 DataURI 解码为 bytes；
- 以 `mediaType` 传给 Gemini；
- 同样保留 `<file_context>` 兜底。

### 6.3 纯文本/非 native 模型

DeepSeek 等模型当前不走原文件 direct native 输入。

它们依赖：

1. 当前文件解析 chunks；
2. 历史文件 RAG chunks；
3. `<file_context>` prompt 注入。

---

## 7. 为什么复杂文件以前理解差

旧架构主要依赖“解析 → chunks → prompt/RAG”。对简单文本没问题，但复杂文件容易失真：

| 问题 | 表现 |
|---|---|
| PDF 复杂排版 | 跨栏、表格、图文混排顺序错乱 |
| 扫描 PDF | 没有 OCR/视觉解析时文本为空或很少 |
| PPT / Excel | 图表、公式、样式、跨 sheet 关系丢失 |
| 图片文件 | 只能依赖 caption，不能进行细粒度视觉推理 |
| RAG 检索片段化 | 用户要“整体总结/改写/对比”时，只拿到局部 chunks |
| Token 上限 | 大文件无法完整塞入上下文 |

因此用户会感觉：简单 txt/md/csv 能回答，复杂 PDF/PPT/XLSX/图片理解弱。

当前 direct-first 的意义是：

- 对 GPT/Gemini，把原文件也交给模型；
- 平台解析文本仍保留，保证兼容和兜底；
- 历史文件继续 RAG，避免每次都把所有历史原文件塞给模型。

---

## 8. 是否需要“解析大模型”

快速上线阶段：**不建议把解析大模型作为上线前置条件。**

当前最佳策略：

1. **先上线 direct-first**：当前文件原生直传给 GPT/Gemini；
2. **保留现有解析/RAG**：给 DeepSeek、历史文件、引用、搜索兜底；
3. **上线后观察日志和失败样本**：重点看复杂 PDF、扫描件、图表型 PPT/Excel；
4. **后续再引入解析大模型做增强解析**，不要阻塞上线。

后续可加的解析增强：

| 优先级 | 能力 | 作用 |
|---|---|---|
| P0 | 扫描 PDF / 图片 OCR + vision layout | 解决无文本 PDF、截图文档 |
| P1 | PDF layout model / 多模态解析 | 保留阅读顺序、表格、图文位置 |
| P1 | Excel 结构化 sheet 摘要 | 支持多 sheet、公式、图表解释 |
| P2 | PPT 页面视觉摘要 | 支持图形/布局/演示逻辑理解 |
| P2 | 文件级摘要索引 | 历史大文件先走摘要再局部检索 |

---

## 9. 运行时可观测性

聊天注入文件上下文时会输出类似日志：

```text
[Chat FileContext] injected context usedFiles=[...] nativeParts=N nativeImagesAdded=N nativeFilesAdded=N warnings=N systemPrompt=true
```

重点看：

| 指标 | 含义 |
|---|---|
| `nativeParts` | 本轮构造出的原生直传部件数 |
| `nativeImagesAdded` | 实际注入最后 user message 的图片数 |
| `nativeFilesAdded` | 实际注入最后 user message 的文件数 |
| `warnings` | 未解析、读取失败、超大小等问题 |
| `systemPrompt=true` | 是否注入了 `<file_context>` 解析文本兜底 |

上线后如果用户反馈“文件看不懂”，先查：

1. 该文件 `parse_status` 是否 `done`；
2. 当前模型是否支持 native file input；
3. 日志中 `nativeFilesAdded` 是否 > 0；
4. 是否有 warning；
5. `file_chunks` 是否为空或质量差；
6. 是否是历史文件场景导致只走 RAG，没有原文件直传。

---

## 10. 当前上线判断

当前架构可快速上线：

- 当前上传文件：direct-first 已补齐；
- OpenAI / Gemini native 文件输入路径已支持；
- 解析文本兜底仍在；
- 历史文件 RAG 不被破坏；
- DeepSeek 等非 native 模型仍可通过 `<file_context>` 使用文件内容；
- 复杂文件理解风险主要来自解析质量和模型 native 能力差异，不应阻塞 MVP 上线。

后续优化方向不是重写上传系统，而是增强三件事：

1. 复杂文件解析质量；
2. historical files 的上下文组织策略；
3. 引用原文/页码/表格的可视化回溯体验。
