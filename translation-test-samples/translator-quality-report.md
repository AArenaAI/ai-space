# AI Space 翻译质量报告（当前项目真实 API）

生成时间：2026-06-01  
测试入口：`/api/chat`，请求参数与前端翻译页一致：`stream: true`、`search: false`、`reasoning: false`、`conversation_id: 0`。  
系统提示词来源：自动抽取 `frontend/app/(main)/(work)/translator/page.tsx`。  
默认模型：`gemini-3.1-flash-lite`。  
测试账号：脚本自动注册 free 用户（30 basic credits），本次完成 30/30，无额度错误。  
最终体验评分：按前端实际路径，对模型输出应用 `postProcessTranslationFormat` 后评分。

## 总体结论

当前版本适合作为**快速、低成本、日常翻译默认模型**：延迟很低，普通语义翻译大多自然，外层 ASCII 引号/括号可由确定性后处理兜住。但它还不适合作为**严格标点镜像型翻译器**，尤其是句内逗号/句号序列严格一致要求下，模型仍会按目标语言习惯改写。

- 完成：30/30，错误：0
- Exact match：9/30 = 30.0%
- Acceptable match：11/30 = 36.7%
- Punctuation OK（全部样本）：25/30 = 83.3%
- Strict punctuation OK（严格标点样本）：16.7%
- ASCII outer wrapper OK：30/30 = 100.0%
- 平均延迟：1.212s，P50：0.72s，最大：6.34s

> 说明：Exact/Acceptable 是 fixture 字符串匹配，保守偏严。很多未命中项是自然同义改写（例如“文件/文档”、“推迟至/推迟到”），不等同于真实不可用；但它能暴露模型在礼貌程度、人称和严格标点上的稳定性。

## 按类别统计

|类别|样本数|Exact|Acceptable|Punctuation OK|
|---|---:|---:|---:|---:|
|business|5|0|0|5|
|code|2|1|1|2|
|format|2|1|1|2|
|health|4|1|2|4|
|polite|11|5|5|6|
|request|2|0|0|2|
|travel|2|1|2|2|
|uncertainty|2|0|0|2|

## 确定性格式后处理效果

本轮 30 条中，后处理改变 1 条。主要改善是把模型本地化的外层引号恢复为源文 ASCII 外层结构。

|ID|原始模型输出|后处理后|改善|
|---|---|---|---|
|TR-0958|「何か必要なものがございましたら、お知らせください。」|"何か必要なものがございましたら、お知らせください。"|外层ASCII wrapper恢复|

本次已新增并验证的格式 guard：

- 外层 ASCII wrapper：`"..."`、`'...'`、`() / [] / {} / ```...````
- 首尾空白保留
- inline code：`` `code` ``
- URL / email
- 常见变量与占位符：`{{var}}`、`{var}`、`%{var}`、`$API_URL`、`CLIENT_SECRET`
- Markdown link target：`[text](url)` 中的 URL
- HTML/XML tag：`<strong class="x">...</strong>` 中的 tag
- fenced code block：整块代码恢复

专用回归：`npm run test:translator`，当前 18/18 通过。

## 主要失败类型

### 1. 严格句内标点仍不稳定

外层 ASCII 引号已能兜住，但句内逗号/句号数量和位置仍会按目标语言习惯变化。这是当前最大剩余问题，也是不建议继续堆 prompt 的原因。

|ID|方向|类别|原文|期望/可接受|实际|问题|
|---|---|---|---|---|---|---|
|TR-0008|英语->简体中文|polite|"Please let me know if you need anything."|"如果你需要任何东西，请告诉我。" / "如果你需要什么，请告诉我。"|"如果你需要任何东西，请告诉我。"|严格标点序列不一致|
|TR-0108|韩语->简体中文|polite|"필요한 것이 있으면 알려 주세요."|"如果有需要，请告诉我。" / "如果你需要什么，请告诉我。"|"如果您有什么需要，请告诉我。"|语义/表达未命中fixture；严格标点序列不一致|
|TR-0208|德语->简体中文|polite|"Bitte sagen Sie mir Bescheid, wenn Sie etwas brauchen."|"如果您需要什么，请告诉我。" / "如有需要，请通知我。"|"如果您需要什么，请告诉我。"|严格标点序列不一致|
|TR-0908|中文->英语|polite|"如果你需要什么，请告诉我。"|"Please let me know if you need anything." / "Let me know if you need anything."|"If you need anything, let me know."|语义/表达未命中fixture；严格标点序列不一致|
|TR-0958|中文->日语|polite|"如果您需要什么，请告诉我。"|"何か必要なものがあればお知らせください。" / "必要なことがあれば教えてください。"|"何か必要なものがございましたら、お知らせください。"|语义/表达未命中fixture；严格标点序列不一致|

### 2. 礼貌程度有时偏正式或偏泛化

英语普通 `you` 偶尔仍会被翻成“您”；礼貌请求有时会被泛化为“如有需要请告知”，牺牲了 fixture 中的具体表达。

### 3. 自然同义改写导致 fixture 不命中

不少输出从真实使用角度可以接受，但不在当前 acceptable list 中，例如“文档/文件”、“推迟至/推迟到”、“奏效/可行”。这说明后续质量评估需要继续区分：

- 字符串 exact / acceptable
- 人工或 LLM semantic acceptability
- 严格格式/结构

## 代表性未命中样例

|ID|方向|类别|原文|期望/可接受|实际|问题|
|---|---|---|---|---|---|---|
|TR-0051|日语->简体中文|health|体調など崩されていませんか？|您身体还好吗？ / 您最近身体还好吗？ / 您没有身体不舒服吧？|您身体没出什么问题吧？|语义/表达未命中fixture|
|TR-0108|韩语->简体中文|polite|"필요한 것이 있으면 알려 주세요."|"如果有需要，请告诉我。" / "如果你需要什么，请告诉我。"|"如果您有什么需要，请告诉我。"|语义/表达未命中fixture；严格标点序列不一致|
|TR-0151|法语->简体中文|health|Vous vous sentez bien ?|您感觉还好吗？ / 您还好吗？|您感觉好吗？|语义/表达未命中fixture|
|TR-0908|中文->英语|polite|"如果你需要什么，请告诉我。"|"Please let me know if you need anything." / "Let me know if you need anything."|"If you need anything, let me know."|语义/表达未命中fixture；严格标点序列不一致|
|TR-0958|中文->日语|polite|"如果您需要什么，请告诉我。"|"何か必要なものがあればお知らせください。" / "必要なことがあれば教えてください。"|"何か必要なものがございましたら、お知らせください。"|语义/表达未命中fixture；严格标点序列不一致|
|TR-0006|英语->简体中文|polite|Please let me know if you need anything.|如果你需要任何东西，请告诉我。 / 如果你需要什么，请告诉我。|如果您有任何需要，请告知我。|语义/表达未命中fixture|
|TR-0011|英语->简体中文|business|I will send you the document tomorrow morning.|我明天早上会把文件发给你。 / 明天早上我会把文件发给你。|我明天早上把文件发给你。|语义/表达未命中fixture|
|TR-0016|英语->简体中文|business|The meeting has been postponed until next Friday.|会议已推迟到下周五。 / 会议已经延期到下周五。|会议已推迟至下周五。|语义/表达未命中fixture|
|TR-0021|英语->简体中文|request|Could you check this issue again?|你能再检查一下这个问题吗？ / 能否请你再确认一下这个问题？|您可以再核查一下这个问题吗？|语义/表达未命中fixture|
|TR-0026|英语->简体中文|uncertainty|I am not sure whether this approach will work.|我不确定这种方法是否可行。 / 我不确定这个方案是否行得通。|我不确定这种方法是否有效。|语义/表达未命中fixture|

## 最终判断

建议保留当前策略：

1. 默认模型继续使用 `gemini-3.1-flash-lite`。
2. Prompt 保持当前泛化规则，不继续加入具体样本答案或错误译法。
3. 格式一致性继续走 deterministic guard，而不是 prompt 堆规则。
4. 后续若要提升质量，优先做两件事：
   - 扩充 acceptable variants / 加语义评审，避免把自然同义译文误判为失败；
   - 如产品要“严格标点镜像模式”，单独加一个严格模式，不影响默认自然翻译。

## 产物

- 原始逐条结果：`translation-test-samples/project_translator_quality_current.jsonl`
- 汇总 JSON：`translation-test-samples/project_translator_quality_current_summary.json`
- 测试脚本：`translation-test-samples/run_project_translator_quality_current.py`
- 格式后处理：`frontend/lib/translatorFormat.ts`
- 格式回归：`frontend/scripts/regression/translator-format-regression.cjs`
