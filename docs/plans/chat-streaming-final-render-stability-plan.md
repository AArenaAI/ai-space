# Chat 正文流式输出完成态稳定实施计划

> **文档定位:** 这是实施计划，描述 completed 后可见正文稳定、canonical reconciliation 与富文本 hydration gate 的长期方案；路线图见 `docs/plans/chat-compare-ux-roadmap.md`，回测标准见 `docs/testing/chat-switch-resume-regression-standard.md`。

## 背景

当前普通 Chat 输出正文时，用户能感知到：

```text
正文流式输出完成
↓
完成后又像刷新/重排了一次
```

用户期望更接近 Gemini / ChatGPT 的体验：

```text
输出过程中落下来的字，就是最终结果
完成后不要有可见二次刷新、换皮、跳高、重排
```

这不是单纯的视觉样式问题，而是涉及：

- 流式内容展示
- completed 后内容 canonical reconciliation
- 富文本 Markdown 渲染性能
- 会话切换/历史消息恢复稳定性
- 长消息/复杂 Markdown 的延迟 hydration

因此不能直接删除现有 `DeferredMarkdownRenderer`、`useSmoothStreaming` 或 completed reconciliation 逻辑。

---

## 现有机制为什么存在

### 1. `DeferredMarkdownRenderer` / 富文本延迟渲染

历史修复中已有记录：

```text
825f9be fix(chat): prevent cached switch and idle render flicker
```

当时解决的是：

```text
- 切换会话时历史消息不要重新刷一遍
- 历史 assistant 不要 idle 后突然从 lite 切 full
- 停留后才升级富文本
- 避免路由切换时 Loading chat history 闪烁
```

所以富文本延迟渲染不是临时方案，而是为了：

```text
- 长消息性能
- 历史消息滚动性能
- 首屏速度
- 避免历史消息全量重排
```

不能简单移除。

### 2. Completed content canonicalization

现有原则：

```text
running 时：live/realtime content 是展示源
completed 后：backend DB content 是最终权威内容
```

这是为了避免历史 bug：

```text
streaming 过程中正常
completed/background polling 后把 transient liveContent 当作更完整内容
结果 UI 里最终答案重复出现两遍
```

长期必须保留：

```ts
if (taskStatus === "completed" && dbContent.trim()) return dbContent;
if (liveContent.trim()) return liveContent;
return existingContent;
```

但要避免这次 canonical 对用户造成可见刷新。

### 3. Running row visual stability

历史文档要求：

```text
- pending/generating 行不要跳高
- optimistic id → server id 不要导致 DOM remount
- content-visibility 不要作用于生成中的 assistant 行
- restore 后旧消息不要像重新刷了一遍
```

因此本次问题不能只看单条消息内容，还要确保：

```text
- data-message-id 稳定
- row height 稳定
- Markdown renderer 不在完成瞬间整体替换 DOM
- 历史消息不被顺带刷新
```

---

## 当前二次刷新感的来源

### 1. Completed 后保留 streaming 分支

`AssistantMessageContent.tsx` 中存在：

```ts
const JUST_COMPLETED_STREAMING_HOLD_MS = 800;
const [keepCompletedStreaming, setKeepCompletedStreaming] = useState(false);
```

完成后会短暂进入：

```ts
finalizingRealtime
```

初衷：防止完成瞬间丢最后几个 token。

副作用：

```text
streaming renderer
↓
final renderer
```

用户感知为完成后二次刷新。

### 2. `useSmoothStreaming` 停止后继续追赶

`useSmoothStreaming` 逻辑：

```ts
isStreaming=false，但 displayedText 还没追上 targetText
→ 继续 RAF 补完
```

初衷：避免最终内容一帧跳全量，避免缺字。

副作用：

```text
模型已经 completed
UI 还在补一次文字/状态
```

### 3. Markdown renderer 在完成态切换

当前链路：

```text
StreamingText
→ StreamingMarkdownView
→ DeferredMarkdownRenderer
→ completed 后 final MarkdownRenderer / rich hydrate
```

如果 streaming 时使用 plain/lite fallback，完成后立即升级 full Markdown，会产生：

```text
轻量文本/流式 Markdown
↓
最终富文本 Markdown
```

这就是用户看到的“输出完又刷了一下”。

---

## 长期目标

### 目标 1：落字即最终视觉

流式阶段显示出来的文字，在完成后不应该被整体替换。

理想体验：

```text
streaming 中看到的 DOM
completed 后继续保留同一 DOM identity
只更新状态，不重建正文区域
```

### 目标 2：保留 completed canonical 内容权威

不能为了视觉稳定放弃 backend DB content 作为最终答案。

需要做到：

```text
数据可以 canonical
视觉不要刷新
```

### 目标 3：富文本 hydration 与 completed 解耦

不要把：

```text
completed
```

等同于：

```text
马上 full rich Markdown hydrate
```

应该改成：

```text
completed → 稳定当前视觉
idle / viewport / non-active → 静默升级富文本
```

### 目标 4：不破坏历史性能优化

保留：

```text
- DeferredMarkdownRenderer
- rich lite fallback
- viewport/idle hydration
- 长消息性能保护
- 历史消息恢复稳定策略
```

---

## 推荐长期架构

引入统一的：

```text
AssistantAnswerRenderer
```

不要让 streaming 和 final 使用两个完全不同分支。

### 当前问题结构

```text
StreamingText 分支
Final MarkdownRenderer 分支
```

完成时从一个分支切到另一个分支。

### 目标结构

```tsx
<AssistantAnswerRenderer
  messageId={message.id}
  liveContent={runtimeState.content}
  dbContent={message.content}
  reasoningContent={runtimeState.reasoningContent}
  status={runtimeState.status}
/>
```

内部状态机：

```text
pending
streaming
settling
completed-stable
hydrated
```

---

## 核心设计

### 1. Visible Stable Layer

负责用户眼前看到的稳定内容。

规则：

```ts
if streaming:
  display live content incrementally

if completed:
  if normalized(displayedContent) === normalized(canonicalDbContent):
    keep displayed DOM untouched
  else:
    silently replace content without animation/smooth/re-mount
```

禁止 completed 瞬间：

```text
- 重新 mount answer DOM
- 重新跑 appear animation
- 重新 smooth streaming
- 立即切 full Markdown renderer
```

### 2. Semantic Hydration Layer

负责富文本增强。

规则：

```text
streaming/latest active assistant:
  使用稳定轻量 renderer

completed 后：
  保留当前 renderer

idle + viewport + 非 active generation：
  再升级 full MarkdownRenderer
```

富文本升级必须：

```text
- 保持外层 DOM 不变
- 保持高度 guard
- 不触发 message row remount
- 不影响旧消息
```

---

## 具体实施计划

### 阶段一：梳理状态源

统一判断：

```text
running/live source
completed canonical source
displayed stable source
hydration source
```

明确：

```ts
runningContent = realtime/live stream
canonicalContent = backend DB content when completed
visibleContent = current DOM/displayed text
hydrationContent = canonicalContent but only after stable gate
```

### 阶段二：抽 `AssistantAnswerRenderer`

将当前分散在：

```text
StreamingText.tsx
AssistantMessageContent.tsx
StreamingMarkdownView.tsx
DeferredMarkdownRenderer.tsx
```

里的正文展示状态收敛到一个 renderer。

保留 ThinkBlock / reasoning 入口，但正文 answer 只走一个稳定通道。

### 阶段三：取消 completed 瞬间可见切换

调整：

```text
keepCompletedStreaming / finalizingRealtime
```

从“继续保留 streaming 分支”改为“visible stable commit”：

```ts
onCompleted() {
  const canonical = dbContent || liveContent;
  if (sameVisibleContent(displayed, canonical)) {
    keepCurrentDom();
  } else {
    replaceSilently(canonical);
  }
}
```

注意：不是简单删除 `keepCompletedStreaming`，而是用更稳定的 completed commit 机制替代。

### 阶段四：富文本 hydration gate

新增 gate：

```text
canHydrateRichText =
  !isStreaming
  && !justCompletedWithinShortWindow
  && isNearViewport
  && !userBrowsing
  && !activeGeneration
```

完成瞬间不要立刻 hydrate。

### 阶段五：保留 canonical 防重复

completed 后必须仍然：

```ts
prefer dbContent over liveContent
```

并新增 regression 防止重复答案：

```text
liveContent = final final
dbContent = final
status = completed
expected = final
```

---

## 需要补的回归验证

### 1. 完成后无二次刷新

测试流程：

```text
真实 UI 发送 deterministic prompt
要求模型输出 B001 ... B120
采样：
  streaming 中
  done 瞬间
  done + 300ms
  done + 1200ms
```

断言：

```text
- latest assistant row data-message-id 不变
- answer text 不重复
- row height 无明显突变
- answer DOM 不卸载/重挂
- bottom Stop 消失
- completed card 无 spinner / ellipsis
```

### 2. Markdown 富文本稳定

测试内容：

```text
列表
代码块
表格
数学公式
长段落
```

断言：

```text
- 完成瞬间不立即大幅重排
- hydrate 前后纯文本一致
- hydrate 后高度变化在可接受范围
- 历史消息不因当前消息完成而刷新
```

### 3. 路由切换恢复

流程：

```text
发送消息
输出中切换到其他会话
切回
等 completed
不刷新页面
```

断言：

```text
- running 内容续上
- completed 后不重复
- reasoning/answer 都不丢
- row id 稳定
- 无二次刷新感
```

---

## 不建议的短期粗暴改法

不要直接：

```text
- 删除 DeferredMarkdownRenderer
- 删除 all markdown hydration delay
- completed 后强制 full MarkdownRenderer
- 完全禁用 canonical DB content
- 直接移除 useSmoothStreaming 的 catch-up
```

这些可能重新引入：

```text
- 长消息卡顿
- 历史消息切换闪烁
- markdown 富文本升级重排
- completed 后内容重复
- route switch 后内容丢失
```

---

## 最终原则

长期方案一句话：

> 完成态只做数据 canonical，不做可见 renderer 切换；富文本 hydration 从 completed 瞬间解耦，放到稳定后的 idle/viewport 阶段静默发生。

目标效果：

```text
流式输出：落字即最终
完成瞬间：不刷新、不跳高、不换皮
完成之后：后台静默 canonical + 延迟富文本 hydration
历史消息：性能保护继续保留
```
