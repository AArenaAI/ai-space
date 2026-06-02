# 标点符号翻译对照样本（100条）

用途：用于测试 AI Space `/translator` 在 Google Translation LLM + 前端确定性后处理下，对标点符号、外层 wrapper、技术 token 和目标语言标点习惯的处理是否符合预期。

## 样本文件

- JSONL：`translation-test-samples/punctuation_translation_examples_100.jsonl`
- 总数：100

## 覆盖设计

- 10 类标点/格式场景，每类 10 条：ASCII 引号、本地化引号、括号/方括号、省略号、破折号、冒号/分号、问号/叹号、列表逗号、书名号/标题标记、URL/code/placeholder/email。
- 5 个语言方向，每个方向 20 条：中文->英语、英语->简体中文、中文->日语、日语->简体中文、英语->日语。
- 每条包含 `expected_translation` 和 `expected_punctuation_behavior`，并用 `strict_preserve_punctuation` 标出是否要求严格保留标点结构；标点形态按目标语言规范映射。

## 按方向统计

|方向|数量|
|---|---:|
|中文->日语|20|
|中文->英语|20|
|日语->简体中文|20|
|英语->日语|20|
|英语->简体中文|20|

## 按类别统计

|类别|数量|
|---|---:|
|colon_semicolon|10|
|dash|10|
|ellipsis|10|
|list_commas|10|
|parentheses_brackets|10|
|question_exclamation|10|
|quotes_ascii|10|
|quotes_localized|10|
|technical_tokens|10|
|title_marks|10|

## 严格标点要求

|strict_preserve_punctuation|数量|
|---|---:|
|False|15|
|True|85|

## 评测建议

1. 调 `/api/translate` 获取 Google 原始译文。
2. 使用前端同款 `postProcessTranslationFormat(source_text, translated_text)` 后处理。
3. 对比：
   - `expected_translation`：严格期望译文。
   - `acceptable_translations`：可接受替代译文。
   - `expected_punctuation_behavior`：人工/脚本检查重点。
   - `strict_preserve_punctuation=true`：外层引号、括号、URL/code/placeholder 等结构应严格符合；引号/括号形态按目标语言规范映射，例如中译英 `“你好”` 应为 `"Hello"`。
4. 对 `strict_preserve_punctuation=false` 的标题/自然引语样本，不应只看字符是否完全一致；应检查标题/引语边界是否在目标语言中自然保留。
