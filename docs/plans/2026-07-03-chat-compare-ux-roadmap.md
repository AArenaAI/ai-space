# Chat / Compare 用户体验稳定性路线图

> **来源:** 2026-07-03 用户粘贴的 Chat/Compare 后续优化清单。
> **目标:** 按“稳定感 → 可控感 → 阅读效率 → 长远架构”推进 Chat / Compare，不再零散修 bug。
> **状态口径:**
> - ✅ 已完成：已有提交、回归或线上验证支撑。
> - 🟡 部分完成：已有基础能力或局部修复，但还未达到目标体验。
> - ⬜ 未完成：尚未系统实现。
>
> **已完成相关提交参考:**
> - `8221aa4 fix(chat): surface search sources across providers`
> - `687902d chore(testnet): stabilize backend startup`
> - `b066ff0 fix(chat): polish activity source display`
> - `c4c0317 test(chat): cover activity entry states`
> - `69f9589 fix(chat): keep sources accessible after failures`
> - `2d6d58e fix(chat): group activity sources by domain`
> - `ca08ca0 fix(chat): clarify expandable source groups`
> - `eba377f fix(chat): clarify failed activity source state`

---

## 总览

| 优先级 | 主题 | 状态 | 说明 |
|---|---|---:|---|
| P1 | 发送后的稳定感 | 🟡 | 已补 live jitter/旧行稳定 probe；当前 3 轮 testnet 验证无旧行 remount/高度/文本变化；富文本完成态已统一到 stable token/block 渲染，常用 Markdown + 数学/脚注/Mermaid 已覆盖，当前重点转向“完成后二次刷新”与更强 stress probe。 |
| P2 | 模型选择与 Compare 可控感 | ✅ | Compare 模型持久化已静默 PATCH 当前会话，并有 testnet live 回归覆盖刷新与新一轮 payload。 |
| P3 | 阅读效率 | 🟡 | Compare 双列与 Activity 来源已显著改善；长 Markdown 常用结构、数学、脚注、Mermaid 已覆盖；移动端/滚动定位/长消息操作栏仍需继续。 |
| P4 | 侧栏/历史体验 | 🟡 | “发送后会话移动到今天”等已修，hook 化未做。 |
| P5 | 长期状态架构 | 🟡 | Markdown 渲染长期主干已落地为 `StableMarkdownRenderer`；ConversationRuntimeStore / stream ownership / merge 版本机制仍是长期工作。 |

---

## 优先级 1：发送后的稳定感

### 1. 彻底压掉“旧消息刷新感”

**状态:** ✅ 主要稳定性已用 5 轮 mixed rich live stress 覆盖，长期 identity 仍归入 P5

**附件目标:**

> 用户发新消息时，旧消息完全像静态文档，不闪、不重排、不刷新。

**已完成:**

- 已修过一处 `onOpenActivity` 导致的旧行重渲染问题。
- Chat Activity 入口和面板逻辑已收敛到更稳定的单入口路径。
- 已有 `chat-placeholder-jitter-live.cjs` 覆盖旧行 DOM node、height、text、duplicate id、latest assistant id、pending 高度跳变。
- 2026-07-03 testnet 3 轮连续发送验证通过：无旧行 remount、无旧行高度变化、无旧行文本变化、无重复 id；pending/content 跳变在阈值内。
- 2026-07-03 新增 `npm run test:chat-old-row-rich-stability-live`，真实 testnet 5 轮 mixed rich stress 已通过：短答、长 Markdown、代码/表格、数学/Mermaid、切会话返回全覆盖；旧消息 `oldNodeUidChanges=0`、`oldHeightChanges=0`、`oldTextChanges=0`、`completedStableChangeCount=0`、`dupIds=[]`。

**未完成 / 长期项:**

- 给旧消息对象做更强的 identity preservation。
- restore/bootstrap 只 patch 当前 active/pending assistant，避免全量 remap 旧 messages。
- 这些不再阻塞 P1 体验验收，归入 P5 `ConversationRuntimeStore / mergeConversationSnapshot` 长期状态架构。

**补充优化项:**

- 给旧消息行增加可测试的稳定签名：`data-message-stability-key`。
- 在 live probe 里记录：
  - old row DOM node 是否被替换；
  - old row textContent 是否变化；
  - old row height 是否变化；
  - old row React key 是否变化。
- 把 old row 允许变化的字段列白名单，例如只允许 hover/action 状态变化，不允许正文和布局变化。

**建议验证命令:**

```bash
npm run test:chat-placeholder-jitter-live
# 或新增：npm run test:chat-old-row-stability-live
```

---

### 2. Pending / 思考占位高度稳定

**状态:** 🟡 已有 probe 监控，暂未发现超阈值问题

**附件目标:**

> 点发送后，回答区域平滑出现，不“蹦一下”。

**已知问题 / 当前验证:**

- placeholder 初始高度可能 `216 → 180`。
- 空占位到 reasoning token 有时会跳。
- 当前 testnet `chat-placeholder-jitter-live` 3 轮结果：placeholder → content 最大跳变 25px，低于 32px 阈值；latest assistant 最大高度变化 41px，属于内容自然增长，低于 96px 阈值。

**待做:**

- 固定 assistant pending row 首帧高度。
- `AssistantMessageMeta`、model/status slot 预留稳定高度。
- reasoning 开始前后保持布局一致。
- Compare 两列 pending 高度一致。

> 这项先不做无证据重构；后续 probe 出现超阈值再引入统一 `AssistantPendingShell`。

**补充优化项:**

- 给普通 Chat 和 Compare pending 使用同一个 `AssistantPendingShell`。
- pending shell 内部固定三段高度：模型/meta 区、状态区、内容占位区。
- 对 reasoning 首 token 前后做高度快照回归。
- Compare 场景下左右列 pending 行使用相同 min-height，但允许内容增长。

**建议新增回归:**

```bash
npm run test:chat-pending-height-fixture
npm run test:chat-placeholder-jitter-live
```

---

### 3. Stop / resume / route switch 的视觉一致性

**状态:** 🟡 部分完成

**附件目标:**

> 用户切来切去不会感觉“这个会话状态乱了”。

**已完成:**

- stream ownership 已经比之前稳定。
- 相关 live 脚本已有基础：active task resume、interrupt resume、stop button 多会话切换等。

**未完成:**

- 发送中切会话再回来时的视觉一致性专项验证。
- Stop 后状态是否稳定的 UX 级验证。
- 后台任务恢复时是否重复显示 pending。
- Compare 一列完成、一列还在跑时，按钮状态是否明确。

**补充优化项:**

- 给每个 active generation 显示明确状态：`生成中 / 已停止 / 后台继续 / 可恢复`。
- Compare 一列完成一列生成时，顶部按钮文案区分：
  - `停止全部`
  - `左列已完成，右列生成中`
- 恢复后台任务时避免新增重复 assistant placeholder，必须复用 serverMessageId / taskId。

---

### 4. 富文本完成态稳定渲染长期方案

**状态:** ✅ 长期主干与高级 Markdown 覆盖已落地，继续压“完成后二次刷新”

**目标:**

> 落字即最终结果；回复完成后不整条刷新；旧消息读取时不因富文本 hydrate 出现高度/文本/DOM 跳动。

**已完成:**

- 新增统一入口 `StableMarkdownRenderer`，覆盖：
  - `streaming`
  - `settling`
  - `completed-visible`
  - `historical`
- `StreamingMarkdownView` 已改为只转发到 `StableMarkdownRenderer`，不再自己决定 plain / token / rich。
- 历史 / final message Markdown 入口已改为走 `StableMarkdownRenderer`，不再默认直接进入 full-message `MarkdownRenderer`。
- 策略边界已固定：

```txt
streaming:
  长/复杂内容允许 plain，降低流式阶段抖动

settling / completed-visible / historical:
  默认 token/block renderer，必须正常渲染 **粗体**、[链接](url)、列表、代码块、表格

rich-deferred:
  只能显式 policy 开启，不作为普通历史/完成态默认路径
```

- `MarkdownBlockTokenRenderer` 已给块级结构打稳定标记：

```txt
data-md-block-id
data-md-block-type
```

覆盖：

```txt
heading / paragraph / blockquote / list / code / table / hr / html
```

- 针对截图中 `**加粗**`、`[链接](url)` 原样显示的问题，已修正为：只有真正 `streaming` 阶段才允许 plain；完成后立即进入 token/block 渲染。
- 列表项内 block-level `text` / `escape` token 已按 paragraph 解析，修复历史消息列表内 `**粗体**`、`[链接](url)` 原样泄漏。
- 长 Markdown 覆盖回归已补齐并验证：标题、段落、粗体、斜体、删除线、行内代码、链接、无序/有序/任务列表、引用块、表格、代码块、分割线。
- 高级 Markdown 已按 block-local 渐进增强落地：
  - `$...$` 行内数学：KaTeX 渲染。
  - `$$...$$` 块级数学：KaTeX display 渲染，`data-md-block-type="math"` + `data-md-enhance-policy="block-local"`。
  - `[^note]` 脚注引用 / 定义：稳定 token 渲染，正文不再泄漏原始脚注语法。
  - `mermaid` 代码块：局部 Mermaid SVG 渲染，不走整条消息 hydrate。
  - HTML 与图片仍待定：HTML 保持安全降级，图片暂不富渲染。

**不可回退规则:**

1. 不允许为了“恢复富文本”把 completed/historical 默认切回整条 `MarkdownRenderer` hydrate。
2. 不允许让 `completed-visible` 使用 plain fallback；plain 只属于真正 streaming 阶段。
3. 不允许用消息级 remount 解决代码块/表格/公式渲染；后续增强必须在 `data-md-block-id` 容器内做局部升级。
4. 历史消息默认保持 token/block stable；full rich 只能作为明确、延迟、可中断、受用户滚动窗口保护的 policy。

**已验证:**

```bash
npm run build
npm run test:chat-compare-unboxed-style
npm run test:chat-compare-model-selection
npm run test:chat-placeholder-jitter-live
npm run test:chat-old-row-stability-live
npm run test:chat-rich-markdown-stability-live
npm run test:chat-markdown-token-fixture
npm run test:chat-markdown-coverage-fixture
```

额外 DOM 验证：

```txt
**美国经济** -> <strong>
[BEA](https://www.bea.gov) -> <a href="https://www.bea.gov">
hasRawStrong: false
hasRawMarkdownLink: false
stablePolicy: token
tokenMode: stable
```

**下一阶段:**

- 完成后二次刷新专项：采样 `streaming → settling → completed-visible → historical/hydrated` 的 DOM node、height、tokenMode、stable phase，确认完成后不再切换可见正文层。
- block-level progressive enhancement 继续收敛：
  - code block：保留稳定 block 容器内 copy / highlight；不替换整条消息。
  - table：稳定 block 容器内横向滚动 / sticky header；不替换整条消息。
  - math / Mermaid：已局部增强，后续只补样式和失败降级，不做消息级 hydrate。
- block anchor：历史加载 / prepend / hydrate 时以 `messageId + data-md-block-id + offset` 恢复阅读位置。
- 将 `AssistantAnswerRenderer` 继续收敛成显式 reducer/state machine，避免状态分支重新散落。

---

## 优先级 2：模型选择与 Compare 可控感

### 4. 模型选择要有明确“当前生效范围”

**状态:** 🟡 部分完成；Compare 显式 `下一轮 / 本轮` 标签不做

**附件目标:**

- 普通 Chat 模型选择旁可提示：`用于下一条消息`。
- Compare 顶部不增加 `下一轮` 显式标签：当前认为冗余，避免视觉噪音。
- 历史回答仍显示当时生成模型。

**已完成:**

- 模型选择失效的根因之前已修过一部分。
- 历史回答已有模型展示基础。

**未完成:**

- 普通 Chat 选择器旁的轻提示。
- Compare 不做顶部“下一轮模型”和历史 group“本轮模型”显式标签；只保留实际模型展示与持久化语义。

**补充优化项:**

- 模型选择器 hover tooltip 可作为低干扰解释：
  - 普通 Chat：`只影响下一条消息，不改变历史回答`。
  - Compare：`只影响下一次对比，历史列保留实际生成模型`。
- 如果当前会话内 active generation 正在跑，模型选择器文案改为：`下一条生效`，避免用户以为会影响正在生成的回答。
- 明确不做 Compare 顶部 `下一轮` / 历史 `本轮` 常驻标签，避免冗余。

---

### 5. Compare 模型选择需要保存到当前会话

**状态:** ✅ 已实现并有 live 回归

**附件目标:**

> 刷新页面、切会话回来，Compare 模型仍是刚才选的。

**已完成:**

- 用户在 Compare 会话顶部改模型后，立即 PATCH 当前 conversation：
  - `compare_models`
- 侧栏 / 恢复 / 刷新后保持一致。
- 静默保存：成功不提示，失败也不打扰用户；保留当前本地 UI 状态，后台尽力 PATCH。
- PATCH 防抖 300ms，避免快速连点模型频繁请求。
- 新增 `chat-compare-model-persistence-live.cjs`：真实 testnet 创建 Compare 会话 → UI 切换模型 → 后端确认 `compare_models` → 刷新确认 header 保留 → 新发一轮确认 payload 使用新模型。

**补充优化项:**

- 不做保存状态轻提示：模型选择是体验增强，应静默持久化，避免额外通知打扰用户。
- conversation restore 时优先 server `compare_models`，localStorage 只作为 fallback。

**建议回归:**

```bash
npm run test:chat-compare-model-persistence-live
```

验证：

1. 打开 Compare 会话。
2. 切换顶部模型。
3. 刷新页面。
4. 确认顶部模型仍是新值。
5. 新发一轮 payload 使用新模型。

---

### 6. Compare 历史 group 与当前模型分离展示

**状态:** 🟡 部分完成；`下一轮` / `本轮` 冗余标签不做

**附件目标:**

- 顶部固定栏：当前选择的 Compare 模型，实际影响下一次发送。
- 每个历史回答 group：显示当时实际生成模型。
- 切顶部模型不影响旧 group。
- 新发一轮后，新 group 使用顶部模型。

**已完成:**

- 代码已经朝“历史实际模型”和“下一轮模型”分离方向走。

**未完成:**

- 不再追加 `下一轮` / `本轮` 极简标识：用户认为冗余，容易增加视觉噪音。
- 仍需保证数据语义正确：切顶部模型不改旧 group，新发一轮使用当前顶部模型。

**补充优化项:**

- 不做顶部 `下一轮`、历史 `本轮`、`历史模型` 等常驻标签。
- 保留更低干扰方案：必要时仅在模型选择器 hover tooltip 解释生效范围。

---

## 优先级 3：阅读效率

### 7. Compare 双列阅读体验继续优化

**状态:** 🟡 部分完成

**附件目标:**

> Compare 是“并排阅读工具”，不是两个窄聊天框。

**已完成:**

- Compare 双列方向已改为：外层历史滚动 + 列内答案独立滚动。
- Activity inline / split 双列均已回归通过。
- Compare 来源 Activity ownership 已明确到左列 / 右列。

**未完成:**

- 两列高度差很大时，短列不要空得太突兀。
- 列内滚动条 / 阴影提示更自然。
- 当前 active column 更明确。
- 长回答底部操作不要被列内滚动遮住。
- 移动端 Compare 降级为 tab 或上下卡片。

**补充优化项:**

- 列内滚动到底部时显示底部操作栏 sticky。
- 短列可显示轻量占位：`本列回答较短`，但不要抢眼。
- 移动端断点下：
  - 优先 tab 切模型；
  - 保留横向切换，而不是硬塞双列。

---

### 8. Activity / 思考与来源入口继续减噪

**状态:** ✅ 大部分已完成

**附件目标:**

- 普通 Chat：只保留一个自然入口。
- 来源 / 思考 / 工具都进 Activity。
- Compare：每列只一个入口。
- 不重复出现 `思考与来源 ›`、`已思考 ›`、`来源 ›` 三个箭头。
- Activity 面板默认不要抢空间。
- Compare Activity ownership 必须明确属于左 / 右哪列。

**已完成:**

- 无思考但有来源：显示弱入口 `来源 · N`。
- 有思考：使用 `已思考 · Xs` 入口。
- 失败但有来源：仍显示 `来源 · N`。
- Activity 面板来源 / 思考统一承载。
- Gemini grounding redirect 显示真实域名。
- 来源按域名聚合。
- 聚合卡有 `展开` 提示。
- 失败态 Activity 文案：`模型生成失败` + `搜索完成 · N 个来源`。
- Compare inline / split 来源回归通过。
- 新增总回归命令：

```bash
npm run test:chat-activity-sources
```

**仍可优化:**

- 工具调用、文件检索与网页来源的 Activity 入口文案还可以统一。
- 聚合卡展开状态目前未持久化，切开关或重开面板会恢复默认。
- 对 Gemini 12+ 来源可考虑“默认只展示前 N 个域名 + 查看全部”。

---

### 9. 长消息性能和阅读定位

**状态:** 🟡 部分完成，block anchor 第一版已落地

**附件目标:**

> 长会话像读文档一样稳，不像网页一直在重排。

**已完成:**

- 已有 lazy markdown、content visibility、overview 等基础能力。
- 已新增会话滚动 block anchor：保存 `anchorMessageId + anchorBlockId + anchorOffset`，切会话返回时优先按 `data-md-block-id` 恢复阅读位置，失败再回退 `distanceToBottom / scrollTop`。
- 新增 live 回归命令：`npm run test:chat-block-anchor-restore-live`。

**未完成:**

- 大 markdown 渲染分级：首屏 plain/light，进入视口再 rich。
- 代码块 / table 单独延迟 hydrate。
- 回到某条消息时高亮稳定，避免二次跳动。
- 加载历史 prepend 后 scrollTop 锚定继续强化。

**补充优化项:**

- 给代码块和表格增加独立 IntersectionObserver hydration。
- 对超过阈值的 assistant message 先渲染轻量 markdown，再 idle hydrate rich renderer。
- scroll restore 加入“目标 message id + offset within message”而不是只保存 scrollTop。

---

## 优先级 4：侧栏 / 历史体验

### 10. 抽 `useChatSidebarHistory()`

**状态:** ✅ 已完成适配层，后续只补专项 fixture

**附件目标:**

统一桌面 `AppSidebar` 和移动 `MobileNav` 的历史列表逻辑。

**已完成:**

- 已抽出 `frontend/hooks/useChatSidebarHistory.ts`。
- 桌面 `AppSidebar` 和移动 `MobileNav` 已共用该 hook。
- 已统一管理：
  - bootstrap merge
  - canonical fetch
  - cursor pagination
  - conversation-updated event
  - optimistic reorder
  - workspace filter
  - loading more

**待做:**

- 为 hook 写 fixture 测试：bootstrap + event + cursor + optimistic reorder。

**补充优化项:**

- hook 输出稳定 API：

```ts
const {
  conversations,
  activeConversationId,
  loading,
  loadMore,
  renameConversation,
  deleteConversation,
  pinConversation,
} = useChatSidebarHistory(...)
```

- 桌面和移动只负责展示，不再各自管理 merge 逻辑。
- 为 hook 写 fixture 测试：bootstrap + event + cursor + optimistic reorder。

---

### 11. 侧栏实时状态更清晰

**状态:** 🟡 部分完成

**已完成:**

- 发送后会话移动到今天已修。

**未完成:**

- 新生成会话立即在侧栏出现 skeleton / title。
- 标题生成后平滑替换。
- 当前 active conversation 始终高亮。
- 加载更多历史不造成当前列表重排。
- 删除 / 重命名 / 置顶走同一 optimistic pipeline。

**补充优化项:**

- 新会话 optimistic item 使用稳定 client id，服务端 id 返回后原地替换。
- 标题生成中显示弱 skeleton，不移动列表位置。
- active conversation 高亮应基于 canonical id + temporary id 映射。

---

## 优先级 5：长期状态架构

### 12. Chat runtime state 收成单一 store

**状态:** ⬜ 未完成

**附件目标:**

```ts
ConversationRuntimeStore
```

按 conversationId 管：

- messages
- generation tasks
- active streams
- pending optimistic messages
- compare models
- activity target
- scroll state
- restore freshness / version

**核心原则:**

> 所有状态都带 conversationId，不允许全局状态裸奔。

**补充优化项:**

- store 内部以 conversationId 为一级 key。
- 所有 async response merge 前必须校验 owner：conversationId + taskId + serverMessageId。
- UI hook 只订阅当前 conversation slice，减少全局重渲染。
- 先做 adapter 层，不一次性大重构。

---

### 13. Stream ownership 正式化

**状态:** 🟡 部分完成

**已完成:**

- 现有 refs / abort 已经减少了串流串状态问题。

**未完成:**

- 明确 owner model：

```ts
generationTaskId -> streamOwner
serverMessageId -> streamOwner
conversationId -> activeStreams
```

规则：

- 同 task 只能一个 owner。
- 新 owner 接管旧 owner 必须 abort。
- 被 abort 的 finally 不能 final sync。
- sequence dedupe 是 task/message 级别，不是单个 stream handler 私有。

**补充优化项:**

- 加 `StreamOwnerRegistry`，集中处理 register / abort / finalize。
- 所有 stream finally 都走 `registry.canFinalize(owner)`。
- live 回归覆盖：切会话、stop、resume、compare 双列并发。

---

### 14. Restore / bootstrap 版本机制更硬

**状态:** 🟡 部分完成

**已完成:**

- 已有 snapshot_version、updatedAt 等概念。

**未完成:**

统一比较规则：

- local optimistic > bootstrap stale
- active stream > restore snapshot
- newer sequence > older sequence
- completed terminal > running stale
- user route current conversation > stale request result

**补充优化项:**

- 做统一 `mergeConversationSnapshot(local, remote, context)`。
- 输出 merge decision reason，方便调试：

```ts
{ accepted: false, reason: 'remote_snapshot_older_than_active_stream' }
```

- 加 fixture 覆盖 bootstrap / restore / stream / optimistic 的冲突组合。

---

## 建议下一轮执行顺序

### 第一轮：P3 Activity / 来源入口继续减噪

**状态:** 🟡 当前优先执行

任务：

1. 聚合卡展开状态在当前面板生命周期内记忆。✅
2. 来源域名过多时，默认只展示前 N 个域名，支持“显示全部 / 收起”。✅
3. 工具调用、文件检索、网页来源统一入口文案和视觉层级。✅
4. 保持普通 Chat 一个入口、Compare 每列一个入口，不新增冗余箭头。✅

**原因:** 来源是高频阅读入口，优化应以“少打扰、可展开、可回到原状态”为主。

---

### 第二轮：P3 长消息性能和阅读定位

**状态:** 🟡 当前优先执行

任务：

1. 继续强化 block anchor：overview 点击后写入 block anchor；prepend / restore / hydrate 后不二次跳。
2. 长 Markdown 的代码块 / 表格做块级增强，不替换整条消息。
3. 回到某条消息时提供轻量稳定高亮，帮助用户确认定位。
4. 长回答底部操作不要被列内滚动遮住。

**原因:** 目标是“像读文档一样稳”，优先做用户可感知的阅读定位和长内容操作体验。

---

### 已完成 / 不再作为下一轮主任务

- ✅ P1 发送 / 停止 / 恢复视觉一致性：pending shell、Compare loading 稳定高度、P1 state consistency live probe 已完成。
- ✅ Compare 模型持久化：已静默 PATCH 当前会话，并有 live 回归覆盖刷新与新一轮 payload。
- ✅ 视觉稳定 live probe：已新增 5 轮 mixed rich old-row stability stress，覆盖旧消息 DOM/height/text/remount。
- ✅ Sidebar hook 化：`useChatSidebarHistory()` 已抽出，桌面 / 移动已共用；剩余是 fixture 测试与 optimistic pipeline。
- ✅ block anchor 第一版：已支持 `anchorMessageId + anchorBlockId + anchorOffset` 恢复阅读位置。
- ⏬ Compare 移动端体验：按用户要求优先级排到最后，暂不混入 P3 桌面阅读体验。

---

## 额外补充项

### A. Activity 来源体验继续补强

**状态:** 🟡 可选优化

- 聚合卡展开状态可在当前面板生命周期内记忆。
- 来源域名过多时，支持“显示全部 / 收起”。
- 对文件来源、网页来源、工具来源统一视觉层级。

### B. Chat Activity 总回归纳入 CI / 手工 checklist

**状态:** 🟡 可选优化

当前已拆分：

```bash
npm run test:chat-activity-sources:fixture
npm run test:chat-activity-sources:live
npm run test:chat-activity-sources
```

普通本地开发跑 fixture；发布前再跑 live 聚合，避免每次开发都打真实模型。

### C. WebUI / testnet 部署前检查固定化

**状态:** 🟡 可选优化

本轮多次验证了：

```bash
curl http://127.0.0.1:9091/health
npm run build
npm run test:chat-activity-sources
```

建议写成轻量发布 checklist，避免以后漏检 testnet 后端是否脚本托管、是否 PPID=1。

---

## 当前未完成但不应混入本计划的 WIP

这些属于其它产品线，不建议混进 Chat / Compare 体验计划：

- 高考志愿主线：`backend/internal/api/gaokao.go`、`backend/internal/services/gaokao*.go`、`frontend/app/(main)/(work)/gaokao-volunteer/`、导入脚本等。
- 图片服务实验：`backend/internal/api/image.go`、`backend/internal/services/image_service.go`。
- Admin token 修复：`frontend/app/admin/beta-*.tsx`。

建议单独拆 plan / commit。
