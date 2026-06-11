# AI Space 聊天切换 / 上滑历史 / Markdown 渲染根治方案

> 目标：借鉴 Open WebUI 的“默认最近少量消息 + 上滑逐页释放/加载”优点，结合 AI Space 现有 React + Virtuoso + restore/cache 架构，根治切换会话、路由和上滑历史时的 Markdown 渐进渲染可感知、掉底、闪屏/跳动问题。
>
> 本文是实施计划，不是最终产品代码。所有阶段必须在 `testnet` 分支小范围提交，并用 fixture + 真实 profile 验证后推进。

## 1. 背景与问题

AI Space 当前为了解决极端历史会话（尤其 62）在会话切换时的掉底和 LongTask，已经引入：

- React Virtuoso 虚拟列表；
- 初始尾部窗口裁剪；
- heavy Markdown 延迟 hydrate；
- rich-lite / plain fallback 分层；
- history prepend settling 期间暂停 Markdown 大幅切换；
- bottom lock 多阶段补偿。

这些策略让 62 等极端会话稳定，但副作用是：

```text
历史 assistant 行先显示 plain fallback
用户上滑进入可见区后再逐步 rich-lite/full Markdown
=> 用户能明显感觉到“富文本渲染过程”
```

之前已证伪的修复方向：

- 直接给历史可见行启用 rich-lite fallback；
- 即使限定为 `userBrowsing && isInViewport`；
- 真实 62 profile 仍出现 `distanceToBottom=4783`、`message-row-commit=282`、`longTaskTotalMs=1453ms`。

所以问题不应继续靠 Markdown renderer 条件微调解决，而应从消息窗口和历史分页模型根治。

## 2. 外部参考

### 2.1 Open WebUI 的优点

公开源码参考：

- `https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/Messages.svelte`
- Raw: `https://raw.githubusercontent.com/open-webui/open-webui/main/src/lib/components/chat/Messages.svelte`

关键做法：

```ts
export let messagesCount: number | null = 8;

const loadMoreMessages = async () => {
  const element = document.getElementById('messages-container');
  element.scrollTop = element.scrollTop + 100;

  messagesLoading = true;
  messagesCount += 8;
  buildMessages();
  await tick();
  messagesLoading = false;
};
```

它的核心不是“复杂 Markdown 分层”，而是：

```text
默认只构建最近 8 条消息
上滑时每次 +8
streaming 时 rebuild 按 requestAnimationFrame 节流
内容可见性变化后再二次 scrollToBottom
```

优点：

1. 初始挂载消息少；
2. Markdown 直接渲染压力低；
3. 上滑成本有边界；
4. 不需要大量历史消息在后台参与 hydrate/测量；
5. 用户很少看到 plain -> rich 的明显切换。

限制：

- Open WebUI 不是 React Virtuoso 模型；
- 它更依赖本地 history 链和 Svelte 更新；
- AI Space 不能照搬 DOM/滚动逻辑，需要适配 Virtuoso firstItemIndex、backend restore、IndexedDB snapshot、target message 定位。

### 2.2 ChatGPT / Gemini 类产品的可观察共性

ChatGPT/Gemini 的内部实现不是公开源码，不能假定具体数据结构。但从可观察行为和通用大型聊天 UI 实践看，共性是：

- 首屏只让最近上下文快速可读；
- 历史内容按用户滚动逐步释放/加载；
- 流式输出按帧或批次更新，避免每 token 全量重排；
- 长代码块、图片、表格等重内容不应在会话切换关键窗口同步全量 hydrate；
- 滚动锚点优先于离屏历史内容增强。

这些原则和 Open WebUI 的 `messagesCount += 8` 是一致的。

### 2.3 Virtuoso 相关实践

参考：

- `https://virtuoso.dev/`
- `https://virtuoso.dev/endless-scrolling/`
- `https://virtuoso.dev/scroll-to-index/`

AI Space 现有 Virtuoso 使用点：

- `data={visibleMessages}`；
- `firstItemIndex={firstItemIndex}`；
- `startReached` 触发历史加载；
- `computeItemKey={(_, msg) => msg.id}`；
- prepend 时通过 `firstItemIndexRef.current - firstPrevIndex` 保护锚点；
- `historyPrependSettling=1600ms` 保护测量窗口。

所以根治方案应该复用 Virtuoso 的 prepend 模型，而不是手动改 `scrollTop`。

## 3. AI Space 当前架构事实

### 3.1 Restore 默认 tail=32

文件：`frontend/lib/chatConversationRestoreCoordinator.ts`

```ts
export const DEFAULT_CONVERSATION_RESTORE_TAIL = 32;

export function buildConversationRestoreUrl({
  apiBaseUrl = "",
  conversationId,
  tail = DEFAULT_CONVERSATION_RESTORE_TAIL,
}: {
  apiBaseUrl?: string;
  conversationId: number;
  tail?: number;
}): string {
  return `${apiBaseUrl}/api/conversations/${conversationId}?message_tail=${tail}`;
}
```

后端：`backend/internal/api/conversation.go`

```go
// /api/conversations/:id?message_tail=N
if msgTail > 0 {
  offset := int(total) - msgTail
  if offset < 0 { offset = 0 }
  msgQuery = msgQuery.Offset(offset)
  msgQuery = msgQuery.Limit(msgTail)
}
```

当前状态：

- `DEFAULT_CONVERSATION_RESTORE_TAIL = 32` 已落地；
- 当前打开会话时后端默认返回最近 32 条；
- 前端再从这些消息里做窗口裁剪；
- 32 条 canonical tail 仍会参与 group inference、overview、缓存、diff、状态判断等。

### 3.2 MessageList 已有“尾部窗口”雏形

文件：`frontend/components/chat/MessageList.tsx`

当前常量：

```ts
const INITIAL_RENDERED_MESSAGE_WINDOW = 16;
const CONTENT_HEAVY_INITIAL_RENDERED_MESSAGE_WINDOW = 8;
const MIN_HIDDEN_MESSAGES_TO_WINDOW = 8;
const CONTENT_HEAVY_TOTAL_CHARS_THRESHOLD = 24_000;
const CONTENT_HEAVY_CODE_BLOCK_THRESHOLD = 24;
const CONTENT_HEAVY_TABLE_LINE_THRESHOLD = 80;
```

当前逻辑：

```ts
const visibleMessages = useMemo(() => {
  if (allVisibleMessages.length <= effectiveRenderedMessageWindow) return allVisibleMessages;
  return allVisibleMessages.slice(allVisibleMessages.length - effectiveRenderedMessageWindow);
}, [allVisibleMessages, effectiveRenderedMessageWindow]);
```

这说明 AI Space 已经不是完全“全量消息交给 Virtuoso”，而是有初始窗口。

但关键差异是：

```ts
if (hasHiddenLocalMessages) {
  setRenderedMessageWindow(allVisibleMessages.length);
  return;
}
```

该问题已在 Stage 0 修复：用户到顶部后，本地隐藏消息按 `MESSAGE_WINDOW_PAGE_SIZE = 8` 分页释放，并通过 `localWindowReleaseAwaitingScrollAwayRef` guard 避免 Virtuoso 锚点补偿触发连锁释放。

### 3.3 后端已有分页接口

文件：`backend/internal/api/conversation.go`

```go
func (h *ConversationHandler) GetMessages(c *gin.Context) {
  limit := 50
  offset := 0
  tail := 0

  // GET /api/conversations/:id/messages?limit=&offset=&tail=
  // limit <= 200, tail <= 200
}
```

前端 load-more coordinator：`frontend/lib/chatLoadMoreCoordinator.ts`

```ts
export function buildLoadMorePage({
  totalMessages,
  loadedPersistedMessages,
  defaultLimit = 50,
}: LoadMorePaginationInput): LoadMorePage {
  const limit = defaultLimit;
  const offset = Math.max(0, totalMessages - loadedPersistedMessages - limit);
  const expectedOlderCount = Math.max(0, totalMessages - loadedPersistedMessages - offset);
  return {
    limit,
    offset,
    expectedOlderCount,
    requestLimit: expectedOlderCount || limit,
  };
}
```

当前后端基础已足够支持“小页加载”，且默认前端 older page size 已在 Stage 1 降为 8。

## 4. 根因判断

当前问题不是“Markdown renderer 慢”一个点，而是三层耦合：

```text
restore/cache 一次带入较多 tail 消息
+ MessageList 本地/远端历史释放页过大
+ Markdown 为保护 62 做 plain/rich-lite/full 分层
= 上滑历史时用户能看到富文本渐进过程
```

真正根治方向：

```text
把“有多少消息参与当前列表/测量/Markdown”作为第一等状态管理
默认只暴露最近 8/12 条
上滑每次只释放或请求 8/12 条
窗口内消息再尽量直接富文本化
```

## 5. 目标架构

### 5.1 三层消息状态

引入清晰分层：

```ts
type ChatMessageWindowState = {
  // 后端/IndexedDB/restore 返回的 canonical tail，不一定全部给 Virtuoso
  canonicalMessages: Message[];

  // 当前允许交给 Virtuoso 的尾部窗口大小
  renderedWindowSize: number;

  // 每次本地释放/远端请求的页大小
  pageSize: number;

  // 当前可见窗口起点，用于 firstItemIndex / target 定位
  windowStartIndex: number;
};
```

实际实施时不一定单独建这个 type，但逻辑必须按这三层拆：

1. canonical source：后端 + memory cache + IndexedDB；
2. local release window：从 canonical tail 中释放多少条给 Virtuoso；
3. remote older page：canonical 不够时向后端请求更早消息。

### 5.2 建议默认值

```ts
const CHAT_INITIAL_MESSAGE_WINDOW = 12;
const CHAT_HEAVY_INITIAL_MESSAGE_WINDOW = 8;
const CHAT_MESSAGE_WINDOW_PAGE_SIZE = 8;
const CHAT_RESTORE_TAIL = 32;
const CHAT_LOAD_MORE_PAGE_SIZE = 8;
```

为什么不是固定 8：

- Open WebUI 用 8 是好参考；
- AI Space 一轮通常 user + assistant 两条，12 条约等于最近 6 轮，对中文用户更自然；
- heavy 会话仍用 8。

### 5.3 startReached 新流程

当前：

```text
顶部触发
如果有 hidden local messages -> 每次释放 8 条
否则 -> 后端请求 8 条 older
```

目标：

```text
顶部触发
1. 记录当前第一条可见 row anchor
2. 如果 canonicalMessages 里还有 hidden local messages：
     renderedWindowSize += 8
     Virtuoso firstItemIndex -= 实际新增数
     开启 historyPrependSettling
     不请求后端
3. 如果本地已释放完且 hasMoreMessages：
     请求 older page limit=8/12
     prepend 到 canonicalMessages
     renderedWindowSize += 实际新增数
     firstItemIndex -= 实际新增数
4. prepend settling 窗口内禁止 full Markdown 大幅 hydrate
```

### 5.4 Markdown 策略简化

窗口化稳定后，逐步从当前：

```text
plain fallback -> rich-lite -> delayed full
```

改为：

```text
窗口内 normal message: rich-lite immediately 或 full Markdown immediately
窗口内 heavy message: rich-lite immediately, full Markdown idle/visible hydrate
离窗口消息: 不参与 DOM / 不 hydrate
```

已验证不能“一刀切取消分层”，也不能在普通切换或泛化 `userBrowsing` 期间启用 rich-lite fallback。当前可保留的最窄模式是：只在 history prepend 后短时间内，对短且无代码/无表格的简单消息使用 rich-lite fallback；heavy guard 仍保留。

### 5.5 IndexedDB/cache 策略

IndexedDB 仍是加速层，不是事实源。

当前 persistent cache 保存 snapshot.messages。改造原则：

- 初期不改 schema，只在 UI 层窗口化；
- 第二阶段可增加 `renderWindowSize` / `lastViewedMessageId` 等 UI hint，但不能作为 canonical；
- cache key 继续保持用户隔离：

```text
user:${userId}:conversation:${conversationId}
```

- revalidate 后以后端为准，窗口大小只影响 UI 渲染，不影响消息真实性。

## 6. 分阶段实施计划

当前已落地提交：

```text
c15c752 perf: remove sidebar conversation load delay
50def0d perf: delay heavy markdown hydration during chat switch
dc76f8a perf: page local chat history window
a4a984e perf: shrink chat history load-more pages
6c08599 perf: reduce conversation restore tail
16ba0d6 perf: limit rich markdown fallback to history prepend
```

截至 `16ba0d6`，固定真实 profile `62 / 12 / 116 / 608 / 264 / 607 / 606` 均保持 `distanceToBottom=0`；新用户切换性能仍保持 `message_tail=32` 且无额外 `messageCount/messageStatus` 请求。

### Stage 0：前端窗口分页实验，不改后端，不改 IndexedDB（已完成）

目标：验证“每次 +8”是否稳定改善体验。

改动范围：

- `frontend/components/chat/MessageList.tsx`
- `frontend/scripts/regression/chat-load-more-history-fixture.cjs`
- 必要时 `frontend/lib/chatLoadMoreCoordinator.ts` 测试 fixture 参数，不先动真实后端请求 limit。

核心改动：

```ts
const MESSAGE_WINDOW_PAGE_SIZE = 8;

if (hasHiddenLocalMessages) {
  setRenderedMessageWindow((current) =>
    Math.min(current + MESSAGE_WINDOW_PAGE_SIZE, allVisibleMessages.length)
  );
  stopBottomLockForUserBrowse(1800);
  markHistoryPrependSettling(1600);
  return;
}
```

注意：

- 不能使用 `setRenderedMessageWindow(allVisibleMessages.length)`；
- `firstItemIndex` 仍按实际 prepend 数计算；
- 不改变 Markdown 策略；
- 只验证窗口分页是否让上滑更平滑。

验收：

- `chat-load-more-history-fixture` 需要新增断言：
  - 首次顶部触发只新增 8/12 条，不是全量；
  - prepend 后当前 anchor row 仍在可视位置附近；
  - 无空白/闪屏；
- 真实 profile：62/12/116/608/264/607/606 全部 `distanceToBottom=0`；
- 62 不得出现 message-row-commit 爆炸。

### Stage 1：真实 load-more page size 从 50 降到 8（已完成）

目标：后端 older page 也小页化。

改动范围：

- `frontend/lib/chatLoadMoreCoordinator.ts`
- `frontend/hooks/useChatConversationLifecycle.ts`
- 对应 regression 脚本。

建议：

```ts
const DEFAULT_CHAT_LOAD_MORE_PAGE_SIZE = 8;

const page = buildLoadMorePage({
  totalMessages,
  loadedPersistedMessages,
  defaultLimit: DEFAULT_CHAT_LOAD_MORE_PAGE_SIZE,
});
```

风险：

- 目标消息定位可能需要多次请求；
- 搜索/overview jump 到旧消息时不能死循环；
- `loadedPersistedMessages` 必须按实际 olderMessagesCount 更新。

验收：

- `chat-load-more-coordinator-regression.cjs` 覆盖 defaultLimit=8；
- targetMessageId 找不到时能连续加载，直到找到或无更多；
- 真实 profile 不回退。

### Stage 2：restore tail 从 50 调低到 32，并保留 revalidate（已完成）

目标：切换会话时 canonical tail 也减少，降低 group inference、overview、cache diff 等成本。

改动范围：

- `frontend/lib/chatConversationRestoreCoordinator.ts`
- `frontend/scripts/regression/chat-conversation-restore-coordinator-regression.cjs`
- `frontend/scripts/regression/chat-conversation-switch-real-performance.cjs`

建议：

```ts
const DEFAULT_CONVERSATION_RESTORE_TAIL = 32;
```

先从 32，不直接 8：

- 当前 overview / compare / groupViews / last assistant status 需要上下文；
- 真实用户切换后可能希望看到最近多轮；
- UI 只显示 8/12，但 canonical tail 可保留 32 作本地释放缓冲。

验收：

- cache miss / IndexedDB hit 指标不回退；
- first snapshot messageCount 下降；
- 62/12/116/608/264/607/606 贴底；
- 新消息发送、继续生成、regenerate、compare 不破坏。

### Stage 3：窗口内 Markdown 策略简化（进行中：Step 3.1d 已完成）

目标：解决用户看到 plain -> rich 的观感。

前提：Stage 0-2 全部稳定。

当前 Step 3.1d 已落地：

```text
只在 history prepend 后短时间内开启 rich-lite fallback
仅对 content.length <= 500、无代码块、无表格的简单消息生效
初始切换 / 普通路由 / 泛化 userBrowsing 均不启用
```

已证伪并回退的变体：

```text
全局取消 plain/rich/full 分层 -> 62 掉底且 LongTask 爆炸
所有非 heavy fallback rich-lite -> 12 掉底
短消息 rich-lite 但初始切换也生效 -> 62 掉底
userBrowsing-gated rich-lite -> 62 掉底
```

改动方向：

```text
普通窗口内 assistant 行：直接 rich-lite fallback 或 full Markdown
heavy assistant 行：rich-lite immediately，full hydrate 延后
prepend settling 内：保持结构稳定，不切 full
离窗口消息：不渲染，不 hydrate
```

重要：

- 不再尝试“所有历史可见行在旧窗口模型下 rich-lite”；已证伪；
- 必须先减少窗口规模，再改善 Markdown 策略；
- full Markdown 对 62 仍要 guard。

验收：

- 上滑历史 fixture 视觉断言：新释放的可见 assistant 行不出现 plain fallback；
- 62 贴底；
- LongTask 不出现 300ms+；
- `/chat` First Load JS 不明显增加。

### Stage 4：可选：persistent cache 保存 UI window hint

仅当 Stage 0-3 稳定后考虑。

可存：

```ts
uiWindowHint?: {
  initialWindowSize: number;
  lastRenderedWindowSize: number;
  lastViewedMessageId?: string;
}
```

不可做：

- 不把 IndexedDB 当事实源；
- 不因为 cache hint 跳过 backend revalidate；
- 不跨用户复用。

## 7. 验证矩阵

### 7.1 静态/单元/fixture

每阶段至少跑：

```bash
cd frontend
npx tsc --noEmit --pretty false
npm run test:chat-load-more-history-fixture
npm run test:chat-history-loading-fixture
npm run test:chat-row-memo-fixture
npm run test:chat-load-more-coordinator
npm run test:chat-conversation-restore-coordinator
NEXT_PRIVATE_BUILD_WORKER=1 npm run build
```

如修改 restore/cache，还需：

```bash
npm run test:chat-conversation-switch-cache-fixture
npm run test:chat-conversation-persistent-cache
npm run test:chat-conversation-restore-runtime-hook
```

### 7.2 真实 profile

必须覆盖：

```text
62 / 12 / 116 / 608 / 264 / 607 / 606
```

核心硬指标：

- `distanceToBottom=0`；
- 62 不得掉底；
- 不出现 300ms 级 LongTask；
- `message-row-commit` 不得爆炸；
- 上滑历史时 anchor 稳定，无明显闪屏/空白。

### 7.3 用户体验验收

手动/浏览器 E2E 需要确认：

1. 切换会话首屏最近消息立即可读；
2. 上滑历史每次释放小页，用户不感到大批富文本突然重排；
3. 历史加载 spinner 不遮挡当前阅读；
4. 返回底部按钮、进度条、overview jump 正常；
5. 搜索/targetMessageId 能定位旧消息；
6. streaming 时保持锁底，不因 window size 变化掉底；
7. compare 模式先不受影响，或单独按组窗口化。

## 8. 不做项 / 风险红线

不要做：

- 不要再次直接对旧模型历史行启用 `userBrowsing && isInViewport` rich-lite fallback；
- 不要在 prepend settling 期间 full hydrate Markdown；
- 不要手动同时改 `scrollTop` 和 Virtuoso `firstItemIndex` 来补偿 prepend；
- 不要一次把 restore tail 改成 8；
- 不要把 IndexedDB 当 canonical source；
- 不要提交真实账号脚本/凭据；
- 不要 `git add -A`；
- 不要把 compare 模式和普通单聊一起大改。

## 9. 推荐提交拆分

1. `perf(chat): page local message window expansion`
   - 只改本地 hidden message 每次 +8；
   - 不改后端请求；
   - fixture + profile。

2. `perf(chat): reduce older message page size`
   - load-more backend page 50 -> 8/12；
   - coordinator regression。

3. `perf(chat): reduce restore tail for windowed chat`
   - restore tail 50 -> 32；
   - cache/restore regression。

4. `perf(chat): limit rich fallback to history prepend`
   - 只在 history prepend 后的短时间窗口对短简单消息启用 rich-lite fallback；
   - 普通切换 / 路由 / `userBrowsing` 不启用；
   - heavy guard 保留。

每个提交都必须独立可回退。

## 10. 下一步建议

已补充真实上滑历史 profile 脚本：

```bash
npm run profile:chat-history-real
```

脚本通过真实账号登录、经本地 proxy 打开指定会话、记录自然初始落底、归一到底部、上滑触发本地窗口释放 / older page，并输出：

```text
visibleMessageCount / hiddenLocalMessageCount
anchor top delta / settle delta
Markdown plain fallback / rich-lite / full signals
message-row / message-list / markdown render profile events
post-prepend long tasks
```

真实 12 曾暴露一个重要问题：页面已到 `scrollTop=0`、仍有 `hiddenLocalMessageCount`，但 Virtuoso `startReached` 没触发本地 +8；当前修复是在 `onWheel(deltaY<0 && scrollTop<=4)` 和 `onScroll(scrollTop<=4)` 中复用同一个本地窗口释放 helper，作为 `startReached` 的兜底。

## 11. 结论

根治方案不是继续调 Markdown fallback，而是把 Open WebUI 的优点迁移到 AI Space 的 Virtuoso 架构里：

```text
Open WebUI:
默认最近 8 条 + 上滑 +8 + Markdown 直接渲染

AI Space 目标：
Virtuoso + canonical tail cache + rendered window
默认 8/12 条 + 上滑本地释放 8/12 + 不足再后端请求 8/12
窗口内再简化 Markdown 分层
```

这样能同时满足：

- 切换会话快；
- 上滑历史稳定；
- Markdown 渐进感降低；
- 62/12/116 等极端会话不回退；
- IndexedDB 仍只是加速层，后端仍是事实源。
