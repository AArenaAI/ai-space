# AI Space 功能实现与验证执行准则

> 适用范围：AI Space 前端、聊天流式、搜索/推理、Notebook/Wisebase、翻译、`/create` 图片工具、后台任务、部署相关改动。  
> 核心原则：功能完成不等于“代码写完 + build 通过”。只有在代码级回归、真实 UI、真实 API/provider、生产构建和 diff 质量都被验证后，才算达到可交付标准。

---

## 1. 总体原则

AI Space 的实现和验证应遵循以下原则：

1. **先理解数据流，再改代码**
   - 先定位相关 hook、helper、store、API、fixture、regression script。
   - 不在未理解状态机、持久化路径、真实 UI 路径的情况下直接改。

2. **按风险层级验证，而不是只跑一个命令**
   - 纯逻辑回归证明状态机正确。
   - TypeScript / diff 检查证明代码质量。
   - 浏览器 fixture 证明真实 DOM 和交互正确。
   - 真实页面 E2E 证明用户路径正确。
   - 真实模型/API E2E 证明 provider、SSE、任务收敛和持久化路径正确。

3. **E2E 断言用户不变量，而不是只断言请求成功**
   - 请求 200 只是最低条件。
   - 必须验证用户真实看到的状态、内容、去重、失败保护、点击浮层、历史恢复等不变量。

4. **小范围实现，小范围提交**
   - 实现时避免混入无关 WIP。
   - 提交前检查 `git status` 和 diff。
   - 如果工作区存在大量既有 WIP，必须只按 pathspec 暂存本次相关文件，或暂不提交并说明原因。

5. **报告结果必须可复查**
   - 最终说明要列出：改了什么、验证了什么、跑了哪些命令、哪些真实场景通过、还有什么风险或未提交原因。

---

## 2. 标准验证层级

实现功能后，按以下层级逐步验证。

### 2.1 代码级 / 纯逻辑回归

适用于：状态派生、SSE event handler、task stream、fallback、timeline、content/reasoning 分离、搜索状态、错误恢复等。

常用命令示例：

```bash
npm run test:chat-message-status
npm run test:chat-generation-phase
npm run test:chat-initial-realtime
npm run test:streaming
npm run test:chat-task-stream-event-handler
npm run test:chat-main-stream-event-handler
```

标准：

- 状态机分支必须被覆盖。
- fallback 行为必须有测试。
- 错误、停止、完成、搜索、推理、轮询恢复等路径不能只靠人工看页面。

---

### 2.2 TypeScript / diff 检查

所有前端功能改动至少运行：

```bash
npx tsc --noEmit --pretty false
git diff --check
```

标准：

- TypeScript 必须通过。
- `git diff --check` 必须无 trailing whitespace、bad patch、空白错误。
- 如果 TypeScript 不通过，即使页面看起来可用，也不能算完成。

---

### 2.3 Production build

涉及前端页面、组件、hook、route、i18n、动态 import、browser API 的改动，应运行：

```bash
NEXT_PRIVATE_BUILD_WORKER=1 npm run build
```

标准：

- `next dev` 能跑不代表生产构建可用。
- build 应至少出现：

```text
✓ Compiled successfully
```

如果 build 失败，必须定位是否为本次改动引入；不能忽略。

---

### 2.4 浏览器 fixture

适用于：真实 DOM、点击、悬浮、弹窗、状态标签、滚动、Markdown、before/after slider、i18n 可见文本等。

示例：

```bash
CHAT_FIXTURE_BASE_URL=http://127.0.0.1:3000 npm run test:chat-streaming-state-fixture
```

标准：

- 断言真实 DOM，而不是只断言函数返回。
- 交互类功能必须测点击、悬浮、输入、滚动等真实行为。
- 文本匹配必须尽量限定作用域，避免命中 overlay、历史消息、隐藏内容导致误判。

---

### 2.5 真实页面 E2E

适用于：用户真实操作路径，例如 `/chat/` 输入、点击发送、等待 SSE、查看最终消息、打开 timeline。

示例：

```bash
REAL_CHAT_MODEL=gpt-5.5 \
REAL_CHAT_SEARCH=0 \
REAL_CHAT_REASONING=0 \
REAL_CHAT_EXPECT_TIMELINE='正在等待模型响应|正在生成回答' \
npm run test:chat-real-live-send-e2e
```

标准：

- 必须通过真实页面操作，不只调用 API。
- 必须验证最终用户可见状态。
- 必须验证没有重复回答、没有假失败、没有空 timeline。

---

### 2.6 真实模型 / API / provider E2E

适用于：模型调用、SSE、搜索、推理、任务轮询、持久化、provider fallback。

示例：

```bash
REAL_CHAT_MODEL=deepseek-v4-pro \
REAL_CHAT_SEARCH=1 \
REAL_CHAT_REASONING=1 \
REAL_CHAT_EXPECT_TIMELINE='正在等待模型响应|联网搜索完成|引用|正在生成回答' \
npm run test:chat-real-live-send-e2e
```

标准：

- 必须覆盖至少一个 baseline 场景和一个边界/高风险场景。
- 对聊天功能，建议至少覆盖：
  - GPT / 普通无搜索场景。
  - DeepSeek 或其他长耗时/推理/搜索场景。
- 如果功能涉及 persisted history，还要验证刷新/重新进入后内容仍正确。

---

## 3. 通用“完成”标准

### 3.1 不能算完成的情况

以下情况不能算真正完成：

- 只写完代码，未跑测试。
- 只跑 build，未跑对应 regression。
- 只跑 Node 测试，未跑浏览器 fixture。
- 只测 mock fixture，未测真实页面路径。
- 涉及 provider/SSE/search/reasoning，却未跑真实 API 或真实模型 E2E。
- E2E 只检查 HTTP 200，没有检查用户可见结果。
- 测试用全页面文本匹配，导致重复文本或 overlay 误判。
- 未检查 `git status`，提交混入无关 WIP。

### 3.2 可以算完成的情况

通常至少满足：

1. 相关 Node regression 通过。
2. TypeScript 通过。
3. `git diff --check` 通过。
4. Production build 通过。
5. 有浏览器 fixture 验证核心 UI 不变量。
6. 涉及真实用户路径的功能跑过真实页面 E2E。
7. 涉及模型、SSE、搜索、推理、任务轮询的功能跑过真实 API/provider E2E。
8. 最终报告明确列出验证命令和结果。
9. 提交范围清晰；如未提交，说明原因。

---

## 4. 场景化验证标准

## 4.1 普通 frontend / UI 功能

适用于：按钮、弹窗、布局、导航、轻量交互、普通表单。

最低验证：

```bash
npx tsc --noEmit --pretty false
git diff --check
NEXT_PRIVATE_BUILD_WORKER=1 npm run build
```

如果涉及真实交互，增加 browser fixture 或 smoke：

```bash
SMOKE_BASE_URL=http://127.0.0.1:3000 npm run test:browser-smoke
```

标准：

- 页面可打开。
- DOM 状态正确。
- 交互路径正确。
- 移动端/响应式影响可控。
- i18n 场景不出现硬编码或错语言。

---

## 4.2 Chat streaming / 状态 / 搜索 / 推理功能

适用于：聊天流式输出、状态标签、完成标签、timeline、搜索、推理、任务流、轮询恢复、stop/retry。

建议基础验证：

```bash
npm run test:chat-message-status
npm run test:chat-generation-phase
npm run test:chat-initial-realtime
npm run test:streaming
npm run test:chat-task-stream-event-handler
npm run test:chat-main-stream-event-handler
npx tsc --noEmit --pretty false
git diff --check
NEXT_PRIVATE_BUILD_WORKER=1 npm run build
```

UI 状态相关改动，增加：

```bash
CHAT_FIXTURE_BASE_URL=http://127.0.0.1:3000 npm run test:chat-streaming-state-fixture
```

真实页面 baseline：

```bash
REAL_CHAT_MODEL=gpt-5.5 \
REAL_CHAT_SEARCH=0 \
REAL_CHAT_REASONING=0 \
npm run test:chat-real-live-send-e2e
```

搜索/推理高风险场景：

```bash
REAL_CHAT_MODEL=deepseek-v4-pro \
REAL_CHAT_SEARCH=1 \
REAL_CHAT_REASONING=1 \
npm run test:chat-real-live-send-e2e
```

必须验证的不变量：

| 类型 | 不变量 |
|---|---|
| 网络 | `/api/chat` 返回 `text/event-stream` |
| 内容 | assistant 有真实回答 |
| 去重 | 回答 marker 只出现一次 |
| 失败保护 | 不出现假的 `生成中断` / `生成失败` |
| 最终状态 | 完成后显示 `生成完成 · 用时 X秒` |
| 搜索状态 | `联网搜索完成 · 引用 N 个来源` 进入 timeline，不抢占最终标签 |
| timeline | 点击/悬浮完成标签后流程非空 |
| GPT 无搜索 | 无搜索场景也有完成 timeline |
| 推理 | reasoning 与 answer 顺序正确，思考不泄漏到正文 |
| 持久化 | 刷新/历史恢复后内容、reasoning、引用仍正确 |

### 4.2.1 会话切换 / 对话渲染性能专项验证

适用于：聊天页路由切换慢、对话切换后首屏跳动、最新消息 Markdown/文章渲染形态变化、Virtuoso 贴底/慢滑稳定性、历史消息延迟 hydrate/token upgrade 等问题。

除通用 chat 回归外，必须显式覆盖以下问题，不得只看 build 通过或 profile `ok=true`：

| 问题类型 | 必须检测的不变量 | 典型对话/样本 |
|---|---|---|
| 最新消息 2s 后从 lite/plain 升级 | 进入后早期快照与 2.5s 后快照不能出现明显 `textLen` 增长；不能出现 `markdown-hydrate-delayed-first-chunk` 影响最新可见 assistant | 607、62 |
| 文章型最新消息可感知 morph | 非 streaming latest assistant 的 `data-markdown-lite-renderer` / `data-markdown-token-renderer` 不应在用户可见后从 lite 变 token/rich；即使 `textDelta=0`，`rendererChanged=true` 也要视为潜在问题 | 607、608、264 |
| extreme 最新消息分段增长 | 超长/大量 code/table 的 latest assistant 不能在首屏后以 `32→64→96...` block append 方式增长；如使用 token renderer，应一次性进入稳定 block 数，或使用明确的稳定 fallback | 62 |
| fresh/direct entry 与 switch profile 不一致 | 不能只跑 conversation switch profile；还要直接打开 `/chat/?id=<cid>`，比较早期与晚期 renderer/text/贴底。direct entry 中出现 `deferred-lite`/`stable-preview` 残留也算问题 | 62 |
| 历史行延迟 upgrade 干扰首屏 | 历史消息的 delayed hydrate/token upgrade 不应改变最新可见消息高度、触发 bottom lock 抖动，或造成用户当前看到的文章形态变化 | 606、608、264 |
| 贴底稳定 | 所有固定样本必须 `distanceToBottom=0`；62 是核心回归指标，606 慢滑 `flags=[]`，213 静置/慢滑不能因 delayed hydrate/token upgrade 跳动 | 62、606、213 |
| 路由/切换性能 | 记录 click → URL change → first rows → rows changed → bottom0；同时记录 fetch、long task、row/list/lite/token/code commit 计数，避免误把 fetch/parser 当成 DOM mount 问题 | 12、62、606、607 |
| 全会话扫描边界 | 侧边栏 DOM 枚举只能称为“已加载/可见会话扫描”，不能误报为全库全部历史；如要称“全部”，必须通过分页/API 拿到完整会话列表 | 当前真实账号会话列表 |

建议固定执行：

```bash
npm run test:chat-markdown-token-fixture
npm run test:chat-scroll-intent-fixture
npm run test:chat-conversation-switch-cache-fixture
npm run test:chat-row-memo-fixture
npm run test:chat-load-more-history-fixture
npm run test:chat-history-loading-fixture
```

真实 profile 至少包含：

```bash
FRONTEND_BASE_URL=http://127.0.0.1:3012 \
AI_SPACE_E2E_PROFILE_RUNS=3 \
node scripts/regression/chat-switch-profile-summary.cjs
```

报告中必须列出：

- `distanceToBottomNonZero`。
- `urlMs` / `firstRowsMs` / `rowsChangedMs` / `bottom0Ms` 的 p50/p90/max。
- `longTaskBeforeBottom0Total` / `longTaskBeforeBottom0Max`。
- `rowCommitBeforeBottom0` / `liteBeforeBottom0` / `tokenBeforeBottom0`。
- 62、607、606、213 的单独结果。
- 是否检测到 `textDelta`、`rendererChanged`、`markdown-hydrate-delayed-first-chunk`、`markdown-token-rendered` 多次分批、`markdown-token-upgrade-skipped-browse`。

如果用户反馈“能看到跳动/文章变形”，测试脚本要按用户可见不变量判断，而不是只用性能 profile 通过作为结论。尤其要同时采集早期快照（约 150–200ms）与晚期快照（约 2.5s），比较最新 assistant 的：

- `textContent.length`。
- `data-markdown-lite-renderer`。
- `data-markdown-token-renderer`。
- `distanceToBottom`。
- 与该 messageId 相关的 render profile events。

架构判断标准：如果同类问题反复出现，不要继续在 `MessageRow`、`DeferredMarkdownRenderer`、`MarkdownTokenRenderer`、`MarkdownLiteRenderer` 里叠局部条件；应收敛到统一的 `deriveMarkdownRenderMode(...)` 决策点，显式输出 `stable-lite`、`stable-token`、`deferred-lite`、`deferred-token`、`streaming` 等模式，以及 `allowUpgrade`、`allowBatchAppend`、`allowPreview` 等布尔值。

---

## 4.3 Notebook / Wisebase / source-grounded Q&A

适用于：Notebook 问答、Wisebase 知识库、引用、保存 Note、Studio 相关功能。

额外原则：

- 无来源时不能保存为可信 Note。
- no-source / no-ready / no-hit 保护必须生效。
- citations 必须指向真实来源。
- 保存前必须确认来源选择和引用安全。
- 刷新/重新进入后引用和答案仍可追溯。

建议验证：

```bash
npx tsc --noEmit --pretty false
git diff --check
NEXT_PRIVATE_BUILD_WORKER=1 npm run build
```

并增加：

- API 级问答 fixture。
- 浏览器保存/刷新/恢复 fixture。
- 真实文档检索/问答路径。
- no-hit/no-source/no-ready 负向场景。

标准：

- 不能只验证“模型回答了”。
- 必须验证答案和来源之间的绑定关系。
- 必须验证保存 Note / Studio 入口不会绕过来源保护。

---

## 4.4 翻译功能

适用于：AI 翻译、translation API、模型 fallback、语言检测、标点映射、i18n 文案。

验证重点：

- 单字、短句、长文都要覆盖。
- 源语言/目标语言明确。
- 标点符号要符合目标语言习惯，例如中文引号到英文引号。
- API/model 默认行为要有 benchmark 或 fixture。
- 不能只测 UI 文案，要测真实翻译结果。

建议验证：

```bash
npx tsc --noEmit --pretty false
git diff --check
NEXT_PRIVATE_BUILD_WORKER=1 npm run build
```

并按改动范围增加：

- 翻译 API fixture。
- 多语言 benchmark fixture。
- 浏览器输入/输出 E2E。
- 失败/fallback 场景。

---

## 4.5 `/create` 图片工具

适用于：图片生成、图片编辑、局部编辑、before/after slider、task history。

额外原则：

- 必须保持原始像素尺寸。
- metadata 尺寸正确不够，视觉 composition 也不能变化。
- 用户反馈“尺寸变了”“图也放大了”应视为 bug。
- 图片编辑工具默认应位于 `/create`，并复用现有 image edit task/history 存储，除非明确要求新路由或新数据库。

必须验证：

- 输出图片实际像素尺寸与输入一致。
- 前端展示没有拉伸、放大、裁切、偏移。
- before/after slider 视觉对齐。
- task/history 正确记录和恢复。
- 浏览器真实上传/编辑/查看路径可用。

建议验证项：

```bash
npx tsc --noEmit --pretty false
git diff --check
NEXT_PRIVATE_BUILD_WORKER=1 npm run build
```

再增加：

- 图片尺寸检查脚本。
- 浏览器 before/after slider fixture。
- task history API/DB 检查。
- 真实编辑 API E2E。

---

## 4.6 后台任务 / task events / polling

适用于：长任务、后台生成、任务事件流、完成通知、轮询恢复、任务历史。

必须验证：

- task event sequence 不重复、不丢失。
- 主 SSE 与 task stream 恢复不会重复 append 内容。
- `sequence <= after` 的边界 replay 被正确过滤。
- 完成、失败、停止状态能正确收敛。
- 用户在同一任务会话中时通知应低打扰；在不同会话或页面时仍应通知。

建议验证：

- task-stream Node regression。
- 浏览器 fixture。
- 真实后台任务 E2E。
- 任务完成后刷新/历史恢复。

---

## 5. E2E 断言设计标准

E2E 脚本应验证用户不变量，而不是只验证请求成功。

### 5.1 好的 E2E 断言

- 请求类型正确，例如 `/api/chat` 是 `text/event-stream`。
- 页面没有错误态，例如 `生成失败`、`生成中断`。
- assistant row 有真实回答。
- 回答只出现一次。
- 完成标签文案正确。
- 点击完成标签后 timeline 非空。
- 搜索来源数量出现且位置正确。
- reasoning 和 answer 顺序正确。
- 刷新历史后仍正确。
- 对图片工具，before/after 视觉位置和像素尺寸一致。

### 5.2 不好的 E2E 断言

- 只检查 HTTP 200。
- 只检查页面 body 包含某个文本。
- 不区分 assistant row、overlay、历史消息、隐藏文本。
- 用固定 sleep 等待 provider 完成，而不是等待稳定 DOM/网络条件。
- 对长耗时模型设置过短 timeout，然后误判为前端 bug。
- 只测 mock，不测真实 API。

---

## 6. 提交与报告标准

### 6.1 提交前检查

```bash
git status --short
git diff --stat
git diff --check
```

如果工作区有无关 WIP：

- 不要 `git add .`。
- 使用精确 pathspec 暂存本次相关文件。
- 如果无法安全区分，暂不提交，并在最终报告说明原因。

### 6.2 最终报告格式

建议每次实现后按以下结构汇报：

```markdown
## 已完成
- ...

## 关键改动
- `path/to/file.ts`: ...
- `path/to/component.tsx`: ...

## 已验证
- `npm run ...` passed
- `npx tsc --noEmit --pretty false` passed
- `NEXT_PRIVATE_BUILD_WORKER=1 npm run build` passed
- 真实 GPT E2E passed: ...
- 真实 DeepSeek 搜索/推理 E2E passed: ...

## 用户不变量
- 回答不重复
- 完成标签正确
- timeline 非空
- 刷新后仍正确

## 注意事项
- 是否有既有 WIP
- 是否已提交
- 如果未提交，原因是什么
```

---

## 7. 推荐执行流程

后续 AI Space 功能实现建议按以下流程：

1. **定位代码和测试入口**
   - 查找相关 hook/helper/API/fixture/script。

2. **确认验证策略**
   - 根据功能风险选择 Node regression、browser fixture、真实 E2E。

3. **小范围实现**
   - 保持改动集中，避免混入无关 WIP。

4. **逐层验证**
   - 纯逻辑 → TypeScript → diff check → browser fixture → build → 真实 E2E。

5. **检查工作区**
   - `git status --short`
   - 区分本次改动和既有 WIP。

6. **提交或说明不提交原因**
   - 可安全暂存时提交。
   - 不安全时不提交，并明确说明。

7. **输出可复查报告**
   - 列命令、结果、真实场景、剩余风险。

---

## 8. 参考案例：chat final status timeline 修复

一次符合本准则的聊天状态修复，应类似以下验证链路：

### 修改目标

- 修复真实 GPT 完成后点击 `生成完成` 标签，timeline 为空。
- 完成态即使 canonical message 没持久化 `statusTimeline`，也能生成 fallback timeline。
- 搜索完成进入 timeline，不抢占最终完成标签。
- `streaming_answer` 统一显示 `正在生成回答`。

### 验证命令

```bash
npm run test:chat-message-status
npm run test:chat-generation-phase
npm run test:chat-initial-realtime
npm run test:streaming
npm run test:chat-task-stream-event-handler
npm run test:chat-main-stream-event-handler
npx tsc --noEmit --pretty false
git diff --check
NEXT_PRIVATE_BUILD_WORKER=1 npm run build
CHAT_FIXTURE_BASE_URL=http://127.0.0.1:3000 npm run test:chat-streaming-state-fixture
```

### 真实 GPT E2E

```bash
REAL_CHAT_MODEL=gpt-5.5 \
REAL_CHAT_SEARCH=0 \
REAL_CHAT_REASONING=0 \
REAL_CHAT_EXPECT_TIMELINE='正在等待模型响应|正在生成回答' \
npm run test:chat-real-live-send-e2e
```

通过标准：

```json
{
  "model": "gpt-5.5",
  "searchEnabled": false,
  "reasoningEnabled": false,
  "answerMatches": 1,
  "completedBadgeText": "生成完成 · 用时 5秒",
  "timelineTextLength": 36
}
```

### 真实 DeepSeek 搜索/推理 E2E

```bash
REAL_CHAT_MODEL=deepseek-v4-pro \
REAL_CHAT_SEARCH=1 \
REAL_CHAT_REASONING=1 \
REAL_CHAT_EXPECT_TIMELINE='正在等待模型响应|联网搜索完成|引用|正在生成回答' \
npm run test:chat-real-live-send-e2e
```

通过标准：

```json
{
  "model": "deepseek-v4-pro",
  "searchEnabled": true,
  "reasoningEnabled": true,
  "answerMatches": 1,
  "completedBadgeText": "生成完成 · 用时 20秒",
  "timelineTextLength": 68
}
```

用户不变量：

- GPT 无搜索场景完成后也有 timeline。
- DeepSeek 搜索/推理场景最终标签仍是 `生成完成 · 用时 X秒`。
- 搜索完成和引用来源进入 timeline。
- 回答只出现一次。
- 不出现假失败或空流程。

---

## 9. 一句话总结

AI Space 的功能完成标准是：

> 代码实现只是第一步；必须用代码级回归、真实浏览器 fixture、真实页面 E2E、真实 provider/API 场景和生产构建共同证明用户关心的不变量没有被破坏，才算完成。
