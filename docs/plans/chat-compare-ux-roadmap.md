# Chat / Compare 用户体验稳定性路线图

> **来源:** 2026-07-03 用户粘贴的 Chat/Compare 后续优化清单。
> **目标:** 按“稳定感 → 可控感 → 阅读效率 → 长远架构”推进 Chat / Compare，不再零散修 bug。
> **文档定位:** 本文件是路线图；回测标准放在 `docs/testing/`；具体实施方案放在 `docs/plans/*-plan.md`。
> **最近更新:** 2026-07-07，根据用户消息二次编辑（普通 Chat、截断后续并重新生成）实现与验证结果刷新状态。
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
> - `66aaa1a fix(chat): preserve composer state and simplify pending UI`
> - `9f420c2 test(chat): update compare activity live regression`
> - `5898260 test(chat): harden live regression auth and cleanup`
> - `63b51a2 test(chat): add live smoke suite and cleanup helpers`
> - `f9c912b feat(chat): highlight exact message jumps and lock block markdown`
> - `f442cb7 feat(chat): support block-level jump anchors`
> - `4c759e7 feat(chat): keep compare actions reachable`
> - `233c3c7 feat(chat): allow editing user messages`

---

## 总览

| 优先级 | 主题 | 状态 | 说明 |
|---|---|---:|---|
| P1 | 发送后的稳定感 | ✅ | accepted-send contract、pending 单灰点、Stop/switch/reload、真实完整回复、真实 Compare、`test:chat-live-full` 均已通过；长期 identity/merge 问题归入 P5。 |
| P2 | 模型选择与 Compare 可控感 | ✅ | Compare 模型持久化、当前 DOM marker、真实 Compare 双列 Activity inline/split 均有 live 回归覆盖。 |
| P3 | 阅读效率 | ✅/🟡 | 桌面 Chat/Compare 阅读定位主线已完成：message 精确回跳、block-level jump、高亮、code/table block-local 回归、Compare 长回答 action 可达；移动端 Compare 与收藏片段仍后置。 |
| P4 | 侧栏/历史体验 | ✅ | `useChatSidebarHistory` 已抽出并补齐 optimistic pipeline：新会话 temp→canonical 原地替换、标题弱 pending、active 高亮连续、rename/delete/pin 统一更新、load-more 锚点保护与 fixture 覆盖。 |
| P5 | 长期状态架构 | ✅/🟡 | Runtime 基础与 adapter 写入主线已完成：ConversationRuntimeStore、StreamOwnerRegistry、mergeConversationSnapshot、create/restore/send/main/task/poll/generation controls/lifecycle/local actions/top-level resume-stop 均已同步 runtime store，并有 architecture/runtime/live 回归；后续只剩更大范围的 UI 读路径订阅 store（不再属于 adapter 收口）。 |
| P6 | 用户消息二次编辑 | ✅/🟡 | 普通 Chat user message 已支持编辑：后端 PATCH 持久化、截断后续、复用 `skip_save_user_msg + user_message_id` 重新生成、runtime store 同步与 fixture 覆盖；Compare/附件替换/生成中编辑后置。 |

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

**状态:** ✅ 已收敛为普通 Chat / Compare 共用的轻量 pending shell，并通过 live 回归

**附件目标:**

> 点发送后，回答区域平滑出现，不“蹦一下”。

**当前验证:**

- `AssistantPendingShell` 已收敛为单个中性灰呼吸点：无 spinner、无“正在生成/思考中/后台保持进度”、无卡片/骨架。
- 普通 Chat、Compare、Activity fixture 均覆盖 `data-chat-pending-dot-core="true"`。
- `test:chat-live-full` 中 P1 state consistency live 验证 pending 高度稳定为 26px，`duplicateIds=[]`，Stop 后 pending/spinner 清零。

**长期项:**

- 若后续 stress probe 再出现首 token 高度跳变，再补专门的 pending-height fixture；当前不再作为下一轮主任务。

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

**状态:** ✅ P1 live 回归已覆盖真实发送、切会话、切回、Stop、reload 和 cleanup

**附件目标:**

> 用户切来切去不会感觉“这个会话状态乱了”。

**已完成:**

- `test:chat-p1-state-consistency-live` 已覆盖真实 UI 发送、早期采样、切到 B、切回 A、多阶段采样、Stop、reload。
- `test:chat-live-full` 已串联 dynamic shell、真实完整 Chat、真实 Compare、P1 状态一致性，并默认清理临时会话。
- 已验证：无重复 id、pending 高度稳定、Stop 后 stop button 清零、active tasks 为空、reload 后中断态稳定。

**长期项:**

- Compare 一列完成一列生成时的按钮文案仍可作为后续体验优化，但不阻塞当前 P1 验收。

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
npm run test:chat-old-row-rich-stability-live
npm run test:chat-markdown-token-fixture
npm run test:chat-markdown-coverage-fixture
npm run test:chat-markdown-code-fixture
npm run test:chat-compare-column-scroll-fixture
npm run test:chat-message-overview-fixture
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

**状态:** ✅ 桌面长回答可达性已完成；移动端降级后置

**附件目标:**

> Compare 是“并排阅读工具”，不是两个窄聊天框。

**已完成:**

- Compare 双列方向已改为：外层历史滚动 + 列内答案独立滚动。
- Activity inline / split 双列均已回归通过。
- Compare 来源 Activity ownership 已明确到左列 / 右列。
- Compare 长回答列内滚动时，操作栏保持 sticky / 可见：当列可滚且不在底部时自动显现，短回答和普通 Chat 不变。
- `npm run test:chat-compare-column-scroll-fixture` 已覆盖右半区列内滚动、左半区页面滚动、scrollTop 恢复、阴影、action row sticky/visible/position。

**未完成:**

- 两列高度差很大时，短列不要空得太突兀。
- 列内滚动条 / 阴影提示更自然。
- 当前 active column 更明确。
- 移动端 Compare 降级为 tab 或上下卡片。

**补充优化项:**

- 列内长回答 action row 已 sticky；后续只做视觉微调，不再作为阻塞项。
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

**状态:** ✅ 桌面定位主线已完成；真实搜索 block 来源产品化后置

**附件目标:**

> 长会话像读文档一样稳，不像网页一直在重排。

**已完成:**

- 已有 lazy markdown、content visibility、overview 等基础能力。
- 已新增会话滚动 block anchor：保存 `anchorMessageId + anchorBlockId + anchorOffset`，切会话返回时优先按 `data-md-block-id` 恢复阅读位置，失败再回退 `distanceToBottom / scrollTop`。
- 新增 live 回归命令：`npm run test:chat-block-anchor-restore-live`。
- 搜索 / 收藏 / overview 回跳已统一到具体 `message`，assistant 命中时高亮精确 assistant 行而不是只高亮 paired user。
- URL 已支持 `block` 参数：`/chat?id=...&message=...&block=...`，MessageList 会优先定位 `data-md-block-id`，找不到 block 时回退到 message row。
- 目标 block 使用轻量 `data-md-anchor-restored="true"` transient highlight，不 remount Markdown。
- `MarkdownBlockTokenRenderer` 已锁定 code/table/math/Mermaid 的 `data-md-enhance-policy="block-local"`；table 补 `data-testid="markdown-table-block"`，回归覆盖 sticky header 与 block-local policy。
- `npm run test:chat-message-overview-fixture` 覆盖 message jump、assistant exact target、block target、overview hidden cases。
- `npm run test:chat-markdown-coverage-fixture` 覆盖 table/code/math/Mermaid block-local 与 raw leak。

**未完成:**

- 大 markdown 渲染分级：首屏 plain/light，进入视口再 rich。
- 加载历史 prepend 后 scrollTop 锚定继续强化。
- 真实搜索结果如果提供 `matched_block_id`，前端可把它接到 `block` 参数；当前能力已就绪但搜索索引来源未产品化。

**补充优化项:**

- 给代码块和表格增加独立 IntersectionObserver hydration 可作为后续性能优化；当前先确保 block-local 增强不替换整条消息。
- 对超过阈值的 assistant message 先渲染轻量 markdown，再 idle hydrate rich renderer。
- scroll restore 加入“目标 message id + offset within message”而不是只保存 scrollTop。

---

## 优先级 4：侧栏 / 历史体验

### 10. 抽 `useChatSidebarHistory()`

**状态:** ✅ 已完成并补专项 fixture

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

**已验证:**

- `npm run test:chat-sidebar-history-hook` 覆盖静态约束与行为 reducer：bootstrap/event/cursor/optimistic reorder、temp→canonical 原地替换、pin patch reorder、remove cleanup。

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

**状态:** ✅ 已完成主线

**已完成:**

- 发送后会话移动到今天已修。
- 新生成会话在创建请求发出前插入本地 temp row，显示弱 `title_pending` 状态。
- 服务端 id 返回后按 `client_temp_id` 原地替换为 canonical row，避免重复项和跳位。
- 当前 active conversation 高亮兼容 temp id / canonical id，创建期间不丢高亮。
- `loadMoreConversations` 继续使用 `captureAnchor` / `restoreAnchor` 保护侧栏滚动锚点。
- 删除 / 重命名 / 置顶统一通过 `patchConversation` / `removeConversation` / `applyConversationActivity` optimistic pipeline。
- 创建失败会发 `conversation-deleted` 清理临时 row。

**后续仅可选微调:**

- 标题 pending 的视觉强弱可按实际反馈微调；当前使用低干扰 `text-text-tertiary animate-pulse`。

**补充优化项:**

- 新会话 optimistic item 使用稳定 client id，服务端 id 返回后原地替换。
- 标题生成中显示弱 skeleton，不移动列表位置。
- active conversation 高亮应基于 canonical id + temporary id 映射。

---

## 优先级 5：长期状态架构

### 12. Chat runtime state 收成单一 store

**状态:** ✅/🟡 adapter 写入主线已完成，后续只剩 UI 读路径订阅 store

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

**已完成第一包:**

- 新增 `frontend/lib/chatRuntimeStore.ts`，提供 conversationId 分片的 runtime store，覆盖 messages、generationTasks、activeStreams、pendingOptimisticMessages、compareModels、activityTarget、scrollState。
- 新增 `frontend/lib/chatRuntime.ts` 统一导出全局 `chatRuntimeStore`。
- `useChatConversationCreateRuntime` 已低风险接入：创建请求发出前写入 temp runtime conversation，服务端 id 返回后删除 temp 并设置 canonical active conversation；失败时清理 temp。
- 新增 `npm run test:chat-runtime-state-architecture` 并纳入 `test:chat-runtime`。

**已完成 adapter 收口:**

- `useChatConversationRestoreRuntime`：memory cache、persistent cache、backend restore/bootstrap 应用后同步 `messages`、`compareModels`、`updatedAt`，并从 active task/pending refs 同步 `activeStreams`、`generationTasks`、`pendingOptimisticMessages`。
- `useChatTaskStreamRuntime` / `useChatMainStreamRuntime` / `useChatBackgroundPollingRuntime`：stream start、active state、message patch、fallback polling、finished/cleanup 都同步 runtime store，且清理只清当前 conversation 的 active metadata。
- `useChatSingleSendRuntime` / `useChatCompareSendRuntime`：发送前 optimistic messages、server-bound assistant、recoverable/error/abort patch、pending optimistic clear、compareModels 均写入 runtime store。
- `useChatGenerationControlsRuntime`：Stop 清 runtime active metadata；Fork/refresh/streaming fork 的 compare messages 与 compareModels 同步 runtime store。
- `useChatConversationLifecycle` / `useChatLocalActions` / top-level `useChat`：active conversation、load-more prepend、clear messages、bootstrap task resume、stop pending local assistants 均同步 runtime store。
- `chat-runtime-state-architecture-regression` 已覆盖 create→send optimistic→main/task/poll→restore/cache 的同一 slice 演进，并用源码锚点锁住各 adapter helper，避免后续重构误删 bridge。

---

### 13. Stream ownership 正式化

**状态:** ✅ owner/finalizer 主线已完成；更广 cache/runtime 写入路径已在 P5 adapter 收口中覆盖

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

**已完成第一包:**

- 新增 `frontend/lib/chatStreamOwnerRegistry.ts`，支持 owner register、replacement abort、`canFinalize(owner)`、stale finalize no-op、conversation-level abort。
- 回归覆盖 replacement owner 不能 finalize、new owner 可以 finalize、conversation abort 清理 owner。

**已完成第三包:**

- `useChatTaskStreamRuntime` 已注册 task stream owner，finally 前必须 `canFinalize(owner)`；stale owner 不再 patch message、不再启动 fallback polling。
- `useChatMainStreamRuntime` 已注册 main stream owner，finally reconciliation 前必须 `canFinalize(owner)`；stale owner 不再 close/reconcile/mark completed。
- `createStopAllTaskStreamsAction` 会按 active task conversation 调用 `abortConversation(convId, "stop")`，避免 owner 残留。
- 回归覆盖：task stale owner、main stale owner、stopAll owner abort、正常 fallback/polling 路径保持不变。

**已完成第四包:**

- `runStopGeneration` 增加 `abortStreamOwners` callback，Stop 时与 task streams/controller abort 同步清 owner。
- `createStopGenerationAction` 接入 `chatStreamOwnerRegistry.abortConversation(currentConversation, "stop")`，覆盖普通 Chat 与 Compare 当前会话级 Stop。
- 回归覆盖：stop coordinator 必须调用 owner abort、generation controls 通过当前 conversation 清理 owner，同时 Compare run/stream/runtime 回归保持通过。

**已完成第五包:**

- `ChatStreamOwner` 增加 `groupId`、`groupIndex`、`groupModels`、`column` metadata。
- `StreamOwnerRegistry` 对带 `groupId + groupIndex` 的 Compare stream 使用 column-level key：同会话同 group 同列替换旧 owner，另一列不受影响。
- `runCompareModels` 在 server-bound assistant 上写入 group metadata，单列 retry / explicit group context 会传给 `streamResponse`。
- `useChatMainStreamRuntime` 注册 owner 时携带 group/column metadata，左列=`groupIndex 0`，右列=`groupIndex 1`。
- 回归覆盖：Compare 左列重试只 retire 左列 owner、不影响右列；main stream owner metadata 完整；single-column explicit retry 保留 group metadata。

---

### 14. Restore / bootstrap 版本机制更硬

**状态:** ✅ restore/bootstrap/cache merge 与 runtime adapter 主线已完成

**已完成:**

- 已有 snapshot_version、updatedAt 等概念。

**已完成规则:**

统一比较规则已由 `mergeConversationSnapshot` / restore merge decision / runtime adapter regression 覆盖：

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

**已完成第一包:**

- 新增 `frontend/lib/chatConversationSnapshotMerge.ts`，输出 `{ accepted, reason, snapshot }`。
- 已覆盖：`remote_conversation_mismatch`、`remote_snapshot_older_than_active_stream`、`local_optimistic_newer_than_bootstrap`、`remote_completed_terminal_wins`、`remote_snapshot_newer`。

**已完成第二包:**

- 新增 `buildConversationRestoreMergeDecision`，把 `ConversationRestoreResponse` 归一为 merge snapshot。
- `useChatConversationRestoreRuntime` 在 backend restore response 应用前先执行 merge decision；拒绝时保留当前 UI/cache，只关闭 loading history。
- 新增 `restore-merge-rejected` performance event，透出 rejected reason，便于后续调试 stale bootstrap/restore。
- 回归覆盖：active stream 拒绝 stale restore、bootstrap 不覆盖 optimistic local、terminal backend status 可替换 running local task、hook 在应用 backend restore state 前调用 decision。

---

## 优先级 6：用户消息二次编辑

### 15. 普通 Chat 用户消息编辑后重跑

**状态:** ✅ 第一版已完成；Compare / 附件替换 / 生成中编辑后置

**已完成提交:**

```text
233c3c7 feat(chat): allow editing user messages
```

**第一版边界:**

- 仅支持普通 Chat 的 `role=user` 消息。
- 非 Compare、非生成中才显示编辑入口。
- 只编辑文字内容；原 `message_files` / 附件保留，不支持替换附件。
- 保存后会截断这条用户消息之后的所有消息，并重新生成 assistant；不保留旧后续回答。
- 不支持 assistant 消息编辑。

**实现要点:**

- 后端新增：

```http
PATCH /api/conversations/:id/messages/:message_id
```

- 请求体：

```json
{ "content": "新的用户消息内容", "truncate_after": true }
```

- 后端校验：conversation 归属当前用户、message 属于 conversation、只能编辑 user message、content 非空、会话有 running/pending/streaming/retrying task 时返回 409。
- 后端动作：更新 user message content，soft delete 后续 messages，更新 `conversation.updated_at`，返回 `deleted_message_ids`。
- 前端新增 `useChatUserMessageEditRuntime`：先 PATCH 编辑接口，再本地/runtime 截断消息，插入新 assistant pending，调用 `/api/chat/init`。
- 重新生成必须传：

```json
{
  "skip_save_user_msg": true,
  "user_message_id": "edited user serverMessageId"
}
```

这样后端复用已编辑的 user row，不会重复保存用户消息。
- 生成继续走 server-first task stream：`/api/tasks/:task_id/stream?after=0`。

**已验证:**

```bash
cd backend
# gofmt 已执行
go test ./internal/api ./internal/models

cd frontend
npx tsc --noEmit --pretty false
npm run test:chat-request-builder
npm run test:chat-single-send-coordinator
CHAT_USER_CONTENT_FIXTURE_BASE_URL=http://127.0.0.1:3000 npm run test:chat-user-content-fixture
USER_EDIT_API_BASE_URL=http://127.0.0.1:19091 USER_EDIT_FRONTEND_BASE_URL=http://127.0.0.1:3000 USER_EDIT_MODEL=gpt-5.4-mini npm run test:chat-user-message-edit-live
npm run build
```

通过结果：

- backend API / models tests ✅
- frontend typecheck ✅
- request builder / single-send coordinator ✅
- user-content fixture：文件 chip、引用、长用户消息折叠、长代码块、编辑入口与编辑框 ✅
- user-message-edit live：本地前端 + 本地后端新代码 + 真实测试账号 + 真实模型 `gpt-5.4-mini`；覆盖发送、编辑、PATCH 200、截断旧分支、重新生成、bootstrap 持久化、刷新恢复、无重复 user/assistant row ✅
- production build ✅

**后续优化项:**

1. Compare 历史 shared prompt 编辑：需要重新定义 `MessageGroup`、双列 assistant、`group_models`、column owner、retry column 的截断/重建语义，不能复用普通 Chat 的简单截断。
2. 附件编辑：需要支持 message_files 替换、file context 重新入库、RAG 上下文重算和 UI 上的附件增删。
3. 生成中编辑：当前禁止；若要支持，应先 Stop/cancel 当前 task，再走编辑重跑，避免旧 stream 写回被删 assistant。
4. 历史编辑确认体验：目前编辑框内提示“保存后将重新生成这条消息之后的回答”；若误触反馈多，再加轻量 confirm。
5. Live 覆盖扩展：当前已覆盖单轮真实闭环；后续可补多轮历史中编辑第一条 / 中间条、长回答截断、以及失败恢复。

---

## 建议下一轮执行顺序

### 第一轮：P3 Activity / 来源入口继续减噪

**状态:** ✅ 已完成，不再作为下一轮主任务

任务：

1. 聚合卡展开状态在当前面板生命周期内记忆。✅
2. 来源域名过多时，默认只展示前 N 个域名，支持“显示全部 / 收起”。✅
3. 工具调用、文件检索、网页来源统一入口文案和视觉层级。✅
4. 保持普通 Chat 一个入口、Compare 每列一个入口，不新增冗余箭头。✅

**原因:** 来源是高频阅读入口，优化应以“少打扰、可展开、可回到原状态”为主。

---

### 第二轮：P3 长消息性能和阅读定位

**状态:** ✅ 当前桌面主线已完成，后续转入 testnet 验证 / 搜索 block 来源产品化

任务：

1. ✅ message 精确回跳与 assistant exact highlight。
2. ✅ URL `block` 参数、block target 定位 / transient highlight / message fallback。
3. ✅ code/table/math/Mermaid block-local 回归锁定。
4. ✅ Compare 长回答 action row sticky / visible。
5. ⏭️ 搜索结果 `matched_block_id` 来源产品化；没有字段时保持 message 级回跳。

**原因:** 目标是“像读文档一样稳”，优先做用户可感知的阅读定位和长内容操作体验。

---

### 已完成 / 不再作为下一轮主任务

- ✅ P1 发送 / 停止 / 恢复视觉一致性：pending shell、Compare loading 稳定高度、P1 state consistency live probe 已完成。
- ✅ Compare 模型持久化：已静默 PATCH 当前会话，并有 live 回归覆盖刷新与新一轮 payload。
- ✅ 视觉稳定 live probe：已新增 5 轮 mixed rich old-row stability stress，覆盖旧消息 DOM/height/text/remount。
- ✅ Sidebar hook 化：`useChatSidebarHistory()` 已抽出，桌面 / 移动已共用；剩余是 fixture 测试与 optimistic pipeline。
- ✅ block anchor 第一版：已支持 `anchorMessageId + anchorBlockId + anchorOffset` 恢复阅读位置。
- ✅ P3 桌面阅读定位：message / block 回跳、高亮、block-local Markdown、Compare 长回答操作可达已完成。
- ⏬ Compare 移动端体验：按用户要求优先级排到最后，暂不混入 P3 桌面阅读体验。

---

## 额外补充项

### A. Activity 来源体验继续补强

**状态:** 🟡 可选优化

- 聚合卡展开状态可在当前面板生命周期内记忆。
- 来源域名过多时，支持“显示全部 / 收起”。
- 对文件来源、网页来源、工具来源统一视觉层级。

### B. Chat live 总回归纳入手工 checklist

**状态:** ✅ 已形成标准命令

当前可用：

```bash
npm run test:chat-live-smoke
npm run test:chat-live-full
```

`test:chat-live-full` 覆盖 dynamic shell、真实完整 Chat、真实 Compare、P1 send/switch/stop/reload，并默认删除临时测试会话；需要保留现场时设置 `KEEP_LIVE_CONVERSATIONS=1`。

### C. testnet 前端静态部署检查固定化

**状态:** ✅ 已沉淀到记忆和 skill reference

AI Space testnet 前端由 nginx 直接服务 `frontend/out`。前端-only 变更只需在干净目标代码上 `npm run build` 并同步/生成静态 `out`，不需要额外部署或重启后端。验证重点：

```bash
stat -c '%y %n' /workspace/aipool/frontend/out/chat/index.html
curl -sS -I --max-time 10 https://testnet.ai-space.xyz/chat/ | sed -n '1,16p'
npm run test:chat-live-full
```

---

## 当前未完成但不应混入本计划的 WIP

这些属于其它产品线，不建议混进 Chat / Compare 体验计划：

- 高考志愿主线：`backend/internal/api/gaokao.go`、`backend/internal/services/gaokao*.go`、`frontend/app/(main)/(work)/gaokao-volunteer/`、导入脚本等。
- 图片服务实验：`backend/internal/api/image.go`、`backend/internal/services/image_service.go`。
- Admin token 修复：`frontend/app/admin/beta-*.tsx`。

建议单独拆 plan / commit。
