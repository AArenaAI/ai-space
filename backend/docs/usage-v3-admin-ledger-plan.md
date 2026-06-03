# Usage v3 Admin Ledger Plan

## 背景

当前后台消耗页更像统计面板：能看到总成本、模型排行和最近调用，但管理员无法稳定从一个成本数字下钻到具体业务调用。例如已回填 7 条 `video_generation` 账本，后台仍然只能看到大概成本，无法直接筛出这 7 条并解释每条成本来源。

Usage v3 的目标是把后台消耗体系从“模型服务统计”升级为“产品模块可追溯账本”：

```text
产品模块 / 功能入口
        ↓
一次外部模型或付费 API 调用
        ↓
统一 APIUsageLog 账本
        ↓
后台总览 → 模块 → 功能 → 操作 → 单条调用详情
```

## 核心原则

1. 一次外部模型/API 调用 = 一条 `api_usage_logs`。
2. 账本和业务表分离；业务表只保留快速展示字段和任务状态。
3. 每条账本必须能追溯到业务上下文：用户、模块、功能、操作、resource/task/request。
4. 非 token 型成本必须进入统一账本：图片张数、视频 token、翻译字符、音频秒数、本地工具 0 成本操作。
5. 价格表保存官方原始定价，不保存固化 RMB；写账本时保存 RMB 成本快照和汇率快照。
6. 后台默认展示官方单位，不展示内部 `RMB/1K tokens` 快照。
7. 失败/审核失败不产生外部成本时可以记录 0 成本操作，但不得伪造用量。

## 现状审计

### 已经写入账本但维度不足

| 入口 | 当前写账本情况 | 主要缺口 |
| --- | --- | --- |
| Chat | `RecordChatUsageWithContext` 已记录 conversation/message/task/workspace/notebook 部分上下文 | 缺 `module/feature/operation`，无法区分主聊天、写作助手、文档研读、workspace transient 调用 |
| Video | 独立视频和视频会话已按 Seedance `completion_tokens` 计费 | 后台缺明细筛选；历史记录缺产品维度 |
| PPT 大纲/全文生成 | `RecordPPTUsage` 已记录 `ppt_generation` resource | 缺 operation：outline/full/slides；`RewriteSlide` 当前没有写账本 |
| File Vision 解析 | `RecordVisionUsage` 已记录 file id | 缺 module/feature/operation，后台看不到是文件解析/文档研读成本 |
| Embedding | `RecordEmbeddingUsage` 已记录 file/job | 缺 notebook/workspace/module 维度 |
| 图片生成/编辑 | `RecordImageUsage` 已粗略记录成功/失败 | user/context 丢失、operation 丢失、resource id 丢失；image-chat 当前传 `user_id=0` |

### 当前没有进入统一账本或不完整

| 入口 | 当前状态 | 需要补齐 |
| --- | --- | --- |
| Google Translation | `TranslateService` 调用 Google Cloud Translation v3，但 handler 未注入 UsageService | 新增 `RecordTranslationUsage`，按字符数/官方价格计费 |
| 图片本地工具 | 背景移除、文字消除、超分等部分走本地脚本 | 记录 0 成本操作：`provider=local`、`service=image_utility` |
| 图片编辑细分 | replace-bg/inpaint/region-brush 等可能调用 OpenAI 图片编辑 | 写入 `operation`、resource、size/quality/mask/reference count |
| PPT 单页重写 | `RewriteSlide` 返回 usage 但未记录 `RecordPPTUsage` | 记录 `operation=ppt_slide_rewrite` |
| PPT 配图 | `PPTImageJob` 创建后需确认图片生成是否写账本 | 每张配图应记录为 image_generation，resource 指向 ppt_image_job 或 ppt_generation |
| AI 工作/创作入口 | 很多入口通过 chat/image/video 间接调用 | 需要按路由或请求上下文填 module/feature/operation |

## 账本字段扩展

现有 `APIUsageLog` 已有：

- `Service`
- `Provider`
- `Model`
- `ResourceType`
- `ResourceID`
- `ConversationID`
- `MessageID`
- `TaskID`
- `WorkspaceID`
- `NotebookID`
- `PromptTokens`
- `CompletionTokens`
- `TotalTokens`
- `ImageCount`
- `VideoSeconds`
- `AudioSeconds`
- `CharacterCount`
- 成本快照、官方价格快照、`RequestID`、`RawUsageJSON`

Usage v3 新增三个产品维度：

```go
Module    string // chat / creative / work / workspace / admin / system
Feature   string // image / video / translator / writing_assistant / document_reader / ppt / notebook / chat
Operation string // text_to_image / remove_bg / translate_text / ppt_outline / chat_completion 等
```

建议索引：

```text
idx_usage_module
idx_usage_feature
idx_usage_operation
idx_usage_module_feature_created(module, feature, created_at)
```

## Service / Module / Feature / Operation 规范

### Chat

| 场景 | service | module | feature | operation |
| --- | --- | --- | --- | --- |
| 主聊天 | chat | chat | chat | chat_completion |
| 多模型对比 | chat | chat | compare | compare_completion |
| 分叉回答 | chat | chat | fork | fork_completion |
| 写作助手 | chat | work | writing_assistant | writing_assistant_completion |
| 文档研读问答 | chat | work | document_reader | document_qa |
| Workspace transient 生成 | chat | workspace | workspace | transient_generation |
| Notebook 问答 | chat | work | notebook | notebook_qa |

### Creative 图片

| 场景 | service | module | feature | operation |
| --- | --- | --- | --- | --- |
| 文生图 | image_generation | creative | image | text_to_image |
| 图生图/参考图 | image_generation | creative | image | image_to_image |
| 通用图片编辑 | image_edit | creative | image | image_edit |
| 局部重绘 | image_edit | creative | image | inpaint |
| 区域刷除 | image_edit | creative | image | region_brush |
| 换背景 | image_edit | creative | image | replace_bg |
| 背景移除（本地） | image_utility | creative | image | remove_bg |
| 文字消除（本地） | image_utility | creative | image | text_removal |
| 画质增强/超分（本地） | image_utility | creative | image | upscale |

本地工具建议也记录一条 0 成本账本，方便统计使用量。

### Creative 视频

| 场景 | service | module | feature | operation |
| --- | --- | --- | --- | --- |
| 文生视频 | video_generation | creative | video | text_to_video |
| 图生视频 | video_generation | creative | video | image_to_video |
| 视频生视频/参考视频 | video_generation | creative | video | video_to_video |

Seedance 成功时按 provider 返回的 `usage.completion_tokens` 计费。

### AI 工作

| 场景 | service | module | feature | operation |
| --- | --- | --- | --- | --- |
| Google 翻译 | translation | work | translator | translate_text |
| PPT 大纲 | document_generation | work | ppt | ppt_outline |
| PPT 全文生成 | document_generation | work | ppt | ppt_full_generation |
| PPT 单页重写 | document_generation | work | ppt | ppt_slide_rewrite |
| PPT 配图 | image_generation | work | ppt | ppt_slide_image |
| 文件视觉解析 | vision | work | document_reader | file_vision_parse |
| 文件 embedding | embedding | work | document_reader / notebook | file_embedding |

## Google Translation 计费设计

新增 `UsageService.RecordTranslationUsage(input)`。

输入字段：

```go
type TranslationUsageInput struct {
    UserID uint
    GuestID string
    Provider string // google-cloud-translate-v3
    Model string    // general/nmt 或 general/translation-llm
    CharacterCount int
    ResourceType string // translation_request 或 message 等
    ResourceID uint
    RequestID string
    RawUsageJSON string
    LatencyMs int
}
```

计费口径：

- `PricingUnit = character_1m`
- `UnitCount = CharacterCount / 1_000_000`
- 官方价格放入 `backend/config/model-prices.json`
- DeepSeek/人民币同理；Google 若官方 USD，则写账本时用实时汇率折 RMB 快照

价格项示意：

```json
{
  "google-cloud-translate-v3:general/translation-llm": {
    "provider": "google-cloud-translate-v3",
    "model": "general/translation-llm",
    "pricing_unit": "character_1m",
    "source_currency": "USD",
    "source_unit": "per_1m_characters",
    "source_input_price": 0,
    "source_url": "https://cloud.google.com/translate/pricing"
  }
}
```

实际价格必须以 Google 官方价格页为准，不能用占位价上线。

## 后台 API 规划

### `GET /api/admin/usage/logs`

增强参数：

```text
range=today|7d|30d|all
start_date=
end_date=
module=
feature=
operation=
service=
provider=
model=
status=
user_id=
guest_id=
conversation_id=
message_id=
task_id=
workspace_id=
notebook_id=
resource_type=
resource_id=
request_id=
estimated=true|false
min_cost=
max_cost=
q=
page=
page_size=
sort=created_at|cost|tokens|characters|images
order=desc|asc
```

返回：

```json
{
  "logs": [],
  "total": 123,
  "page": 1,
  "page_size": 50,
  "summary": {
    "requests": 7,
    "cost_rmb": 36.242129,
    "prompt_tokens": 0,
    "completion_tokens": 123456,
    "total_tokens": 123456,
    "character_count": 0,
    "image_count": 0,
    "video_seconds": 0
  }
}
```

### `GET /api/admin/usage/logs/:id`

账本详情。

返回：

- APIUsageLog 全字段
- 用户信息
- 关联 conversation/message/task/workspace/notebook
- 关联 image/video/ppt/file 业务对象
- 官方价格快照
- raw usage JSON
- error 信息

### `GET /api/admin/usage/facets`

根据当前筛选返回可选项：

```json
{
  "modules": [],
  "features": [],
  "operations": [],
  "services": [],
  "providers": [],
  "models": [],
  "statuses": [],
  "resource_types": []
}
```

### `GET /api/admin/usage/modules`

按 module/feature/operation 聚合：

```text
module, feature, operation, requests, success, failed, tokens, characters, images, cost_rmb
```

### `GET /api/admin/usage/tasks`

按业务资源聚合：

```text
resource_type, resource_id, task_id, request_id, user, service, module, feature, operation, cost_rmb, tokens, characters, image_count
```

用于视频、图片、PPT、文件解析等任务视图。

## 前端页面规划

`/admin/usage` 改成标签页：

1. Overview：总览和趋势。
2. Ledger：账本明细，可筛选、分页、详情抽屉。
3. Modules：按产品模块/功能/操作聚合。
4. Models：按 provider/model 聚合，可下钻。
5. Users：用户成本排行，可下钻。
6. Conversations：会话成本。
7. Tasks：业务任务/资源成本。

组件建议：

```text
frontend/components/admin/usage/UsageFilters.tsx
frontend/components/admin/usage/UsageLedgerTable.tsx
frontend/components/admin/usage/UsageLogDetailDrawer.tsx
frontend/components/admin/usage/UsageSummaryCards.tsx
frontend/components/admin/usage/UsageModuleMatrix.tsx
frontend/components/admin/usage/UsageModelMatrix.tsx
frontend/components/admin/usage/UsageUserRanking.tsx
frontend/components/admin/usage/UsageConversationRanking.tsx
frontend/components/admin/usage/UsageTaskTable.tsx
```

## 实施顺序

### Phase 1：账本可下钻，先解决视频 7 条不可见

1. `APIUsageLog` 增加 `Module/Feature/Operation`。
2. `UsageLogs` 支持 `module/feature/operation/resource_type/resource_id/request_id/range=all/page/page_size`。
3. `UsageLogs` 返回筛选 summary。
4. `/admin/usage` 添加 Ledger 筛选和分页。
5. 验证筛 `service=video_generation` 能看到 7 条，合计 `¥36.242129`。

### Phase 2：补齐图片上下文

1. 图片生成写 `resource_type=image_generation/resource_id=gen.ID`。
2. 按入口写 `operation=text_to_image/image_to_image/image_edit/inpaint/replace_bg/region_brush`。
3. image-chat 修正 user/guest/chat/message 上下文，不能继续传 `user_id=0`。
4. 本地 remove-bg/text-removal/upscale 写 0 成本 `image_utility` 记录。

### Phase 3：补 Google 翻译成本

1. 官方价格入 `model-prices.json`。
2. 新增 `RecordTranslationUsage`。
3. TranslateHandler 注入 UsageService。
4. 成功翻译后按字符数写账本。
5. 后台可筛 `module=work&feature=translator`。

### Phase 4：补 AI 工作模块归属

1. PPT outline/full/rewrite/image job 写 `module=work feature=ppt operation=...`。
2. file vision parse 写 `module=work feature=document_reader operation=file_vision_parse`。
3. embedding 按 notebook/workspace/file 来源写 feature。
4. chat transient / document reader / writing assistant 通过请求上下文或路由推断 module/feature/operation。

### Phase 5：详情抽屉和任务视图

1. 新增 `usage/logs/:id`。
2. 新增 `usage/tasks`。
3. 前端详情抽屉显示 raw usage、官方价格、resource/task 链接。
4. 所有聚合卡片支持点击下钻到 Ledger。

### Phase 6：历史回填

1. 已有 video_generation 7 条补 `module=creative feature=video`。
2. 旧 image_generation 根据 `image_generations.prompt/reference/status` 尽量回填 `operation`，不能判断的标记 `unknown`。
3. 旧 chat 根据 conversation/workspace/notebook 尽量回填 module/feature。
4. Google 翻译没有旧账本则只能从翻译请求历史回填；若无请求表，不伪造成本。

## 验收标准

最低验收：

1. `/admin/usage` Ledger 可筛 `service=video_generation`，显示 7 条视频，summary 合计 `¥36.242129`。
2. Ledger 可筛：
   - `module=creative feature=image operation=remove_bg`
   - `module=work feature=translator`
   - `module=work feature=ppt`
3. 每条记录可打开详情，看到：
   - module/feature/operation
   - resource/task/request
   - token/character/image/video 用量
   - 官方价格快照
   - RMB 成本快照
   - raw usage JSON
4. `go test ./...` 通过。
5. 前端 `npx tsc --noEmit` 无本次新增错误；若仓库已有无关错误，必须明确排除并不混入提交。
6. 浏览器 E2E 实际验证筛选和详情，不只看接口。

## 注意事项

- 不要把 `frontend` 无关 WIP 混入 usage 改动提交。
- 不要用 `git add -A`。
- 价格配置继续使用 JSON，可版本管理。
- Google Translation 官方价格必须重新抓取/核验，不允许占位价格上线。
- 本地工具 0 成本记录是运营使用量，不是外部 API 成本。
- 历史无法精确判断的字段用 `unknown` 或留空，不伪造精确归属。
