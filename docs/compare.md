好的，我来分析这个需求并设计架构。

## 核心理解：「单消息对比」+「可切换查看」

这是一个类似 ChatGPT/Claude 官方的「分支对话」（branch/thread）功能：
- 任何一条 AI 消息都可以 fork 出一个对比视角
- 同一条用户问题，不同模型的回答可以互相切换查看
- 退出对比后回到原来的普通聊天流

---

## 一、数据模型设计

### 1. 新增概念：`MessageGroup`（消息组）

```
user 提问 ──┬──> gpt-5.5 回答  ← 默认显示
            └──> gpt-5.4 回答  ← 可切换查看
            └──> gemini-3.1 回答 ← 可切换查看
```

同一条用户问题下的多个模型回答，构成一个**消息组**。

### 2. 最小改动方案：复用现有 `Message` 表

给 `Message` 加两个字段：

```go
type Message struct {
    // 现有字段...
    
    GroupID       uint    `json:"group_id,omitempty"`       // 同一条用户问题的多个回答共享 group_id
    GroupIndex    int     `json:"group_index,omitempty"`    // 在该组中的顺序，默认0
    IsDefault     bool    `json:"is_default,omitempty"`     // 普通聊天模式下是否默认显示
}
```

#### 数据示例

```
ID  Role      Content      Model       GroupID  GroupIndex  IsDefault
─────────────────────────────────────────────────────────────────
1   user      "你好"                    0        0           false
2   assistant "你好！我是GPT..."  gpt-5.5   1        0           true    ← 默认显示
3   assistant "你好！我是Claude..." claude-4  1        1           false   ← 可切换
4   user      "再说点"                  0        0           false
5   assistant "好的..."         gpt-5.5   2        0           true
```

### 3. 更干净的方案：独立 `MessageGroup` 表

```go
type MessageGroup struct {
    ID              uint      `gorm:"primarykey"`
    ConversationID  uint      `gorm:"index;not null"`
    UserMessageID   uint      `gorm:"not null"`        // 关联的用户提问
    Models          string    `gorm:"type:text"`       // JSON: ["gpt-5.5", "claude-4"]
    CreatedAt       time.Time
}
```

`messages` 表加 `group_id` 字段指向 `MessageGroup`。

**推荐独立表方案**，更清晰，以后扩展分组统计、分享也方便。

---

## 二、前端状态设计

### 核心状态

```tsx
// 每轮（每组）的显示状态
interface GroupViewState {
  groupId: number;
  activeIndex: number; // 当前显示组内第几个回答
  isExpanded: boolean; // 是否展开显示所有回答（对比模式）
}

// 全局模式
type ViewMode = 'normal' | 'compare' | 'fork-compare';

// 用 Map 存储所有组的当前视图
const [groupViews, setGroupViews] = useState<Map<number, GroupViewState>>(new Map());
```

### 普通模式渲染

```
消息列表渲染时：
- user message → 直接显示
- assistant message → 找到它所属的 group
  - 如果该 group 在 groupViews 中有 activeIndex → 显示对应的消息
  - 如果没有 → 显示 is_default=true 的那条

同时在这条消息下方显示：
┌────────────────────────────┐
│  [gpt-5.5]  [claude-4 ▼]  │  ← 切换按钮，显示该组所有模型
└────────────────────────────┘
```

### 消息组件结构

```tsx
// 每条 assistant 消息的 wrapper
<AssistantMessage
  message={msg}
  group={msg.group}           // 所属组信息
  activeModel={activeModel}   // 当前显示的模型
  allModels={group.models}    // 组内所有模型
  onSwitchModel={(modelId) => switchGroupView(group.id, modelId)}
  onForkCompare={(modelId) => enterForkCompare(group.id, modelId)}
/>
```

---

## 三、交互流程

### 场景 A：从普通消息进入对比

```
1. 用户看到 GPT-5.5 的回答
2. 点击「对比」按钮 → 选择「对比 gpt-5.4」
3. 前端：
   a. 发送请求给 gpt-5.4，带上相同的上文
   b. 创建 MessageGroup（Models: ["gpt-5.5", "gpt-5.4"]）
   c. gpt-5.5 的消息标记 group_id=group.id, group_index=0
   d. gpt-5.4 的新消息标记 group_id=group.id, group_index=1
   e. 进入 compare 模式，显示两列
4. 用户继续提问 → 两个模型并行回答，都关联到新的 group
```

### 场景 B：退出对比回到普通模式

```
1. 用户点击「退出对比」
2. 前端：
   a. viewMode 切回 'normal'
   b. 但 groupViews 保留：group_id → activeIndex
   c. 默认显示 index=0（原模型）的消息
3. 消息列表中，有 group 的消息下方显示切换条：
   「[gpt-5.5] [gpt-5.4] ← 当前显示」
```

### 场景 C：普通模式下切换查看其他模型的回答

```
1. 用户在有切换条的消息下方，点击 [gpt-5.4]
2. 前端：
   a. groupViews.set(groupId, { activeIndex: 1 })
   b. 该位置的消息内容实时切换为 gpt-5.4 的版本
   c. 不刷新页面，纯前端状态切换
3. 如果用户继续发消息 → 以当前 active 的模型继续对话
```

---

## 四、关键设计决策

### Q1：切换模型后，后续对话跟谁走？

**方案一（推荐）：跟随当前显示的模型**
- 用户切到 gpt-5.4 查看 → 下次发消息用 gpt-5.4 回答
- 简单直观，用户想看谁就继续跟谁聊

**方案二：保持原默认模型**
- 切换只是查看，不改变后续对话走向
- 需要额外提示「当前查看的是历史版本」

### Q2：对比模式下历史轮次怎么显示？

```
Round 1 (group 1): 用户问题 A
  ├─ gpt-5.5 回答
  └─ gpt-5.4 回答

Round 2 (group 2): 用户问题 B  
  ├─ gpt-5.5 回答
  └─ gpt-5.4 回答
```

每轮固定列数 = 该 group 的 models 数量。

如果第二轮用户把 gpt-5.4 换成 gemini-3.1：
```
Round 2 (group 2): 用户问题 B
  ├─ gpt-5.5 回答
  └─ gemini-3.1 回答
```

Round 1 仍显示 gpt-5.5 + gpt-5.4，不受影响。

### Q3：颜色/标识怎么区分？

```tsx
// 消息框样式
const getMessageStyle = (groupIndex: number, total: number, isActive: boolean) => {
  if (!group || total === 1) return "default";
  
  // 组内有多条回答时
  const colors = [
    "border-l-4 border-blue-500",   // index 0
    "border-l-4 border-orange-500", // index 1
  ];
  
  return isActive 
    ? colors[groupIndex] + " bg-surface-elevated"
    : "opacity-50 grayscale"; // 非当前显示的消息暗淡
};

// 切换条样式
<SwitchBar>
  {group.models.map((model, idx) => (
    <button 
      className={idx === activeIndex ? "bg-brand text-white" : "bg-surface-card"}
      onClick={() => switchTo(idx)}
    >
      {model.name}
      {idx === 0 && <span className="text-xs">(默认)</span>}
    </button>
  ))}
</SwitchBar>
```

---

## 五、数据库迁移方案

### 步骤 1：建表

```sql
-- 1. 创建 message_groups 表
CREATE TABLE message_groups (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_message_id INTEGER NOT NULL REFERENCES messages(id),
    models TEXT NOT NULL, -- JSON array
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. messages 表加字段
ALTER TABLE messages ADD COLUMN group_id INTEGER REFERENCES message_groups(id);
ALTER TABLE messages ADD COLUMN group_index INTEGER DEFAULT 0;
```

### 步骤 2：数据迁移

```go
// 迁移脚本：把现有 compare=true 的 conversation 的消息分组
// 逻辑：
// 1. 按 created_at 排序 messages
// 2. user message → 创建新 group
// 3. 后续连续的 assistant messages（直到下一个 user）→ 归入该 group
// 4. 第一个 assistant 设 group_index=0, is_default=true
```

### 步骤 3：API 调整

```go
// GET /api/conversations/:id
// 返回时附带 groups 信息
type ConversationResponse struct {
    models.Conversation
    Messages []MessageWithGroup `json:"messages"`
    Groups   []MessageGroup     `json:"groups"` // 新增
}

type MessageWithGroup struct {
    models.Message
    GroupID    uint   `json:"group_id"`
    GroupIndex int    `json:"group_index"`
}
```

---

## 六、前端组件架构

```
ChatPage
├── MessageList
│   ├── UserMessage
│   └── AssistantMessage
│       ├── MessageContent (markdown 渲染)
│       ├── ModelSwitchBar (如果有 group，显示切换条)
│       │   ├── ModelBadge (当前显示)
│       │   └── ModelSelectorDropdown (展开选其他)
│       └── ForkCompareButton (进入对比)
├── CompareView (对比模式覆盖层)
│   ├── CompareColumn[] (每列一个模型)
│   └── CompareInput (底部共享输入)
└── InputArea (普通模式输入)
```

---

## 七、一句话总结

> 核心不是「对比模式」和「普通模式」二选一，而是**每条 AI 消息天然属于一个可切换的组**。普通模式下默认显示组内第一条，用户可以随时切看同问题的其他模型回答；点击对比则展开组内所有回答为并列布局。数据库用 `MessageGroup` 把同问题的多个回答绑在一起，`group_id` + `group_index` 决定消息归属和显示顺序。


## MessageGroup 独立表完整实施方案

---

### 一、数据库层

#### 1.1 新增模型 `backend/internal/models/message_group.go`

```go
package models

import (
	"encoding/json"
	"time"
)

// MessageGroup 消息组：同一用户提问下的多个模型回答集合
type MessageGroup struct {
	ID             uint      `gorm:"primarykey" json:"id"`
	ConversationID uint      `gorm:"not null;index" json:"conversation_id"`
	UserMessageID  uint      `gorm:"not null;index" json:"user_message_id"` // 关联的用户提问消息ID
	Models         string    `gorm:"type:text;not null" json:"models"`      // JSON: ["gpt-5.5","claude-4"]
	CreatedAt      time.Time `json:"created_at"`
}

// GetModels 解析 Models JSON
func (g *MessageGroup) GetModels() []string {
	var m []string
	json.Unmarshal([]byte(g.Models), &m)
	return m
}

// SetModels 序列化 Models
func (g *MessageGroup) SetModels(m []string) {
	b, _ := json.Marshal(m)
	g.Models = string(b)
}
```

#### 1.2 Message 表加字段

```go
type Message struct {
	// ... 现有字段保持不变 ...
	
	GroupID    uint `gorm:"index" json:"group_id,omitempty"`    // 所属消息组
	GroupIndex int  `json:"group_index,omitempty"`              // 在组内的顺序
}
```

#### 1.3 AutoMigrate 注册

```go
// db.go:45
if err := db.AutoMigrate(
	// ... 现有表 ...
	&MessageGroup{}, // 新增
); err != nil {
	return nil, err
}
```

#### 1.4 数据迁移脚本（一次性）

```go
// backend/internal/models/db.go 新增
func migrateMessageGroups(db *gorm.DB) error {
	// 检查是否已有 MessageGroup 数据
	var count int64
	if err := db.Model(&MessageGroup{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil // 已迁移过
	}

	// 遍历所有 compare=true 的 conversation
	var conversations []Conversation
	if err := db.Where("compare = ?", true).Find(&conversations).Error; err != nil {
		return err
	}

	for _, conv := range conversations {
		var messages []Message
		if err := db.Where("conversation_id = ?", conv.ID).
			Order("created_at asc, id asc").Find(&messages).Error; err != nil {
			continue
		}

		var currentGroup *MessageGroup
		groupIndex := 0

		for i := range messages {
			msg := &messages[i]
			
			if msg.Role == "user" {
				// 用户消息：创建新组
				groupIndex = 0
				currentGroup = &MessageGroup{
					ConversationID: conv.ID,
					UserMessageID:  msg.ID,
				}
				// 从 conversation.CompareModels 推断
				currentGroup.SetModels(conv.GetCompareModels())
				if err := db.Create(currentGroup).Error; err != nil {
					continue
				}
				// 用户消息本身不绑定 group
				continue
			}

			if msg.Role == "assistant" && currentGroup != nil {
				// assistant 消息：绑定到当前组
				msg.GroupID = currentGroup.ID
				msg.GroupIndex = groupIndex
				db.Save(msg)
				groupIndex++
			}
		}
	}

	return nil
}
```

---

### 二、API 层改动

#### 2.1 GET /api/conversations/:id 返回结构

```go
// 现有返回不变，但 messages 中增加 group 信息
// 前端通过 msg.group_id + msg.group_index 即可渲染

// 额外返回 groups 数组（用于快速构建组视图）
type ConversationDetailResponse struct {
	models.Conversation
	Messages []MessageWithGroup `json:"messages"`
	Groups   []GroupSummary     `json:"groups"`
}

type GroupSummary struct {
	ID      uint     `json:"id"`
	Models  []string `json:"models"`
}
```

#### 2.2 普通单聊发送时创建组

```go
// POST /api/chat
// 修改保存 assistant message 的逻辑：

// 单聊模式下，每个 user + assistant 也创建一个 group
// 这样后续可以 fork 对比

func (h *ChatHandler) Chat(c *gin.Context) {
	// ... 现有逻辑 ...
	
	// 保存 assistant message 之前：
	group := &models.MessageGroup{
		ConversationID: conversationID,
		UserMessageID:  userMsgID,
	}
	group.SetModels([]string{modelID})
	db.Create(group)
	
	assistantMsg.GroupID = group.ID
	assistantMsg.GroupIndex = 0
	db.Create(assistantMsg)
}
```

#### 2.3 从普通消息 fork 对比

```go
// POST /api/chat/:message_id/fork
// 参数：{ model_id: "gpt-5.4" }

func (h *ChatHandler) ForkCompare(c *gin.Context) {
	messageID := c.Param("message_id")
	var originMsg models.Message
	if err := db.First(&originMsg, messageID).Error; err != nil {
		return 404
	}

	// 找到该消息所属的 group
	var group models.MessageGroup
	if err := db.First(&group, originMsg.GroupID).Error; err != nil {
		return 404
	}

	// 检查是否已在组内
	existingModels := group.GetModels()
	for _, m := range existingModels {
		if m == req.ModelID {
			return 400, "该模型已在对比组中"
		}
	}

	// 扩展组模型列表
	newModels := append(existingModels, req.ModelID)
	group.SetModels(newModels)
	db.Save(&group)

	// 用相同上下文调用新模型
	// 上下文 = 该 conversation 中该 group 之前的所有消息
	contextMessages := h.buildContextUpToGroup(group.ID)
	
	// 调用模型
	content, err := h.callModel(ctx, req.ModelID, contextMessages, ...)
	
	// 保存新 assistant message
	newMsg := models.Message{
		ConversationID: group.ConversationID,
		Role:           "assistant",
		Content:        content,
		Model:          req.ModelID,
		GroupID:        group.ID,
		GroupIndex:     len(existingModels), // 新索引
	}
	db.Create(&newMsg)

	// 返回新消息
	c.JSON(200, newMsg)
}
```

#### 2.4 传统对比模式（底部输入）也要用 Group

```go
// POST /api/compare 改造：
// 不再是平铺保存 messages，而是每组走 MessageGroup

func (h *ChatHandler) CompareChat(c *gin.Context) {
	// ... 并行调用模型 ...
	
	// 创建 group
	group := models.MessageGroup{
		ConversationID: conversationID,
		UserMessageID:  userMsgID,
	}
	group.SetModels(req.ModelIDs)
	db.Create(&group)

	// 每个结果保存为 group 内的 message
	for i, res := range ordered {
		msg := models.Message{
			ConversationID: conversationID,
			Role:           "assistant",
			Content:        res.Content,
			Model:          res.ModelID,
			GroupID:        group.ID,
			GroupIndex:     i,
		}
		db.Create(&msg)
	}
}
```

---

### 三、前端数据结构

#### 3.1 Message 接口扩展

```tsx
// hooks/useChat.ts
export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  createdAt: number;
  // ... 现有字段 ...
  
  // 新增
  groupId?: number;
  groupIndex?: number;
}

// 新增：组视图状态
export interface GroupView {
  groupId: number;
  activeIndex: number;      // 当前显示组内第几个回答
  models: string[];         // 该组所有模型
}
```

#### 3.2 全局状态

```tsx
// useChat.ts 中新增
const [groupViews, setGroupViews] = useState<Map<number, GroupView>>(new Map());
const [viewMode, setViewMode] = useState<"normal" | "compare">("normal");

// 加载历史时初始化 groupViews
useEffect(() => {
  if (data.groups) {
    const views = new Map();
    data.groups.forEach((g: any) => {
      views.set(g.id, {
        groupId: g.id,
        activeIndex: 0, // 默认显示第一个
        models: g.models,
      });
    });
    setGroupViews(views);
  }
}, [conversationId]);
```

---

### 四、渲染逻辑

#### 4.1 消息列表分组渲染

```tsx
// MessageList.tsx
function renderMessages(messages: Message[]) {
  const result: ReactNode[] = [];
  let currentGroup: number | null = null;
  let groupMessages: Message[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      // user 消息直接显示，并结束上一组
      if (groupMessages.length > 0) {
        result.push(<MessageGroupBlock messages={groupMessages} />);
        groupMessages = [];
      }
      result.push(<UserMessage msg={msg} />);
      currentGroup = null;
    } else if (msg.groupId && msg.groupId !== currentGroup) {
      // 新组开始
      if (groupMessages.length > 0) {
        result.push(<MessageGroupBlock messages={groupMessages} />);
      }
      currentGroup = msg.groupId;
      groupMessages = [msg];
    } else if (msg.groupId === currentGroup) {
      groupMessages.push(msg);
    } else {
      // 无 group 的单条 assistant（兼容旧数据）
      if (groupMessages.length > 0) {
        result.push(<MessageGroupBlock messages={groupMessages} />);
        groupMessages = [];
      }
      result.push(<AssistantMessage msg={msg} />);
    }
  }

  if (groupMessages.length > 0) {
    result.push(<MessageGroupBlock messages={groupMessages} />);
  }

  return result;
}
```

#### 4.2 MessageGroupBlock 组件

```tsx
// 核心组件：显示一组回答（普通模式下只显示 active，对比模式展开全部）
function MessageGroupBlock({ messages }: { messages: Message[] }) {
  const { viewMode, groupViews, switchGroupModel } = useChat();
  const groupId = messages[0].groupId!;
  const view = groupViews.get(groupId);
  
  if (!view || messages.length === 1) {
    // 单条消息，直接显示
    return <AssistantMessage msg={messages[0]} />;
  }

  if (viewMode === "compare") {
    // 对比模式：展开显示所有列
    return (
      <div className="grid grid-cols-2 gap-4">
        {view.models.map((modelId, idx) => {
          const msg = messages.find(m => m.groupIndex === idx);
          return (
            <div key={modelId} className="border-l-4 border-brand rounded-r-xl bg-surface-elevated">
              <div className="px-3 py-1.5 text-xs font-medium text-text-secondary border-b border-surface-border">
                {getModelName(modelId)}
              </div>
              <div className="p-4">
                {msg ? <MessageContent msg={msg} /> : <Loading />}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // 普通模式：只显示 activeIndex 对应的消息 + 切换条
  const activeMsg = messages.find(m => m.groupIndex === view.activeIndex) || messages[0];
  
  return (
    <div>
      <AssistantMessage 
        msg={activeMsg} 
        // 边框颜色标识组内第几个模型
        borderColor={getModelColor(view.models[view.activeIndex])}
      />
      
      {/* 切换条：显示该组所有可用模型 */}
      <div className="flex items-center gap-1 mt-1.5 ml-12">
        {view.models.map((modelId, idx) => (
          <button
            key={modelId}
            onClick={() => switchGroupModel(groupId, idx)}
            className={cn(
              "px-2 py-0.5 rounded-full text-[11px] transition-colors",
              idx === view.activeIndex
                ? "bg-brand text-white"
                : "bg-surface-card text-text-tertiary hover:bg-surface-hover"
            )}
          >
            {getModelName(modelId)}
          </button>
        ))}
        
        {/* + 按钮：fork 新模型对比 */}
        <button
          onClick={() => openForkDialog(groupId)}
          className="px-1.5 py-0.5 rounded-full text-[11px] bg-surface-card text-text-tertiary hover:bg-surface-hover"
        >
          +
        </button>
      </div>
    </div>
  );
}
```

#### 4.3 视觉标识方案

```tsx
// 普通模式下，不同模型的消息用左侧边框区分
const modelBorderColors: Record<string, string> = {
  "gpt-5.5": "border-l-blue-500",
  "gpt-5.4": "border-l-green-500", 
  "claude-4": "border-l-orange-500",
  "gemini-3.1": "border-l-purple-500",
  "deepseek-v4": "border-l-cyan-500",
};

// AssistantMessage 组件
<div className={cn(
  "rounded-xl bg-surface-elevated",
  msg.groupId && modelBorderColors[msg.model || ""] || "border-l-4 border-transparent"
)}>
```

---

### 五、关键交互流程时序

```
【场景：普通聊天 → 点击某条 GPT-5.5 消息 fork 对比】

1. 用户 hover GPT-5.5 回答 → 显示「对比」按钮
2. 点击「对比」→ 弹出模型选择器 → 选 GPT-5.4
3. 前端：
   a. 发送 POST /api/chat/:msgId/fork { model_id: "gpt-5.4" }
   b. 同时本地进入 compare 模式，占位显示 loading
4. 后端：
   a. 找到原消息所属 Group
   b. Group.Models 从 ["gpt-5.5"] 扩展为 ["gpt-5.5","gpt-5.4"]
   c. 用相同上下文调用 GPT-5.4
   d. 保存新 assistant message (group_id=原group, group_index=1)
   e. 返回新消息
5. 前端：
   a. 收到新消息，替换 loading
   b. 该轮显示两列：GPT-5.5 | GPT-5.4
   c. 底部输入框变为「对比输入框」（共享输入）
6. 用户继续提问 → 两个模型并行回答，创建新 Group

【场景：退出对比模式】

1. 用户点击「退出对比」
2. 前端：viewMode = "normal"
3. 消息列表恢复单流布局
4. 但该 Group 的消息下方保留切换条：
   [gpt-5.5] [gpt-5.4] ← 当前显示
5. 用户可随时点击 [gpt-5.4] 切换查看另一版本
6. 继续发消息 → 以当前 active 的模型走单聊（不走对比）
```

---

### 六、改动清单

| 文件 | 改动 | 优先级 |
|------|------|--------|
| `backend/internal/models/message_group.go` | 新建 | P0 |
| `backend/internal/models/conversation.go` | Message 加 GroupID/GroupIndex | P0 |
| `backend/internal/models/db.go` | AutoMigrate + 迁移脚本 | P0 |
| `backend/internal/api/chat.go` | 保存消息时创建/绑定 Group | P0 |
| `backend/internal/api/chat.go` | 新增 ForkCompare 接口 | P0 |
| `backend/internal/api/conversation.go` | GET /conversations/:id 返回 groups | P0 |
| `frontend/hooks/useChat.ts` | Message 接口加 group 字段 | P0 |
| `frontend/hooks/useChat.ts` | 新增 groupViews 状态管理 | P0 |
| `frontend/components/chat/MessageList.tsx` | 分组渲染逻辑 | P0 |
| `frontend/components/chat/AssistantMessage.tsx` | 加模型切换条 + 边框颜色 | P0 |
| `frontend/components/chat/ForkCompareDialog.tsx` | 新建：选择对比模型弹窗 | P1 |

---


这几个问题非常好，触及了架构的核心。答案就一句话：

> **每轮 Group 的模型组合是创建时的快照，不可变。全局 `activeModels` 只决定「下一轮」新消息用谁。**

---

## 逐条回答

### 第 8 问：单聊消息在对比模式下怎么展示？

```
Round 1 (Group 1): [GPT-5.5, GPT-5.4] 对比
Round 2 (Group 2): [GPT-5.5] 单聊 ← 消息1
Round 3 (Group 3): [GPT-5.5, GPT-5.4] 对比 ← 对消息1进行对比
```

**渲染时：**
```tsx
// 对比模式下的消息列表
<div>
  {/* Group 1: 2列 */}
  <CompareRow models={["gpt-5.5", "gpt-5.4"]}>
    <Column model="gpt-5.5">...</Column>
    <Column model="gpt-5.4">...</Column>
  </CompareRow>
  
  {/* Group 2: 单聊Group只有1个模型，只显示1列 */}
  <CompareRow models={["gpt-5.5"]}>
    <Column model="gpt-5.5">消息1内容...</Column>
    {/* 右边空白或提示 */}
    <div className="text-text-tertiary text-sm flex items-center justify-center">
      该消息为单聊生成
    </div>
  </CompareRow>
  
  {/* Group 3: 2列 */}
  <CompareRow models={["gpt-5.5", "gpt-5.4"]}>
    <Column model="gpt-5.5">...</Column>
    <Column model="gpt-5.4">...</Column>
  </CompareRow>
</div>
```

**Group 的列数 = 该 Group 自己的 `models.length`**。单聊 Group 只有1列，不用硬凑2列。

---

### 第 9 问：对比模式下切换列的模型

```
当前状态：
- 全局 activeModels = ["gpt-5.5", "gpt-5.4"]
- 历史：Group1 [GPT-5.5, GPT-5.4], Group2 [GPT-5.5]

用户操作：
1. 左边列切换为 DeepSeek
2. 右边列切换为 Gemini
```

**会发生什么：**

```tsx
// 1. 只改全局 activeModels，不改任何历史 Group
setActiveModels(["deepseek-v4", "gemini-3.1"]);

// 2. 当前已生成的 Group 完全不变
// Group1 仍然是 [GPT-5.5, GPT-5.4]
// Group2 仍然是 [GPT-5.5]

// 3. 用户发新消息 → 创建 Group3
// Group3 的 models = 当前 activeModels 的快照 = ["deepseek-v4", "gemini-3.1"]
```

**渲染时：**
```tsx
{/* Group 1: 老模型组合 */}
<CompareRow models={["gpt-5.5", "gpt-5.4"]}>...</CompareRow>

{/* Group 2: 单聊 */}
<CompareRow models={["gpt-5.5"]}>...</CompareRow>

{/* Group 3: 新模型组合 */}
<CompareRow models={["deepseek-v4", "gemini-3.1"]}>...</CompareRow>
```

**每轮 Group 顶部显示该轮当时的模型名称**，不是全局统一的。

---

### 回退到单聊后怎么兼容？

```tsx
// 普通模式：每个 Group 只显示 activeIndex 对应的那条消息
<div>
  {/* Group 1: 用户上次看的是 GPT-5.5 (activeIndex=0) */}
  <SingleMessage 
    msg={group1.messages[0]} 
    switchBar={["gpt-5.5", "gpt-5.4"]} // 可切换
  />
  
  {/* Group 2: 只有一个模型 */}
  <SingleMessage 
    msg={group2.messages[0]}
    // 没有 switchBar，因为 models.length === 1
  />
  
  {/* Group 3: 用户上次看的是 Gemini (activeIndex=1) */}
  <SingleMessage 
    msg={group3.messages[1]}
    switchBar={["deepseek-v4", "gemini-3.1"]}
  />
</div>
```

**普通模式下：**
- 每个 Group 只显示 **1 条**消息（activeIndex 指定的）
- Group 下方显示 **该 Group 自己的** 模型切换条
- 单聊 Group（1个模型）没有切换条
- 对比 Group（2+个模型）有切换条，可切看不同版本

---

## 核心状态设计（最终版）

```tsx
// ========== 全局状态（只影响「下一轮」） ==========
const [viewMode, setViewMode] = useState<"normal" | "compare">("normal");
const [activeModels, setActiveModels] = useState<string[]>(["gpt-5.5"]); 
// normal 模式下 length=1，compare 模式下 length=2

// ========== Group 快照（不可变，创建时确定） ==========
interface MessageGroup {
  id: number;
  userMessageId: number;
  models: string[];        // 快照：["gpt-5.5","gpt-5.4"]
  createdAt: number;
}

// ========== 用户视图状态（可切换） ==========
interface GroupView {
  groupId: number;
  activeIndex: number;     // 当前显示组内第几个回答
}

// 发送消息时：
const sendMessage = (content: string) => {
  const groupModels = [...activeModels]; // 快照！
  
  if (viewMode === "compare") {
    // 创建 Group，models = groupModels
    // 并行调用每个模型
    // 每条 assistant message: groupId=group.id, groupIndex=i
  } else {
    // 单聊
    // 创建 Group，models = [groupModels[0]]
    // 调用单个模型
  }
};
```

---

## 一句话总结

> **Group 是「每轮」的不可变快照，activeModels 是「下一轮」的可变配置。切换模型只改下一轮，不改历史。普通模式下每个 Group 显示一个（可切换），对比模式下每个 Group 展开全部（各轮列数不同）。**