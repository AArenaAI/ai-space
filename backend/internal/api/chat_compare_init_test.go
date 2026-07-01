package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"aipool-backend/internal/config"
	"aipool-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupCompareInitTestDB(t *testing.T) (*gorm.DB, models.User, models.Workspace) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(
		&models.User{},
		&models.Workspace{},
		&models.Conversation{},
		&models.Message{},
		&models.MessageGroup{},
		&models.MessageFile{},
		&models.NotebookConversation{},
		&models.AIBackgroundTask{},
		&models.AIBackgroundTaskEvent{},
		&models.RefreshToken{},
		&models.ModelConfig{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	user := models.User{Email: "compare-init@example.com", Password: "x", Name: "Compare Init", Role: "user", PlanTier: "free"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	workspace := models.Workspace{UserID: user.ID, Name: "默认工作区", IsDefault: true}
	if err := db.Create(&workspace).Error; err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	return db, user, workspace
}

func performCompareInitRequest(t *testing.T, handler *ChatHandler, userID uint, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	router := gin.New()
	router.POST("/api/chat/compare/init", func(c *gin.Context) {
		c.Set("userID", userID)
		handler.InitCompareChat(c)
	})
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/chat/compare/init", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	return res
}

func TestInitCompareChatCreatesConversationUserMessageAndGroup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, user, workspace := setupCompareInitTestDB(t)
	handler := &ChatHandler{db: db, cfg: &config.Config{JWTSecret: "test-secret"}}

	res := performCompareInitRequest(t, handler, user.ID, map[string]any{
		"content":        "并行对比测试",
		"model":          "deepseek-v4-pro",
		"compare_models": []string{"deepseek-v4-pro", "gemini-3.1-flash-lite"},
		"workspace_id":   workspace.ID,
	})
	if res.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}

	var payload struct {
		ConversationID uint `json:"conversation_id"`
		UserMessage    struct {
			ID      uint   `json:"id"`
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"user_message"`
		Group struct {
			ID            uint     `json:"id"`
			UserMessageID uint     `json:"user_message_id"`
			GroupModels   []string `json:"group_models"`
		} `json:"group"`
		CompareModels []string `json:"compare_models"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.ConversationID == 0 || payload.UserMessage.ID == 0 || payload.Group.ID == 0 {
		t.Fatalf("missing ids in payload: %+v", payload)
	}
	if payload.UserMessage.Role != "user" || payload.UserMessage.Content != "并行对比测试" {
		t.Fatalf("unexpected user message payload: %+v", payload.UserMessage)
	}
	if payload.Group.UserMessageID != payload.UserMessage.ID {
		t.Fatalf("group user_message_id=%d user=%d", payload.Group.UserMessageID, payload.UserMessage.ID)
	}
	if len(payload.CompareModels) != 2 || payload.CompareModels[0] != "deepseek-v4-pro" || payload.CompareModels[1] != "gemini-3.1-flash-lite" {
		t.Fatalf("unexpected compare models: %+v", payload.CompareModels)
	}

	var conv models.Conversation
	if err := db.First(&conv, payload.ConversationID).Error; err != nil {
		t.Fatalf("find conversation: %v", err)
	}
	if !conv.Compare || conv.Model != "deepseek-v4-pro" || conv.WorkspaceID != workspace.ID {
		t.Fatalf("unexpected conversation: %+v", conv)
	}
	if got := conv.GetCompareModels(); len(got) != 2 || got[1] != "gemini-3.1-flash-lite" {
		t.Fatalf("conversation compare models=%+v", got)
	}

	var messages []models.Message
	if err := db.Where("conversation_id = ?", conv.ID).Find(&messages).Error; err != nil {
		t.Fatalf("find messages: %v", err)
	}
	if len(messages) != 1 || messages[0].Role != "user" || messages[0].ID != payload.UserMessage.ID {
		t.Fatalf("unexpected messages: %+v", messages)
	}
	var group models.MessageGroup
	if err := db.First(&group, payload.Group.ID).Error; err != nil {
		t.Fatalf("find group: %v", err)
	}
	if group.UserMessageID != payload.UserMessage.ID || group.ConversationID != conv.ID {
		t.Fatalf("unexpected group: %+v", group)
	}
}

func TestInitCompareChatDoesNotOverwriteExistingWorkspaceWithZero(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, user, workspace := setupCompareInitTestDB(t)
	handler := &ChatHandler{db: db, cfg: &config.Config{JWTSecret: "test-secret"}}
	existing := models.Conversation{UserID: user.ID, WorkspaceID: workspace.ID, Title: "existing", Model: "gpt-5.4"}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatalf("create existing conversation: %v", err)
	}

	res := performCompareInitRequest(t, handler, user.ID, map[string]any{
		"conversation_id": existing.ID,
		"content":         "已有会话进入对比",
		"model":           "deepseek-v4-pro",
		"compare_models":  []string{"deepseek-v4-pro", "gemini-3.1-flash-lite"},
	})
	if res.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	var conv models.Conversation
	if err := db.First(&conv, existing.ID).Error; err != nil {
		t.Fatalf("find conversation: %v", err)
	}
	if conv.WorkspaceID != workspace.ID {
		t.Fatalf("compare init overwrote workspace_id: got %d want %d", conv.WorkspaceID, workspace.ID)
	}
	if !conv.Compare {
		t.Fatalf("conversation should be compare after init")
	}
}

func TestInitCompareChatUsesDefaultWorkspaceWhenMissing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, user, workspace := setupCompareInitTestDB(t)
	handler := &ChatHandler{db: db, cfg: &config.Config{JWTSecret: "test-secret"}}

	res := performCompareInitRequest(t, handler, user.ID, map[string]any{
		"content":        "新对比会话默认工作区",
		"model":          "deepseek-v4-pro",
		"compare_models": []string{"deepseek-v4-pro", "gemini-3.1-flash-lite"},
	})
	if res.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	var payload struct {
		ConversationID uint `json:"conversation_id"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	var conv models.Conversation
	if err := db.First(&conv, payload.ConversationID).Error; err != nil {
		t.Fatalf("find conversation: %v", err)
	}
	if conv.WorkspaceID != workspace.ID {
		t.Fatalf("new compare conversation workspace_id: got %d want default %d", conv.WorkspaceID, workspace.ID)
	}
}

func TestInitCompareChatRejectsSingleModel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, user, workspace := setupCompareInitTestDB(t)
	handler := &ChatHandler{db: db, cfg: &config.Config{JWTSecret: "test-secret"}}
	res := performCompareInitRequest(t, handler, user.ID, map[string]any{
		"content":        "bad",
		"model":          "deepseek-v4-pro",
		"compare_models": []string{"deepseek-v4-pro"},
		"workspace_id":   workspace.ID,
	})
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}
