# Chat 切屏 / 续流 / 完成态复测用例

> 目的：后续排查 Chat 切出去再切回来、reasoning/正文续流、Stop/spinner/completed、重复 append 时，统一按本文件逐项复测，不再只看刷新后或后端 completed。

## 基本原则

1. 必须走真实 UI 发送按钮，不只用 API 预创建任务。
2. 必须测 no-refresh 动态路径：发送 → 切到其他会话 → 切回原会话 → 等完成；刷新只能作为对照。
3. 必须区分：
   - 后端 task 生产进度：`task.last_sequence_number`
   - 前端/UI 已渲染进度：latest assistant DOM / realtime store / message.content / reasoningContent
4. 必须只统计 **latest assistant row**，不要用全页面 `.reasoning-markdown` 汇总；长历史会话会污染结果。
5. completed 后必须检查：
   - 底部 Stop 是否消失
   - assistant 卡片 spinner/ellipsis 是否消失
   - completed icon 是否出现
   - 最新 assistant 正文是否重复
   - reasoning 是否仍在且刷新前后稳定
6. 如果用户给了具体 conversation/model/path，必须复测原 conversation；新会话只能作为补充。

---

## 用例 1：发送后 assistant 占位稳定

### 场景

普通 Chat，真实 UI 点击发送后，模型尚未返回任何正文/reasoning。

### 操作

1. 打开目标会话。
2. 输入 prompt。
3. 点击发送。
4. 80ms~300ms 内采样 DOM 和 bootstrap。

### 预期

- 最新 assistant row 可见。
- 有 pending/empty streaming placeholder 或 assistant card spinner。
- 底部按钮是 Stop。
- 后端已有 assistant message/task：
  - `generation_task_id` 非空
  - `generation_status` / `server_generation_status` 为 `running` 或 `streaming`
- 不允许只剩 user message。

### 失败信号

- 只显示用户消息，没有 assistant 占位。
- `backend.active_tasks.chat` 有任务，但 DOM 没有 assistant row。
- Stop 出现但 assistant 卡片缺失。

---

## 用例 2：早期切回 assistant 占位稳定

### 场景

发送后立刻切到另一个会话，再在模型正文/reasoning 出现前切回来。

### 操作

1. 发送消息。
2. 100ms~300ms 内切到会话 B。
3. 200ms~500ms 后切回会话 A。
4. 采样 `back-150ms / back-500ms / back-1000ms`。

### 预期

- 切回后 latest assistant row 存在。
- 可以是 placeholder，但不能消失。
- Stop 存在，spinner 存在。
- `serverMessageId` 应从 optimistic UUID 收敛到服务端 message id。
- 后端 active task 和 DOM assistant message 可关联。

### 失败信号

- 切回只剩 user message。
- assistant row 抖动：出现 → 消失 → 再出现。
- optimistic UUID 行消失后，服务端 assistant 行没有补上。

---

## 用例 3：切回后 reasoning 续上，不跳过中间 delta

### 场景

模型先输出 reasoning。切走期间后端 task sequence 继续增长，但 DB `message.reasoning_content` 可能还没持久化。

### 操作

1. 使用 reasoning 模型，如 `deepseek-v4-pro`。
2. prompt 要求长 reasoning。
3. 发送后立刻切走。
4. 切回后采样 latest assistant row：`back-200 / back-700 / back-1500 / back-3000`。

### 预期

- 切回早期可先显示占位。
- 之后 latest assistant row 的 reasoning 文本长度应递增。
- 如果 restored server message 没有可见 `content/reasoningContent`，task stream 必须从 `after=0` replay，而不是从 `task.last_sequence_number` 跳过。
- 完成后 no-refresh reasoning 与 refresh 后 reasoning 基本一致。

### 失败信号

- 切回后一直没有 reasoning，直到 completed 或刷新才出现。
- reasoning 从中间突然开始，缺少切走期间已生成的前段。
- latest assistant row 的 reasoning 不增长，但后端 task sequence 增长。
- 只检查全页面 `.reasoning-markdown` 导致误判；必须只看 latest assistant row。

### 关键实现约束

- `task.last_sequence_number` 是生产进度，不是 UI 已渲染进度。
- 若 message 空：`after=0` replay。
- 若 message 已有 persisted reasoning/content：可以从 persisted sequence 后续接，并用 `<think>reasoning</think>` seed 初始内容。

---

## 用例 4：正文续流，不丢、不重、不乱序

### 场景

关闭 thinking，让模型直接输出可验证序列，检查正文切屏回来后是否从中断处继续。

### 推荐 prompt

```text
不要写思考，不要解释。直接按顺序输出 B001 到 B120，每个编号后跟“正文续流测试”，用空格分隔，必须从 B001 开始到 B120 结束。
```

### 操作

1. 设置：
   - `reasoning-mode=fast`
   - `reasoning-enabled=false`
2. 发送 prompt。
3. 250ms 内切走。
4. 350ms 后切回。
5. 采样 `back-900 / back-1800 / back-3500 / back-6500 / after-done`。

### 预期

- 进行中正文 token/编号持续增长。
- completed 后最终正文包含 B001-B120。
- B002-B119 应各出现一次。
- B001/B120 若在 reasoning/指令说明中出现，不计为正文重复；判断正文重复时应剔除 reasoning 区。
- 后端 `message.content` 是 canonical final answer。

### 失败信号

- completed 瞬间正常，1 秒后正文变成两遍。
- UI latest text 长度显著大于 backend `contentLen` + reasoning 展示长度。
- B001-B120 完整出现两轮：`nums≈240, unique=120`。
- background polling/final reconciliation 把 backend content append 到 liveContent 后面。

### 关键实现约束

- completed/final polling 是 reconciliation，不是 append。
- `taskStatus === "completed" && dbContent` 时，最终 `message.content` 必须 canonical replace 为 DB content。
- 不允许按 `liveContent.length > dbContent.length` 保留 liveContent，因为 liveContent 可能已包含重复 replay。

---

## 用例 5：完成后 Stop / spinner / completed 状态收敛

### 操作

完成前后采样：

- `back-running`
- `after-done-no-refresh`
- `after-refresh`

### 预期

完成后 no-refresh：

- 底部 Stop = 0。
- submit/send 按钮恢复。
- `[data-chat-status-icon="spinning"]` = 0。
- `[data-chat-status-icon="completed"]` >= 1，且 latest assistant completed。
- `backend.active_tasks.chat` 为空。
- latest assistant 的 `server_generation_status` / `generation_status` 为 `completed`。
- reasoning 和正文仍可见。

### 失败信号

- 后端 completed 但底部仍是 Stop。
- 后端 active 空，但 assistant 卡片仍有 spinner/ellipsis。
- 刷新后才正常。

---

## 用例 6：重复 append / 刷屏防护

### 场景

route switching abort 原 stream，切回后 task stream replay 多次连接。

### 操作

1. 发送长输出 prompt。
2. 快速切走/切回。
3. 记录 task stream 请求：
   - `/api/tasks/:id/stream?after=0`
   - `/api/tasks/:id/stream?after=1`
4. 等 completed，再比较 UI 与 backend content。

### 预期

- 同一个 completed backend content 到达多次，UI 只显示一次。
- replay stream 重连不能导致 `answerDelta` 重复 append。
- `after=0/after=1` 即使出现多次，也必须被幂等处理。

### 失败信号

- 最终正文从一句变几十句。
- B001-B120 出现两遍。
- UI content 长度持续超过 backend content，刷新后才缩回。

---

## 用例 7：长历史会话精确复测

### 场景

用户给出具体 conversation，例如历史会话 721。

### 操作

1. 用用户指定账号登录。
2. 打开原 conversation。
3. 用用户同类 prompt 发送。
4. 切到另一个会话。
5. 切回原 conversation。
6. 只统计 latest assistant row。

### 预期

- 不用新会话替代原会话。
- 不用全页面 reasoning 计数。
- 旧历史 reasoning 不应污染本轮判断。
- 本轮 latest assistant 的 reasoning/content 必须独立连续。

### 失败信号

- 用新会话复测说通过，但原会话仍复现。
- 用全页面 `.reasoning-markdown` 统计导致历史内容看似增长。
- completed 截图被误判为 running 恢复成功。

---

## 推荐采样字段

### DOM

- latest assistant row id
- latest assistant text length
- latest assistant text tail
- latest assistant reasoning text length
- latest assistant answer text length（completed 后 selector 可能不同，必要时从 row 中剔除 reasoning）
- placeholder count
- Stop button count
- send/submit button count
- `[data-chat-status-icon="spinning"]` count
- `[data-chat-status-icon="completed"]` count
- console/page errors

### Backend bootstrap

- `snapshot.messages` tail
- latest assistant:
  - `id`
  - `generation_task_id`
  - `last_sequence_number`
  - `generation_status`
  - `server_generation_status`
  - `phase`
  - `completed_at`
  - `reasoning_content.length`
  - `content.length`
- `active_tasks.chat`

### Network

- `/api/chat/init`
- `/api/tasks/:id/stream?after=...`
- `/api/chat/bootstrap?...`
- requestfailed / aborted 是否只是切路由导致
- 429 / 500 / console error

---

## 当前已覆盖的回归脚本

```bash
cd frontend
node scripts/regression/chat-background-polling-runtime-hook-regression.cjs
node scripts/regression/chat-bootstrap-task-resume-regression.cjs
node scripts/regression/chat-task-stream-runtime-hook-regression.cjs
npm run build
```

## 建议保留的临时/专项复测脚本模式

### Reasoning 续流

- 使用真实 UI send。
- 使用 reasoning 模型。
- 发送后 100~300ms 切走，200~500ms 切回。
- latest assistant row 采样：`back-200 / back-700 / back-1500 / back-3000 / after-done / after-refresh`。

### 正文续流

- 关闭 thinking。
- 输出 B001-B120。
- 统计 latest assistant row 中 B 编号。
- 剔除 reasoning 区后判断正文是否重复。

---

## 当前通过标准总结

一次完整复测必须同时满足：

- [ ] 发送后 assistant pending row 存在。
- [ ] 早期切回 assistant pending row 存在。
- [ ] 切回后 reasoning 在 running 阶段恢复，不等 completed/refresh。
- [ ] reasoning 不跳过切走期间 delta。
- [ ] 正文在 running 阶段继续增长。
- [ ] completed 后正文 canonical 为 backend `message.content`，不重复叠加。
- [ ] completed 后 Stop 消失。
- [ ] completed 后 spinner/ellipsis 消失。
- [ ] completed 状态 no-refresh 正常。
- [ ] refresh 后与 no-refresh 基本一致。
- [ ] 无 console/page error。
- [ ] 若用户给具体 conversation，必须原 conversation 通过。
