     1|# AI Space - 多模型AI聚合站
     2|
     3|> 一个入口，所有顶尖AI。集成 GPT、Claude、Gemini、DeepSeek、Kimi 等主流大模型。
     4|
     5|## 项目结构
     6|
     7|```
     8|aipool/
     9|├── frontend/          # Next.js 14 前端
    10|│   ├── app/           # App Router
    11|│   ├── components/    # React 组件
    12|│   ├── hooks/         # 自定义 Hooks
    13|│   └── lib/           # 工具函数
    14|├── backend/           # Node.js + Express API 网关
    15|│   ├── src/
    16|│   │   ├── routes/    # API 路由
    17|│   │   ├── services/  # 模型服务封装
    18|│   │   └── types/     # TypeScript 类型定义
    19|│   └── .env.example   # 环境变量示例
    20|└── docs/              # 项目文档
    21|    └── 策划案.md
    22|```
    23|
    24|## 技术栈
    25|
    26|### 前端
    27|- **Next.js 14** (App Router)
    28|- **React 18** + TypeScript
    29|- **Tailwind CSS** + shadcn/ui 风格
    30|- **react-markdown** + **react-syntax-highlighter** (代码高亮)
    31|
    32|### 后端
    33|- **Node.js** + **Express**
    34|- **TypeScript**
    35|- 安全：**Helmet** + **CORS** + **Rate Limit**
    36|- 流式输出：Server-Sent Events (SSE)
    37|
    38|### 集成的模型
    39|| 模型 | 提供商 | 特点 |
    40||------|--------|------|
    41|| GPT-4o / GPT-4o mini | OpenAI | 通用能力最强 |
    42|| Claude 3.5 Sonnet | Anthropic | 代码和逻辑推理 |
    43|| Gemini 2.0 Flash | Google | 超快响应速度 |
    44|| DeepSeek-V3 | DeepSeek | 国产之光，性价比高 |
    45|| Kimi k1.5 | Moonshot | 超长上下文，文档处理 |
    46|
    47|## 快速开始
    48|
    49|### 1. 克隆项目
    50|```bash
    51|cd aipool
    52|```
    53|
    54|### 2. 启动后端
    55|```bash
    56|cd backend
    57|cp .env.example .env
    58|# 编辑 .env 填入你的 API Keys
    59|npm install
    60|npm run dev
    61|```
    62|后端将运行在 http://localhost:4000
    63|
    64|### 3. 启动前端
    65|```bash
    66|cd frontend
    67|npm install
    68|npm run dev
    69|```
    70|前端将运行在 http://localhost:3000
    71|
    72|### 4. 访问
    73|打开浏览器访问 http://localhost:3000/chat
    74|
    75|## 环境变量
    76|
    77|在 `backend/.env` 中配置以下变量：
    78|
    79|```env
    80|PORT=4000
    81|FRONTEND_URL=http://localhost:3000
    82|
    83|# 各模型 API Keys（至少需要填一个）
    84|OPENAI_API_KEY=sk-your-key
    85|ANTHROPIC_API_KEY=***
    86|GEMINI_API_KEY=your-key
    87|DEEPSEEK_API_KEY=your-key
    88|MOONSHOT_API_KEY=your-key
    89|```
    90|
    91|## 开发路线图
    92|
    93|- [x] MVP 框架搭建
    94|- [x] 基础聊天界面 + 模型切换
    95|- [x] 后端 API 网关 + 流式输出
    96|- [ ] 用户登录/注册
    97|- [ ] 对话历史保存
    98|- [ ] 文件上传解析
    99|- [ ] 联网搜索
   100|- [ ] AI 画图
   101|- [ ] PPT 生成
   102|- [ ] 会员订阅 + 支付
   103|- [ ] API 开放平台
   104|
   105|## 贡献
   106|
   107|欢迎提交 Issue 和 PR！
   108|
   109|## License
   110|
   111|MIT
   112|