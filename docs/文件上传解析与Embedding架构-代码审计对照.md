# AI Pool 文件上传解析与 Embedding 架构 —— 代码审计对照报告

> 生成日期：2026-05-14  
> 审计范围：`backend-go/internal/api/file_handler.go`、`backend-go/internal/services/file_service.go`、`backend-go/internal/services/file_parser.go`、`backend-go/internal/services/retrieval_service.go`、`frontend/components/chat/MessageInput.tsx`  
> 对照文档：`docs/文件上传解析与Embedding架构.md`（v1.0，2026-05-13）

---

## 一、架构符合度总览

| 文档描述 | 实际代码 | 符合度 |
|---------|---------|--------|
| **数据模型** File / FileChunk / FileEmbedding / FileEmbeddingJob 四表结构 | `internal/models/file.go` 中四张表完全对应，字段一致 | ✅ 完全吻合 |
| **PublicID 对外**，内部自增 ID 不暴露 | `file_handler.go` 所有 API 返回/查询均使用 `public_id` | ✅ 吻合 |
| **异步解析**，上传后立即返回，后台 goroutine 解析 | `file_service.go` 的 `UploadAndParse` 中 `go parseAsync()` | ✅ 吻合 |
| **状态分离** `parse_status` 与 `embedding_status` | 代码中确实是两个独立字段 | ✅ 吻合 |
| **功能开关** `ENABLE_TEXT_EMBEDDING` | `router.go` 中 `cfg.EnableTextEmbedding` 控制 embedder 初始化 | ✅ 吻合 |
| 解析状态流转：`pending → parsing → done` | 代码中只有 `pending → done`，**没有中间的 `parsing` 状态** | ⚠️ 略有差异 |
| 前端轮询间隔 2 秒 | `MessageInput.tsx` 中实际是 **3 秒** | ⚠️ 略有差异 |
| 异步摘要生成（截取前 500 字符） | `file_service.go` 的 `parseAsync` 中确实如此 | ✅ 吻合 |
| 图片解析后生成 `image_caption` chunk，统一进入 embedding | `file_service.go` 中不再按 MIME 跳过图片，只要解析出有效文本 chunk 就创建 embedding job | ✅ 已更新 |

**结论：** 整体架构与文档描述高度一致，仅存在两处实现细节差异（状态流转少一个中间态、轮询间隔不同），不影响功能。

---

## 二、端到端数据流

```
用户点击 Paperclip → 前端 FormData 上传
          ↓
POST /api/files/upload（无需认证）
          ↓
FileService.UploadAndParse()
   ├── 保存到磁盘 ./uploads/YYYY/MM/DD/
   ├── 创建 File 记录（parse_status=pending）
   └── go parseAsync() 后台解析
          ↓
FileParser.Parse() 按扩展名分发
   ├── 文本 → parseText() → chunkStructured()
   ├── PDF  → parsePDF()  → 按页分块
   ├── MD   → parseText() → 识别 heading/paragraph
   ├── PPTX → parsePPTX() → 每页一个 chunk
   ├── XLSX → parseXLSX() → Markdown 表格 chunk
   └── 图片 → parseImage() → image_ref chunk
          ↓
保存 FileChunk 到 DB
   └── 若启用 Embedding：创建 FileEmbeddingJob
          ↓
Embedding Worker（每 5 秒轮询）
   ├── 串行处理 pending jobs
   ├── embedder.EmbedDocuments(chunks)
   └── 保存到 FileEmbedding
          ↓
聊天时 RetrievalService.Search()
   ├── 优先向量检索（cosine similarity）
   └── 失败降级关键词检索
```

---

## 三、不同文件类型的具体处理

### 1. 照片（.jpg / .png / .webp / .gif / .bmp）

#### 上传阶段
- 前端：`MessageInput.tsx` 通过 `<input type="file">` 选择，以 `FormData` POST 到 `/api/files/upload`
- 后端：`file_service.go` 中 `detectFileType` 根据扩展名判定为 `image`
- `UploadAndParse` 将文件保存到磁盘，创建 `File` 记录，`type="image"`，`parse_status="pending"`

#### 解析阶段
```go
// file_parser.go → parseImage()
func (p *FileParser) parseImage(ctx context.Context, data []byte, ext string) (*ParseResult, error) {
    return &ParseResult{
        Content:   "",                          // 不提取文字内容
        Pages:     1,
        Chunks:    []TextChunk{{
            Index: 0, BlockID: "img-1", Page: 1,
            BlockType: "image_caption",
            Text: caption,
        }},
        HasImages: true,
    }, nil
}
```
- **调用 Vision API** 生成图片描述，作为 `image_caption` 类型的 chunk
- `parse_status` 变为 `done`，`embedding_status = "pending"`（图片 caption 参与 embedding）

#### 聊天使用
- `chat.go` 中所有文件统一走 `RetrievalService.Search()` 检索
- 图片内容通过 `image_caption` chunk 进入 RAG 上下文，不再 base64 直传模型
- **统一走检索系统**，避免不同模型视觉能力不一致

---

### 2. PDF（.pdf）

#### 上传阶段
- 同照片流程，判定为 `document` 类型

#### 解析阶段
```go
// file_parser.go → parsePDF()
func (p *FileParser) parsePDF(data []byte) (*ParseResult, error) {
    // 读取 PDF 字节，按文本内容提取
    for 按每 2000 字符切分 {
        chunks = append(chunks, TextChunk{
            BlockType: "paragraph",
            Page:      pageNum,
            Text:      textSegment,
            ...
        })
    }
}
```
- 按固定长度（2000 字符）切分文本，保留段落边界，相邻 chunk 有 200 字符重叠
- 生成多个 `paragraph` 类型的 chunk，记录所属页码 `Page`
- `File.Content` 存储完整提取的文本（用于小文件直接全文发送）
- `File.Summary` 取前 500 字符作为摘要

#### Embedding 阶段（若启用 `ENABLE_TEXT_EMBEDDING=true`）
- `parseAsync` 为所有解析出有效文本 chunk 的文件创建 `FileEmbeddingJob`（不再按 MIME 类型排除图片）
- Worker 每 5 秒轮询，**串行处理**（避免 API RPM 限制）：
  1. 加载所有 pending 的 `FileChunk`
  2. 调用 `embedder.EmbedDocuments(contents)`（batch 调用 OpenAI `/v1/embeddings`）
  3. 向量存入 `FileEmbedding`，更新 `chunk.embedding_status = "done"`

#### 聊天使用
```go
// retrieval_service.go → Search()
func (s *RetrievalService) Search(fileIDs []uint, query string, topK int, forceKeyword bool) ([]ChunkSearchResult, error) {
    hasEmbedding := !forceKeyword && s.hasEmbeddings(fileIDs)
    if hasEmbedding {
        return s.vectorSearch(fileIDs, query, topK)   // 优先向量检索
    }
    return s.keywordSearch(fileIDs, query, topK)      // 降级关键词检索
}
```
- **向量检索**：计算查询向量 → 与 `FileEmbedding` 中所有向量算 cosine similarity → 返回 topK chunks
- **关键词检索**：提取查询关键词 → 匹配 chunk content → 按匹配度排序返回
- 小文件（<6000 tokens）会直接走**全文发送**，不检索

---

### 3. Markdown（.md / .txt / .json / .csv / 代码文件）

#### 上传阶段
- 扩展名 `.md` 被判定为 `text` 类型，代码文件（.go, .py, .js 等）同理

#### 解析阶段
```go
// file_parser.go → parseText()
func (p *FileParser) parseText(data []byte, ext string) (*ParseResult, error) {
    lines := strings.Split(content, "\n")
    for _, line := range lines {
        // 检测标题
        if strings.HasPrefix(line, "#") {
            blockType = "heading"
        }
        chunks = append(chunks, TextChunk{
            BlockType: blockType,   // heading | paragraph | code
            Text:      line,
            ...
        })
    }
}
```
- 按行读取，识别 `#` 开头的标题行，标记 `BlockType="heading"`
- 普通段落标记 `BlockType="paragraph"`
- 同样经过 `chunkStructured()` 按 2000 字符做二次切分，保留段落边界

#### Embedding & 聊天使用
- 与 PDF 完全相同，走相同的 embedding 和检索流程

---

### 4. Excel（.xlsx）

#### 解析阶段
```go
// file_parser.go → parseXLSX()
```
- 解压 ZIP，读取 `xl/sharedStrings.xml` 和 `xl/worksheets/sheetN.xml`
- 每个 sheet 输出为标准 **Markdown 表格**：
  ```markdown
  | 列A | 列B | 列C |
  | --- | --- | --- |
  | 值1 | 值2 | 值3 |
  ```
- 每个 sheet 作为一个 `table` 类型的 chunk，元数据记录列数

---

### 5. PPTX（.pptx）

#### 解析阶段
```go
// file_parser.go → parsePPTX()
```
- 解压 ZIP，按 `ppt/slides/slideN.xml` 逐页解析
- 每页生成一个 chunk，内部结构化为 `heading` / `paragraph` / `image_ref` 子块
- 第一段文本识别为 `heading`，后续为 `paragraph`
- 输出标准 Markdown 格式，可直接用于 LLM 上下文

---

## 四、关键实现细节

### 1. 前端轮询机制
```typescript
// frontend/components/chat/MessageInput.tsx
const interval = setInterval(async () => {
    const res = await fetch(`/api/files/${f.public_id}`);
    const data = await res.json();
    // 更新 parse_status 和 content_preview
}, 3000);  // 每 3 秒轮询一次
```

### 2. Embedding Worker 串行处理
```go
// file_service.go → startEmbeddingWorker()
ticker := time.NewTicker(5 * time.Second)
for range ticker.C {
    jobs, _ := s.ListPendingEmbeddingJobs(1)  // 每次只取 1 个
    for _, job := range jobs {
        s.ProcessEmbeddingJob(job)  // 串行执行
    }
}
```

### 3. 检索降级策略
```go
// retrieval_service.go
func (s *RetrievalService) Search(...) {
    hasEmbedding := !forceKeyword && s.hasEmbeddings(fileIDs)
    if hasEmbedding {
        results, err := s.vectorSearch(...)
        if err == nil && len(results) > 0 {
            return results, nil  // 向量检索成功
        }
        // 向量检索失败时降级到关键词
    }
    return s.keywordSearch(...)
}
```

---

## 五、总结表

| 文件类型 | 解析方式 | Embedding | 聊天使用方式 |
|---------|---------|-----------|-------------|
| **照片**（jpg/png/webp/gif/bmp） | Vision API 生成 `image_caption` chunk | ✅ 若启用 | 统一走 RAG 检索，不再 base64 直传 |
| **PDF** | 提取纯文本，按 2000 字符分块 | ✅ 若启用 | 向量检索 / 关键词检索，取 topK chunks |
| **Markdown** | 按行解析，识别 heading/paragraph | ✅ 若启用 | 同 PDF |
| **Excel**（xlsx） | 解析为 Markdown 表格，每 sheet 一个 chunk | ✅ 若启用 | 同 PDF |
| **PPTX** | 按页解析，heading/paragraph/image_ref | ✅ 若启用 | 同 PDF |
| **代码文件**（go/py/js 等） | 按段落分块，BlockType="code" | ✅ 若启用 | 同 PDF |

---

## 六、备注

- **Embedding 功能默认关闭**（`ENABLE_TEXT_EMBEDDING=false`），此时所有文件的 chunk 仍然会被解析和存储，但聊天时只会走**关键词检索**降级方案。
- 图片在任何情况下都不参与 embedding，这是符合文档设计的。
- 解析状态流转中缺少 `parsing` 中间态，不影响功能但文档与代码略有出入。
