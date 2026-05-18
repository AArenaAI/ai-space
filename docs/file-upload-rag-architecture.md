# 文件上传与 RAG 架构

> 最后更新：2026-05-16

## 概述

整个文件处理流程分为两个完全独立的路径：

| 路径 | 名称 | 来源 | 处理方式 | 适用模型 |
|---|---|---|---|---|
| **A** | 文件上传 RAG | `POST /api/files/upload` → 后端解析 | Vision/image caption/chunk → `<file_context>` system message | **所有模型**（包括纯文本模型如 DeepSeek） |
| **B** | 内联多模态直传 | `Message.Images` 字段（base64 dataURI） | 直接调用模型原生 vision API | 仅支持 vision 的模型（GPT-5x, Claude, Kimi K2.5+） |

两条路径最终共存：文件通过**路径 A** 提供深度解析与检索，内联图片通过**路径 B** 提供即时视觉理解。

---

## 路径 A：文件上传 RAG（当前主力路径）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 前端上传 ──→ POST /api/files/upload                                        │
│                  │                                                          │
│                  ▼                                                          │
│         FileService.UploadAndParse()                                        │
│                  ├─ 保存原始文件到磁盘                                       │
│                  ├─ 创建 File 记录（parse_status="pending"）               │
│                  └─ 启动 goroutine 异步解析                                 │
│                          │                                                   │
│                          ▼                                                   │
│                  FileParser.Parse() — 按扩展名路由                          │
│                          │                                                   │
│           ┌──────────────┼──────────────┬──────────────┐                    │
│           ▼              ▼              ▼              ▼                    │
│      parseText()   parsePDF()   parseImage()   parseDOCX/PPTX/XLSX         │
│      (.md/.go/     (.pdf)       (.jpg/.png/    (Office 文档)                │
│       .py/.tsx)                  .gif/.webp)                                │
│           │              │              │              │                    │
│           └──────────────┴──────────────┴──────────────┘                    │
│                              │                                               │
│                              ▼                                               │
│                      ParseResult 保存：                                      │
│                        ├─ File: content / summary / page_count / ...        │
│                        ├─ FileChunk 记录                                     │
│                        └─ FileEmbeddingJob（若 embedder 已配置）          │
│                              │                                               │
│                              ▼                                               │
│                      [聊天阶段]                                              │
│                        Chat handler -> buildFileContext()                    │
│                          ├─ file_ids → files → 区分 image / doc             │
│                          ├─ 图片: 直接读 image_caption chunks              │
│                          ├─ 文档: RetrievalService.Search()                  │
│                          └─ 注入 <file_context> system message               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 上传阶段

**入口**：`POST /api/files/upload` → `file_handler.go` → `FileService.UploadAndParse()`

关键步骤：

| 步骤 | 实现 |
|---|---|
| 文件保存 | 磁盘原始文件 + `File` 表记录，`parse_status = "pending"` |
| 异步解析 | `go fileParser.Parse(...)` — goroutine 异步执行，不阻塞上传返回 |
| Embedding Job | 若 `EnableEmbedding = true` → 创建 `FileEmbeddingJob` |
| Embedding Worker | 每 5 秒轮询 `file_embedding_jobs` 表，生成向量后写入 `FileEmbedding` |

**配置控制**：
- `cfg.EnableEmbedding` + `cfg.OpenAIKey` 控制是否启动 Embedding Worker
- 当前环境：`EnableEmbedding = false` → 全部降级为关键词搜索（`keywordSearch`）
- Embedding 开启时使用 `text-embedding-3-small` (dim=1536)

### 1.2 解析阶段

按文件扩展名路由到不同解析器：

#### 图片（.jpg/.png/.gif/.webp）

| 项 | 值 |
|---|---|
| 解析器 | `parseImage()` → `AIService.ExtractImageContent()` |
| Vision 模型 | OpenAI `gpt-4o` |
| 输出 | `Content = "图片视觉描述：\n" + caption` |
| Chunk 类型 | `BlockType = "image_caption"`，`BlockID = "img-1-caption-1"` |
| 存储 | 写入 `file_chunks` 表，参与 RAG 检索 |

#### PDF

| 项 | 值 |
|---|---|
| 解析器 | `parsePDF()` — 使用 `ledongthuc/pdf` 库 |
| 分块 | 逐页 → `detectBlocks()` 检测类型 |
| BlockType | `paragraph` / `heading` / `table` |
| 表格处理 | 多空格对齐的行转 Markdown 表格，自动补 `\|---|---\||`
| 特殊字段 | `HasTables=true` / `pageCount` |

#### 纯文本 / 代码

| 项 | 值 |
|---|---|
| 解析器 | `parseText()` |
| 编码 | 非法 UTF-8 字节替换为 � |
| 代码文件 | `.go` / `.py` / `.tsx` → `BlockType = "code"`，包裹 Markdown 代码块 |

#### Office 文档

| 类型 | 处理方式 | BlockType |
|---|---|---|
| DOCX | 解压 `word/document.xml` → 按段落 + 样式 | `heading` / `paragraph` / `table` |
| PPTX | 读 `ppt/slides/slide{i}.xml` | `slide_title` / `slide_content`（含 Slide 编号） |
| XLSX | 读 `xl/worksheets/*.xml` | `table`（含 SheetName） |

### 1.3 聊天阶段（RAG 检索）

**入口**：`chat.go` → `buildFileContext()`

```
用户消息（含 file_ids）
        │
        ▼
  解析 file_ids → 查询 File 表
        │
        ▼
  按类型分流：
    ├── 图片文件（HasImages=true / MIME 匹配）
    │     └── 直接读 file_chunks WHERE block_type='image_caption'
    │           全部注入 allResults（score=1.0）
    │
    └── 文档文件
          └── RetrievalService.Search(fileIDs, query, topK)
                ├── 若 embedder 可用 → 语义检索
                └── 否则 → keywordSearch 降级
        │
        ▼
  构建 <file_context> XML 块，拼入 system message
```

**多轮对话复用**：当 `file_ids` 为空时，自动从 `conversation_files` 表查询当前对话关联的文件，实现跨轮次的上下文保持。

---

## 路径 B：内联多模态直传（预留/未来路径）

通过 `Message.Images` 字段（`[]string`，存储 `data:image/...;base64,...` 格式 dataURI）向支持 vision 的模型直接发送图片。

### 当前实现状态

| 模型适配器 | 路径 B 支持 |
|---|---|
| `callOpenAIResponses()` | ✅ — `input_image` content parts |
| `callAnthropic()` | ✅ — `base64` image source |
| `callMoonshot()` | ✅ — `image_url` content（旧版降级为文字提示） |
| `callDeepSeek()` | ❌ — 检测到 Images 时只发文字提示（模型纯文本） |
| `callGemini()` | 未检查 |

### 重要说明

- **当前主路径不走 B 路径**：`chat.go` 中的消息构造不会把 `file_ids` 转换成 `Message.Images`。图片全部通过**路径 A** 的 `image_caption` chunk 文本形式注入。
- **路径 B 是为未来预留的**：当需要"用户粘贴 base64 图片到输入框"或"聊天时实时拍照发送"场景时，走路径 B。
- **两条路径不冲突**：路径 A 的图片已通过 Vision 转成文字描述（LLM 可理解的上下文），路径 B 提供原生视觉理解（更精确）。如果未来两者同时启用，模型会同时收到文本描述 + 原始图片。

---

## Embedding 与检索策略

```
                    ┌──────────────────────────┐
                    │  RetrievalService.Search  │
                    │                           │
                    │  ┌─────────────────────┐  │
                    │  │  keywordSearch()     │  │
                    │  │  (SQL LIKE / FTS)    │◄─┤── 默认 / 降级路径
                    │  └─────────────────────┘  │
                    │          │                │
                    │          ▼                │
                    │  ┌─────────────────────┐  │
                    │  │  semanticSearch()    │  │
                    │  │  (向量余弦相似度)   │◄─┤── EnableEmbedding 时
                    │  └─────────────────────┘  │
                    │          │                │
                    │          ▼                │
                    │  合并结果 + 去重排序      │
                    └──────────────────────────┘
```

**策略说明**：

1. 默认先用 `keywordSearch` 做关键词匹配
2. 若 embedder 可用，再追加 `semanticSearch`（向量检索）
3. 合并去重后按 `Score` 降序返回
4. `DynamicTopK(model)` 根据模型类型动态调整返回条数

---

## 数据模型

### File

| 字段 | 类型 | 说明 |
|---|---|---|
| ID | uint | 自增主键 |
| PublicID | string | 公开唯一 ID（`public_id`，暴露给前端） |
| UserID | uint | 所有者 |
| Filename | string | 原始文件名 |
| MimeType | string | MIME 类型 |
| Content | text | 解析后的文本内容 |
| Summary | text | 摘要（Vision 生成的图片描述等） |
| HasImages | bool | 是否包含图片 |
| HasTables | bool | 是否包含表格 |
| PageCount | int | PDF 页码数 |
| ParseStatus | string | `pending` / `parsing` / `done` / `error` |
| FileSize | int64 | 文件大小 |

### FileChunk

| 字段 | 类型 | 说明 |
|---|---|---|
| ID | uint | 自增主键 |
| FileID | uint | 关联 File |
| BlockID | string | `p3-b7` / `img-1-caption-1` / `slide-5-content` |
| BlockType | string | `paragraph` / `heading` / `table` / `image_caption` / `code` / `slide_title` / `slide_content` |
| Content | text | 块内容 |
| Page | *int | 页码（PDF） |
| Slide | *int | 幻灯片编号（PPTX） |
| SheetName | string | 工作表名（XLSX） |
| Meta | JSON | 额外元数据（如 `{"language":"go","filename":"main.go"}`） |
| ChunkIndex | int | 排序索引 |

### FileEmbedding

| 字段 | 说明 |
|---|---|
| ChunkID | 关联 FileChunk |
| Vector | 1536 维 float32 向量 |
| Model | 使用的 embedding 模型 |

### FileEmbeddingJob

记录待处理的 embedding 任务，由 `StartEmbeddingWorker` 每 5 秒轮询消费。

---

## 关键代码入口

| 组件 | 文件 | 关键函数 |
|---|---|---|
| 上传处理 | `internal/api/file_handler.go` | `handleUpload()` |
| 文件服务 | `internal/services/file_service.go` | `UploadAndParse()`, `parseImage()`, `parsePDF()`, `parseText()` |
| RAG 检索 | `internal/services/file_service.go` | `keywordSearch()`, `SemanticSearch()` |
| Embedding | `internal/services/embedding/` | `StartEmbeddingWorker()`, `OpenAIProvider.EmbedDocuments()` |
| 聊天 RAG | `internal/api/chat.go` | `buildFileContext()`, `reuseConversationFiles()` |
| 模型适配 | `internal/services/ai_service.go` | `callOpenAIResponses()`, `callAnthropic()`, `callDeepSeek()`, `callMoonshot()` |

---

## 常见问题

### Q：为什么上传图片后问「这是什么」，模型说不知道？

最可能的原因（按概率排序）：

1. **异步解析未完成**：`UploadAndParse` 是 goroutine 异步执行，上传后立刻发消息时 `FileChunk` 还没写入。等待 `parse_status = "done"` 后再提问。
2. **多轮对话未携带 file_ids**：只有第一条消息会附加 `file_ids`，后续消息默认清空。当前代码已自动从 `conversation_files` 表复用文件。
3. **Vision API 异常**：如果 `gpt-4o` 调用失败，`image_caption` chunk 可能为空或内容泛化。

### Q：路径 A 的图片处理跟路径 B 有什么区别？

路径 A：上传时调用 Vision 分析，将图片内容转为文本 caption → 存入 `file_chunks` → 作为 system message `<file_context>` 注入。**所有模型通用**，但依赖 Vision 的 caption 质量。

路径 B：聊天时将 base64 图片直接发给模型原生 vision API。**更精确**（模型自己看图片），但只有支持 vision 的模型能用。

两条路径在设计上是互补的，未来可以同时启用。

### Q：Embedding 没配置时 RAG 怎么工作？

纯关键词搜索（`keywordSearch`）：用 SQL `LIKE` 和全文索引匹配 `file_chunks.content`。对英文和中文关键词都有效，但不如语义搜索智能。所有文件的 `EmbeddingStatus = "skipped"`。

---

## 演变历史

| 时间 | 变更 |
|---|---|
| 初始 | 文件上传 + 简单解析 |
| 迭代 | PDF 表格检测、DOCX/PPTX/XLSX 解析、Vision 图片描述 |
| 当前 | 路径 A（文件上传 RAG）成熟运行，路径 B（`Message.Images`）预留 |
| 未来 | 两条路径共存：文件上传走 RAG 提供上下文，内联图片走原生 vision 提供精确视觉 |
