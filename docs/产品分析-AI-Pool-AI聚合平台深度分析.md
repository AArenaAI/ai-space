# AI Pool — AI 聚合平台深度产品分析

> 撰写时间：2026-05-16  
> 代码版本：基于 `/workspace/aipool/` 仓库全面审计

---

## 一、产品简介

**AI Pool** 是一个企业级的多模型 AI 聚合平台，通过**单一接入点**提供对 GPT（OpenAI Responses API）、Claude（Anthropic Messages API）、DeepSeek（含 V4 Pro Reasoning）、Kimi（Moonshot K2.5/K2.6）等主流大模型的统一访问。

产品定位介于「AI 网关代理」和「AI 工作平台」之间——不仅做 API 路由转发，还提供：

- ✅ 统一会话管理（对话历史持久化、置顶、分组、搜索）
- ✅ 技能系统（Skill Plugin — 动态注入 AI 角色/工具）
- ✅ 图片生成与编辑（GPT-Image-2 异步生成、背景移除/替换、文字移除、画质提升）
- ✅ 文件上传与 RAG（PDF/Office 解析 → 文本分块 → Embedding → 向量检索）
- ✅ 积分计费系统（基础/高级/精英三级积分，基于 Token 消耗自动扣减）
- ✅ 对话分享（URL Slug 分享，选择性展示消息）
- ✅ 响应模板（可复用 Prompt 模板）
- ✅ 深色/浅色主题（CSS 变量系统）

**架构：** Go/Gin 后端 + Next.js 前端，静态导出(Static Export)部署，单进程轻量架构。

---

## 二、产品核心优势

### 维度一：深度可定制的产品界面（品牌白标能力）

这是 AI Pool 面向 B 端客户最具卖点的能力——**每一层 UI 都可以被定制为客户的品牌**。

| 可定制层级 | 实现方式 | 定制深度 |
|---|---|---|
| **品牌 Logo & 名称** | `AppSidebar.tsx` 中 `"AI Space"` → 任意品牌名 | 1 行代码 |
| **配色系统** | `tailwind.config.ts` 定义了 `primary(紫色)`、`surface`、`border`、`text` 全部自定义色 | CSS 变量全局控制，5 分钟完成换肤 |
| **主题系统** | `ThemeProvider.tsx` 通过 `data-theme` + CSS 变量实现深色/浅色双主题 | 增减自定义变量即可适配任意品牌 |
| **侧边栏布局** | 侧边栏宽度可调（260px ↔ 52px 折叠），功能项可增删 | 模块化组件，直接增删即可 |
| **页面路由** | 聊天 / 技能市场 / 图片编辑 / 定价 / 模板 / 分享 | 可选择性暴露或隐藏 |
| **技能图标与颜色** | `SKILL_ICON_MAP` 中每个技能可配独立图标+颜色 | 可编程映射，客户可自定义角色模板 |
| **定价页面** | `pricing/page.tsx` 中纯静态配置，积分套餐、功能列表、按钮文案全可配 | 配置文件级定制 |
| **着陆页/SEO** | `next.config.js` + `layout.tsx` 中 `Metadata`（标题、描述、关键词） | 完全可控 |
| **移动端适配** | `MobileNav` 组件，独立的移动端导航栏 | 可单独定制 |
| **全局字体/动画** | TailwindCSS `antialiased` + 自定义动画 `animate-fade-in` | Tailwind 层扩展 |

**商业意义：** 这对于需要**白标私有部署**的企业客户（教育机构、企业内部平台、咨询公司）是强吸引力——不需要重新开发前端，只需替换 CSS 变量中的配色和 Logo，就可以拥有一个完全属于自己品牌的 AI 平台。

---

### 维度二：稳定可靠的技术底座（后端能力）

#### 2.1 多模型统一接入
- 单一 API `/api/chat/stream` 统一管理 4+ 模型家族的接入：
  - **OpenAI Responses API** (gpt-5.x) — 支持 Web Search 工具、Reasoning Effort
  - **Anthropic Messages API** (claude-x) — 支持多模态、Streaming
  - **DeepSeek** — 支持 V4 Pro Thinking/Reasoning 控制
  - **Moonshot/Kimi** (kimi-k2.x) — 支持 Vision 多模态、Thinking 控制
- 每个模型家族都有**独立的 Base URL 配置**，支持代理/中转部署
- 多模态（图片输入）支持 GPT-5x、Claude、Kimi，同时**通过 RAG 路径A为所有模型（包括纯文本模型）提供图片内容理解**

#### 2.2 SSE 实时流式响应
- `chat.go` 中完整实现了 `Server-Sent Events` 流式传输
- 支持 context 窗口管理、token 追踪、retry 逻辑
- 前端 `ChatContent` 组件做增量渲染，用户体验流畅

#### 2.3 图片生成与编辑引擎
- **异步生成架构：** 提交后立即返回 `pending` 状态，后台 goroutine 完成
- **gpt-image-2** 支持：纵横比映射（1:1 ~ 21:9）、分辨率（1K/2K/4K）、质量（low/medium/high/auto）
- **参考图编辑：** `file_publicId` 从已上传文件库引用，支持 image-to-image 编辑
- **图片编辑能力：** 移除背景、替换背景、文字移除、画质提升（均基于 GPT-Image-2 Edit API）
- 结果自动保存到本地 + DB 记录，访问 URL 可公开分享

#### 2.4 文件上传与智能解析（RAG 流水线）
- 支持 PDF、Office 文档上传 → 解析 → 文本分块 → Embedding → 向量检索
- `File` 模型记录完整元数据：Token 计数、Page 数、MIME 类型、Vision 成本
- `FileChunk` 实现结构化分块（段落/表格/代码/图片引用），支持跨 provider 的 Embedding
- `FileEmbedding` 支持多 provider 共存，通过 `uniqueIndex` 防重复

#### 2.5 技能插件系统
- `skills/injector.go` 实现**动态插件注入**——无需重启即可加载/卸载 AI 技能角色
- 技能包含完整 manifest（name/description/icon/category/co_skills/system_prompt）
- REST API 支持：CREATE、DELETE、CONFIGURE、RELOAD、LIST
- `is_meta` 技能可组合 `co_skills` 形成复合能力

#### 2.6 积分计费系统
- 三级积分体系：`basic_credits` / `advanced_credits` / `elite_credits`
- `credits.go` 实现完整的 consume/debit/refund 逻辑
- 自动按 Token 消耗扣减，支持不同模型级别（基础/高级/精英）对应不同积分类型
- 免费版每日自动重置配额（30 基础积分）

#### 2.7 安全与用户体系
- JWT 认证 + bcrypt 密码哈希
- 登录/注册页面完整，`AuthInterceptor` 全局保护
- 用户 CORS 配置支持跨域调试

---

## 三、稀缺性能力（市场差异化 & 规划方向）

AI Pool 已经具备了一些竞品（ChatGPT、Claude.ai、Poe、OpenRouter）没有或做得不够好的能力，以下是**目前已经稀缺但未充分包装的能力**，以及**下一步可以规划建设的稀缺功能**。

### ✅ 当前已具备的稀缺能力

| 能力 | 稀缺性说明 | 直接竞品对标 |
|---|---|---|
| **技能插件动态注入** | 无需重启即可增删 AI 角色，不是简单的"选角色"——技能就是可编程的 agent manifest | Poe 有 bot，但不能运行时热加载；OpenRouter 没有 |
| **图片编辑工作台** | 背景移除/替换、文字移除、画质提升——这些功能通常在独立的 SaaS（Remove.bg、Clipdrop）上，聚合到 AI 聊天平台中很少见 | ChatGPT 有 DALL·E 但没图片编辑工作台；Poe 没有 |
| **三级积分 + Token 级计费** | 按基础/高级/精英三级划分模型，自动 token 计费，支持 refund——比 OpenRouter 的按 Token 计价更灵活 | OpenRouter 按 token 固定计价；ChatGPT 按订阅；Claude 按订阅 |
| **多 provider 的 RAG + Vision 双路径** | 图片/文件通过 路径A(文件RAG→Vision caption→文本注入) 为所有模型提供内容理解，路径B(内联多模态) 为 vision 模型提供原生支持——两种并行 | Poe 不支持文件 RAG；ChatGPT 文件上传只能 GPT-4 用 |
| **SSE 流式 + 多模型统一 API** | 统一 `/api/chat/stream` 给前端，后端按模型家族分发到各 API——前端无需关心后端是哪个厂商 | OpenRouter 只是代理转发，没有会话管理和中间件能力 |

### 🚀 规划中的稀缺能力（建议优先级）

#### P0 — 短期（1-2 周）

1. **嵌入模式 Widget（iframe 或 Web Component）**
   - 客户只需一行 `<script>` 或 `<iframe>` 就能在自己的网站嵌入 AI Pool 聊天窗口
   - 比 API 调用的门槛更低，面向非技术客户
   - 技术实现：前端抽离为独立的嵌入式 React 组件 + CORS 白名单

2. **数据看板与用量分析**
   - 用户/租户级别的 API 调用统计：每日活跃、Token 消耗趋势、模型使用分布、错误率
   - 后端已有完整的会话和积分数据，前端展示即可
   - 差异化价值：ChatGPT 不提供企业用量分析，OpenRouter 提供但非常基础

3. **多语言界面**
   - 当前硬编码中文 + 英文。通过 `i18n` 框架实现动态切换
   - 服务出海/外企客户的必选项

#### P1 — 中期（1 个月）

4. **企业级多租户（Organization/Workspace）**
   - 一个部署实例服务多个客户，每个客户独立用户、独立技能、独立定价
   - 这是 B 端付费的关键功能
   - 后端数据模型已有 `User` → 增加 `Org` 和 `OrgMember` 即可

5. **自动 Agent 能力（Tools/Function Calling 的 UI 化）**
   - 用户可以在聊天中调用「搜索网页」「计算数学」「查询数据库」等工具
   - 后端已有 Tavily/Brave 搜索配置，只需在前端暴露出 Tool Choice 界面
   - 对标 ChatGPT 的 GPTs（但更开放、可自定义）

6. **API Key 自服务门户**
   - 用户可生成自己的 API Key，通过 OpenAI 兼容格式调用 AI Pool
   - 这意味着 AI Pool 不仅是一个聊天平台，还是一个**AI API 市场**
   - 商业模式转型的关键节点

#### P2 — 长期（1-3 个月）

7. **模型成本优化层**
   - 自动路由：简单问题 → 便宜模型，复杂问题 → 旗舰模型
   - 模型缓存：重复问题命中缓存，节省成本
   - 竞价切换：在当前模型超时/失败时自动切换到替代模型

8. **自定义 Agent 构建器**
   - 拖拽式 Agent 工作流：输入 → 模型调用 → 工具调用 → 输出
   - Agent 可共享/出售（像一个 Agent Store）
   - 对标 ChatGPT GPTs + Poe Bot Builder + Coze

---

## 四、定制界面 + 定制能力矩阵

将「能做什么」总结为对客户一句话可懂的矩阵：

| 客户需求 | AI Pool 的能力 | 定制方式 |
|---|---|---|
| "我要有自己的 AI 平台，不要 ChatGPT 的 Logo" | 完整品牌白标：Logo、名称、配色、域名 | 替换 `tailwind.config.ts` 色值 + 侧边栏品牌名 + 页头 Metadata |
| "我要给我的团队定制不同的 AI 角色" | 技能插件系统，每个角色有独立 icon/color/prompt | API 或后台配置，无需重启 |
| "我要控制哪些模型给我的用户用" | 模型 Provider 可配置（开关 + Key 管理） | `.env` 配置 + `config.go` |
| "我要计费/限制我的用户" | 三级积分体系，Token 级别扣费 | 后台配置积分套餐 |
| "我要用户上传文件让 AI 分析" | PDF/Office → 解析 → Embedding → 问答 | 开箱即用，无需额外开发 |
| "我要我的平台能生成和编辑图片" | 图片生成 + 背景移除/替换 + 画质提升 | 开箱即用，可配置模型 |
| "我要分享对话给外部客户看" | 对话分享（URL Slug，可选消息） | 开箱即用 |
| "我要在我的网站上嵌入聊天" | **规划中**：Widget/iframe 嵌入 | 配置项：颜色、位置、触发方式 |
| "我要多个团队互相隔离" | **规划中**：多租户（Org/Workspace） | 后台管理 |
| "我要我的用户也能调 API" | **规划中**：API Key 自服务门户 | 后台配置 |

---

## 五、竞品对比一览

| 维度 | AI Pool | ChatGPT (OpenAI) | Poe (Quora) | OpenRouter |
|---|---|---|---|---|
| **多模型** | ✅ GPT+Claude+DeepSeek+Kimi | ❌ 仅 OpenAI | ✅ 多模型 | ✅ 200+ 模型 |
| **品牌白标** | ✅ 完整 CSS 变量定制 | ❌ 不可定制 | ❌ 不可定制 | ❌ 不可定制 |
| **技能/角色系统** | ✅ 运行时热加载 | ❌ GPTs（不开源） | ✅ Bots | ❌ 无 |
| **图片编辑** | ✅ 移除/替换/提升 | ❌ 仅生成 | ❌ 无 | ❌ 无 |
| **文件RAG** | ✅ 全自研 | ✅ GPT-4 可用 | ❌ 有限 | ❌ 无 |
| **积分计费** | ✅ 三级 Token 计费 | ❌ 固定订阅 | ✅ 订阅+点数 | ✅ 按 Token |
| **对话分享** | ✅ URL Slug 分享 | ✅ 有 | ❌ 无 | ❌ 无 |
| **本地部署** | ✅ 单二进制 + 静态文件 | ❌ 不可 | ❌ 不可 | ❌ 不可 |
| **嵌入 Widget** | 🚧 规划中 | ✅ ChatGPT 分享 | ❌ 无 | ❌ 无 |
| **多租户** | 🚧 规划中 | ✅ Team 版 | ❌ 无 | ✅ API Key |
| **API 市场** | 🚧 规划中 | ✅ API 产品 | ❌ 无 | ✅ 核心定位 |

---

## 六、总结

**AI Pool 的核心竞争力**不在于模型数量（比不过 OpenRouter），也不在于品牌知名度（比不过 ChatGPT），而在于：

1. **「开箱即用的白标 AI 平台」** — 从界面到能力，从计费到分享，一个二进制文件搞定
2. **「聚合 + 增强」** — 不仅仅是路由转发，还提供了 RAG、图片编辑、技能插件等**开放平台不具备的上层能力**
3. **「单机可部署」** — Go 单一二进制 + 静态前端，低资源消耗，适合中小企业和自部署场景

**下一步聚焦方向：** 嵌入 Widget → 多租户 → API 自服务门户，这三步完成后，AI Pool 将从「AI 聊天平台」进化为「AI 基础设施平台」。
