# GPT 限流处理

## 背景

AI Pool 在调用 OpenAI / GPT 系列模型进行长文本生成时，可能出现一种前后端状态不一致的问题：

> 实时生成过程中，最后收到 `rate_limit_exceeded` 或 `OpenAI response status=failed`，前端显示生成失败；但实际正文已经完整写入 `messages.content`，刷新页面后又能看到完整答案。

这类问题不是单纯的流式解析问题，而是 **后台任务终态、消息内容终态、前端实时展示状态三者不一致**。

---

## 典型案例

一次实际排查中，用户反馈“任务 2111”异常。经查：

- `2111` 实际是 `messages.id`，不是 `ai_background_tasks.id`；
- 对应后台任务是 `ai_background_tasks.id = 432`；
- 模型：`gpt-5.5`；
- provider：`openai`；
- task 最终状态：`failed`；
- assistant message 内容长度：`22966`；
- `messages.completed_at` 已有值；
- `ai_background_tasks.result` 中也保存了完整正文；
- 事件最后为：
  - `rate_limit_exceeded`
  - `OpenAI response status=failed`

结果表现为：

| 层级 | 状态 |
|---|---|
| `messages.content` | 已保存完整正文 |
| `messages.completed_at` | 已完成 |
| `ai_background_tasks.status` | `failed` |
| `ai_background_task_events` | 最后事件是 `error` |
| 前端实时态 | 显示失败 |
| 刷新后状态 | 显示完整答案 |

本质问题：

> provider 最后的 failed/error 覆盖了已经成功落库的完整 message 状态。

---

## 问题根因

### 1. task 状态过于粗糙

当前任务状态大致只有：

```txt
running / completed / failed
```

但 GPT 长文本生成中存在更细的状态：

1. 完全成功；
2. 生成完成但过程中有 rate limit / retry / warning；
3. 已有部分内容但最终中断；
4. 完全失败，没有有效内容；
5. 用户主动停止。

如果全部压成 `failed`，就会导致前端误判。

---

### 2. error event 被当成最终失败

当前前端/任务逻辑容易出现：

```txt
最后一个 event = error
=> 整条消息失败
```

但对于 OpenAI Responses API，`error` 可能只是：

- 某次 retry 的中间错误；
- rate limit 后仍可继续；
- 生成接近完成后的 provider 状态异常；
- 搜索/工具调用阶段的可恢复错误；
- 已经落库之后的收尾失败。

因此，不能把所有 error 都视为 fatal。

---

### 3. 重试后的 sequence_number 重复

实际排查发现，同一个 `task_id` 下，不同 OpenAI `response_id` 的事件序号多次从 `2` 重新开始。

这会影响：

- 前端事件排序；
- 断线续流；
- SSE 回放；
- 调试定位；
- 最终状态判断。

正确做法应该是：

```txt
task 维度 sequence_number 全局单调递增
provider response 维度用 attempt_number / provider_response_id 区分
```

---

## 设计目标

统一三类状态：

1. **消息内容状态**：`messages.content` 是否存在、是否完整；
2. **任务执行状态**：`ai_background_tasks.status`；
3. **前端展示状态**：用户实时看到的是成功、失败、部分失败还是带警告完成。

最终原则：

> 如果 `messages.content` 已经完整落库，前端刷新态和实时态必须一致。

---

## 推荐状态模型

建议将后台任务状态扩展为：

```txt
queued
running
completed
completed_with_warning
partial_failed
failed
cancelled
```

### 状态含义

| 状态 | 含义 | 前端展示 |
|---|---|---|
| `queued` | 等待执行 | 等待中 |
| `running` | 正在生成 | 流式输出中 |
| `completed` | 正常完成，收到 DONE，内容落库 | 正常展示 |
| `completed_with_warning` | 内容完整，但过程中或结尾出现 rate limit / provider failed | 正常展示，可弱提示 |
| `partial_failed` | 有部分内容，但没有正常完成 | 展示已有内容 + 中断提示 |
| `failed` | 没有有效正文，任务失败 | 显示失败 |
| `cancelled` | 用户主动停止 | 显示已停止 |

---

## 状态判定规则

| 场景 | task status | message 状态 | 前端展示 |
|---|---|---|---|
| 收到正常 DONE，内容落库 | `completed` | completed | 正常完成 |
| 最后 provider failed，但已有完整 `message.content` | `completed_with_warning` | completed | 正常展示答案，可弱提示 |
| 有部分 delta，但没有 DONE，也没有最终完整 content | `partial_failed` | completed / interrupted | 显示已有内容 + 生成中断 |
| 没有任何有效正文 | `failed` | failed | 显示失败 |
| 用户主动停止 | `cancelled` | stopped | 显示已停止 |

典型 GPT 限流场景应归类为：

```txt
completed_with_warning
```

而不是：

```txt
failed
```

---

## 后端处理原则

### 1. `messages.content` 优先级高于最后一条 event

最终展示优先级应为：

```txt
messages.content + messages.completed_at
  > ai_background_tasks.status
  > ai_background_task_events 最后一条 event
```

只要 message 已经有完整正文并完成落库，后端不应再将任务简单标记成纯失败。

---

### 2. 区分 fatal error 和 recoverable warning

error payload 建议增加语义字段：

```json
{
  "_error_meta": {
    "category": "rate_limit",
    "code": "rate_limit_exceeded",
    "retriable": true,
    "fatal": false,
    "affects_content": false,
    "user_message": "gpt-5.5 当前达到官方速率限制，建议稍后重试"
  }
}
```

前端只应对：

```json
"fatal": true
```

进入真正失败状态。

---

### 3. DONE 必须是最终收束事件

理想事件序列：

```txt
generation_task running
delta...
recoverable_error rate_limit
retry_started
delta...
warning rate_limit
final_content_persisted
DONE
```

如果 provider 最后返回 failed，但系统已经判定内容完整：

```txt
delta...
provider_failed_warning
final_content_persisted
DONE
```

不应出现：

```txt
delta...
error rate_limit
error stream_failed
```

否则前端容易把最后一个 error 当成整条消息失败。

---

## 后端 finalize 逻辑

建议在 `runGenerationTask` 或统一任务收尾逻辑中做最终归一化。

伪代码：

```go
func finalizeTask(task, message, events, providerErr) {
    hasContent := strings.TrimSpace(message.Content) != ""
    hasCompletedAt := message.CompletedAt != nil
    gotDone := events.HasDone()
    errIsRecoverable := isRecoverable(providerErr)

    switch {
    case gotDone && hasContent:
        task.Status = "completed"

    case hasContent && hasCompletedAt && providerErr != nil:
        task.Status = "completed_with_warning"
        task.ErrorMessage = providerErr.UserMessage
        appendFinalDoneEvent(task, message)

    case hasContent && providerErr != nil:
        task.Status = "partial_failed"
        task.ErrorMessage = providerErr.UserMessage

    case providerErr != nil:
        task.Status = "failed"
        task.ErrorMessage = providerErr.UserMessage

    default:
        task.Status = "completed"
    }
}
```

关键规则：

> 不要让 provider 最后的 failed 状态无条件覆盖已经落库的完整 message。

---

## 最小改动方案

如果暂时不想大改状态模型，可以先做最小修复。

### 后端最小修复

在任务失败收尾处增加判断：

```go
if providerErr != nil && strings.TrimSpace(finalContent) != "" {
    task.Status = "completed_with_warning"
    task.ErrorMessage = providerErr.UserMessage
    message.Content = finalContent
    message.CompletedAt = now
    appendDoneEvent()
    return
}
```

如果暂时不新增 `completed_with_warning` 状态，也可以先降级为：

```go
if providerErr != nil && strings.TrimSpace(finalContent) != "" {
    task.Status = "completed"
    task.ErrorMessage = "completed with warning: " + providerErr.Error()
    message.Content = finalContent
    message.CompletedAt = now
    appendDoneEvent()
    return
}
```

但更推荐新增 `completed_with_warning`，语义更清晰。

---

## 前端展示策略

前端不要只根据最后一个 SSE event 判断整条消息失败。

建议逻辑：

```ts
if (message.content?.trim() && message.completed_at) {
  showCompletedMessage()
} else if (task.status === 'completed_with_warning') {
  showMessageWithWeakWarning()
} else if (task.status === 'partial_failed') {
  showPartialMessageWithInterruptedNotice()
} else if (task.status === 'failed') {
  showFailedCard()
}
```

### `completed_with_warning`

正常展示答案。

可选弱提示：

```txt
生成过程中发生限流重试，内容已保存
```

默认也可以不显示，只在调试模式显示。

### `partial_failed`

展示已有内容，并显示：

```txt
生成中断，以上为已生成内容
```

可提供操作：

```txt
继续生成 / 重试 / 复制已有内容
```

### `failed`

只有在没有任何有效正文时才显示失败卡片。

---

## 事件序号优化

当前问题：同一个 `task_id` 内不同 OpenAI `response_id` 的 `sequence_number` 会重复。

建议改为：

```txt
task_id + sequence_number 全局单调递增
provider_response_id 只表示上游响应 ID
attempt_number 表示第几次尝试
```

示例：

| task_id | attempt_number | provider_response_id | sequence_number | event_type |
|---|---:|---|---:|---|
| 432 | 1 | resp_a | 1 | generation_task |
| 432 | 1 | resp_a | 2 | delta |
| 432 | 1 | resp_a | 3924 | error |
| 432 | 2 | resp_b | 3925 | retry_started |
| 432 | 2 | resp_b | 3926 | delta |
| 432 | 2 | resp_b | 4133 | delta |
| 432 | 2 | resp_b | 4134 | warning |
| 432 | 2 | resp_b | 4135 | done |

这样可以保证：

- 断线续流稳定；
- 前端事件回放稳定；
- 调试日志可读；
- 不同 retry attempt 不会互相覆盖。

---

## 推荐落地顺序

### 第一阶段：后端终态归一化

优先修：

```txt
有正文 + provider failed
=> completed_with_warning / partial_failed
```

这是最关键的。

---

### 第二阶段：保证 DONE 最后

即便 provider failed，只要系统判定已有最终内容，也由后端追加统一终止事件：

```txt
final_content_persisted
DONE
```

不要让 `error` 成为最后事件。

---

### 第三阶段：修复 sequence_number

重试后继续递增，不要重复。

---

### 第四阶段：前端支持细状态

支持：

- `completed_with_warning`
- `partial_failed`
- `failed`

避免所有 error 都进入同一种失败 UI。

---

## 最终期望

对于类似 `message=2111 / task=432` 的场景，最终状态应该是：

```txt
ai_background_tasks.status = completed_with_warning
messages.completed_at = 有值
messages.content = 完整答案
前端实时态 = 展示完整答案
可选弱提示 = 生成过程中触发限流重试
```

而不是：

```txt
ai_background_tasks.status = failed
前端实时态 = 显示失败
刷新页面后 = 显示完整答案
```

一句话总结：

> GPT 限流处理的核心不是隐藏错误，而是统一消息最终内容、任务最终状态和前端展示状态；不能让最后一个 provider error 覆盖已经成功落库的答案。
