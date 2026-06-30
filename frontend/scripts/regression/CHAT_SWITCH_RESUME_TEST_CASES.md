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

## 用例 8：发送后空占位到 reasoning 首屏不能二次抖动

### 场景

发送后 assistant pending row 先显示空 streaming placeholder，随后第一段 reasoning 出现。若空占位高度过低，reasoning 首屏出现时会把卡片突然撑高，表现为“占位二次抖动”。

### 操作

1. 使用 reasoning 模型，如 `deepseek-v4-pro`。
2. 发送会触发 reasoning 的 prompt。
3. 点击发送后每 50ms 采样 2~3 秒：
   - latest assistant row id
   - latest assistant row height
   - placeholder count
   - text prefix
   - spinner / Stop

### 预期

- latest assistant row id 不变；不应因为 optimistic UUID → server id 造成行消失/替换。
- placeholder 阶段和 reasoning 首屏阶段高度应接近。
- 空占位 → 第一段 reasoning 时不能出现大幅高度跳变。
- 后续 reasoning 内容自然变多导致高度增长是允许的。

### 参考通过信号

```text
placeholder:
height ≈ 180
placeholder=1
text=DeepSeek-V4 Pro...

reasoning first token:
height ≈ 180
placeholder=0
text=DeepSeek-V4 Pro Deep reasoning in progress...
```

### 失败信号

- 空占位高度明显偏小，例如 `128px`，reasoning 首屏瞬间涨到 `180px+`。
- latest assistant row id 改变并导致行重新 mount/动画重播。
- placeholder 消失后短暂空白，再出现 reasoning。

### 关键实现约束

- 空 streaming placeholder 应预留接近 reasoning 首屏的高度。
- 不要用延迟/隐藏掩盖；应该稳定布局高度。

---

## 用例 9：stream ownership 接管，旧 stream abort 后不能继续 final sync/fallback

### 场景

真实 UI 发送后，先有 optimistic local assistant stream；切屏/恢复后 server message id stream 接管同一个 generation task。如果两个 stream 并行处理同一批 sequence，就会造成重复 append 或 completed 瞬间重复。

### 操作

1. 发送长 reasoning 或长正文 prompt。
2. 快速切走/切回，触发：
   - optimistic local stream
   - restored server message stream
3. 记录 `/api/tasks/:task_id/stream?after=...`。
4. 检查同一 `generationTaskId` 下的 owner stream 行为。

### 预期

- 同一个 `generationTaskId` / `serverMessageId` 只允许一个 active owner stream。
- 新 server message stream 接管时，应 abort 旧 optimistic stream。
- 旧 stream abort 后不能再执行：
  - final realtime sync
  - fallback background polling
  - completed mark
- 同一 sequence 跨 stream handler 只能 apply 一次。

### 失败信号

- optimistic stream 和 server-id stream 并行 append。
- 旧 stream abort 后仍触发 background polling。
- completed 瞬间出现重复正文，随后 polling 才修正。
- 同一 sequence 在不同 handler 中各 append 一次。

### 关键实现约束

- sequence 去重必须是 task/message 级别共享状态，不只是单个 stream handler 内的局部 `seenSequences`。
- owner transfer 时主动 abort 旧 controller，并清理旧 `taskStreamsRef` / `activeTaskStreamsRef`。
- abort 的 stream finally 阶段应直接退出，不做 final sync/fallback。

---

## 用例 10：completed polling 同步 reasoning_content，no-refresh 与 refresh 思考一致

### 场景

task stream completed 后，background polling / final reconciliation 同步 backend final message。若只同步 `content`，不同步 `reasoning_content`，会出现 no-refresh 的思考内容短/重复/不完整，refresh 后才正确。

### 操作

1. 使用 reasoning 模型。
2. 发送后切走/切回。
3. 等 completed，但不刷新，采样 latest assistant reasoning。
4. 再刷新作为对照。
5. 对比：
   - no-refresh reasoning 长度/内容
   - refresh 后 reasoning 长度/内容
   - backend `message.reasoning_content.length`

### 预期

- completed polling 返回 backend message 时，应同时把：
  - `message.content`
  - `message.reasoning_content`
  同步进前端 message。
- no-refresh 和 refresh 后的 reasoning 内容基本一致。
- 差异只应来自 UI 标签文案，例如 `Collapsed`，不应是正文/思考主体缺失。

### 失败信号

- no-refresh completed 后 reasoning 明显短于 refresh。
- refresh 后才出现完整 reasoning。
- backend `reasoning_content` 已完整，但前端 message 没有 `reasoningContent`。
- completed polling 只 patch `content`，不 patch `reasoningContent`。

---

## 用例 11：右侧 Activity 面板 active reasoning 平滑流式

### 场景

右侧 `思考与来源` 面板打开时，reasoning 内容来自 provider/task chunk。若面板直接渲染累计 `reasoningContent`，会表现为一段一段跳；应和主消息流式一样小步追赶。

### 操作

1. 使用 deterministic fixture：

```text
/test-chat-streaming-state?activity_reasoning_long=1&activity_panel_open=1
```

2. 打开页面后等待 `mixed-held` / active reasoning。
3. 每 60~80ms 采样 `[data-chat-activity-panel="true"]` 中 reasoning 文本长度。
4. 记录：
   - length 序列
   - 最大单次正向增长 `maxJump`
   - distinct length 数量
   - console/page errors

### 预期

- reasoning length 应多次递增，例如：`4, 8, 12, 16, ...`。
- `maxJump` 应是小值，fixture 中建议 `<= 12`。
- 不应一次从 0 跳到完整段落。
- completed 后历史消息不应重新打字，应直接稳定显示完整内容。

### 失败信号

- active 阶段 length 长时间不变，随后一次性跳到完整段落。
- completed 历史消息打开面板后重新逐字播放。
- 面板 reasoning 与主消息 reasoning 行为不一致。

---

## 用例 12：页面隐藏 / 切回前台后 Activity 平滑流式继续追赶

### 场景

浏览器切到后台时 `requestAnimationFrame` 会暂停。若 `useSmoothStreaming` 在 `document.hidden` 时停止 RAF，但没有监听 `visibilitychange` 恢复，切回前台后面板可能停在旧进度，除非刚好有新 chunk 触发 effect。

### 操作

1. 打开 fixture：

```text
/test-chat-streaming-state?activity_reasoning_long=1&activity_panel_open=1
```

2. 等待 active reasoning 出现，记录 `beforeLen`。
3. 强制或真实触发页面隐藏：
   - browser tab 切后台，或 Playwright 中覆盖 `document.hidden=true` 并 dispatch `visibilitychange`。
4. 等待 1s 左右。
5. 切回前台：`document.hidden=false` + `visibilitychange`。
6. 每 60~80ms 采样 Activity reasoning length。

### 预期

- 隐藏期间 RAF 可暂停，length 可以保持不变。
- 切回前台后，如果 target 长于 displayed，应继续追赶。
- length 应从 `beforeLen` 继续递增到完整 reasoning。
- 不应卡死在隐藏前长度。

### 失败信号

- 切回前台后 length 不再增长。
- 只有新 chunk 到达时才恢复，若没有新 chunk 就永久停住。
- 为追赶而一次性全量跳出，造成段落闪现。

---

## 用例 13：Activity 面板 A→B→A 会话切换恢复

### 场景

用户在会话 A 的右侧 Activity 面板查看 reasoning，切到会话 B，再切回 A。需要验证面板不会串台、不会丢 reasoning、不会被 stale realtime 误判为 running，并且在 active/terminal 两种窗口下判定不同。

### 操作

1. 使用 live 专项脚本模式：

```bash
TESTNET_EMAIL=... TESTNET_PASSWORD=... TESTNET_BASE_URL=https://testnet.ai-space.xyz \
ACTIVITY_SWITCH_MODEL=deepseek-v4-pro \
node scripts/regression/chat-activity-panel-switch-live.cjs
```

2. 脚本应：
   - 新建会话 A。
   - 启动 DeepSeek search + reasoning。
   - 打开 A 并打开 Activity 面板。
   - 切到新会话 B。
   - 再切回 A。
   - 重新打开 Activity 面板。
   - 采样 panel reasoning length、请求、console/page errors。

### Active 窗口预期

切回 A 时如果任务仍在 running：

- `/api/tasks/:id/stream?after=...` 应出现。
- Activity 面板可打开。
- reasoning length 应继续小步递增。
- 不允许出现 B 会话内容或旧会话 reasoning。
- 无 console/page error。

### Terminal 窗口预期

切回 A 时如果 DeepSeek 已完成或 reasoning 已完整：

- 面板应稳定显示完整 reasoning。
- timeline 应显示 terminal 阶段：`Responded/模型响应`、`Search done/搜索完成`、`Reasoned/深度推理`、`Generated/回答完成`。
- reasoning length flat 是允许的，不能因此判失败。
- 不应闪 `正在推理` / running spinner。
- 无 console/page error。

### 失败信号

- 切回后 Activity 面板打不开。
- 面板显示 B 会话内容。
- completed 消息打开面板仍闪 running reasoning。
- active 阶段 reasoning 不增长且后端 task 仍在产生 sequence。
- terminal 阶段缺 `Generated/回答完成`。

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
- `[data-chat-activity-panel="true"]` 是否存在
- Activity panel reasoning text length / tail
- Activity panel timeline labels：`Responded/模型响应`、`Search done/搜索完成`、`Reasoned/深度推理`、`Generated/回答完成`
- Activity panel 是否出现 stale running 文案：`正在推理`、`Reasoning ·`、`Generating`
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
- `/api/tasks/:id`（Activity panel 打开后的 latest snapshot polling）
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
node scripts/regression/chat-activity-timeline-regression.cjs
TESTNET_EMAIL=... TESTNET_PASSWORD=*** TESTNET_BASE_URL=https://testnet.ai-space.xyz node scripts/regression/chat-active-task-interrupt-resume-live.cjs
TESTNET_EMAIL=... TESTNET_PASSWORD=*** TESTNET_BASE_URL=https://testnet.ai-space.xyz node scripts/regression/chat-quick-switch-live.cjs
TESTNET_EMAIL=... TESTNET_PASSWORD=*** TESTNET_BASE_URL=https://testnet.ai-space.xyz node scripts/regression/chat-activity-panel-switch-live.cjs
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
- [ ] completed polling 同步 backend `reasoning_content`，no-refresh 和 refresh 思考主体一致。
- [ ] Activity panel active reasoning 平滑小步增长，不是一段一段跳。
- [ ] 页面隐藏/切回前台后 Activity 平滑流式可继续追赶。
- [ ] Activity panel A→B→A 切换不串台；active 窗口继续增长，terminal 窗口完整稳定显示且有 `Generated/回答完成`。
- [ ] 同一 generation task 跨 optimistic/server stream 只能有一个 owner；旧 stream abort 后不 final sync/fallback。
- [ ] 同一 task sequence 跨 stream handler 只能 apply 一次。
- [ ] 空 placeholder 到 reasoning 首屏高度稳定，无明显二次抖动。
- [ ] completed 后 Stop 消失。
- [ ] completed 后 spinner/ellipsis 消失。
- [ ] completed 状态 no-refresh 正常。
- [ ] refresh 后与 no-refresh 基本一致。
- [ ] 无 console/page error。
- [ ] 若用户给具体 conversation，必须原 conversation 通过。
