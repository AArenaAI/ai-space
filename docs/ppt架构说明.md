# AI Pool PPT 生成架构说明

> 基于当前代码整理：后端 Go/Gin + GORM，前端 Next.js。本文只记录配置项名称和接口路径，不包含任何真实 API Key、Token、密码或连接串。

## 1. 总体架构

```text
前端 /ppt 页面
  ├─ hooks/usePPT.ts 封装 PPT API
  └─ app/(main)/ppt/page.tsx 管理步骤 UI
        │
        ▼
后端 Gin Router
  └─ /api/ppt/* 路由 → PPTHandler
        │
        ▼
PPTHandler
  ├─ 创建/查询任务
  ├─ 调用 PPTService 生成大纲、完整幻灯片、重写单页、精修图片 prompt
  ├─ 写入 PPTGeneration / PPTSlide / PPTRevision
  └─ 配图阶段启动 goroutine 异步生成图片
        │
        ▼
PPTService
  ├─ callLLM()：调用文档生成模型 /v1/chat/completions
  ├─ GenerateOutline()：生成 PPT 大纲 JSON
  ├─ GenerateFullPPT()：生成完整 slides JSON
  ├─ RewriteSlide()：重写单页
  ├─ GenerateImagePrompt()：按用户指令精修图片 prompt
  └─ GenerateImage()：调用 ImageGenService 生成 PPT 配图
        │
        ▼
ImageGenService
  ├─ OpenAI-compatible：POST {baseURL}/v1/images/generations
  └─ DashScope Qwen Image：POST {baseURL}/services/aigc/multimodal-generation/generation
        │
        ▼
本地图片存储
  └─ data/images/*.png → /api/images/file/:filename
```

## 2. 核心文件清单

| 层级 | 文件 | 作用 |
|---|---|---|
| 前端页面 | `frontend/app/(main)/ppt/page.tsx` | PPT 功能主页面，管理模板选择、参数配置、大纲确认、预览编辑四个步骤 |
| 前端 Hook | `frontend/hooks/usePPT.ts` | 封装 `/api/ppt` 相关请求、轮询状态、更新前端 task/slides/outline 状态 |
| 路由注册 | `backend/internal/api/router.go` | 注册 `/api/ppt/*` 路由；注册公开图片文件服务 `/api/images/file/:filename` |
| API Handler | `backend/internal/api/ppt.go` | PPT 任务 CRUD、大纲生成、确认大纲、异步配图、重写、重生图、导出 |
| 业务服务 | `backend/internal/services/ppt_service.go` | 文档生成 LLM 调用、JSON 解析、大纲/幻灯片/重写/图片 prompt/导出逻辑 |
| 图片生成服务 | `backend/internal/services/image_gen_service.go` | 统一图片生成适配器，支持 OpenAI-compatible 和 DashScope 原生 Qwen Image |
| 数据模型 | `backend/internal/models/ppt.go` | `PPTGeneration`、`PPTSlide`、`PPTRevision`、`PPTTemplate` 模型 |
| 配置 | `backend/internal/config/config.go`、`backend/.env` | 文档生成、PPT 配图生成、Vision/OpenAI fallback 配置 |

## 3. 数据模型

### 3.1 PPTGeneration：PPT 任务主表

位置：`backend/internal/models/ppt.go`

关键字段：

| 字段 | 含义 |
|---|---|
| `UserID` / `GuestID` | 登录用户或匿名用户归属 |
| `Title` / `Topic` | PPT 标题与用户输入主题 |
| `TemplateID` | 模板 ID，例如 `modern`、`business`、`creative`、`minimal` |
| `Language` | 输出语言，默认 `zh-CN` |
| `Audience` / `Purpose` | 受众和用途 |
| `SlideCount` | 页数 |
| `WithImages` | 配图策略：`none` / `cover` / `key_slides` / `all` |
| `WithNotes` | 是否生成演讲备注 |
| `QualityMode` | 质量模式：`fast` / `standard` / `premium` |
| `Status` | 任务状态 |
| `OutlineJSON` | 大纲 JSON 字符串 |
| `SlidesJSON` | 完整 slides JSON 字符串，前端预览主要使用它 |
| `Progress` / `ProgressMsg` | 前端轮询展示进度 |
| `PromptTokens` / `CompTokens` / `Cost` | 用量与成本统计字段 |
| `ErrorMsg` | 失败原因 |

### 3.2 PPTSlide：单页幻灯片表

关键字段：

| 字段 | 含义 |
|---|---|
| `PPTID` | 所属 PPT 任务 |
| `Page` | 页码 |
| `Type` | 页面类型：`cover` / `agenda` / `section` / `content` / `chart` / `summary` / `end` |
| `Title` / `Subtitle` | 标题与副标题 |
| `ContentJSON` | 页面 bullet 内容 |
| `Layout` | 布局，如 `cover_hero`、`content_left_right` 等 |
| `ImagePrompt` | 当前页图片生成 prompt |
| `ImageURL` | 图片访问 URL，DashScope 场景应保存为本地 `/api/images/file/*.png` |
| `SpeakerNotes` | 演讲备注 |
| `ChartJSON` | 图表数据 |

### 3.3 PPTRevision：修订记录

当前模型已定义：记录 `Instruction`、修改前后 JSON、模型和成本。现有 handler 中重写单页会更新 `SlidesJSON` 与 `PPTSlide`，后续如果要做版本回滚，可补充写入 `PPTRevision`。

## 4. API 路由

注册位置：`backend/internal/api/router.go`

| 方法 | 路径 | Handler | 说明 |
|---|---|---|---|
| `GET` | `/api/ppt/templates` | `GetTemplates` | 获取内置模板列表 |
| `POST` | `/api/ppt` | `CreatePPT` | 创建 PPT 任务，状态为 `pending` |
| `GET` | `/api/ppt` | `ListPPTs` | 当前用户/游客历史 PPT 列表 |
| `GET` | `/api/ppt/:id` | `GetPPT` | 获取 PPT 主记录与 slides |
| `GET` | `/api/ppt/:id/status` | `GetPPTStatus` | 获取状态、进度、outline、slides |
| `GET` | `/api/ppt/:id/outline` | `GetPPTOutline` | 获取已生成大纲 |
| `POST` | `/api/ppt/:id/outline` | `GenerateOutline` | 生成大纲 |
| `POST` | `/api/ppt/:id/confirm` | `ConfirmOutline` | 确认大纲并生成完整 slides，必要时异步生成图片 |
| `PUT` | `/api/ppt/:id/slides/:page` | `UpdateSlide` | 手动更新单页 |
| `POST` | `/api/ppt/:id/slides/:page/rewrite` | `RewriteSlide` | AI 重写单页 |
| `POST` | `/api/ppt/:id/slides/:page/image` | `RegenerateSlideImage` | 重新生成单页图片 |
| `GET` | `/api/ppt/:id/export/:format` | `ExportPPT` | 导出，当前支持 `markdown`、`text` |
| `DELETE` | `/api/ppt/:id` | `DeletePPT` | 删除 PPT 及单页记录 |
| `GET` | `/api/images/file/:filename` | `ServeImageFile` | 公开访问本地生成图片 |

## 5. 前端状态与页面流程

前端入口：`frontend/app/(main)/ppt/page.tsx`

页面步骤：

```text
template → config → outline → preview
选择模板 → 配置参数 → 大纲确认 → 预览编辑
```

`usePPT.ts` 维护的主要状态：

| 状态 | 含义 |
|---|---|
| `templates` | 模板列表 |
| `task` | 当前 PPT 任务，包括 `id/status/progress/progress_msg` |
| `outline` | 大纲 JSON |
| `slides` | 完整幻灯片数组 |
| `loading` / `error` | UI 加载与错误状态 |

前端主要调用链：

```text
fetchTemplates()
  → GET /api/ppt/templates

createTask(config)
  → POST /api/ppt
  → 返回 id/pending

generateOutline(id)
  → POST /api/ppt/:id/outline
  → 后端同步生成大纲
  → 状态 outline_ready

confirmOutline(id, outline)
  → POST /api/ppt/:id/confirm
  → 后端同步生成完整 slides
  → 如果开启配图，返回 generating_images，前端轮询状态

startPolling(id)
  → 每 2 秒 GET /api/ppt/:id/status
  → completed / failed / outline_ready 时停止

getPPT(id)
  → GET /api/ppt/:id
  → 拉取最终 slides

rewriteSlide(id, page, instruction)
  → POST /api/ppt/:id/slides/:page/rewrite

regenerateImage(id, page, instruction)
  → POST /api/ppt/:id/slides/:page/image

exportPPT(id, format)
  → GET /api/ppt/:id/export/:format
```

注意：后端新增了 `partial_completed`、`image_failed` 状态后，前端轮询停止条件如果只判断 `completed/failed/outline_ready`，可能不会自动停止。建议前端把 `partial_completed` 和 `image_failed` 也纳入终态。

## 6. 后端生成流程

### 6.1 创建任务

`POST /api/ppt` → `CreatePPT`

1. 读取用户或游客身份：`UserID` / `GuestID`。
2. 接收主题、模板、页数、语言、受众、用途、配图策略等参数。
3. 设置默认值：
   - `SlideCount = 8`
   - `TemplateID = modern`
   - `Language = zh-CN`
   - `WithImages = key_slides`
   - `QualityMode = standard`
4. 创建 `PPTGeneration`，初始状态 `pending`。

### 6.2 生成大纲

`POST /api/ppt/:id/outline` → `GenerateOutline`

状态流转：

```text
pending → planning → outline_ready
```

处理逻辑：

1. 状态设为 `planning`，进度 `10`，提示 `正在策划大纲...`。
2. 调用 `PPTService.GenerateOutline()`。
3. `GenerateOutline()` 使用 `callLLM()` 调用文档生成模型，要求模型返回纯 JSON：
   - `title`
   - `subtitle`
   - `audience`
   - `purpose`
   - `slides[]`
   - `image_plan`
4. 成功后写入 `OutlineJSON`，状态 `outline_ready`，进度 `30`。
5. 记录 token 用量。

### 6.3 确认大纲并生成完整 PPT

`POST /api/ppt/:id/confirm` → `ConfirmOutline`

状态流转：

```text
outline_ready → generating_slides → generating_images → completed
                                      ├─ partial_completed
                                      └─ image_failed
```

处理逻辑：

1. 如果请求里带自定义 `outline`，覆盖 `OutlineJSON` 和 `Title`。
2. 状态设为 `generating_slides`，进度 `40`。
3. 调用 `PPTService.GenerateFullPPT()` 生成完整 slides JSON。
4. 写入：
   - `PPTGeneration.SlidesJSON`
   - 每页一条 `PPTSlide`
5. 记录文档生成 token 用量。
6. 根据 `WithImages` 判断是否进入异步配图：
   - `none` / 空：直接 `completed`，进度 `100`
   - 其他：进入 `generating_images`，进度 `70`，启动 goroutine

### 6.4 异步配图 goroutine

触发位置：`ConfirmOutline()` 中 `needsImages == true` 分支。

筛选规则：

| `WithImages` | 生成范围 |
|---|---|
| `cover` | 只生成 `type == cover` 的页 |
| `key_slides` | 生成 `cover` / `section` / `summary` 页 |
| `all` | 所有 `image.needed == true` 且有 prompt 的页 |

每张图处理：

```text
slide.image.prompt
  → PPTService.GenerateImage()
  → ImageGenService.Generate()
  → DashScope / OpenAI-compatible
  → 返回图片 URL
  → 更新 ppt_slides.image_url
  → 更新 ppt_generations.slides_json 中对应 slide.image.url
  → 更新 progress
```

最终状态：

| 条件 | 状态 | 进度文案 |
|---|---|---|
| 全部成功 | `completed` | `PPT 生成完成` |
| 部分成功、部分失败 | `partial_completed` | `部分配图生成成功：X 成功，Y 失败` |
| 全部失败 | `image_failed` | `内容已生成，但配图全部失败` |

## 7. PPTService 责任边界

位置：`backend/internal/services/ppt_service.go`

| 方法 | 作用 |
|---|---|
| `callLLM()` | 调用文档生成模型，接口为 OpenAI-compatible chat completions：`{baseURL}/v1/chat/completions` |
| `GenerateOutline()` | 根据主题生成大纲 JSON |
| `GenerateFullPPT()` | 根据大纲生成完整 slides JSON，包括布局、图片 prompt、演讲备注、图表字段 |
| `RewriteSlide()` | 按用户指令重写单页，保持 slide JSON 结构 |
| `GenerateImagePrompt()` | 按用户指令和当前 slide 精修英文图片 prompt |
| `GenerateImage()` | 使用 PPT 配图配置调用图片生成服务 |
| `ExportToMarkdown()` | 导出 Markdown 文本 |
| `GetTemplateStyle()` | 返回内置模板风格配置 |
| `extractJSON()` | 从 LLM 输出中提取 JSON |

`callLLM()` 的配置来源：

```text
DOC_GEN_API_KEY / DOC_GEN_BASE_URL / DOC_GEN_MODEL
  ↓ 未配置时 fallback
OPENAI_API_KEY / OPENAI_BASE_URL / gpt-4o-mini
```

## 8. 图片生成链路

位置：

- `backend/internal/services/ppt_service.go`
- `backend/internal/services/image_gen_service.go`

### 8.1 PPT 配图配置来源

`PPTService.GenerateImage()` 的 fallback 链：

```text
PPT_IMAGE_GEN_API_KEY
  ↓ 空时
VISION_API_KEY
  ↓ 空时
OPENAI_API_KEY
```

baseURL/model 默认：

```text
PPT_IMAGE_GEN_BASE_URL 默认 https://dashscope-intl.aliyuncs.com/api/v1
PPT_IMAGE_GEN_MODEL 默认 qwen-image-2.0-2026-03-03
```

文档中只允许记录配置项名称，不记录任何真实值。

### 8.2 Provider 判断

`ImageGenService.Generate()` 判断逻辑：

```go
strings.Contains(baseURL, "dashscope") || strings.HasPrefix(model, "qwen-image")
```

满足条件则走 DashScope 原生接口，否则走 OpenAI-compatible 接口。

### 8.3 DashScope Qwen Image 原生调用

接口：

```text
POST https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
```

请求结构：

```json
{
  "model": "qwen-image-2.0-2026-03-03",
  "input": {
    "messages": [
      {
        "role": "user",
        "content": [{ "text": "image prompt" }]
      }
    ]
  },
  "parameters": {
    "n": 1,
    "size": "1024*1024",
    "result_format": "message",
    "watermark": true
  }
}
```

关键点：

- `size` 必须是 `1024*1024`，不是 `1024x1024`。
- 后端会把 OpenAI 风格 `1024x1024` 自动转换为 DashScope 风格 `1024*1024`。
- 返回图片位置：`output.choices[0].message.content[].image`。
- DashScope 返回的是带过期时间的 OSS 临时链接，不能持久化到 PPT 数据里。
- 当前实现会立即下载到 `data/images/`，再返回本地 URL：`/api/images/file/<filename>.png`。

### 8.4 OpenAI-compatible 图片生成

接口：

```text
POST {baseURL}/v1/images/generations
```

适用于 OpenAI-compatible provider。若返回 `url` 则直接返回；若返回 `b64_json`，保存到 `data/images/` 并返回 `/api/images/file/<filename>.png`。

## 9. 状态机

当前代码中出现的 PPT 状态：

| 状态 | 触发位置 | 含义 |
|---|---|---|
| `pending` | `CreatePPT` | 任务已创建，尚未开始生成 |
| `planning` | `GenerateOutline` | 正在生成大纲 |
| `outline_ready` | `GenerateOutline` 成功 | 大纲已生成，等待用户确认 |
| `generating_slides` | `ConfirmOutline` | 正在生成完整 slides |
| `generating_images` | `ConfirmOutline` 中开启配图 | 文本内容已生成，正在异步配图 |
| `completed` | 无配图或配图全部成功 | PPT 生成完成 |
| `partial_completed` | 配图部分失败 | 内容完成，部分配图失败 |
| `image_failed` | 配图全部失败 | 内容完成，但配图全部失败 |
| `failed` | 大纲或 slides 生成失败 | 主流程失败 |

建议前端终态判断统一为：

```ts
const terminalStatuses = ["completed", "partial_completed", "image_failed", "failed", "outline_ready"];
```

其中 `outline_ready` 只适用于大纲阶段轮询；进入 preview 后应重点处理 `completed`、`partial_completed`、`image_failed`、`failed`。

## 10. 导出能力

`ExportPPT()` 当前支持：

| format | 输出 |
|---|---|
| `markdown` | Markdown 文件，包含标题、内容 bullet、演讲备注 |
| `text` | 纯文本文件，包含页码、标题和 bullet |

目前没有真正生成 `.pptx` 文件。若后续需要 PPTX 导出，应新增独立 exporter，而不是复用 Markdown export。

## 11. 当前已知注意点与维护建议

1. **前端轮询终态需要同步新增状态**  
   后端已有 `partial_completed`、`image_failed`，前端 `usePPT.ts` 的 `startPolling()` 当前只把 `completed`、`failed`、`outline_ready` 当终态。建议补齐，否则图片部分失败或全部失败时可能持续轮询。

2. **DashScope OSS 临时链接必须本地化**  
   不能把带 `Expires` 的临时 URL 存进 `SlidesJSON` 或 `PPTSlide.ImageURL`。当前 `ImageGenService` 已实现下载到 `data/images/` 后返回本地 URL。

3. **配置值不要写死真实凭据**  
   文档、日志、提交信息中只记录配置项名称。所有真实 key/token/password 必须视作 `[REDACTED]`。

4. **文档生成和图片生成是两套配置**  
   - 文档生成：`DOC_GEN_*`，走 chat completions。
   - PPT 配图：`PPT_IMAGE_GEN_*`，优先走 DashScope Qwen Image 原生接口。

5. **`PPTRevision` 模型尚未充分使用**  
   如果要支持“撤销/版本历史”，应在 `RewriteSlide` 和 `UpdateSlide` 时写入 revision。

6. **`PPTSlide.ChartJSON` 当前写入不足**  
   `FullSlide` 有 `Chart` 字段，`PPTSlide` 也有 `ChartJSON`，但当前保存 slides 时主要写入 content/image/speaker_notes，后续可补充图表字段落库。
