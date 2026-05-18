# AI Pool 文件上传与处理流程架构评估

**日期：** 2026-05-17  
**范围：** AI Pool Go 后端文件上传、解析、切块、检索、聊天上下文注入流程  
**核心目录：** `backend/internal`

---

## 1. 结论

当前 AI Pool 的文件系统架构方向是合理的：

```text
上传文件
  → 原文件落盘
  → files 表记录
  → 异步解析
  → files.content + file_chunks 入库
  → 可选 embedding 索引
  → 聊天时按 file public_id 选择上下文
  → 构造 <file_context> 注入模型
```

这比“聊天时直接把整份文件传给模型”更合理，原因是：

1. 上传和聊天解耦；
2. 文件可以持久化和复用；
3. 大文件、PDF、图片等慢处理可以异步完成；
4. 历史会话可以复用已上传文件；
5. 后续可以扩展检索、摘要、引用、重新解析等能力。

但是，当前架构的薄弱点不在“上传”，而在：

> **文件解析后，如何稳定、正确地选择内容并喂给模型。**

也就是说，文件可能已经上传成功、解析成功、chunk 也入库了，但模型最终看到的 `<file_context>` 可能仍然不够完整或不够代表性，导致它回答：

```text
我看不到完整内容
内容被截断了
无法判断这是什么
```

因此，当前架构可以评价为：

> **底座合理，MVP 可用；但文件理解层还偏粗，需要从“RAG 检索片段”升级为“按任务意图组织文档上下文”。**

---

## 2. 当前流程梳理

## 2.1 上传入口

代码位置：

```text
backend/internal/api/file_handler.go
backend/internal/services/file_service.go
```

上传接口：

```text
POST /api/files/upload
```

匿名用户身份通过请求头传递：

```text
X-Guest-ID: <visitor id>
```

不是 multipart form 字段 `guest_id`。

上传后调用：

```go
FileService.UploadAndParse()
```

主要职责：

```text
读取 multipart 文件
  → 校验用户 / guest 身份
  → 原文件保存到 storageDir
  → 创建 files 表记录
  → 启动 goroutine 异步解析
  → 返回 public_id 给前端
```

对前端暴露的是：

```text
files.public_id
```

不是数据库自增 `files.id`。

---

## 2.2 文件记录模型

代码位置：

```text
backend/internal/models/file.go
backend/internal/models/conversation.go
```

核心模型包括：

### `File`

保存文件元信息和解析状态：

```text
public_id
user_id
workspace_id
guest_id
filename
mime_type
size
storage_path
parse_status
embedding_status
content
summary
token_count
has_images
has_tables
```

其中：

```text
parse_status
```

决定文件是否可以参与聊天问答。

### `FileChunk`

保存解析后的分块内容：

```text
file_id
chunk_index
block_id
page
slide
sheet_name
block_type
content
markdown
token_count
embedding_status
```

聊天时实际注入模型的内容主要来自 `file_chunks`。

### `ConversationFile`

保存会话与文件的关联，用于多轮对话自动复用历史文件。

### `MessageFile`

保存“当前用户消息”与文件的关联，用于前端展示当前消息附件。

---

## 2.3 异步解析

代码位置：

```text
backend/internal/services/file_parser.go
```

上传成功后，后端不会同步等完整解析结束，而是在 goroutine 中处理：

```text
parse_status = parsing
  → parser.Parse()
  → 保存 content / chunks
  → parse_status = done
```

如果解析失败：

```text
parse_status = error
error_message = <错误信息>
```

这意味着：

```text
上传完成 ≠ 文件可问答
```

前端必须把“上传完成”和“解析完成”区分开。

当前支持的解析类型大致为：

```text
.txt / .md / .json / .csv / 代码文件 → 文本解析
.pdf                         → PDF 解析
.docx                        → Word 解析
.pptx                        → PPT 解析
.xlsx                        → Excel 解析
.jpg/.png/.webp/...          → 图片解析
其他                         → fallback 文本解析
```

对于 `111.md` 这类 Markdown 文件，当前走文本解析路径。

---

## 2.4 切块

代码位置：

```text
backend/internal/services/file_chunker.go
```

文本类文件会被拆成多个 `FileChunk`。

当前目标策略是：

```text
目标 chunk 大小：约 10K 字符
硬上限：约 16K 字符
overlap：约 800 字符
```

这个方向比之前少量超大 chunk 更合理，因为可以避免：

```text
一个 chunk 过大
  → prompt 被截断
  → 模型只看到截断提示
  → 回答“我看不到内容”
```

但是 Markdown 文件如果只按通用文本切块，仍然会丢失文档结构，例如标题、章节、表格、代码块等。

---

## 2.5 Embedding 索引

代码位置：

```text
backend/internal/services/file_service.go
backend/internal/services/retrieval_service.go
```

如果配置了 embedder，后端会创建 embedding job：

```text
file_embedding_jobs.status = pending
```

后台 worker 定期处理：

```text
startEmbeddingWorker()
  → ListPendingEmbeddingJobs(1)
  → ProcessEmbeddingJob()
  → EmbedDocuments()
  → SaveFileEmbeddings()
```

如果没有配置 embedder，worker 不启动：

```text
[Embedding Worker] embedder 未配置，不启动 embedding worker
```

没有 embedding 时，文件仍可以使用，只是精确问答会更多依赖关键词检索或确定性上下文选择。

---

## 2.6 聊天阶段如何引用文件

代码位置：

```text
backend/internal/api/chat.go
```

聊天请求支持：

```go
MessageFileIDs []string `json:"message_file_ids,omitempty"`
ContextFileIDs []string `json:"context_file_ids,omitempty"`
FileIDs        []string `json:"file_ids,omitempty"`
```

含义：

| 字段 | 作用 |
|---|---|
| `message_file_ids` | 当前消息显式附件，会展示在消息气泡里，也参与本轮 RAG |
| `context_file_ids` | 显式选择的上下文文件，不展示在当前消息气泡 |
| `file_ids` | 旧兼容字段，等同于 `message_file_ids` |

核心函数：

```go
buildChatFilePlan()
```

它会生成：

```go
type ChatFilePlan struct {
  MessageFiles []models.File
  ContextFiles []models.File
  RAGFiles     []models.File
}
```

含义：

```text
MessageFiles：当前消息附件，用于展示和 message_files 记录
ContextFiles：只作为上下文，不展示在当前消息
RAGFiles：真正参与 buildFileContext 的文件集合
```

如果本轮没有新文件，且 context policy 是 `auto`，后端会从 `conversation_files` 中加载历史文件，避免多轮对话丢失文件上下文。

---

## 2.7 聊天前文件状态检查

在真正调用模型前，后端会检查：

```go
if f.ParseStatus != "done" {
  return 409 file_not_ready
}
```

所以如果用户刚上传完立刻问，可能得到：

```json
{
  "error": "file_not_ready",
  "message": "文件正在解析中，请稍后重试",
  "status": "parsing"
}
```

这是合理的后端保护，但前端要做好状态展示。

---

## 2.8 文件上下文注入

核心函数：

```go
buildFileContext()
```

代码位置：

```text
backend/internal/api/chat.go
```

它会先把文件分成两类：

```text
图片文件
文档文件
```

### 图片文件

上传图片走“文件上传 RAG”路径：

```text
parseImage
  → Vision 解析
  → image_caption chunk
  → 聊天时直接注入 image_caption chunks
```

优点：所有文本模型都可以回答图片问题，不依赖模型原生 vision 能力。

### 文档文件

文档文件分两种模式。

#### 概览模式

如果用户问：

```text
这是什么
总结一下
分析一下
看下这个文件
主要内容是什么
overview
summary
```

会触发：

```go
services.IsDocumentOverviewQuery(query)
```

然后走：

```go
services.SelectOverviewChunks(chunks, query, 40000)
```

当前策略是：

```text
前 2 个 chunk
+ 后 2 个 chunk
+ 包含关键词的 chunk
+ 总字符预算约 40000
```

这个比普通 RAG 更适合“总结 / 这是什么”问题。

#### 普通问答模式

如果不是概览类问题，走：

```go
retrievalSvc.Search(docFileIDs, query, topK, forceKeyword)
```

`topK` 根据模型动态决定：

```text
flash / mini → 4
opus / o1 / o3 → 12
default → 8
```

普通 RAG 适合：

```text
文件里有没有提到某个概念？
某个配置在哪里？
某个字段是什么意思？
```

但不适合直接做全文总结。

---

## 2.9 最终给模型的内容

代码位置：

```text
backend/internal/services/context_builder.go
```

选中的 chunks 会被拼成：

```xml
<file_context>
  ...文件上下文...
</file_context>
```

然后作为 system message 插入到聊天 messages 最前面。

后续 `mergeSystemMessages()` 会把多个 system message 合并，并保证优先级：

```text
file_context
其他 system
web_search_context
```

这样可以降低部分模型只读取第一条 system message 的风险。

---

## 3. 合理的地方

## 3.1 上传和聊天解耦是正确的

当前不是每次聊天重新传文件，而是：

```text
先上传 → 拿 public_id → 聊天时引用 public_id
```

这个设计是正确的，方便：

```text
文件复用
会话复用
历史记录展示
异步解析
后续重新索引
```

---

## 3.2 异步解析是正确的

PDF、PPT、Excel、图片 Vision 都可能很慢。上传接口如果同步等解析完成，体验会很差，也容易超时。

当前异步解析方向正确。

---

## 3.3 files + chunks + embeddings 三层存储是合理的

当前把文件拆成：

```text
原始文件：storage_path
完整文本：files.content
检索单元：file_chunks
向量索引：file_embeddings
```

这是比较标准的文件问答底座。

---

## 3.4 图片转 caption 再注入，适合作为第一版

图片上传后先 Vision 解析成文本，再让任意聊天模型读取 caption。

这比直接要求所有模型支持 vision 更稳。

---

## 3.5 概览问题从普通 RAG 分流是正确方向

“这是什么 / 总结 / 分析”这类问题不应该只走向量检索。

因为向量检索天然返回局部片段，而不是全文结构。

当前新增概览分流是正确的。

---

## 4. 当前不合理 / 不够稳的地方

## 4.1 模型看到的不是完整文件，而是被选择后的上下文

这是当前体验问题的核心。

即使：

```text
files.content 有完整内容
file_chunks 有完整切块
```

模型真正能看到的只有：

```text
buildFileContext() 选中的 chunks
```

所以如果选择策略不对，模型就会表现得像“没看到文件”。

---

## 4.2 `...已达到总字数上限...` 容易误导模型

如果 `<file_context>` 里出现：

```text
... (已达到总字数上限) ...
```

模型很容易回答：

```text
我看不到完整内容
请把正文贴出来
```

这不是模型问题，而是上下文提示本身在暗示它内容不完整。

更好的做法是不要把内部截断提示直接暴露给模型，而是改成面向任务的说明：

```text
系统已从文件中选择代表性片段，包括开头、章节、相关段落和结尾。
以下不是完整逐字全文，但足以用于概览总结。
除非上下文为空，不要声称“没有看到文件”。
```

---

## 4.3 Markdown 仍然按普通文本处理，结构利用不足

`.md` 文件天然有结构：

```text
# 一级标题
## 二级标题
代码块
列表
表格
引用
```

当前如果只走通用文本切块，会导致：

```text
标题结构丢失
目录信息没有被单独保留
总结时无法稳定知道文档大纲
chunk 可能切断章节
```

对于 Markdown，应该至少提取：

```text
headings
outline
sections
code_blocks
tables
```

不一定第一版就做复杂 AST，但不能完全当 txt。

---

## 4.4 概览策略仍然比较粗

当前：

```text
前 2 chunk + 后 2 chunk + 关键词 chunk
```

比普通 RAG 好，但仍然不是理想的文档概览策略。

更合适的是：

```text
文件名
文件类型
字符数 / token 数
标题列表
目录 / heading outline
开头
每个一级章节的开头
结尾
关键词命中的段落
```

尤其是 Markdown、PDF、PPT、Excel，每种文件都应该有自己的“概览上下文”。

---

## 4.5 小文件不应该走复杂 RAG

对于小文件，例如：

```text
小于 30K ~ 50K 字符
```

直接完整注入往往最稳。

现在所有文件都统一走 chunk 选择，可能导致小文件也被不必要地截断或选择局部。

建议：

```text
小文件：直接完整注入
中等文件：结构化上下文
大文件：概览选择 / RAG / 摘要索引
```

---

## 4.6 会话历史文件自动复用可能污染普通聊天

当前 auto 策略是：

```text
本轮没有新文件时，自动加载 conversation_files 历史文件
```

这样能避免多轮追问丢上下文，但也可能导致：

```text
用户问普通问题
  → 系统自动注入历史文件
  → 模型被文件内容带偏
```

建议后续更严格：

```text
只有当前问题明确指代文件时，才自动加载历史文件
或者由前端维护“当前选中文件”状态
```

---

## 5. 推荐改造方向

## P0：修正模型上下文提示，不要让模型看到内部截断语

目标：减少模型回答“我看不到文件”。

建议修改：

```text
backend/internal/services/context_builder.go
```

把类似：

```text
... (已达到总字数上限) ...
```

改成：

```text
[系统说明] 文件较长，以下是系统选择的代表性内容片段，不是完整逐字全文。
请优先基于这些片段回答用户问题；如果片段不足以支持精确结论，再说明需要更多上下文。
```

同时在 `<file_context>` 开头明确：

```text
除非 file_context 为空，否则不要声称“没有看到文件”。
```

---

## P1：小文件直接全文注入

目标：让小文档的问答稳定。

建议位置：

```text
backend/internal/api/chat.go
backend/internal/services/context_builder.go
```

策略：

```text
如果文件 content 字符数 <= 30K 或 50K：
  直接注入 files.content
否则：
  走 chunk 选择
```

这样 `111.md` 如果是小文件，就不会因为 RAG / chunk 选择导致模型说看不到内容。

---

## P2：Markdown 单独结构化解析

目标：让 `.md` 文档概览更稳。

建议新增或扩展：

```text
backend/internal/services/file_parser.go
backend/internal/services/markdown_parser.go
```

至少提取：

```text
headings
sections
code_blocks
tables
```

可以先不引入复杂依赖，用简单行扫描实现：

```text
以 # / ## / ### 识别标题
以 ``` 识别代码块
以 | 识别表格
空行分段
```

然后 chunk 的 `BlockType` 可以更细：

```text
heading
paragraph
code
table
list
```

---

## P3：新增 Document Profile / Outline

目标：让“这是什么 / 总结 / 分析”不依赖普通 chunk 检索。

可以在文件解析完成后生成确定性 profile：

```json
{
  "filename": "111.md",
  "type": "markdown",
  "char_count": 120000,
  "headings": ["...", "..."],
  "first_section": "...",
  "last_section": "..."
}
```

第一版可以不单独建表，先放在：

```text
files.summary
```

或者新增 metadata 字段。

概览类问题优先注入：

```text
文件名
文件类型
文档大纲
章节标题
代表性片段
结尾
```

---

## P4：细化意图路由

当前只有：

```text
概览模式
普通 RAG 模式
```

后续建议扩展为：

| 用户意图 | 推荐上下文策略 |
|---|---|
| 这是什么 / 总结 / 分析 | outline + representative chunks |
| 查找具体信息 | embedding / keyword RAG |
| 日志分析 | ERROR/WARN 附近 + 开头/结尾 |
| 代码审查 | 文件结构 + 函数/类定义 + 相关片段 |
| 表格分析 | 表头 + 样例行 + 统计摘要 |
| 图片理解 | image_caption 全量或重点注入 |

这样文件问答会比单纯 RAG 稳很多。

---

## P5：前端展示解析状态

目标：避免“上传成功但没内容”的误解。

前端应该明确展示：

```text
上传中
解析中
解析完成，可提问
解析失败：错误信息
```

并且在 `parse_status != done` 时禁用提问或提示稍后再试。

---

## 6. 建议的下一版目标架构

推荐演进为：

```text
上传
  → 原文件落盘
  → files 记录

解析
  → content 全文
  → structured_chunks
  → document_profile / outline
  → parse_status done

索引
  → embedding jobs
  → file_embeddings

聊天
  → resolve public_id
  → 判断文件状态
  → 判断用户意图
      - 概览
      - 精确问答
      - 继续追问
      - 图片理解
  → 根据文件大小和意图选择上下文
      - 小文件直接全文
      - Markdown 用 outline + sections
      - 大文件用概览选择或 RAG
  → 构造 <file_context>
  → 合并 system messages
  → 调用模型
```

---

## 7. 最终评价

当前架构：

```text
上传 / 解析 / 存储 / 初步 RAG：合理
文件上下文选择 / 概览理解：需要加强
前端解析状态体验：需要补齐
```

不建议推翻现有架构。

建议在现有架构上优先补三件事：

1. **小文件直接全文注入；**
2. **Markdown / 文档类做结构化 outline；**
3. **概览类问题走结构化上下文，而不是普通 RAG。**

这样能明显减少模型回答“看不到内容 / 内容被截断”的问题，也能让文件问答从“能跑”变成“稳定可用”。
