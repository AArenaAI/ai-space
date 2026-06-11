# Admin Usage v3 Operations Roadmap

> **For Hermes:** Use this plan as the route for the next Usage v3 admin iterations. Keep changes narrowly staged and commit only admin/usage/task/user related files.

**Goal:** 把当前“可用的 Usage v3 账本后台”升级成“实时任务 + 成本 + 用户画像”一体化运营后台，让管理员不用在任务、用户、账本之间反复点开查找。

**Architecture:** 继续以 `api_usage_logs` 为成本事实源，不把成本写回普通任务/用户业务表；任务监控和用户面板通过 usage 聚合/关联查询展示成本快照。前端先做清晰的信息架构与下钻入口，后端只在现有 API 不足时补小型聚合接口。

**Tech Stack:** Go/Gin/GORM backend, PostgreSQL `api_usage_logs`, Next.js/React admin frontend, existing `frontend/lib/admin/*` API/types.

---

## Current Problems

### 1. 实时任务监控看不到消耗价格

当前 `/admin/tasks` 只显示：

- status
- provider/model
- user/conversation/message
- error
- created/updated time

但运营真正需要的是：

- 这个任务预计/实际花了多少钱？
- 是图片、视频、聊天、PPT 还是文档任务？
- 任务正在跑时有没有已产生账本？
- 完成后对应几条 usage log？
- 点击任务能否直接看到成本和账本明细？

现在如果要看成本，需要跳到 `/admin/usage` 或点用户详情，路径太长。

### 2. 用户成本数据不在用户管理页

当前 `/admin/users` 是账号管理页：角色、套餐、积分。它不是成本运营页。

Usage 页里虽然有用户排行和用户 Drawer，但仍然不够友好：

- Drawer 信息密度高，缺少重点摘要。
- 不直接告诉管理员“这个用户为什么贵”。
- 用户的实时任务、最近高成本调用、图片/视频单价没有集中展示。
- 用户管理页和 Usage 用户成本视图割裂。

### 3. Usage 页已经能用，但还不是运营工作台

已完成：

- Usage v3 产品维度账本
- 产品模块默认入口
- 图片/视频均价
- 请求降频、防抖、短缓存
- 首屏运营摘要

但仍缺：

- 任务成本实时可见
- 用户成本画像
- 异常/风险提示
- 业务对象跳转
- URL/筛选保存
- 空状态/错误状态解释

---

## Target Information Architecture

后台建议形成三个互相联动的成本视角：

```text
/admin/usage       成本运营中心：总览、模块、账本、用户排行、模型成本
/admin/tasks       实时任务监控：任务状态 + 任务成本 + 任务账本
/admin/users       用户管理 + 用户成本入口：账号信息 + 成本摘要 + 风险提示
```

核心原则：

1. 管理员看到任何任务，都能看到成本或成本状态。
2. 管理员看到任何用户，都能看到该用户的成本摘要。
3. 管理员看到任何成本数字，都能下钻到 `api_usage_logs` 单条账本。
4. 账本仍是唯一成本事实源；任务/用户页面只聚合展示，不复制成本事实。

---

## Phase 1 — Quick UX Wins: make current screens immediately clearer

**Goal:** 不大改后端，先让现有页面更好用、更少误解。

### Task 1.1: Improve `/admin/usage` tab labels

**Objective:** Tab 上直接显示数量或成本，让管理员不用点进去猜有没有数据。

**Files:**

- Modify: `frontend/app/admin/usage/page.tsx`

**Details:**

Change tab labels from static:

```text
总览 / 账本明细 / 用户 / 产品模块 / 模型 / 对话
```

to contextual labels:

```text
产品模块 ¥126
账本 724
用户 30
模型 12
对话 30
```

Use existing loaded data:

- `modules?.modules.length`
- `logs?.total`
- `users?.users.length`
- `models?.models.length`
- `conversations?.conversations.length`
- module total cost from `modules.modules.reduce(sum cost_rmb)`

**Verification:**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

### Task 1.2: Improve empty/error states on `/admin/usage`

**Objective:** 区分“没数据”和“接口失败/请求太频繁”。

**Files:**

- Modify: `frontend/app/admin/usage/page.tsx`

**Details:**

Replace generic `暂无用量数据` with contextual empty states:

- If filters active: show current filters and suggestions:
  - 清空 operation
  - 切换全部时间
  - 返回产品模块
- If no filters: show “当前时间范围暂无账本”。

For partial API failures, show status by section:

```text
账本明细：正常
产品模块：接口超时，已保留上次数据
用户排行：暂无数据
```

**Verification:** typecheck + build.

### Task 1.3: Show last refresh/cache status

**Objective:** 降低“是不是卡住/请求频繁”的不确定感。

**Files:**

- Modify: `frontend/app/admin/usage/page.tsx`
- Optional Modify: `frontend/lib/admin/api.ts`

**Details:**

Show near refresh button:

```text
刚刚更新 14:32:05
筛选输入已防抖；短时间重复查询会复用缓存
```

Set `lastLoadedAt` when accepted latest request finishes.

---

## Phase 2 — Task Monitor v2: realtime task cost visibility

**Goal:** `/admin/tasks` 不再只是状态表，而是实时任务成本监控页。

### Task 2.1: Extend admin task response with usage summary

**Objective:** 任务列表每行直接显示成本和用量。

**Files:**

- Modify: `backend/internal/api/admin.go`
- Modify: `frontend/lib/admin/types.ts`
- Modify: `frontend/app/admin/tasks/page.tsx`

**Backend approach:**

Extend `adminTaskResponse` with optional usage fields computed from `api_usage_logs`:

```go
type adminTaskUsageSummary struct {
    UsageLogCount  int64   `json:"usage_log_count"`
    CostRMB        float64 `json:"cost_rmb"`
    PromptTokens   int64   `json:"prompt_tokens"`
    CompletionTokens int64 `json:"completion_tokens"`
    TotalTokens    int64   `json:"total_tokens"`
    ImageCount     int64   `json:"image_count"`
    CharacterCount int64   `json:"character_count"`
    VideoSeconds   float64 `json:"video_seconds"`
    LastUsageAt    *time.Time `json:"last_usage_at,omitempty"`
}
```

For each task, aggregate usage logs by likely relations:

```text
task_id = task.ID
OR request_id = task.response_id
OR message_id = task.assistant_message_id
OR conversation_id = task.conversation_id AND created_at >= task.created_at AND created_at <= task.completed_at/updated_at + buffer
```

Start conservative: prefer exact `task_id` / `request_id` / `message_id`. Avoid broad conversation matching unless necessary.

**Frontend display:**

Add columns:

- 产品/功能：from usage if available, otherwise infer from task provider/model/status
- 成本：`¥x.xx` or `待产生账本`
- 用量：tokens / image / video seconds
- 账本：`N 条` clickable to `/admin/usage` filters

### Task 2.2: Add task row detail drawer

**Objective:** 点击任务后直接看到任务详情 + usage logs，不用跳用户详情。

**Files:**

- Modify: `frontend/app/admin/tasks/page.tsx`
- Optional backend: `GET /api/admin/tasks/:id/usage` if list response is insufficient

**Drawer sections:**

1. 任务基础信息：status/provider/model/user/conversation/message/error
2. 成本摘要：cost, avg, unit usage
3. 关联账本：最近 N 条 usage logs
4. Actions:
   - 查看完整账本
   - 查看用户成本
   - 复制 request/task/debug 字段

### Task 2.3: Add live refresh mode

**Objective:** 实时任务页支持轻量自动刷新，但不打爆接口。

**Files:**

- Modify: `frontend/app/admin/tasks/page.tsx`
- Optional Modify: `frontend/lib/admin/api.ts`

**Details:**

- Toggle: `实时刷新 ON/OFF`
- Only auto-refresh when status filter includes active statuses.
- Interval: 8–15 seconds.
- Pause auto-refresh when tab hidden: `document.visibilityState`.
- Preserve selected drawer; refresh its usage summary if open.

**Verification:**

- No infinite refresh loop.
- Switching filters cancels old results / only accepts latest.
- Build passes.

---

## Phase 3 — User Cost Profile: make user data friendly

**Goal:** 用户详情从“表格 Drawer”升级为“用户成本画像”。

### Task 3.1: Build user cost profile drawer in `/admin/usage`

**Objective:** 点击用户后先看到摘要，不先看表格。

**Files:**

- Modify: `frontend/app/admin/usage/page.tsx`

**New drawer structure:**

```text
Header: 用户名 / 邮箱 / plan / role / 最近使用

Top summary cards:
- 总成本
- 调用数
- 平均每次
- 图片/视频/字符单位成本
- 失败率

Why expensive:
- Top service/module by cost
- Top model/provider by cost
- Recent highest cost call
- Running tasks for this user, if available

Tabs inside drawer:
- 成本摘要
- 最近账本
- 对话
- 模型
- 任务
```

Use existing `AdminUsageUserDetail` and recent logs first. Do not add backend unless needed.

### Task 3.2: Add user cost summary to `/admin/users`

**Objective:** 用户管理页也能看到成本入口，不只是积分/角色。

**Files:**

- Modify: `backend/internal/api/admin.go`
- Modify: `frontend/lib/admin/types.ts`
- Modify: `frontend/app/admin/users/page.tsx`

**Backend option A:** Extend `ListUsers` response with current 30d usage summary per listed user.

Fields:

```json
usage_30d: {
  requests,
  cost_rmb,
  image_count,
  video_seconds,
  character_count,
  failures,
  last_used_at
}
```

**Frontend:**

Add columns/cards:

- 30d 成本
- 平均每次
- 图片/视频
- 最近使用
- “查看成本” button linking/filtering to `/admin/usage?user_id=...`

### Task 3.3: User risk labels

**Objective:** 一眼看出哪些用户可能烧钱/异常。

**Rules (initial frontend-only):**

- `高成本`: 30d cost > threshold
- `视频重度`: video cost or seconds significant
- `失败偏高`: failure rate > 20%
- `最近活跃`: last_used_at within 24h

Show as badges, not blocking actions.

---

## Phase 4 — Navigation and deep links

**Goal:** 所有成本视图能互相跳转。

### Task 4.1: URL query sync for `/admin/usage`

**Objective:** 支持复制/分享当前筛选。

**Files:**

- Modify: `frontend/app/admin/usage/page.tsx`

**Details:**

- On mount, parse query into filters.
- When filters change, update URL query using `router.replace` without full navigation.
- Add button: `复制当前查询链接`.

### Task 4.2: Cross-page links

**Objective:** 从任务/用户/账本互相跳转。

**Files:**

- Modify: `frontend/app/admin/tasks/page.tsx`
- Modify: `frontend/app/admin/users/page.tsx`
- Modify: `frontend/app/admin/usage/page.tsx`

**Examples:**

- Task row → `/admin/usage?task_id=123`
- User row → `/admin/usage?user_id=456`
- Usage log drawer → `/admin/tasks?request_id=...` if task relation exists

---

## Phase 5 — Product and pricing intelligence

**Goal:** 从“记录成本”升级到“解释成本和帮助定价”。

### Task 5.1: Media spec breakdown

**Objective:** 图片/视频按规格展示均价。

**Needs:** Usage logs must preserve enough context:

- image size
- image quality
- reference image count
- video duration
- aspect ratio
- resolution/model variant

If current logs lack fields, add to `raw_usage_json` or a normalized metadata JSON field.

**View:**

```text
图片
- 1024x1024 medium: 47 张, ¥0.85/张
- 1536x1024 high: 12 张, ¥1.92/张

视频
- 5s: 7 条, ¥5.17/条, ¥1.03/秒
```

### Task 5.2: Cost health score

**Objective:** Give admins a readable status.

```text
成本健康：注意
原因：
1. creative/video 占比升高
2. 用户 X 贡献 40% 成本
3. 今日失败率 18%
```

Start frontend-derived from existing summary/modules/users data.

---

## Recommended Execution Order

### Sprint A — Low risk UX fixes

1. `/admin/usage` tab labels with counts/costs.
2. Better empty/error states.
3. Last refresh/cache status.
4. Commit: `feat: improve usage dashboard clarity`

### Sprint B — Realtime task cost

1. Backend task usage summary.
2. Frontend task list cost columns.
3. Task detail drawer with usage logs.
4. Live refresh toggle.
5. Commit: `feat: show admin task usage costs`

### Sprint C — User cost profile

1. Redesign Usage user drawer.
2. Add `/admin/users` 30d usage summary.
3. Add risk labels and “查看成本” actions.
4. Commit: `feat: add admin user cost profile`

### Sprint D — Navigation polish

1. Usage URL query sync.
2. Copy current query URL.
3. Cross-page deep links.
4. Commit: `feat: add admin usage deep links`

### Sprint E — Cost intelligence

1. Media spec breakdown.
2. Cost health score.
3. Anomaly indicators.
4. Commit: `feat: add usage cost intelligence`

---

## Immediate Next Step

Start with **Sprint A** if the goal is to improve clarity immediately.

Start with **Sprint B** if the highest pain is realtime task monitoring cost visibility.

Given current feedback, recommended next implementation is **Sprint B first**, because the biggest operational blocker is:

> 实时任务监控看不到消耗价格，必须点到用户详情或账本里找。

After Sprint B, do Sprint C to make user detail friendly.
