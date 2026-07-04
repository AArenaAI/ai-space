# 高考志愿 AI 数据导入记录（更新版）

## 数据源

- 数据集：GaokaoCompass / Gaokao-Compass-11M
- GitHub：https://github.com/choucisan/GaokaoCompass
- HuggingFace：https://huggingface.co/datasets/choucsan/Gaokao-Compass-11M
- 高校基础字典：教育部 2025《全国普通高等学校名单》
  - 教育部页面：https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/A03/202506/t20250627_1195683.html
  - 附件：`全国普通高等学校名单` XLS
- 高校增强字典：`gaokao-pro` npm 包 `school-index.json.gz`，用于补学校类型、公民办、985/211/双一流等结构化字段。
- 主要导入文件：
  - `data/2025/<province>/school-admission.csv`
  - `data/2025/<province>/major-admission.csv`
  - `data/2025/<province>/enrollment-plan.csv`
- 来源标记写入每条记录 `source` 字段。

## 已完成导入

### 1. 院校/专业组投档线

- 2025 年：全国 28 个省份有效位次数据。
- 记录数：约 50,884 条 2025 院校/专业组层记录。
- 额外导入 2022/2023 院校线数据，用于补青海、山西等 2025 缺位次省份的历史参考。

### 2. 专业级录取线

- 已导入 `major-admission.csv`。
- 2025 专业级记录：约 332,922 条。
- 推荐接口现在可以返回 `data_level = 专业录取`。

### 3. 招生计划 / 学费 / 选科要求

- 已新增独立表 `gaokao_enrollment_plans`。
- 已导入 `enrollment-plan.csv`：2025 年 519,831 条招生计划记录。
- 其中：
  - 有学费记录：427,786 条
  - 有招生计划数记录：397,524 条
  - 覆盖省份：30 个
- 推荐接口会优先使用 admission 自带字段；当学费/计划/选科为空时，再按“同年 + 生源省 + 学校 + 专业ID/专业组/专业名 + 科类”到计划表做补全。
- 已增加专业名标准化 fallback：去括号、去“类/试验班/方向/中外合作”等噪声后做包含匹配。
- 已增加专业大类映射：计算机/软件/人工智能/数据科学、电子信息、自动化、电气、机械、材料、工商管理、金融、法学、医学等族内可互相补计划/学费。
- 当前 smoke：广东 5 万位次、计算机/软件偏好，Top80 推荐中 80 条已补出学费。

### 4. 院校城市 / 层级字典

- 已接入教育部 2025《全国普通高等学校名单》作为权威基础源。
- 已接入 `gaokao-pro` 学校索引作为增强源，补充学校类型、公民办、985/211/双一流。
- 回填字段：
  - `moe_code`：教育部学校标识码
  - `department`：主管部门
  - `province` / `city`：省份、所在地
  - `level`：本科/专科 + 985/211/双一流组合层级
  - `ownership`：公办/民办
  - `school_type`：综合类/理工类/师范类/医药类/财经类等
  - `dual_class`：双一流标记
- 回填效果：
  - 学校总记录：23,970
  - 缺城市：11,261 → 561
  - 公民办未知：13,345 → 703
  - 缺学校类型：23,970 → 1,188
  - 缺教育部标识码：23,970 → 912
  - 有学校类型：22,782
  - 有双一流标记：3,057

## 暂缺 / 限制

- 青海：2025/2024/2023 源文件缺失，2022 有位次数据，已导入历史参考。
- 山西：2025/2024 无位次，2023/2022 有位次，已导入历史参考。
- 西藏：2022-2025 源数据均无最低位次，不适合位次推荐；目前只能分数线参考，暂不进入位次推荐核心。
- 城市/公民办/学校类型仍有少量缺口，主要来自源数据中的非普通高校、历史/合并名称、代码缺失或同名变体。
- 招生计划和录取线仍有少量专业组/专业名变体，已通过标准化和专业大类映射补大部分学费/计划信息。

## 已处理的数据质量问题

- 源数据部分省份 `university_code` 为空，导入时生成 `gc-<province_slug>-<university_name>` 稳定 code。
- 源数据部分行无 `major_group`，导入时使用 `school/batch/category/major/min_score/min_rank` 生成分组，避免合并不同录取线。
- 真实 `major_note` / `major_group` / `subject_requirement` 超过旧字段长度，已扩展 DB 字段：
  - `major_group varchar(512)`
  - `subject_requirement varchar(512)`
  - `campus text`
  - `school.code / major.code varchar(512)`
  - `major.name varchar(512)`
- 旧逐行脚本已替换为批量脚本 wrapper，避免再次触发 varchar(128) 错误。

## 推荐接口验证

`POST /api/gaokao/recommend` 已返回：

- `source`
- `year`
- `data_level`

示例：

```txt
专业录取 2025 惠州学院 电子信息工程 GaokaoCompass-11M major ...
专业录取 2025 深圳大学 机械设计制造及其自动化 GaokaoCompass-11M major ...
```

接口现在最多返回 Top 80，避免一次返回过大。

### 推荐算法产品化

- 已新增完整志愿表生成接口：`POST /api/gaokao/volunteer-table`。
  - 已增加多省规则适配，不传 `total_slots` 时按省份默认生成：广东 45、江苏 40、福建 40、湖南/湖北 45、浙江 80、山东/河北/重庆 96、辽宁 112。
  - 广东/江苏/湖南/湖北/福建/江西/安徽/黑龙江/吉林/甘肃/贵州/广西按 3+1+2 院校专业组模式；北京/上海/天津/海南按 3+3 院校专业组模式；浙江/山东/河北/辽宁/重庆按专业+院校/专业平行模式；河南/四川/陕西/山西/云南/内蒙古/新疆/宁夏/青海/西藏按学校+专业传统模式。
  - `GaokaoVolunteerRule` 已结构化：`unit`、`default_slots`、`major_count_per_unit`、`has_adjustment`、`is_parallel`、`source_title/source_url/source_date`、`description`。当前 `source_title` 为规则来源占位，URL/日期待官方文件进一步补齐。
  - 输出字段：序号、冲稳保垫、学校、城市、省份、层级、学校类型、专业组、推荐填报专业池、组内全部专业、选科、学费、近年位次、风险提示、调剂提示、来源。
  - 已按 `school + major_group` 聚合同组专业；若用户排除专业命中组内专业，会标记 `has_rejected_major_risk`、`rejected_majors_in_group` 和 `major_group_risk_level=high`。
  - 调剂建议会结合专业组内专业数量、冲稳保垫和排除专业风险生成；冲刺位/含排除专业组会提示谨慎服从调剂。
  - 默认配比：冲 6、稳 19、保 13、垫 7。
  - Smoke 验证：广东 5 万位次、计算机/软件、广州/深圳，返回 45 条，分布为冲 6 / 稳 19 / 保 13 / 垫 7。
- 候选不再直接按匹配分截断 Top80，已增加志愿方案选择层：
  - 同校去重：默认每所学校最多 3 条；`school`/名校优先模式最多 4 条。
  - 冲稳保垫配比：
    - `balanced` / `major` / `city` / `school`：冲 12、稳 34、保 24、垫 10。
    - `aggressive`：冲 18、稳 34、保 20、垫 8。
    - `safe`：冲 8、稳 28、保 30、垫 14。
  - 策略权重：
    - `major`：专业命中额外加权。
    - `city`：城市命中额外加权。
    - `school`：985/211/双一流额外加权。
    - `safe` / `aggressive`：分别强化保底/冲刺区间。
- Smoke 验证（广东 5 万位次、计算机/软件、广州/深圳）：
  - `balanced`：80 条，冲 12 / 稳 34 / 保 24 / 垫 10，同校最多 3 条。
  - `aggressive`：80 条，冲 18 / 稳 34 / 保 20 / 垫 8，同校最多 3 条。
  - `safe`：80 条，冲 8 / 稳 28 / 保 30 / 垫 14，同校最多 3 条。
  - `school`：80 条，冲 12 / 稳 34 / 保 24 / 垫 10，同校最多 4 条。

## 下一步建议

1. 做高校名称别名表，处理历史名称、独立学院转设、校区/中外合作机构等剩余 561 个缺城市记录。
2. 继续优化推荐算法：院校梯度分层、专业组调剂风险、完整志愿表一键生成。
3. 对青海/山西/西藏补官方考试院数据源。
4. 修复 Chat `MessageList.tsx` 旧改动导致的全量 TypeScript build 阻塞。
