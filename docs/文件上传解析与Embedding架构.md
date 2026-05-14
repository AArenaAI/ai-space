# AI Space — 文件上传、解析与 Embedding 架构文档

> 版本：v1.0  
> 日期：2026-05-13  
> 状态：Embedding 功能暂未启用（`ENABLE_EMBEDDING=false`），文件上传与解析已完整可用

---

## 目录

1. [架构概览](#1-架构概览)
2. [数据模型](#2-数据模型)
3. [文件上传流程](#3-文件上传流程)
4. [文件解析流程](#4-文件解析流程)
5. [Embedding 架构](#5-embedding-架构)
6. [状态流转](#6-状态流转)
7. [功能开关](#7-功能开关)
8. [API 接口](#8-api-接口)
9. [未来扩展](#9-未来扩展)

---

## 1. 架构概览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              用户层 (Frontend)                           │
│  上传文件 → 轮询状态 → 聊天引用文件                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              API 层 (Gin Router)                         │
│  POST /api/files/upload                                                │
│  GET  /api/files/:id                                                   │
│  GET  /api/files                                                       │
│  DELETE /api/files/:id                                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌───────────┐   ┌───────────┐   ┌───────────────┐
            │FileService│   │FileParser │   │RetrievalService│
            │文件服务    │   │解析服务   │   │检索服务        │
            └─────┬─────┘   └─────┬─────┘   └───────┬───────┘
                  │               │                   │
                  ▼               ▼                   ▼
            ┌───────────┐   ┌───────────┐   ┌───────────────┐
            │  File     │   │FileChunk  │   │ FileEmbedding │
            │  文件主表  │   │文本分块表 │   │ 向量存储表    │
            └───────────┘   └───────────┘   └───────────────┘
                                    │
                                    ▼
                         ┌──────────────────┐
                         │ SQLite (GORM)    │
                         │ ./data/aipool.db │
                         └──────────────────┘
```

### 核心设计原则

| 原则 | 说明 |
|------|------|
| **PublicID 对外** | 所有 API 交互使用 `public_id`（如 `file_xxx`），内部自增 ID 不暴露 |
| **异步解析** | 文件上传后立即返回，解析在后台 goroutine 中完成 |
| **状态独立** | `parse_status` 和 `embedding_status` 分离，互不影响 |
| **功能开关** | Embedding 通过 `ENABLE_EMBEDDING` 环境变量控制，可随时开关 |
| **降级兼容** | 无 Embedding 时，文件仍可用，聊天通过全文/关键词 fallback |

---

## 2. 数据模型

### 2.1 File（文件主表）

```go
type File struct {
    ID              uint      `gorm:"primaryKey"`           // 内部自增 ID（不对外暴露）
    PublicID        string    `gorm:"uniqueIndex;not null"` // 对外唯一标识，如 file_abc123
    UserID          uint      `gorm:"index"`                // 上传用户 ID（0=匿名）
    Filename        string                                 // 原始文件名
    Type            string                                 // text / image / document
    MimeType        string                                 // MIME 类型
    Size            int64                                  // 文件大小（字节）
    Content         string                                 // 解析后的完整文本内容
    Summary         string                                 // 文件摘要（可选，异步生成）
    PageCount       int                                    // 页数（PDF/PPT 等）
    ParseStatus     string    // pending | parsing | done | error
    EmbeddingStatus string    // disabled | pending | indexing | done | error | skipped
    ErrorMessage    string                                 // 错误信息
    StoragePath     string                                 // 磁盘存储路径
    CreatedAt       time.Time
    UpdatedAt       time.Time
}
```

**关键索引：**
- `public_id`：唯一索引，所有外部查询入口
- `user_id`：普通索引，用户文件列表查询

### 2.2 FileChunk（文本分块表）

```go
type FileChunk struct {
    ID               uint      `gorm:"primaryKey"`
    FileID           uint      `gorm:"index;not null"`       // 关联 File.ID
    ChunkIndex       int                                    // 块序号（0, 1, 2...）
    BlockType        string    // paragraph | heading | table | list | code | image
    Page             int                                    // 所属页码
    BlockID          string                                 // 原始块 ID
    Text             string                                 // 块文本内容
    Markdown         string                                 // Markdown 格式（保留）
    TokenCount       int                                    // 预估 token 数
    TextHash         string    `gorm:"index"`               // 内容哈希（去重/变化检测）
    EmbeddingStatus  string    // pending | done | error
    Metadata         string    // JSON 扩展字段
    CreatedAt        time.Time
    UpdatedAt        time.Time
}
```

**设计要点：**
- `text_hash`：SHA-256 前 16 字节 hex，用于检测内容变化、避免重复 embedding
- `block_type`：支持多种块类型，便于后续按类型检索（如只取表格、只取标题）
- `page`：支持页码定位，用户可直接问"第 3 页讲了什么"

### 2.3 FileEmbedding（向量存储表）

```go
type FileEmbedding struct {
    ID         uint      `gorm:"primaryKey"`
    FileID     uint      `gorm:"index;not null"`
    ChunkID    uint      `gorm:"not null"`
    Provider   string    // openai | gemini | local
    Model      string    // text-embedding-3-small
    Dimension  int       // 1536
    TextHash   string    // 生成时的 text_hash
    Vector     []byte    // 向量二进制（float32 数组序列化）
    CreatedAt  time.Time
    UpdatedAt  time.Time
}
```

**唯一索引：**
```sql
UNIQUE INDEX idx_embedding_unique ON file_embeddings(
    chunk_id, provider, model, dimension, text_hash
)
```

**作用：** 同一 chunk、同一模型、同一维度、同一内容只存一份向量，避免重复计算。

### 2.4 FileEmbeddingJob（Embedding 任务队列）

```go
type FileEmbeddingJob struct {
    ID          uint      `gorm:"primaryKey"`
    FileID      uint      `gorm:"index;not null"`
    Provider    string
    Model       string
    Dimension   int
    Status      string    // pending | processing | done | error
    ErrorMessage string
    Attempts    int       // 重试次数
    CreatedAt   time.Time
    UpdatedAt   time.Time
}
```

**设计要点：**
- 独立任务表，支持服务重启后自动恢复未完成的 jobs
- `attempts` 字段支持有限重试（目前未实现指数退避）

---

## 3. 文件上传流程

### 3.1 时序图

```
用户          Frontend          Backend (Gin)        FileService         磁盘
 │                │                    │                  │                │
 │  选择文件      │                    │                  │                │
 │───────────────>│                    │                  │                │
 │                │  POST /api/files/upload               │                │
 │                │────────────────────>│                  │                │
 │                │                    │  保存到磁盘       │                │
 │                │                    │─────────────────>│                │
 │                │                    │                  │  写入文件      │
 │                │                    │                  │───────────────>│
 │                │                    │                  │<───────────────│
 │                │                    │  创建 File 记录   │                │
 │                │                    │<─────────────────│                │
 │                │  返回 public_id    │                  │                │
 │                │<────────────────────│                  │                │
 │                │                    │                  │                │
 │                │                    │  启动异步解析    │                │
 │                │                    │  go parseAsync() │                │
 │                │                    │─────────────────>│                │
 │  轮询状态      │                    │                  │                │
 │───────────────>│  GET /api/files/:public_id            │                │
 │                │────────────────────>│                  │                │
 │                │  返回 parse_status │                  │                │
 │                │<────────────────────│                  │                │
 │                │                    │                  │                │
 │                │                    │  [后台] 解析完成  │                │
 │                │                    │  parse_status=d  │                │
 │                │                    │  one             │                │
 │                │                    │                  │                │
 │  轮询到 done   │                    │                  │                │
 │<───────────────│                    │                  │                │
```

### 3.2 详细步骤

**Step 1：接收上传**
```go
// router.go
router.POST("/api/files/upload", fileHandler.UploadFile)
```

**Step 2：保存到磁盘**
```go
// 生成存储路径：./uploads/2026/05/13/filename_xxx.ext
storagePath := generateStoragePath(filename)
// 写入磁盘
os.WriteFile(storagePath, fileData, 0644)
```

**Step 3：创建 File 记录**
```go
file := &models.File{
    PublicID:        generatePublicID(),     // 如 file_abc123
    UserID:          userID,
    Filename:        filename,
    Type:            detectType(mimeType),   // text / image / document
    MimeType:        mimeType,
    Size:            len(fileData),
    ParseStatus:     "pending",
    EmbeddingStatus: "pending",
    StoragePath:     storagePath,
}
db.Create(file)
```

**Step 4：启动异步解析**
```go
go func() {
    // 解析文件 → Content + Chunks
    result, err := parser.Parse(ctx, fileData, filename)
    if err != nil {
        db.Model(file).Update("parse_status", "error")
        return
    }
    
    // 保存解析结果
    db.Model(file).Updates(map[string]interface{}{
        "content":      result.Content,
        "summary":      result.Summary,
        "page_count":   result.PageCount,
        "parse_status": "done",
    })
    
    // 保存 chunks
    for i, chunk := range result.Chunks {
        db.Create(&models.FileChunk{
            FileID:      file.ID,
            ChunkIndex:  i,
            BlockType:   chunk.BlockType,
            Page:        chunk.Page,
            BlockID:     chunk.BlockID,
            Text:        chunk.Text,
            Markdown:    chunk.Markdown,
            TokenCount:  chunk.TokenCount,
            TextHash:    hashText(chunk.Text),  // SHA-256 前 16 字节
            Metadata:    chunk.Metadata,
        })
    }
    
    // 创建 Embedding Job（仅当 embedder 启用且非图片文件）
    if embedder != nil && !isImage(mimeType) {
        db.Create(&models.FileEmbeddingJob{
            FileID:    file.ID,
            Provider:  "openai",
            Model:     "text-embedding-3-small",
            Dimension: 1536,
            Status:    "pending",
        })
    } else {
        db.Model(file).Update("embedding_status", "skipped")  // 图片
        // 或 "disabled"（embedder 未启用）
    }
}()
```

**Step 5：返回 PublicID**
```json
{
    "public_id": "file_abc123",
    "filename": "report.pdf",
    "type": "document",
    "parse_status": "pending",
    "size": 102400
}
```

### 3.3 前端轮询

```javascript
// 上传后立即轮询
const pollStatus = async (publicId) => {
    const res = await fetch(`/api/files/${publicId}`);
    const data = await res.json();
    if (data.parse_status === 'done') {
        // 解析完成，可以聊天引用
        return data;
    } else if (data.parse_status === 'error') {
        // 解析失败
        throw new Error(data.error_message);
    }
    // 继续轮询
    setTimeout(() => pollStatus(publicId), 2000);
};
```

---

## 4. 文件解析流程

### 4.1 支持的文件类型

| 类型 | MIME Type | 处理方式 |
|------|-----------|----------|
| 纯文本 | `text/plain` | 直接读取 |
| Markdown | `text/markdown` | 直接读取 + 标题提取 |
| PDF | `application/pdf` | 文本提取 + 页码 |
| Word | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 文本提取 |
| PPT | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | 幻灯片提取 |
| Excel | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 表格提取 |
| 图片 | `image/*` | base64，不入 embedding |
| 代码文件 | `text/x-python` 等 | 语法高亮 + 块提取 |

### 4.2 解析结果结构

```go
type ParseResult struct {
    Content   string        // 完整文本
    Summary   string        // 摘要（可选）
    PageCount int           // 页数
    Chunks    []Chunk       // 分块结果
}

type Chunk struct {
    BlockType   string      // paragraph | heading | table | list | code | image
    Page        int         // 页码
    BlockID     string      // 原始块 ID
    Text        string      // 纯文本
    Markdown    string      // Markdown 格式
    TokenCount  int         // 预估 token
    Metadata    string      // JSON 扩展
}
```

### 4.3 分块策略

当前实现为简单分块（按段落/页面），未来可扩展：

```
简单分块（当前）
  └── 按段落切分，每段一个 chunk

语义分块（未来）
  └── 按语义边界切分（标题-内容对、表格整体、代码块）

重叠分块（未来）
  └── 相邻 chunk 之间有重叠，避免边界信息丢失
```

### 4.4 异步摘要生成

解析完成后，如果内容较长（>200 字符）且没有摘要，自动在后台生成：

```go
go func() {
    summary := generateSummary(content)  // 截取前 500 字符
    db.Model(file).Update("summary", summary)
}()
```

> ⚠️ 注意：当前实现为简单截取，未来可接入 LLM 生成智能摘要。

---

## 5. Embedding 架构

### 5.1 当前模式：DISABLED

```
ENABLE_EMBEDDING=false
```

**行为：**
- `startEmbeddingWorker()` 检测到 `embedder == nil`，直接返回，不启动 worker
- `UploadAndParse` 跳过 embedding job 创建，标记 `embedding_status = "disabled"`
- 文件解析、chunk 存储、聊天引用完全不受影响
- 聊天时使用 **全文 fallback** 或 **关键词检索**

### 5.2 启用模式：ENABLED

```
ENABLE_EMBEDDING=true
OPENAI_API_KEY=sk-xxx
EMBEDDING_BASE_URL=https://api.openai.com  # 可选，默认复用 OPENAI_BASE_URL
```

**行为：**
- `startEmbeddingWorker()` 启动，每 5 秒轮询 pending jobs
- `UploadAndParse` 为非图片文件创建 `FileEmbeddingJob`
- Worker 串行处理 jobs（避免 API RPM 限制）
- 生成向量后存入 `FileEmbedding`
- `File.EmbeddingStatus` 流转：`pending` → `indexing` → `done`/`error`

### 5.3 Embedding Worker 流程

```
服务启动
  │
  ▼
RecoverEmbeddingJobs()  ──→ 恢复重启前未完成的 jobs（status=pending）
  │
  ▼
ticker (5s)
  │
  ▼
ListPendingEmbeddingJobs(1)  ──→ 每次取 1 个 job
  │
  ▼
ProcessEmbeddingJob(job)
  │
  ├── 1. 获取文件所有 chunks
  │
  ├── 2. 检查是否已有 embedding（通过 uniqueIndex 去重）
  │
  ├── 3. 调用 Embedder.EmbedDocuments(chunks)  
  │      └── 调用 OpenAI /v1/embeddings API
  │
  ├── 4. 保存向量到 FileEmbedding
  │
  ├── 5. 更新 job status = done
  │
  └── 6. 更新 File.EmbeddingStatus = done
```

### 5.4 检索流程（启用时）

```
用户提问
  │
  ▼
EmbedQuery(query)  ──→ 生成查询向量
  │
  ▼
向量相似度检索  ──→ 从 FileEmbedding 找 topK 最相似 chunk
  │
  ▼
构造上下文  ──→ 把 topK chunks 拼入 prompt
  │
  ▼
发给 LLM
```

### 5.5 无 Embedding 时的 Fallback 策略

| 场景 | 策略 | 说明 |
|------|------|------|
| 小文件（<6000 tokens） | **全文** | 直接把完整 content 拼给模型 |
| 中等文件 | **关键词检索** | 用户问题分词，匹配 chunks，取 top 6-10 |
| 用户提到页码 | **页码定位** | 直接取对应 page 的 chunks |
| 无命中 | **摘要 + 前 N 块** | 取摘要、标题 chunks、前 3 个 chunks |

---

## 6. 状态流转

### 6.1 ParseStatus（解析状态）

```
上传文件
  │
  ▼
pending ──→ parsing ──→ done
              │
              └──→ error
```

| 状态 | 含义 |
|------|------|
| `pending` | 等待解析 |
| `parsing` | 正在解析 |
| `done` | 解析完成 |
| `error` | 解析失败 |

### 6.2 EmbeddingStatus（语义索引状态）

```
上传文件（embedder 启用）
  │
  ▼
pending ──→ indexing ──→ done
              │
              └──→ error

上传文件（embedder 未启用）
  │
  ▼
disabled  ←── 功能关闭

上传图片文件
  │
  ▼
skipped   ←── 图片不需要 embedding
```

| 状态 | 含义 | 触发条件 |
|------|------|----------|
| `pending` | 等待 embedding | 文件解析完成，embedder 启用 |
| `indexing` | 正在生成向量 | Worker 开始处理 |
| `done` | 向量生成完成 | 所有 chunks 都已 embedding |
| `error` | 向量生成失败 | API 错误、网络错误 |
| `skipped` | 跳过 | 图片文件 |
| `disabled` | 功能未启用 | `ENABLE_EMBEDDING=false` |

---

## 7. 功能开关

### 7.1 环境变量配置

```env
# ============================================
# Embedding 配置
# ============================================
ENABLE_EMBEDDING=false                    # 总开关：true=启用, false=禁用

# 以下仅在 ENABLE_EMBEDDING=true 时生效
EMBEDDING_PROVIDER=openai                 # 提供商：openai | gemini | local
EMBEDDING_MODEL=text-embedding-3-small    # 模型名
EMBEDDING_DIMENSIONS=1536                 # 向量维度
EMBEDDING_BATCH_SIZE=32                   # 批量大小
EMBEDDING_BASE_URL=                       # 自定义 API 地址（可选）
EMBEDDING_API_KEY=                        # 自定义 API Key（可选，默认复用 OPENAI_API_KEY）
```

### 7.2 开关行为对照表

| 配置 | 上传行为 | Worker | 聊天检索 |
|------|----------|--------|----------|
| `ENABLE_EMBEDDING=false` | 不创建 job，标记 `disabled` | 不启动 | 全文/关键词 fallback |
| `ENABLE_EMBEDDING=true`，API 正常 | 创建 job，标记 `pending` | 启动并处理 | 向量检索 |
| `ENABLE_EMBEDDING=true`，API 失败 | 创建 job，标记 `error` | 持续重试 | 降级到全文/关键词 |

### 7.3 动态切换

修改 `.env` 后重启服务即可：

```bash
# 关闭 embedding
ENABLE_EMBEDDING=false

# 启用 embedding（需确保 API 可用）
ENABLE_EMBEDDING=true
EMBEDDING_BASE_URL=https://api.openai.com
```

> ⚠️ 注意：切换开关不会影响已有文件的状态。从 `disabled` 切换到 `true` 时，已上传的文件不会自动补 embedding，需要重新上传或使用管理工具批量处理。

---

## 8. API 接口

### 8.1 上传文件

```http
POST /api/files/upload
Content-Type: multipart/form-data

file: <二进制文件>
```

**响应：**
```json
{
    "public_id": "file_abc123",
    "filename": "report.pdf",
    "type": "document",
    "parse_status": "pending",
    "mime_type": "application/pdf",
    "size": 102400
}
```

### 8.2 查询文件状态

```http
GET /api/files/:public_id
```

**响应：**
```json
{
    "id": 1,
    "public_id": "file_abc123",
    "filename": "report.pdf",
    "type": "document",
    "parse_status": "done",
    "embedding_status": "disabled",
    "content_preview": "这是文件内容的前 200 字符...",
    "page_count": 12,
    "size": 102400,
    "created_at": "2026-05-13T10:00:00Z",
    "updated_at": "2026-05-13T10:00:05Z"
}
```

### 8.3 列出用户文件

```http
GET /api/files
Authorization: Bearer <token>
```

**响应：**
```json
[
    {
        "public_id": "file_abc123",
        "filename": "report.pdf",
        "parse_status": "done",
        "embedding_status": "disabled",
        "size": 102400,
        "created_at": "2026-05-13T10:00:00Z"
    }
]
```

### 8.4 删除文件

```http
DELETE /api/files/:public_id
Authorization: Bearer <token>
```

**级联删除：**
- File 记录
- FileChunk 记录
- FileEmbedding 记录
- FileEmbeddingJob 记录
- 磁盘文件

---

## 9. 未来扩展

### 9.1 V1.1 — Embedding 上线

- [ ] 配置 `ENABLE_EMBEDDING=true`
- [ ] 接入 OpenAI / Gemini / 本地 embedding 模型
- [ ] 批量 embedding（batch size 32）
- [ ] 指数退避重试
- [ ] 向量相似度检索（cosine similarity）

### 9.2 V1.5 — 语义检索增强

- [ ] Hybrid Search（向量 + 关键词混合检索）
- [ ] 重排序（Re-ranker）
- [ ] 来源引用（citations）
- [ ] 多文件联合检索
- [ ] 图片 caption → text chunk → embedding

### 9.3 V2.0 — 文件智能层

- [ ] 自动标签生成
- [ ] 跨文件知识图谱
- [ ] 智能摘要（LLM 生成）
- [ ] 文件对比分析
- [ ] PPT/Excel 智能问答

---

## 附录

### A. 文件存储路径

```
./uploads/
├── 2026/
│   ├── 05/
│   │   ├── 13/
│   │   │   ├── report_abc123.pdf
│   │   │   └── image_def456.png
```

### B. PublicID 生成规则

```go
func generatePublicID() string {
    return "file_" + randomString(16)  // 如 file_abc123def456ghi7
}
```

### C. TextHash 计算

```go
func hashText(text string) string {
    h := sha256.Sum256([]byte(text))
    return hex.EncodeToString(h[:16])  // 前 16 字节 = 32 字符 hex
}
```

### D. 相关代码文件

| 文件 | 职责 |
|------|------|
| `internal/models/file.go` | 数据模型定义 |
| `internal/services/file_service.go` | 文件上传、解析、embedding worker |
| `internal/services/file_parser.go` | 文件解析逻辑 |
| `internal/services/retrieval_service.go` | 检索服务（向量/关键词） |
| `internal/services/embedding/` | Embedding provider 接口和实现 |
| `internal/api/file_handler.go` | HTTP 接口处理 |
| `internal/api/router.go` | 路由注册、服务初始化 |
| `internal/config/config.go` | 配置读取 |
