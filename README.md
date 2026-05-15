# AI Pool - 多模型 AI 聚合平台

> 一个入口，统一使用 Chat、Compare、Search、Image 四条主产品路径。

## 当前产品边界

AI Pool 现在不是“模型自己随便混用能力”，而是由 **前端功能入口 + 后端路由 + 模型能力** 共同决定实际执行路径。

### 1. Chat
用于所有文本类任务，入口：`POST /api/chat`

覆盖范围：
- 单模型问答
- 流式输出
- Reasoning 深度思考
- 文件问答 / 文档检索注入
- 图片附件理解
- 联网搜索开关
- 图表输出（ECharts 代码块）

说明：
- “画折线图 / 柱状图 / 趋势图” 仍然属于 Chat 路径
- Chat 默认禁用 Responses API 内置工具：`tool_choice: none`
- 这样可以避免把“画图表”误路由成 `image_generation_call` 导致空输出

### 2. Compare
用于多模型并列回答，入口：`POST /api/chat/compare`

覆盖范围：
- 多模型并发对比
- 非流式一次性返回
- 结果保存为普通消息
- 支持 Reasoning
- 支持 Search 开关
- 支持文件上下文

说明：
- Compare 属于 Chat 的“多模型对比形态”，不是独立模型类型
- Compare 现在复用了普通 Chat 的搜索预处理逻辑

### 3. Search
Search 不是独立自然语言模式，而是 Chat / Compare 的增强开关。

触发方式：
- 仅在用户主动打开搜索开关时启用
- 不依赖用户自然语言里是否提到“查一下”

当前规则：
- **支持原生搜索能力的模型**：走模型原生 `web_search`
- **不支持原生搜索的模型**：由 AI Pool 先做第三方搜索，再把结果注入消息

当前第三方搜索链路：
1. Tavily
2. Tavily 失败后降级 Brave
3. Brave fallback 会抓取前几条网页正文片段

### 4. Image
用于真实图片生成，入口：`POST /api/images/generate`

覆盖范围：
- 文生图
- 参考图编辑 / 图生图
- 异步后台任务生成
- 图片任务查询、列表、删除、文件访问

说明：
- Image 是独立功能入口，不会因为用户在 Chat 里说“画一张图”就自动触发
- 当前图片生成模型固定为 `gpt-image-2`
- 文生图调用 `/v1/images/generations`
- 参考图编辑调用 `/v1/images/edits`

---

## 关键路由

### 模型与能力分流
- `GET /api/models`
- `GET /api/models/chat`
- `GET /api/models/image`

### Chat
- `POST /api/chat`

### Compare
- `POST /api/chat/compare`

### Image
- `POST /api/images/generate`
- `POST /api/images/edit`
- `GET /api/images`
- `GET /api/images/:id`
- `DELETE /api/images/:id`
- `GET /api/images/file/:filename`

---

## 路径判定示例

| 用户行为 | 实际路径 |
|---|---|
| 普通聊天问答 | Chat |
| 上传文档后提问 | Chat |
| 上传图片让模型分析 | Chat |
| 开启联网搜索后提问 | Chat / Compare + Search |
| 画折线图、柱状图、饼图 | Chat（输出 ECharts JSON） |
| 多模型并列回答 | Compare |
| 生成海报、封面、插画 | Image |
| 用参考图改风格 | Image |

---

## 搜索边界

Search 只由开关控制，不由自然语言隐式触发。

### 普通 Chat / Compare 中的搜索规则
- 若模型声明支持 `search` 能力：使用模型原生搜索工具
- 若模型不支持 `search` 能力：使用 Tavily / Brave 搜索结果注入 prompt

这意味着：
- Search 是产品增强层，不是单独的模型类型
- Compare 与普通 Chat 保持同一套搜索判定逻辑

---

## 图表与图片生成的边界

### 图表
以下需求走 **Chat**：
- 折线图
- 柱状图
- 饼图
- 趋势图
- ECharts 配置生成

后端会追加图表指令，要求模型输出：

````markdown
```echarts
{ ...严格 JSON option... }
```
````

前端检测 `echarts` 代码块后渲染真实图表。

### 图片生成
以下需求走 **Image**：
- 生成一张海报
- 生成封面图
- 生成插画
- 使用参考图重绘或改背景

所以“画图表”和“生成真实图片”是两条不同产品路径。

---

## 当前技术栈

### 前端
- **Next.js 14**（App Router）
- **React 18** + TypeScript
- **Tailwind CSS**
- **react-markdown** + **react-syntax-highlighter**
- ECharts 图表渲染

### 后端
- **Go** + **Gin**
- Server-Sent Events（SSE）流式输出
- PostgreSQL / GORM（会话、图片任务、配置等）
- 多模型网关与能力分流
- 第三方搜索集成（Tavily / Brave）

### 当前接入模型类型
- OpenAI（Chat / Search / Image）
- Anthropic Claude
- DeepSeek
- Moonshot / Kimi
- 其他聊天模型可按能力继续扩展

---

## 项目结构

```text
aipool/
├── frontend/            # Next.js 前端
├── backend-go/          # Go + Gin 后端
├── docs/                # 项目文档
└── TODO.md              # 当前任务清单
```

---

## 开发状态

### 已完成
- [x] 基础聊天界面 + 流式输出
- [x] 多模型对比（Compare）
- [x] 模型选择器
- [x] Reasoning 深度思考开关
- [x] 联网搜索开关
- [x] 文件上传与解析
- [x] 图片生成（文生图 / 参考图编辑）
- [x] 主题切换
- [x] PPT 生成功能
- [x] Skills / 模板系统
- [x] 对比结果持久化

### 进行中 / 待办
以 `TODO.md` 为准。

---

## 贡献

欢迎提交 Issue 和 PR。

## License

MIT

## 文档说明

- `README.md`：描述当前已落地的产品边界与功能路由
- `docs/AI聚合平台策划案.md`：产品规划与阶段演进文档
- `TODO.md`：当前开发进度与 backlog

如果文档之间出现冲突，以当前代码实现和 `TODO.md` 的完成态为准。 