# Google Cloud Translation 质量报告（当前 `/api/translate`）

测试入口：`POST /api/translate`，后端 provider：`google-cloud-translate-v3`，请求模型：`general/translation-llm`。
实际返回模型：`projects/ai-space-498113/locations/global/models/general/translation-llm`
样本：沿用上一轮 Gemini 翻译质量报告的 30 条代表样本与同一套 exact/acceptable/strict punctuation 评分口径。

## 总体指标

- 完成：30/30，错误：0
- Exact match：10/30 = 33.3%
- Acceptable match：10/30 = 33.3%
- Punctuation OK（全部样本）：25/30 = 83.3%
- Strict punctuation OK（严格标点样本）：16.7%
- ASCII outer wrapper OK：30/30 = 100.0%
- 平均延迟：0.266s，P50：0.274s，最大：0.395s
- 后处理改变：6/30

## 按类别统计

|类别|样本数|Exact|Acceptable|Punctuation OK|
|---|---:|---:|---:|---:|
|business|5|1|1|5|
|code|2|1|1|2|
|format|2|1|1|2|
|health|4|3|3|4|
|polite|11|3|3|6|
|request|2|0|0|2|
|travel|2|1|1|2|
|uncertainty|2|0|0|2|

## 代表性未命中/风险样例

|ID|方向|类别|原文|期望/可接受|实际|问题|
|---|---|---|---|---|---|---|
|TR-0058|日语->简体中文|polite|"お忙しいところ恐れ入ります。"|"百忙之中打扰您了。" / "在您忙碌的时候打扰了。"|"百忙之中打扰了。"|未命中fixture|
|TR-0008|英语->简体中文|polite|"Please let me know if you need anything."|"如果你需要任何东西，请告诉我。" / "如果你需要什么，请告诉我。"|"如果您需要什么，请告诉我。"|未命中fixture；严格标点不一致|
|TR-0101|韩语->简体中文|health|몸은 괜찮으신가요?|您身体还好吗？ / 您身体没事吧？|身体还好吗？|未命中fixture|
|TR-0108|韩语->简体中文|polite|"필요한 것이 있으면 알려 주세요."|"如果有需要，请告诉我。" / "如果你需要什么，请告诉我。"|"如果有需要，请告诉我。"|严格标点不一致|
|TR-0208|德语->简体中文|polite|"Bitte sagen Sie mir Bescheid, wenn Sie etwas brauchen."|"如果您需要什么，请告诉我。" / "如有需要，请通知我。"|"如果您需要什么，请告诉我。"|严格标点不一致|
|TR-0908|中文->英语|polite|"如果你需要什么，请告诉我。"|"Please let me know if you need anything." / "Let me know if you need anything."|"If you need anything, please let me know."|未命中fixture；严格标点不一致|
|TR-0958|中文->日语|polite|"如果您需要什么，请告诉我。"|"何か必要なものがあればお知らせください。" / "必要なことがあれば教えてください。"|"何か必要なものがございましたら、お知らせください。"|未命中fixture；严格标点不一致|
|TR-0006|英语->简体中文|polite|Please let me know if you need anything.|如果你需要任何东西，请告诉我。 / 如果你需要什么，请告诉我。|如果您需要什么，请告诉我。|未命中fixture|
|TR-0011|英语->简体中文|business|I will send you the document tomorrow morning.|我明天早上会把文件发给你。 / 明天早上我会把文件发给你。|我明天早上把文件发给你。|未命中fixture|
|TR-0016|英语->简体中文|business|The meeting has been postponed until next Friday.|会议已推迟到下周五。 / 会议已经延期到下周五。|会议已推迟至下周五。|未命中fixture|
|TR-0021|英语->简体中文|request|Could you check this issue again?|你能再检查一下这个问题吗？ / 能否请你再确认一下这个问题？|您能再检查一下这个问题吗？|未命中fixture|
|TR-0026|英语->简体中文|uncertainty|I am not sure whether this approach will work.|我不确定这种方法是否可行。 / 我不确定这个方案是否行得通。|我不确定这种方法是否行得通。|未命中fixture|

## 后处理改变样例

|ID|原始输出|后处理后|
|---|---|---|
|TR-0058|百忙之中打扰了。|"百忙之中打扰了。"|
|TR-0008|如果您需要什么，请告诉我。|"如果您需要什么，请告诉我。"|
|TR-0108|如果有需要，请告诉我。|"如果有需要，请告诉我。"|
|TR-0208|如果您需要什么，请告诉我。|"如果您需要什么，请告诉我。"|
|TR-0908|If you need anything, please let me know.|"If you need anything, please let me know."|
|TR-0958|何か必要なものがございましたら、お知らせください。|"何か必要なものがございましたら、お知らせください。"|

## 产物

- 原始逐条结果：`translation-test-samples/google_translate_quality_current.jsonl`
- 汇总 JSON：`translation-test-samples/google_translate_quality_current_summary.json`
- 本报告：`translation-test-samples/google-translate-quality-report.md`
