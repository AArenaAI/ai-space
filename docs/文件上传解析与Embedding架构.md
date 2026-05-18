     1|# AI Space — 文件上传、解析与 Embedding 架构文档
     2|
     3|> 版本：v1.1  
     4|> 日期：2026-05-15  
     5|> 状态：文件上传与解析已可用；图片在上传解析阶段文本化为 `image_caption` chunk；Embedding 由 `ENABLE_TEXT_EMBEDDING` 控制
     6|
     7|---
     8|
     9|## 目录
    10|
    11|1. [架构概览](#1-架构概览)
    12|2. [数据模型](#2-数据模型)
    13|3. [文件上传流程](#3-文件上传流程)
    14|4. [文件解析流程](#4-文件解析流程)
    15|5. [Embedding 架构](#5-embedding-架构)
    16|6. [状态流转](#6-状态流转)
    17|7. [功能开关](#7-功能开关)
    18|8. [API 接口](#8-api-接口)
    19|9. [未来扩展](#9-未来扩展)
    20|
    21|---
    22|
    23|## 1. 架构概览
    24|
    25|```
    26|┌─────────────────────────────────────────────────────────────────────────┐
    27|│                              用户层 (Frontend)                           │
    28|│  上传文件 → 轮询状态 → 聊天引用文件                                      │
    29|└─────────────────────────────────────────────────────────────────────────┘
    30|                                    │
    31|                                    ▼
    32|┌─────────────────────────────────────────────────────────────────────────┐
    33|│                              API 层 (Gin Router)                         │
    34|│  POST /api/files/upload                                                │
    35|│  GET  /api/files/:id                                                   │
    36|│  GET  /api/files                                                       │
    37|│  DELETE /api/files/:id                                                 │
    38|└─────────────────────────────────────────────────────────────────────────┘
    39|                                    │
    40|                    ┌───────────────┼───────────────┐
    41|                    ▼               ▼               ▼
    42|            ┌───────────┐   ┌───────────┐   ┌───────────────┐
    43|            │FileService│   │FileParser │   │RetrievalService│
    44|            │文件服务    │   │解析服务   │   │检索服务        │
    45|            └─────┬─────┘   └─────┬─────┘   └───────┬───────┘
    46|                  │               │                   │
    47|                  ▼               ▼                   ▼
    48|            ┌───────────┐   ┌───────────┐   ┌───────────────┐
    49|            │  File     │   │FileChunk  │   │ FileEmbedding │
    50|            │  文件主表  │   │文本分块表 │   │ 向量存储表    │
    51|            └───────────┘   └───────────┘   └───────────────┘
    52|                                    │
    53|                                    ▼
    54|                         ┌──────────────────┐
    55|                         │ SQLite (GORM)    │
    56|                         │ ./data/aipool.db │
    57|                         └──────────────────┘
    58|```
    59|
    60|### 核心设计原则
    61|
    62|| 原则 | 说明 |
    63||------|------|
    64|| **PublicID 对外** | 所有 API 交互使用 `public_id`（如 `file_xxx`），内部自增 ID 不暴露 |
    65|| **异步解析** | 文件上传后立即返回，解析在后台 goroutine 中完成 |
    66|| **状态独立** | `parse_status` 和 `embedding_status` 分离，互不影响 |
    67|| **功能开关** | Embedding 通过 `ENABLE_TEXT_EMBEDDING` 环境变量控制，可随时开关 |
    68|| **图片文本化** | 图片不在聊天阶段 base64 直传；上传解析阶段通过 Vision/OCR 文本化成 `image_caption` chunk，统一进入检索上下文 |
    69|| **降级兼容** | 无 Embedding 时，文件仍可用，聊天通过全文/关键词 fallback |
    70|
    71|---
    72|
    73|## 2. 数据模型
    74|
    75|### 2.1 File（文件主表）
    76|
    77|```go
    78|type File struct {
    79|    ID              uint      `gorm:"primaryKey"`           // 内部自增 ID（不对外暴露）
    80|    PublicID        string    `gorm:"uniqueIndex;not null"` // 对外唯一标识，如 file_abc123
    81|    UserID          uint      `gorm:"index"`                // 上传用户 ID（0=匿名）
    82|    Filename        string                                 // 原始文件名
    83|    MimeType        string                                 // MIME 类型
    84|    Size            int64                                  // 文件大小（字节）
    85|    Content         string                                 // 解析后的完整文本内容
    86|    Summary         string                                 // 文件摘要（可选，异步生成）
    87|    PageCount       int                                    // 页数（PDF/PPT 等）
    88|    ParseStatus     string    // pending | parsing | done | error
    89|    EmbeddingStatus string    // pending | indexing | done | error | skipped
    90|    ErrorMessage    string                                 // 错误信息
    91|    StoragePath     string                                 // 磁盘存储路径
    92|    CreatedAt       time.Time
    93|    UpdatedAt       time.Time
    94|}
    95|```
    96|
    97|**关键索引：**
    98|- `public_id`：唯一索引，所有外部查询入口
    99|- `user_id`：普通索引，用户文件列表查询
   100|
   101|### 2.2 FileChunk（文本分块表）
   102|
   103|```go
   104|type FileChunk struct {
   105|    ID               uint      `gorm:"primaryKey"`
   106|    FileID           uint      `gorm:"index;not null"`       // 关联 File.ID
   107|    ChunkIndex       int                                    // 块序号（0, 1, 2...）
   108|    BlockType        string    // paragraph | heading | table | list | code | image_caption
   109|    Page             int                                    // 所属页码
   110|    BlockID          string                                 // 原始块 ID
   111|    Content          string                                 // 块文本内容
   112|    Markdown         string                                 // Markdown 格式（保留）
   113|    TokenCount       int                                    // 预估 token 数
   114|    TextHash         string    `gorm:"index"`               // 内容哈希（去重/变化检测）
   115|    Slide            int                                    // PPT 页编号
   116|    SheetName        string                                 // Excel sheet 名
   117|    EmbeddingStatus  string    // pending | done | error
   118|    Metadata         string    // JSON 扩展字段
   119|    CreatedAt        time.Time
   120|    UpdatedAt        time.Time
   121|}
   122|```
   123|
   124|**设计要点：**
   125|- `text_hash`：SHA-256 前 16 字节 hex，用于检测内容变化、避免重复 embedding
   126|- `block_type`：支持多种块类型，便于后续按类型检索（如只取表格、只取标题）
   127|- `page`：支持页码定位，用户可直接问"第 3 页讲了什么"
   128|
   129|### 2.3 FileEmbedding（向量存储表）
   130|
   131|```go
   132|type FileEmbedding struct {
   133|    ID         uint      `gorm:"primaryKey"`
   134|    FileID     uint      `gorm:"index;not null"`
   135|    ChunkID    uint      `gorm:"not null"`
   136|    Provider   string    // openai | gemini | local
   137|    Model      string    // text-embedding-3-small
   138|    Dimension  int       // 1536
   139|    TextHash   string    // 生成时的 text_hash
   140|    Vector     []byte    // 向量二进制（float32 数组序列化）
   141|    CreatedAt  time.Time
   142|    UpdatedAt  time.Time
   143|}
   144|```
   145|
   146|**唯一索引：**
   147|```sql
   148|UNIQUE INDEX idx_embedding_unique ON file_embeddings(
   149|    chunk_id, provider, model, dimension, text_hash
   150|)
   151|```
   152|
   153|**作用：** 同一 chunk、同一模型、同一维度、同一内容只存一份向量，避免重复计算。
   154|
   155|### 2.4 FileEmbeddingJob（Embedding 任务队列）
   156|
   157|```go
   158|type FileEmbeddingJob struct {
   159|    ID          uint      `gorm:"primaryKey"`
   160|    FileID      uint      `gorm:"index;not null"`
   161|    Provider    string
   162|    Model       string
   163|    Dimension   int
   164|    Status      string    // pending | processing | done | error
   165|    ErrorMessage string
   166|    Attempts    int       // 重试次数
   167|    CreatedAt   time.Time
   168|    UpdatedAt   time.Time
   169|}
   170|```
   171|
   172|**设计要点：**
   173|- 独立任务表，支持服务重启后自动恢复未完成的 jobs
   174|- `attempts` 字段支持有限重试（目前未实现指数退避）
   175|
   176|---
   177|
   178|## 3. 文件上传流程
   179|
   180|### 3.1 时序图
   181|
   182|```
   183|用户          Frontend          Backend (Gin)        FileService         磁盘
   184| │                │                    │                  │                │
   185| │  选择文件      │                    │                  │                │
   186| │───────────────>│                    │                  │                │
   187| │                │  POST /api/files/upload               │                │
   188| │                │────────────────────>│                  │                │
   189| │                │                    │  保存到磁盘       │                │
   190| │                │                    │─────────────────>│                │
   191| │                │                    │                  │  写入文件      │
   192| │                │                    │                  │───────────────>│
   193| │                │                    │                  │<───────────────│
   194| │                │                    │  创建 File 记录   │                │
   195| │                │                    │<─────────────────│                │
   196| │                │  返回 public_id    │                  │                │
   197| │                │<────────────────────│                  │                │
   198| │                │                    │                  │                │
   199| │                │                    │  启动异步解析    │                │
   200| │                │                    │  go parseAsync() │                │
   201| │                │                    │─────────────────>│                │
   202| │  轮询状态      │                    │                  │                │
   203| │───────────────>│  GET /api/files/:public_id            │                │
   204| │                │────────────────────>│                  │                │
   205| │                │  返回 parse_status │                  │                │
   206| │                │<────────────────────│                  │                │
   207| │                │                    │                  │                │
   208| │                │                    │  [后台] 解析完成  │                │
   209| │                │                    │  parse_status=d  │                │
   210| │                │                    │  one             │                │
   211| │                │                    │                  │                │
   212| │  轮询到 done   │                    │                  │                │
   213| │<───────────────│                    │                  │                │
   214|```
   215|
   216|### 3.2 详细步骤
   217|
   218|**Step 1：接收上传**
   219|```go
   220|// router.go
   221|router.POST("/api/files/upload", fileHandler.UploadFile)
   222|```
   223|
   224|**Step 2：保存到磁盘**
   225|```go
   226|// 生成存储路径：./uploads/2026/05/13/filename_xxx.ext
   227|storagePath := generateStoragePath(filename)
   228|// 写入磁盘
   229|os.WriteFile(storagePath, fileData, 0644)
   230|```
   231|
   232|**Step 3：创建 File 记录**
   233|```go
   234|file := &models.File{
   235|    PublicID:        generatePublicID(),     // 如 file_abc123
   236|    UserID:          userID,
   237|    Filename:        filename,
   238|    MimeType:        mimeType,
   239|    Size:            len(fileData),
   240|    ParseStatus:     "pending",
   241|    EmbeddingStatus: "pending",
   242|    StoragePath:     storagePath,
   243|}
   244|db.Create(file)
   245|```
   246|
   247|**Step 4：启动异步解析**
   248|```go
   249|go func() {
   250|    // 解析文件 → Content + Chunks
   251|    result, err := parser.Parse(ctx, fileData, filename)
   252|    if err != nil {
   253|        db.Model(file).Update("parse_status", "error")
   254|        return
   255|    }
   256|    
   257|    // 保存解析结果
   258|    db.Model(file).Updates(map[string]interface{}{
   259|        "content":      result.Content,
   260|        "summary":      result.Summary,
   261|        "page_count":   result.PageCount,
   262|        "parse_status": "done",
   263|    })
   264|    
   265|    // 保存 chunks
   266|    for i, chunk := range result.Chunks {
   267|        db.Create(&models.FileChunk{
   268|            FileID:      file.ID,
   269|            ChunkIndex:  i,
   270|            BlockType:   chunk.BlockType,
   271|            Page:        chunk.Page,
   272|            BlockID:     chunk.BlockID,
   273|            Content:     chunk.Text,
   274|            Markdown:    chunk.Markdown,
   275|            TokenCount:  chunk.TokenCount,
   276|            TextHash:    hashText(chunk.Text),  // SHA-256 前 16 字节
   277|            Metadata:    chunk.Metadata,
   278|        })
   279|    }
   280|    
   281|    // 创建 Embedding Job：只要 embedder 启用且解析出了有效文本 chunk，就进入统一 RAG。
   282|    // 图片会在解析阶段转成 image_caption 文本 chunk，因此不再按 MIME 类型强制跳过。
   283|    if embedder != nil && hasNonEmptyTextChunk(result.Chunks) {
   284|        db.Create(&models.FileEmbeddingJob{
   285|            FileID:    file.ID,
   286|            Provider:  modelInfo.Provider,
   287|            Model:     modelInfo.Model,
   288|            Dimension: modelInfo.Dimension,
   289|            Status:    "pending",
   290|        })
   291|    } else {
   292|        db.Model(file).Update("embedding_status", "skipped")
   293|    }
   294|}()
   295|```
   296|
   297|**Step 5：返回 PublicID**
   298|```json
   299|{
   300|    "public_id": "file_abc123",
   301|    "filename": "report.pdf",
   302|    "parse_status": "pending",
   303|    "size": 102400
   304|}
   305|```
   306|
   307|### 3.3 前端轮询
   308|
   309|```javascript
   310|// 上传后立即轮询
   311|const pollStatus = async (publicId) => {
   312|    const res = await fetch(`/api/files/${publicId}`);
   313|    const data = await res.json();
   314|    if (data.parse_status === 'done') {
   315|        // 解析完成，可以聊天引用
   316|        return data;
   317|    } else if (data.parse_status === 'error') {
   318|        // 解析失败
   319|        throw new Error(data.error_message);
   320|    }
   321|    // 继续轮询
   322|    setTimeout(() => pollStatus(publicId), 2000);
   323|};
   324|```
   325|
   326|---
   327|
   328|## 4. 文件解析流程
   329|
   330|### 4.1 支持的文件类型
   331|
   332|| 类型 | MIME Type | 处理方式 |
   333||------|-----------|----------|
   334|| 纯文本 | `text/plain` | 直接读取 |
   335|| Markdown | `text/markdown` | 直接读取，按段落/标题等文本块切分 |
   336|| PDF | `application/pdf` | 文本提取 + 页码 |
   337|| Word | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 文本提取 |
   338|| PPT | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | 幻灯片提取 |
   339|| Excel | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 表格提取 |
   340|| 图片 | `image/*` | 上传解析阶段调用 Vision/OCR 文本化，生成 `image_caption` chunk；有 embedder 时进入 embedding/RAG |
   341|| 代码文件 | `text/x-python` 等 | 语法高亮 + 块提取 |
   342|
   343|### 4.2 解析结果结构
   344|
   345|```go
   346|type ParseResult struct {
   347|    Content   string        // 完整文本
   348|    Summary   string        // 摘要（可选）
   349|    PageCount int           // 页数
   350|    Chunks    []Chunk       // 分块结果
   351|}
   352|
   353|type Chunk struct {
   354|    BlockType   string      // paragraph | heading | table | list | code | image_caption
   355|    Page        int         // 页码
   356|    BlockID     string      // 原始块 ID
   357|    Text        string      // 纯文本
   358|    Markdown    string      // Markdown 格式
   359|    TokenCount  int         // 预估 token
   360|    Metadata    string      // JSON 扩展
   361|}
   362|```
   363|
   364|### 4.3 分块策略
   365|
   366|当前实现为简单分块（按段落/页面），未来可扩展：
   367|
   368|```
   369|简单分块（当前）
   370|  └── 按段落切分，每段一个 chunk
   371|
   372|语义分块（未来）
   373|  └── 按语义边界切分（标题-内容对、表格整体、代码块）
   374|
   375|重叠分块（未来）
   376|  └── 相邻 chunk 之间有重叠，避免边界信息丢失
   377|```
   378|
   379|
   380|### 4.5 图片解析说明
   381|
   382|图片上传后仍会保存原文件，但聊天阶段不会再把图片 base64 data URI 直接塞进用户消息。当前链路是在解析阶段调用 Vision/OCR，把可见内容、文字、图表、布局等转成文本：
   383|
   384|1. `FileParser.parseImage()` 调用 `AIService.ExtractImageContent()`；
   385|2. 返回内容包装为 `图片视觉描述：...`；
   386|3. 生成 `BlockType=image_caption` 的 `FileChunk`，`Metadata` 标记 `source=vision` 与 MIME 类型；
   387|4. 如果 embedding 开启且 caption 非空，创建 `FileEmbeddingJob`；
   388|5. 聊天时只根据 `file_ids` 做检索/上下文注入，不再区分“图片直传”和“文档检索”两条通道。
   389|
   390|如果 Vision/OCR 不可用或返回空内容，图片解析会失败并写入 `parse_status=error`，不会伪造一个不可检索的空图片 chunk。
   391|
   392|### 4.4 异步摘要生成
   393|
   394|解析完成后，如果内容较长（>200 字符）且没有摘要，自动在后台生成：
   395|
   396|```go
   397|go func() {
   398|    summary := generateSummary(content)  // 截取前 500 字符
   399|    db.Model(file).Update("summary", summary)
   400|}()
   401|```
   402|
   403|> ⚠️ 注意：当前实现为简单截取，未来可接入 LLM 生成智能摘要。
   404|
   405|---
   406|
   407|## 5. Embedding 架构
   408|
   409|### 5.1 关闭模式：DISABLED
   410|
   411|```
   412|ENABLE_TEXT_EMBEDDING=false
   413|```
   414|
   415|**行为：**
   416|- `startEmbeddingWorker()` 检测到 `embedder == nil`，直接返回，不启动 worker
   417|- `UploadAndParse` 跳过 embedding job 创建，当前实现标记 `embedding_status = "skipped"`
   418|- 文件解析、chunk 存储、聊天引用完全不受影响
   419|- 聊天时使用 **全文 fallback** 或 **关键词检索**
   420|
   421|### 5.2 启用模式：ENABLED
   422|
   423|```
   424|ENABLE_TEXT_EMBEDDING=true
   425|OPENAI_API_KEY=[REDACTED]
   426|TEXT_EMBEDDING_BASE_URL=https://api.openai.com  # 可选，默认复用 OPENAI_BASE_URL
   427|```
   428|
   429|**行为：**
   430|- `startEmbeddingWorker()` 启动，每 5 秒轮询 pending jobs
   431|- `UploadAndParse` 为所有已解析出有效文本 chunk 的文件创建 `FileEmbeddingJob`（包括图片的 `image_caption` chunk）
   432|- Worker 串行处理 jobs（避免 API RPM 限制）
   433|- 生成向量后存入 `FileEmbedding`
   434|- `File.EmbeddingStatus` 流转：`pending` → `indexing` → `done`/`error`
   435|
   436|### 5.3 Embedding Worker 流程
   437|
   438|```
   439|服务启动
   440|  │
   441|  ▼
   442|RecoverEmbeddingJobs()  ──→ 恢复重启前未完成的 jobs（status=pending）
   443|  │
   444|  ▼
   445|ticker (5s)
   446|  │
   447|  ▼
   448|ListPendingEmbeddingJobs(1)  ──→ 每次取 1 个 job
   449|  │
   450|  ▼
   451|ProcessEmbeddingJob(job)
   452|  │
   453|  ├── 1. 获取文件所有 chunks
   454|  │
   455|  ├── 2. 检查是否已有 embedding（通过 uniqueIndex 去重）
   456|  │
   457|  ├── 3. 调用 Embedder.EmbedDocuments(chunks)  
   458|  │      └── 调用 OpenAI /v1/embeddings API
   459|  │
   460|  ├── 4. 保存向量到 FileEmbedding
   461|  │
   462|  ├── 5. 更新 job status = done
   463|  │
   464|  └── 6. 更新 File.EmbeddingStatus = done
   465|```
   466|
   467|### 5.4 检索流程（启用时）
   468|
   469|```
   470|用户提问
   471|  │
   472|  ▼
   473|EmbedQuery(query)  ──→ 生成查询向量
   474|  │
   475|  ▼
   476|向量相似度检索  ──→ 从 FileEmbedding 找 topK 最相似 chunk
   477|  │
   478|  ▼
   479|构造上下文  ──→ 把 topK chunks 拼入 prompt
   480|  │
   481|  ▼
   482|发给 LLM
   483|```
   484|
   485|### 5.5 无 Embedding 时的 Fallback 策略
   486|
   487|| 场景 | 策略 | 说明 |
   488||------|------|------|
   489|| 小文件（<6000 tokens） | **全文** | 直接把完整 content 拼给模型 |
   490|| 中等文件 | **关键词检索** | 用户问题分词，匹配 chunks，取 top 6-10 |
   491|| 用户提到页码 | **页码定位** | 直接取对应 page 的 chunks |
   492|| 无命中 | **摘要 + 前 N 块** | 取摘要、标题 chunks、前 3 个 chunks |
   493|
   494|### 5.6 聊天引用文件流程
   495|
   496|前端发送聊天请求时只传 `file_ids`。后端会统一调用 `RetrievalService.Search(fileIDs, query, topK, false)`：
   497|
   498|- embedding 已完成：优先向量检索；
   499|- embedding 不可用或失败：降级关键词/全文 chunk 检索；
   500|- 命中结果由 `ContextBuilder` 组装为 `<file_context>...</file_context>`，作为 system context 注入模型。
   501|
   502|因此图片、PDF、Markdown、代码等文件在聊天阶段都是“文本 chunk 检索 → 上下文注入”的同一条链路。
   503|
   504|---
   505|
   506|## 6. 状态流转
   507|
   508|### 6.1 ParseStatus（解析状态）
   509|
   510|```
   511|上传文件
   512|  │
   513|  ▼
   514|pending ──→ parsing ──→ done
   515|              │
   516|              └──→ error
   517|```
   518|
   519|| 状态 | 含义 |
   520||------|------|
   521|| `pending` | 等待解析 |
   522|| `parsing` | 正在解析 |
   523|| `done` | 解析完成 |
   524|| `error` | 解析失败 |
   525|
   526|### 6.2 EmbeddingStatus（语义索引状态）
   527|
   528|```
   529|上传文件（embedder 启用）
   530|  │
   531|  ▼
   532|pending ──→ indexing ──→ done
   533|              │
   534|              └──→ error
   535|
   536|上传文件（embedder 未启用，或没有有效文本 chunk）
   537|  │
   538|  ▼
   539|skipped   ←── 不创建 embedding job
   540|
   541|上传图片文件
   542|  │
   543|  ▼
   544|Vision/OCR 文本化为 image_caption chunk
   545|  │
   546|  ├── 有有效文本且 embedder 启用 → pending → indexing → done/error
   547|  └── 视觉解析失败 → parse_status=error
   548|```
   549|
   550|| 状态 | 含义 | 触发条件 |
   551||------|------|----------|
   552|| `pending` | 等待 embedding | 文件解析完成，embedder 启用 |
   553|| `indexing` | 正在生成向量 | Worker 开始处理 |
   554|| `done` | 向量生成完成 | 所有 chunks 都已 embedding |
   555|| `error` | 向量生成失败 | API 错误、网络错误 |
   556|| `skipped` | 跳过 | embedder 未启用，或解析后没有有效文本 chunk |
   557|
   558|---
   559|
   560|## 7. 功能开关
   561|
   562|### 7.1 环境变量配置
   563|
   564|```env
   565|# ============================================
   566|# Embedding 配置
   567|# ============================================
   568|ENABLE_TEXT_EMBEDDING=false                    # 总开关：true=启用, false=禁用
   569|
   570|# 以下仅在 ENABLE_TEXT_EMBEDDING=true 时生效
   571|TEXT_EMBEDDING_PROVIDER=openai                 # 提供商：openai | gemini | local
   572|TEXT_EMBEDDING_MODEL=text-embedding-3-small    # 模型名
   573|TEXT_EMBEDDING_DIMENSIONS=1536                 # 向量维度
   574|TEXT_EMBEDDING_BATCH_SIZE=32                   # 批量大小
   575|TEXT_EMBEDDING_BASE_URL=                       # 自定义 API 地址（可选）
   576|TEXT_EMBEDDING_API_KEY=                        # 自定义 API Key（可选，默认复用 OPENAI_API_KEY）
   577|```
   578|
   579|### 7.2 开关行为对照表
   580|
   581|| 配置 | 上传行为 | Worker | 聊天检索 |
   582||------|----------|--------|----------|
   583|| `ENABLE_TEXT_EMBEDDING=false` | 不创建 job，标记 `skipped` | 不启动 | 全文/关键词 fallback |
   584|| `ENABLE_TEXT_EMBEDDING=true`，API 正常 | 创建 job，标记 `pending` | 启动并处理 | 向量检索 |
   585|| `ENABLE_TEXT_EMBEDDING=true`，API 失败 | 创建 job，标记 `error` | 持续重试 | 降级到全文/关键词 |
   586|
   587|### 7.3 动态切换
   588|
   589|修改 `.env` 后重启服务即可：
   590|
   591|```bash
   592|# 关闭 embedding
   593|ENABLE_TEXT_EMBEDDING=false
   594|
   595|# 启用 embedding（需确保 API 可用）
   596|ENABLE_TEXT_EMBEDDING=true
   597|TEXT_EMBEDDING_BASE_URL=https://api.openai.com
   598|```
   599|
   600|> ⚠️ 注意：切换开关不会影响已有文件的状态。从关闭切换到 `true` 时，已上传且 `embedding_status=skipped` 的文件不会自动补 embedding，需要重新上传或使用管理工具批量处理。
   601|
   602|---
   603|
   604|## 8. API 接口
   605|
   606|### 8.1 上传文件
   607|
   608|```http
   609|POST /api/files/upload
   610|Content-Type: multipart/form-data
   611|
   612|file: <二进制文件>
   613|```
   614|
   615|**响应：**
   616|```json
   617|{
   618|    "public_id": "file_abc123",
   619|    "filename": "report.pdf",
   620|    "parse_status": "pending",
   621|    "mime_type": "application/pdf",
   622|    "size": 102400
   623|}
   624|```
   625|
   626|### 8.2 查询文件状态
   627|
   628|```http
   629|GET /api/files/:public_id
   630|```
   631|
   632|**响应：**
   633|```json
   634|{
   635|    "id": 1,
   636|    "public_id": "file_abc123",
   637|    "filename": "report.pdf",
   638|    "parse_status": "done",
   639|    "embedding_status": "done",
   640|    "content_preview": "这是文件内容的前 200 字符...",
   641|    "page_count": 12,
   642|    "size": 102400,
   643|    "created_at": "2026-05-13T10:00:00Z",
   644|    "updated_at": "2026-05-13T10:00:05Z"
   645|}
   646|```
   647|
   648|### 8.3 列出用户文件
   649|
   650|```http
   651|GET /api/files
   652|Authorization: Bearer ***
   653|```
   654|
   655|**响应：**
   656|```json
   657|[
   658|    {
   659|        "public_id": "file_abc123",
   660|        "filename": "report.pdf",
   661|        "parse_status": "done",
   662|        "embedding_status": "done",
   663|        "size": 102400,
   664|        "created_at": "2026-05-13T10:00:00Z"
   665|    }
   666|]
   667|```
   668|
   669|### 8.4 删除文件
   670|
   671|```http
   672|DELETE /api/files/:public_id
   673|Authorization: Bearer ***
   674|```
   675|
   676|**级联删除：**
   677|- File 记录
   678|- FileChunk 记录
   679|- FileEmbedding 记录
   680|- FileEmbeddingJob 记录
   681|- 磁盘文件
   682|
   683|---
   684|
   685|## 9. 未来扩展
   686|
   687|### 9.1 V1.1 — Embedding 上线
   688|
   689|- [ ] 配置 `ENABLE_TEXT_EMBEDDING=true`
   690|- [ ] 接入 OpenAI / Gemini / 本地 embedding 模型
   691|- [ ] 批量 embedding（batch size 32）
   692|- [ ] 指数退避重试
   693|- [ ] 向量相似度检索（cosine similarity）
   694|
   695|### 9.2 V1.5 — 语义检索增强
   696|
   697|- [ ] Hybrid Search（向量 + 关键词混合检索）
   698|- [ ] 重排序（Re-ranker）
   699|- [ ] 来源引用（citations）
   700|- [ ] 多文件联合检索
   701|- [x] 图片 caption → text chunk → embedding
   702|
   703|### 9.3 V2.0 — 文件智能层
   704|
   705|- [ ] 自动标签生成
   706|- [ ] 跨文件知识图谱
   707|- [ ] 智能摘要（LLM 生成）
   708|- [ ] 文件对比分析
   709|- [ ] PPT/Excel 智能问答
   710|
   711|---
   712|
   713|## 附录
   714|
   715|### A. 文件存储路径
   716|
   717|```
   718|./uploads/
   719|├── 2026/
   720|│   ├── 05/
   721|│   │   ├── 13/
   722|│   │   │   ├── report_abc123.pdf
   723|│   │   │   └── image_def456.png
   724|```
   725|
   726|### B. PublicID 生成规则
   727|
   728|```go
   729|func generatePublicID() string {
   730|    return "file_" + randomString(16)  // 如 file_abc123def456ghi7
   731|}
   732|```
   733|
   734|### C. TextHash 计算
   735|
   736|```go
   737|func hashText(text string) string {
   738|    h := sha256.Sum256([]byte(text))
   739|    return hex.EncodeToString(h[:16])  // 前 16 字节 = 32 字符 hex
   740|}
   741|```
   742|
   743|### D. 相关代码文件
   744|
   745|| 文件 | 职责 |
   746||------|------|
   747|| `internal/models/file.go` | 数据模型定义 |
   748|| `internal/services/file_service.go` | 文件上传、解析、embedding worker |
   749|| `internal/services/file_parser.go` | 文件解析逻辑 |
   750|| `internal/services/retrieval_service.go` | 检索服务（向量/关键词） |
   751|| `internal/services/embedding/` | Embedding provider 接口和实现 |
   752|| `internal/api/file_handler.go` | HTTP 接口处理 |
   753|| `internal/api/router.go` | 路由注册、服务初始化 |
   754|| `internal/config/config.go` | 配置读取 |
   755|