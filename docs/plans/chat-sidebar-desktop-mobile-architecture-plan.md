# Chat Sidebar Desktop/Mobile 架构实施计划

> **文档定位:** 这是 Chat 侧边栏 desktop / mobile 生命周期与数据请求架构计划。重点记录：**视觉互斥不等于组件生命周期互斥，也不等于数据请求互斥**。后续改侧边栏、MobileNav、workspace/bootstrap/history 时必须按本文校验。

**Goal:** 让 desktop AppSidebar 与 mobile MobileNav 在视觉、生命周期、数据请求三层都具备明确边界，避免隐藏移动侧栏在桌面端触发历史请求、状态写入或 DOM 抖动。

**Architecture:** desktop 与 mobile 可以共享 sidebar history 数据工具，但消费者必须显式声明是否启用。`/api/chat/bootstrap`、`/api/conversations`、workspace 解析必须收敛到一个单调 merge/upsert 管线，不能由隐藏组件或未知 workspace 触发额外 replacement / duplicate fetch。

**Tech Stack:** Next.js App Router, React client components, `useChatSidebarHistory`, `AppSidebar`, `MobileNav`, Playwright live probes, testnet dynamic chat shell.

---

## 1. 背景

2026-07-08 live 测试 `https://testnet.ai-space.xyz/chat/?id=1423` 时，用户报告侧边栏会二次刷新。

实测发现，页面初始加载历史请求出现重复：

```text
GET /api/conversations?limit=500
GET /api/conversations?limit=500
GET /api/conversations?workspace_id=2&limit=500
GET /api/conversations?workspace_id=2&limit=500
```

可见 desktop 侧边栏 DOM 采样出现：

```text
0 rows
→ 30 rows
→ 0 rows
→ 177 rows
```

`id=1423` 在第一轮 30 rows 出现，随后短暂消失，再重新出现。用户可感知为侧边栏二次刷新/闪烁。

同日继续实测 `https://testnet.ai-space.xyz/chat`（无 id 路由）发现另一条慢刷新链路：

```text
GET /api/conversations?workspace_id=2&limit=500
GET /api/conversations?workspace_id=2&limit=500
GET /api/conversations?workspace_id=2&limit=500
```

可见 sidebar 第一次很快出现，随后还有重复 canonical 请求返回。即使 top ids 一致，后续慢响应仍可能触发“第二次加载/重刷”的体感。因此长期方案还必须包含 **same-key canonical in-flight de-dupe**：同一个 workspace/page/cursor 的 `/api/conversations` 请求只能在网络层并发一次，多个消费者复用同一个 Promise。

---

## 2. 核心架构原则

### 2.1 视觉互斥不是生命周期互斥

当前布局常见写法：

```tsx
<MobileNav />

<div className="hidden md:block">
  <AppSidebar />
</div>
```

这只做到视觉互斥：

- desktop 看不到 `MobileNav`；
- mobile 看不到 `AppSidebar`；

但 React 生命周期上：

- `MobileNav` 仍然 mount；
- `MobileNav` 的 hooks / effects 仍然运行；
- 如果它调用 `useChatSidebarHistory`，隐藏移动侧栏也会请求 `/api/conversations`；
- desktop `AppSidebar` 也会请求一次，形成重复请求、重复 state stream 和潜在 DOM 抖动。

**结论:** desktop/mobile sidebar 必须区分三层互斥：

```text
1. 视觉互斥：CSS / responsive class 控制是否可见。
2. 生命周期互斥：组件是否 mount。
3. 数据副作用互斥：hooks/effects/fetch 是否启用。
```

最小要求：即使组件因 SSR/hydration/responsive 约束必须 mount，**隐藏消费者也不能执行 sidebar history 数据请求或写入共享 cache/state**。

### 2.2 MobileNav 是移动端抽屉，不是 desktop 隐藏数据源

`MobileNav` 的职责：

- 移动端顶部栏；
- 移动端抽屉打开时展示导航和对话历史；
- 抽屉关闭时不应预拉完整 history；
- desktop 宽屏下不应参与 Chat sidebar history 请求链路。

推荐约束：

```tsx
useChatSidebarHistory({
  ...,
  enabled: menuOpen,
})
```

含义：移动抽屉没打开时，MobileNav 不做 sidebar history fetch，不监听 bootstrap sidebar upsert，不写 sidebar cache。

### 2.3 AppSidebar 是 desktop 侧边栏唯一 live history 消费者

desktop `md` 及以上宽屏：

- `AppSidebar` 负责 sidebar history；
- `MobileNav` 可以保留顶部移动壳，但不能拉 history；
- 可见侧边栏的请求数量应可解释，通常为：
  - dynamic bootstrap seed；
  - canonical `/api/conversations?workspace_id=<id>&limit=500` 一次。

不应出现：

```text
/api/conversations?limit=500
/api/conversations?limit=500
/api/conversations?workspace_id=2&limit=500
/api/conversations?workspace_id=2&limit=500
```

### 2.4 Workspace 未确定前不能先请求 all-workspace history

`/api/chat/bootstrap` 会根据 route conversation 解析 workspace；`useWorkspaces` 也会异步恢复 `current-workspace`。

在 workspace 未确定时先请求：

```text
/api/conversations?limit=500
```

随后再请求：

```text
/api/conversations?workspace_id=2&limit=500
```

会产生额外刷新和可能的跨 workspace 数据闪现。

要求：sidebar history hook 使用 effective workspace：

```ts
const effectiveWorkspaceId =
  workspaceId
  || chatBootstrap?.workspace?.current_id
  || readStoredWorkspaceId();

if (!effectiveWorkspaceId) return;
```

### 2.5 Bootstrap / canonical 都只能 merge/upsert，不能 replace

`/api/chat/bootstrap` 的 sidebar payload 是快速首屏 seed；`/api/conversations` 是 canonical full list。

二者都必须进入同一条 merge/upsert 管线：

```ts
setConversations((prev) => mergeSidebarConversations(prev, incoming));
```

禁止 canonical 首屏用 replacement：

```ts
// 禁止：会造成 bootstrap 30 rows → canonical full rows 的可见二次刷新/收缩
setConversations(sortSidebarConversations(page.conversations));
```

---

## 3. 当前修复点

### Task 1: 让 canonical first page 走 merge/upsert

**Files:**

- Modify: `frontend/hooks/useChatSidebarHistory.ts`
- Test: `frontend/scripts/regression/chat-sidebar-history-regression.cjs`

**Implementation:**

```ts
setConversations((prev) => mergeSidebarConversations(prev, page.conversations));
```

**Regression guard:**

```js
assert.ok(
  hook.includes('setConversations((prev) => mergeSidebarConversations(prev, page.conversations))'),
  'canonical /conversations first page must merge/upsert instead of replacing bootstrap/sidebar state'
);
assert.equal(
  hook.includes('setConversations(sortSidebarConversations(page.conversations))'),
  false,
  'canonical /conversations first page replacement causes visible sidebar second-refresh/shrink regressions'
);
```

### Task 2: 给 sidebar history hook 增加 enabled gate

**Files:**

- Modify: `frontend/hooks/useChatSidebarHistory.ts`
- Test: `frontend/scripts/regression/chat-sidebar-history-hook-static.cjs`

**Implementation sketch:**

```ts
type UseChatSidebarHistoryOptions = {
  // ...
  enabled?: boolean;
};

export function useChatSidebarHistory({ enabled = true, ... }: UseChatSidebarHistoryOptions) {
  useEffect(() => {
    if (!enabled) return;
    // bootstrap sidebar merge listener
  }, [enabled, ...]);

  const loadConversations = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    // fetch canonical list
  }, [enabled, ...]);
}
```

### Task 3: MobileNav 关闭时禁用 history hook

**Files:**

- Modify: `frontend/components/mobile/MobileNav.tsx`
- Test: `frontend/scripts/regression/chat-sidebar-history-hook-static.cjs`

**Implementation:**

```tsx
useChatSidebarHistory({
  user,
  workspaceId: currentWS?.id,
  pathname,
  routeConversationId: effectiveRouteConvId,
  chatBootstrap,
  cacheKey: `mobile:${currentWS?.id || "all"}`,
  captureAnchor: captureHistoryAnchor,
  restoreAnchor: restoreHistoryAnchor,
  firstLoadMinMs: 600,
  enabled: menuOpen,
});
```

**Reason:** `MobileNav` 是移动抽屉。抽屉关闭时，它不应作为隐藏 history consumer 拉取 desktop 页面数据。

### Task 4: workspace 未确定时不请求 all-workspace history

**Files:**

- Modify: `frontend/hooks/useChatSidebarHistory.ts`
- Test: `frontend/scripts/regression/chat-sidebar-history-hook-static.cjs`

**Implementation:**

```ts
function readStoredWorkspaceId() {
  if (typeof window === "undefined") return undefined;
  const raw = localStorage.getItem("current-workspace");
  const id = raw ? Number(raw) : 0;
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

const effectiveWorkspaceId = workspaceId || chatBootstrap?.workspace?.current_id || readStoredWorkspaceId();

if (!effectiveWorkspaceId) return;
```

**Expected:** live 初始加载不再先请求 `/api/conversations?limit=500` 后请求 workspace-scoped list。

---

## 4. Verification

### 4.1 Static/unit regressions

Run:

```bash
cd frontend
node scripts/regression/chat-sidebar-history-regression.cjs
node scripts/regression/chat-sidebar-history-behavior.cjs
node scripts/regression/chat-sidebar-history-hook-static.cjs
npm run build
```

Expected:

```text
chat sidebar history regression passed
chat sidebar history hook static regression passed
Next build compiled successfully
```

### 4.2 Live testnet probe

Use account from `frontend/.env.local`:

```text
TESTNET_BASE_URL
TESTNET_EMAIL
TESTNET_PASSWORD
```

Open exact route:

```text
https://testnet.ai-space.xyz/chat/?id=1423
```

Collect:

- `/api/chat/bootstrap` request/response;
- `/api/conversations` requests;
- visible `[data-conversation-row]` count and top ids every ~100ms for initial 5-7s;
- page errors / console errors.

Pre-fix failure shape:

```text
/api/conversations?limit=500                       x2
/api/conversations?workspace_id=2&limit=500        x2
visible rows: 0 → 30 → 0 → 177
```

Expected post-fix shape:

```text
no hidden MobileNav duplicate history request
no all-workspace /api/conversations?limit=500 before workspace is known
visible rows should not pass through 30 → 0 → 177
id=1423 remains visible once sidebar appears
no page errors
```

### 4.3 Mobile verification

On mobile viewport:

1. Open `/chat/?id=1423`.
2. Before tapping menu, no full sidebar history fetch should be required by `MobileNav`.
3. Tap menu.
4. Mobile drawer should load/show history.
5. Close drawer.
6. No polling or repeated full history fetch should continue just because `MobileNav` remains mounted.

---

## 5. Pitfalls

### Pitfall 1: “hidden md:block” 不是 mount guard

`className="hidden md:block"` only hides DOM visually. It does not stop hooks.

### Pitfall 2: MobileNav 不应为了 desktop 首屏预热 history

如果未来需要 mobile history 预热，必须是显式产品决策，并且不能影响 desktop visible sidebar。不要让移动端优化变成桌面端副作用。

### Pitfall 3: 不要用 refresh 证明问题已修

此类问题发生在 SPA 初始 bootstrap / canonical / workspace handoff 时序。必须无刷新采样 DOM 和请求。

### Pitfall 4: 不要只看接口返回一致

这次接口返回 top ids 一致，但 DOM 仍出现 `30 → 0 → 177`。验证必须包含可见 DOM row count、target row presence、request count。

---

## 6. Long-term direction

更彻底的架构可以考虑 viewport-aware conditional render：

```tsx
{isMobile ? <MobileNav /> : <AppSidebar />}
```

但这会引入 SSR/hydration、resize、媒体查询同步和首屏壳稳定性问题。短期优先保证：

```text
即使两个组件都 mount，只有当前可见/可交互的 sidebar consumer 允许执行 history 数据副作用。
```

后续若做 viewport-aware render，必须另开计划并验证：

- desktop ↔ mobile resize；
- hydration mismatch；
- mobile drawer open/close；
- app shell layout shift；
- sidebar cache key 切换；
- workspace 切换；
- testnet exact route `/chat/?id=1423`。
