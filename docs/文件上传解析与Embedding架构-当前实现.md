# AI Pool 文件上传、解析与 Embedding 架构（当前实现）

## 1. 架构概览

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                           │
│  用户通过文件选择器/拖拽上传 → 调用 POST /api/files/upload          │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         API Layer (Gin)                              │
│  FileHandler.UploadFile()                                           │
│  - 读取 multipart/form-data 文件                                     │
│  - 调用 fileService.UploadAndParse()                                 │
│  - 返回 UploadResponse（含 content_preview, parse_status）          │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       Service Layer                                  │
│  FileService.UploadAndParse()                                       │
│  ├─ 1. 保存原始文件到磁盘 (./uploads/{userID}_{timestamp}.ext)     │
│  ├─ 2. 创建 DB 记录 (files 表, status=pending)                     │
│  ├─ 3. 启动 goroutine 异步解析                                       │
│  │   └─ FileParser.Parse() → 按扩展名路由到对应解析器              │
│  ├─ 4. 保存解析结果到 DB (files.content, files.parse_status=done) │
│  ├─ 5. 保存结构化 chunks (file_chunks 表)                          │
│  ├─ 6. 创建 embedding job (file_embedding_jobs 表, pending)       │
│  └─ 7. 异步生成文件摘要（如摘要为空且内容 > 200 字符）            │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Embedding Worker (后台 goroutine)                 │
│  startEmbeddingWorker() — 每 5 秒轮询 pending jobs                  │
│  ├─ 恢复重启前未完成的 jobs (RecoverEmbeddingJobs)                  │
│  ├─ 获取文件的所有 pending chunks                                   │
│  ├─ 批量调用 embedder.EmbedDocuments(texts)                         │
│  ├─ 保存向量到 file_embeddings 表 (BLOB 存储 float32[])            │
│  └─ 更新 job 和文件状态为 done                                      │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Chat 引用流程                                     │
│  用户提问时关联文件 → GetFileContext() / GetFileContextWithQuery()  │
│  ├─ 关键词过滤 chunks (containsAny)                                 │
│  ├─ 按 chunk_index 排序取前 N 个                                    │
│  └─ 拼接为 "===== 文件: xxx =====\n--- 页码: N ---\n内容" 注入 prompt │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. 数据库表结构

### 2.1 `files` — 文件主表

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uint PK | 自增主键 |
| `public_id` | string(64) UQ | 对外暴露的不可枚举 ID |
| `user_id` | uint IDX | 上传者 (0 = 未登录) |
| `filename` | string | 原始文件名 |
| `mime_type` | string | MIME 类型 |
| `size` | int64 | 文件字节数 |
| `storage_path` | string | 磁盘路径 (./uploads/...) |
| `parse_status` | string(16) | pending / parsing / done / error / unsupported |
| `embedding_status` | string(16) | pending / indexing / done / error / skipped / disabled |
| `error_message` | text | 解析/embedding 失败原因 |
| `content` | text | 解析后的完整 Markdown 文本 |
| `summary` | text | 文件摘要（前 500 字符智能截断） |
| `page_count` | int | 页数/幻灯片数/Sheet 数 |
| `token_count` | int | 总 token 数（估算） |
| `has_images` | bool | 是否含图片 |
| `has_tables` | bool | 是否含表格 |

### 2.2 `file_chunks` — 结构化文本块

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uint PK | |
| `file_id` | uint IDX | 所属文件 |
| `block_id` | string(64) IDX | 结构化标识，如 `p3-b7`, `slide2-b1`, `sheet1` |
| `chunk_index` | int | 顺序索引 |
| `page` / `slide` / `sheet_name` | | 多维度定位 |
| `block_type` | string(32) | paragraph / heading / table / code / image_ref / image_caption |
| `content` | text | 纯文本内容 |
| `markdown` | text | Markdown 格式（如代码块、表格） |
| `token_count` | int | |
| `text_hash` | string(64) IDX | SHA-256 前 16 字节 hex，防重复 embedding |
| `metadata` | text | JSON 元数据（如 `{"language":"go","filename":"main.go"}`） |
| `embedding_status` | string(32) | pending / done / error / skipped |

### 2.3 `file_embeddings` — 向量存储

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uint PK | |
| `file_id` | uint IDX | |
| `chunk_id` | uint UQ(composite) | |
| `provider` | string(32) UQ(composite) | openai / gemini / local |
| `model` | string(128) UQ(composite) | text-embedding-3-small |
| `dimension` | int UQ(composite) | 1536 |
| `text_hash` | string(64) UQ(composite) | 一致性校验 |
| `vector` | BLOB | float32[] 二进制 |

**唯一索引**: `idx_embedding_unique` on `(chunk_id, provider, model, dimension, text_hash)`

### 2.4 `file_embedding_jobs` — 异步任务队列

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uint PK | |
| `file_id` | uint IDX | |
| `provider` / `model` / `dimension` | | 目标 embedding 配置 |
| `status` | string(16) | pending / running / done / error |
| `attempts` | int | 重试次数 |
| `error_message` | text | |
| `created_at` / `started_at` / `finished_at` | | 时间戳 |

### 2.5 `conversation_files` — 对话与文件关联

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uint PK | |
| `conversation_id` | uint IDX | |
| `file_id` | uint IDX | |

---

## 3. 各文件类型的处理流程

### 3.1 纯文本 / 代码文件（.txt, .md, .go, .py, .js, .json, .csv, ...）

```
用户上传 main.go
  │
  ▼
FileParser.Parse() → 命中 parseText()
  ├─ 检测 UTF-8 有效性，无效字符替换为 �
  ├─ 判断 isCodeFile(".go") → true
  ├─ block_type = "code"
  ├─ metadata = {"language":"go","filename":"main.go"}
  ├─ 包装为 Markdown 代码块: ```go\n...\n```
  └─ chunkStructured() 按 2000 字符/200 重叠切分

存储结果:
  files.content      = "```go\npackage main...\n```"
  files.parse_status = "done"
  file_chunks[0]     = {block_type:"code", content:"...", metadata:"..."}
  embedding_job      = pending (非图片文件)
```

**特点**: 
- Markdown 文件原样保留格式，代码文件自动添加语言高亮标记
- 切分策略：按段落边界（`\n\n`）优先，chunk_size=2000，overlap=200

---

### 3.2 PDF（.pdf）

```
用户上传 report.pdf
  │
  ▼
FileParser.Parse() → 命中 parsePDF()
  ├─ 写入临时文件 → pdf.Open() (ledongthuc/pdf 库)
  ├─ 逐页提取纯文本 (GetPlainText)
  ├─ detectBlocks() 启发式检测:
  │   ├─ 表格: 含 "|" 或多空格对齐 → block_type="table"
  │   ├─ 标题: 短行/全大写/以 "Chapter"/"Section"/"第" 开头 → block_type="heading"
  │   └─ 段落: 默认 → block_type="paragraph"
  ├─ 表格自动添加 Markdown 表头分隔线 (ensureTableHeaderSeparator)
  └─ 每页 block 分配 BlockID: "p{page}-b{counter}"

存储结果:
  files.content      = 所有 block 文本拼接
  files.page_count   = PDF 实际页数
  files.has_tables   = true (如检测到表格)
  file_chunks[n]     = {page:3, block_id:"p3-b7", block_type:"table", content:"| A | B |..."}
  embedding_job      = pending
```

**特点**:
- 纯文本提取，不解析图片内容（PDF 内嵌图片不会触发 Vision API）
- 表格检测为启发式，支持 `|` 分隔和多空格对齐两种格式
- 标题检测支持中英文前缀

---

### 3.3 Word 文档（.docx）

```
用户上传 contract.docx
  │
  ▼
FileParser.Parse() → 命中 parseDOCX()
  ├─ zip.NewReader 解压 DOCX (本质是 ZIP)
  ├─ 读取 word/document.xml
  ├─ extractDOCXBlocks():
  │   ├─ 按 <w:p> 分割段落
  │   ├─ 检测 Heading1~Heading6 / 标题1~标题6 样式 → block_type="heading"
  │   ├─ 检测 <w:tbl> → block_type="table"
  │   └─ 默认 → block_type="paragraph"
  ├─ 标题添加 Markdown # 前缀
  └─ BlockID: "docx-b{n}"

存储结果:
  files.content      = 所有 block 拼接
  file_chunks[n]     = {block_type:"heading", content:"## 合同条款", ...}
  embedding_job      = pending
```

---

### 3.4 PowerPoint（.pptx）

```
用户上传 slides.pptx
  │
  ▼
FileParser.Parse() → 命中 parsePPTX()
  ├─ zip.NewReader 解压 PPTX
  ├─ 遍历 ppt/slides/slide{n}.xml
  ├─ extractPPTXSlideBlocks():
  │   ├─ 每页第一段默认为 heading
  │   ├─ 检测 <a:blip> (图片引用) → block_type="image_ref"
  │   └─ 其余 → block_type="paragraph"
  ├─ BlockID: "slide{slide}-b{counter}"
  └─ files.has_images = true (PPT 通常含图片)

存储结果:
  files.content      = 所有 slide 文本拼接
  files.page_count   = slide 数量
  files.has_images   = true
  file_chunks[n]     = {slide:2, block_id:"slide2-b1", block_type:"heading", ...}
  embedding_job      = pending
```

---

### 3.5 Excel（.xlsx）

```
用户上传 data.xlsx
  │
  ▼
FileParser.Parse() → 命中 parseXLSX()
  ├─ zip.NewReader 解压 XLSX
  ├─ 读取 xl/sharedStrings.xml (共享字符串表)
  ├─ 遍历 xl/worksheets/sheet{n}.xml
  ├─ parseSheetXMLStructured():
  │   ├─ XML 解析 <sheetData> → <row> → <c> 单元格
  │   ├─ 单元格类型 "s" → 查 sharedStrings 映射
  │   └─ 输出标准 Markdown 表格（自动添加表头分隔线）
  ├─ 每 Sheet 一个 chunk
  └─ BlockID: "sheet{n}", block_type="table"

存储结果:
  files.content      = "## Sheet 1\n| A | B |...\n| --- | --- |...\n\n## Sheet 2\n..."
  files.page_count   = Sheet 数量
  files.has_tables   = true
  file_chunks[n]     = {block_id:"sheet1", block_type:"table", metadata:'{"table_cols":5,"sheet":"Sheet1"}'}
  embedding_job      = pending
```

---

### 3.6 图片（.jpg, .png, .gif, .webp, .bmp）

```
用户上传 photo.png
  │
  ▼
FileParser.Parse() → 命中 parseImage()
  ├─ 不调用 Vision API，不 OCR
  ├─ 仅记录: content="", has_images=true
  └─ 生成一个占位 chunk: {block_type:"image_ref", text:"[图片文件]"}

存储结果:
  files.content        = "" (空)
  files.parse_status   = "done"
  files.has_images     = true
  file_chunks[0]       = {block_type:"image_ref", text:"[图片文件]"}
  files.embedding_status = "skipped" (图片文件不 embedding)
  
实际使用:
  聊天时前端通过 /api/files/{id}/download 获取 base64
  直接作为 image_url 传入多模态模型 (GPT-4o / Claude / Gemini)
```

**特点**:
- 图片**不走解析/embedding 流程**，原始文件保留在磁盘
- 聊天时由前端或后端 `GetFileBase64DataURI()` 读取并转为 `data:image/png;base64,...` 格式
- 直接传给支持 Vision 的模型，无需文本化

---

## 4. Embedding 流程详解

### 4.1 触发条件

```go
// file_service.go UploadAndParse() 中
if s.embedder != nil && !strings.HasPrefix(mimeType, "image/") {
    // 创建 embedding job
} else {
    // 图片 or embedder 未配置 → skipped / disabled
}
```

- **文本/文档类**: 解析完成后自动创建 `file_embedding_jobs` 记录，状态 `pending`
- **图片类**: 直接标记 `embedding_status = "skipped"`，不创建 job
- **未配置 embedder**: 标记 `"disabled"`

### 4.2 Worker 执行

```go
startEmbeddingWorker()
  ├─ 每 5 秒轮询 DB: SELECT * FROM file_embedding_jobs WHERE status='pending' LIMIT 1
  ├─ ProcessEmbeddingJob():
  │   ├─ 状态设为 running
  │   ├─ 查询该文件所有 embedding_status='pending' 的 chunks
  │   ├─ 批量调用 embedder.EmbedDocuments([]string{chunk1, chunk2, ...})
  │   ├─ 向量序列化为 []float32 → BLOB 存入 file_embeddings
  │   ├─ chunk.embedding_status = "done"
  │   ├─ job.status = "done"
  │   └─ file.embedding_status = "done"
  └─ 串行处理，避免并发 RPM 限制
```

### 4.3 恢复机制

```go
RecoverEmbeddingJobs()
  ├─ 服务启动时查询 status='pending' 的所有 jobs
  └─ 打印日志，由 ticker 自动在下一轮处理
```

---

## 5. 聊天引用流程

### 5.1 关联文件 → 对话上下文注入

```
用户提问时勾选文件 photo.png + report.pdf
  │
  ▼
后端获取 conversation 关联的 file_ids
  ├─ 图片文件 → GetFileBase64DataURI() → 作为 image_url 放入 messages
  └─ 文档文件 → GetFileContext() / GetFileContextWithQuery()
      ├─ 按 chunk_index 排序
      ├─ 关键词过滤 (extractKeywords + containsAny)
      ├─ 取前 maxChunksPerFile 个 (默认全取)
      └─ 拼接格式:
         
         ===== 文件: report.pdf =====
         --- 页码: 3 ---
         [表格内容...]
         
         --- 页码: 5 ---
         [段落内容...]
```

### 5.2 文件权限

```go
ResolveFileByPublicID(publicID, userID)
  ├─ userID == 0 (未登录): 只能访问自己上传的匿名文件
  ├─ userID > 0: 只能访问 user_id == 自己的文件
  └─ 其他情况返回 "无权访问"
```

---

## 6. HTTP API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/files/upload` | 上传文件 (multipart/form-data) |
| `GET`  | `/api/files` | 列出当前用户文件 |
| `GET`  | `/api/files/:id` | 获取文件元数据 |
| `GET`  | `/api/files/:id/download` | 下载原始文件 |
| `DELETE`| `/api/files/:id` | 删除文件（级联删除 chunks/embeddings/jobs） |

---

## 7. 配置项

```yaml
# config.yaml
file_storage_dir: "./uploads"  # 默认，可自定义
```

---

## 8. 关键设计决策

| 决策 | 说明 |
|---|---|
| **异步解析** | Upload 接口立即返回，解析在 goroutine 中完成，避免大文件阻塞 HTTP |
| **图片不 embedding** | 图片内容通过 Vision API 直接消费，无需文本向量化 |
| **纯文本 PDF 解析** | 使用 `ledongthuc/pdf` 提取文本，不解析图片/扫描件（无 OCR） |
| **BLOB 存向量** | float32[] 直接二进制存储，比 JSON/字符串高效 |
| **text_hash 防重复** | 内容不变时避免重复 embedding，节省 API 调用 |
| **关键词检索（MVP）** | 当前使用 containsAny 关键词过滤，未使用向量相似度检索 |
| **PublicID 不可枚举** | 文件访问使用 public_id 而非自增 ID，防止遍历 |

---

## 9. 扩展预留

当前架构已为以下扩展预留字段和接口：

- **向量检索**: `file_embeddings.vector` + `embedding.Provider` 接口已就绪，只需在 `GetFileContextWithQuery()` 中接入余弦相似度计算
- **多 Provider**: `provider` / `model` / `dimension` 字段支持 OpenAI / Gemini / Local 共存
- **Vision 增强**: `has_images` 标记可用于后续自动触发 GPT-4o Vision 描述图片内容
- **结构化引用**: `block_id` / `page` / `slide` / `sheet_name` 支持精确溯源
