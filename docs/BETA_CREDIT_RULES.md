# 内测 Credit 规则

## 单位

- 1 Credit = 1 元人民币。
- 后端内部存储单位为“分”：1 Credit = 100 分。
- Chat 3 成本为 0.006 Credit/条，当前整数分粒度下按最小 1 分扣费；如后续需要精确到 0.006，可迁移到 micro-credit。

## 三阶段熔断

| 阶段 | 发放 | 触发 | 解锁 |
| --- | ---: | --- | --- |
| Phase 1 试探期 | 50 Credits / 5000 分 | beta_credit_balance 归零 | 1 个有效 Bug/逻辑错误案例审核通过 |
| Phase 2 深水区 | 150 Credits / 15000 分 | beta_credit_balance 归零 | 2 个详尽上下文的致命逻辑断点 + 人类专家级标准答案 |
| Phase 3 枯竭期 | 100 Credits / 10000 分 | beta_credit_balance 归零 | 内测结束 |

人均基础预算：300 Credits / 30000 分。

## 钱包隔离

内测 Credit 使用独立字段，不混入会员套餐钱包：

- `beta_credit_balance`
- `beta_credit_granted_total`
- `beta_credit_used_total`
- `beta_phase`
- `beta_batch`

会员套餐仍使用：

- `basic_credits`
- `advanced_credits`
- `elite_credits`
- `plan_tier`

邀请激活和 Bad Case 阶段解锁不得修改 `plan_tier`，也不得把内测额度发到 `basic_credits`。

## 模型成本

| 运营模型 | 成本 | 内部分值 |
| --- | ---: | ---: |
| Chat 1 | 22 Credits / 条 | 2200 |
| Chat 2 | 0.5 Credit / 条 | 50 |
| Chat 3 | 0.006 Credit / 条 | 当前最小 1 分 |
| Image 1 | 1 Credit / 条 | 100 |
| Image 2 | 0.2 Credit / 条 | 20 |
| Video 1 | 1.5 Credits / 秒 | 150 / 秒 |
| Video 2 | 0.5 Credit / 秒 | 50 / 秒 |

实际模型 ID 到运营模型的映射由 `beta_model_costs` 配置控制，管理员可在后台调整。视频模型扣费时应按时长传入 `amount = seconds * per_second_fen`。

## 批次权限

| 批次 | 测试目标 | 权限 |
| --- | --- | --- |
| batch-1 | 复杂逻辑与长文本 | 关闭 Image 1、Video 1、Video 2；允许 Chat 1/2/3 |
| batch-2 | 图像与多模态 | 锁死 Chat 1；开放 Image/Video |
| batch-3 | 综合极限抗压与回归 | 模型全开 |

## 高成本确认

Chat 1 必须二次确认：

> 本次极度深度推理将消耗 22 Credits，确定执行？
