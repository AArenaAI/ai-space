package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"aipool-backend/internal/config"
	"aipool-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestChatBootstrapIncludesStableConversationSnapshot(t *testing.T) {
	gin.SetMode(gin.TestMode)
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
		&models.Notebook{},
		&models.NotebookFile{},
		&models.NotebookConversation{},
		&models.AIBackgroundTask{},
		&models.AIBackgroundTaskEvent{},
		&models.RefreshToken{},
		&models.ModelConfig{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	user := models.User{Email: "bootstrap@example.com", Password: "x", Name: "Bootstrap", Role: "user", PlanTier: "free"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	workspace := models.Workspace{UserID: user.ID, Name: "默认工作区", IsDefault: true}
	if err := db.Create(&workspace).Error; err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	user.BasicCredits = 1200
	user.AdvancedCredits = 3400
	user.BetaCreditBalance = 5600
	user.PlanTier = "plus"
	if err := db.Save(&user).Error; err != nil {
		t.Fatalf("update user credits: %v", err)
	}
	conv := models.Conversation{UserID: user.ID, WorkspaceID: workspace.ID, Title: "Compare conversation", Compare: true, Pinned: true}
	conv.SetCompareModels([]string{"kimi-k2.6", "gpt-5.4"})
	if err := db.Create(&conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	oldAssistant := models.Message{ConversationID: conv.ID, Role: "assistant", Content: "old active", Model: "gpt-5.4"}
	if err := db.Create(&oldAssistant).Error; err != nil {
		t.Fatalf("create old active assistant: %v", err)
	}
	activeTask := models.AIBackgroundTask{ResponseID: "resp_old_active", UserID: user.ID, ConversationID: conv.ID, AssistantMessageID: oldAssistant.ID, Model: oldAssistant.Model, Provider: "openai", Status: "streaming", LastSequenceNumber: 3}
	if err := db.Create(&activeTask).Error; err != nil {
		t.Fatalf("create active task: %v", err)
	}
	userMsg := models.Message{ConversationID: conv.ID, Role: "user", Content: "你好"}
	if err := db.Create(&userMsg).Error; err != nil {
		t.Fatalf("create user message: %v", err)
	}
	group := models.MessageGroup{ConversationID: conv.ID, UserMessageID: userMsg.ID}
	group.SetModels([]string{"kimi-k2.6", "gpt-5.4"})
	if err := db.Create(&group).Error; err != nil {
		t.Fatalf("create group: %v", err)
	}
	assistantA := models.Message{ConversationID: conv.ID, Role: "assistant", Content: "A", Model: "kimi-k2.6", GroupID: group.ID, GroupIndex: 0}
	assistantB := models.Message{ConversationID: conv.ID, Role: "assistant", Content: "B", Model: "gpt-5.4", GroupID: group.ID, GroupIndex: 1}
	if err := db.Create(&assistantA).Error; err != nil {
		t.Fatalf("create assistant A: %v", err)
	}
	if err := db.Create(&assistantB).Error; err != nil {
		t.Fatalf("create assistant B: %v", err)
	}
	notebook := models.Notebook{UserID: user.ID, WorkspaceID: workspace.ID, Title: "Recent notebook"}
	if err := db.Create(&notebook).Error; err != nil {
		t.Fatalf("create notebook: %v", err)
	}

	handler := NewChatBootstrapHandler(db, &config.Config{JWTSecret: "test-secret"})
	router := gin.New()
	router.GET("/api/chat/bootstrap", func(c *gin.Context) {
		c.Set("userID", user.ID)
		handler.Get(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/chat/bootstrap?id=1&message_tail=2", nil)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", res.Code, res.Body.String())
	}

	var payload struct {
		AuthStatus   string `json:"auth_status"`
		Models       []any  `json:"models"`
		Conversation struct {
			ID            uint     `json:"id"`
			Compare       bool     `json:"compare"`
			CompareModels []string `json:"compare_models"`
		} `json:"conversation"`
		Snapshot struct {
			Total           int64  `json:"total"`
			SnapshotVersion string `json:"snapshot_version"`
			Messages        []struct {
				ID            uint     `json:"id"`
				Role          string   `json:"role"`
				GroupIndex    int      `json:"group_index"`
				GroupModels   []string `json:"group_models"`
				UserMessageID uint     `json:"user_message_id"`
			} `json:"messages"`
		} `json:"snapshot"`
		Billing struct {
			Tier            string `json:"tier"`
			BetaCredits     int    `json:"beta_credits"`
			BasicCredits    int    `json:"basic_credits"`
			AdvancedCredits int    `json:"advanced_credits"`
		} `json:"billing"`
		Sidebar struct {
			Conversations   []models.Conversation `json:"conversations"`
			Pinned          []models.Conversation `json:"pinned"`
			RecentNotebooks []struct {
				ID        uint   `json:"id"`
				Title     string `json:"title"`
				FileCount int64  `json:"file_count"`
			} `json:"recent_notebooks"`
			Total int64 `json:"total"`
		} `json:"sidebar"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.AuthStatus != "authenticated" {
		t.Fatalf("auth_status = %q", payload.AuthStatus)
	}
	if len(payload.Models) == 0 {
		t.Fatalf("expected chat models in bootstrap payload")
	}
	if payload.Conversation.ID != conv.ID || !payload.Conversation.Compare || len(payload.Conversation.CompareModels) != 2 {
		t.Fatalf("unexpected conversation payload: %+v", payload.Conversation)
	}
	if payload.Snapshot.Total != 4 || len(payload.Snapshot.Messages) != 4 {
		t.Fatalf("unexpected snapshot total/messages: total=%d len=%d", payload.Snapshot.Total, len(payload.Snapshot.Messages))
	}
	if payload.Snapshot.SnapshotVersion == "" {
		t.Fatalf("expected snapshot_version in bootstrap payload")
	}
	unchangedReq := httptest.NewRequest(http.MethodGet, "/api/chat/bootstrap?id=1&message_tail=2", nil)
	unchangedReq.Header.Set("If-None-Match", payload.Snapshot.SnapshotVersion)
	unchangedRes := httptest.NewRecorder()
	router.ServeHTTP(unchangedRes, unchangedReq)
	if unchangedRes.Code != http.StatusNotModified {
		t.Fatalf("expected 304 for unchanged snapshot, got %d body=%s", unchangedRes.Code, unchangedRes.Body.String())
	}
	if err := db.Model(&activeTask).Updates(map[string]any{"last_sequence_number": int64(4)}).Error; err != nil {
		t.Fatalf("update active task: %v", err)
	}
	changedTaskReq := httptest.NewRequest(http.MethodGet, "/api/chat/bootstrap?id=1&message_tail=2", nil)
	changedTaskReq.Header.Set("If-None-Match", payload.Snapshot.SnapshotVersion)
	changedTaskRes := httptest.NewRecorder()
	router.ServeHTTP(changedTaskRes, changedTaskReq)
	if changedTaskRes.Code != http.StatusOK {
		t.Fatalf("expected 200 when active task progress changed, got %d body=%s", changedTaskRes.Code, changedTaskRes.Body.String())
	}
	foundOldActive := false
	for _, message := range payload.Snapshot.Messages {
		if message.ID == oldAssistant.ID {
			foundOldActive = true
		}
		if message.Role == "assistant" {
			if message.ID == oldAssistant.ID {
				continue
			}
			if message.UserMessageID != userMsg.ID {
				t.Fatalf("assistant %d missing user_message_id: %+v", message.ID, message)
			}
			if len(message.GroupModels) != 2 {
				t.Fatalf("assistant %d missing group_models: %+v", message.ID, message)
			}
		}
	}
	if !foundOldActive {
		t.Fatalf("active task assistant %d outside tail was not included in snapshot", oldAssistant.ID)
	}
	if payload.Billing.Tier != "plus" || payload.Billing.BasicCredits != 1200 || payload.Billing.AdvancedCredits != 3400 || payload.Billing.BetaCredits != 5600 {
		t.Fatalf("unexpected billing payload: %+v", payload.Billing)
	}
	if payload.Sidebar.Total != 1 || len(payload.Sidebar.Conversations) != 1 {
		t.Fatalf("unexpected sidebar conversations: total=%d len=%d", payload.Sidebar.Total, len(payload.Sidebar.Conversations))
	}
	if len(payload.Sidebar.Pinned) != 1 || payload.Sidebar.Pinned[0].ID != conv.ID {
		t.Fatalf("unexpected pinned conversations: %+v", payload.Sidebar.Pinned)
	}
	if len(payload.Sidebar.RecentNotebooks) != 1 || payload.Sidebar.RecentNotebooks[0].ID != notebook.ID || payload.Sidebar.RecentNotebooks[0].Title != notebook.Title {
		t.Fatalf("unexpected recent notebooks: %+v", payload.Sidebar.RecentNotebooks)
	}
}

func TestChatBootstrapConversationListUsesLatestActivityAndRouteWorkspace(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.Workspace{}, &models.Conversation{}, &models.Message{}, &models.AIBackgroundTask{}, &models.NotebookConversation{}, &models.RefreshToken{}, &models.ModelConfig{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	user := models.User{Email: "activity@example.com", Password: "x", Name: "Activity", Role: "user", PlanTier: "free"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	defaultWS := models.Workspace{UserID: user.ID, Name: "默认", IsDefault: true}
	otherWS := models.Workspace{UserID: user.ID, Name: "另一个"}
	if err := db.Create(&defaultWS).Error; err != nil {
		t.Fatalf("create default workspace: %v", err)
	}
	if err := db.Create(&otherWS).Error; err != nil {
		t.Fatalf("create other workspace: %v", err)
	}
	old := time.Now().Add(-48 * time.Hour)
	olderConv := models.Conversation{UserID: user.ID, WorkspaceID: otherWS.ID, Title: "older conv", CreatedAt: old, UpdatedAt: old}
	activeConv := models.Conversation{UserID: user.ID, WorkspaceID: otherWS.ID, Title: "active conv", CreatedAt: old, UpdatedAt: old}
	if err := db.Create(&olderConv).Error; err != nil {
		t.Fatalf("create older conv: %v", err)
	}
	if err := db.Create(&activeConv).Error; err != nil {
		t.Fatalf("create active conv: %v", err)
	}
	latest := time.Now().Add(-30 * time.Minute)
	if err := db.Create(&models.Message{ConversationID: activeConv.ID, Role: "assistant", Content: "latest", CreatedAt: latest, CompletedAt: &latest}).Error; err != nil {
		t.Fatalf("create latest message: %v", err)
	}

	handler := NewChatBootstrapHandler(db, &config.Config{JWTSecret: "test-secret"})
	router := gin.New()
	router.GET("/api/chat/bootstrap", func(c *gin.Context) {
		c.Set("userID", user.ID)
		handler.Get(c)
	})
	req := httptest.NewRequest(http.MethodGet, "/api/chat/bootstrap?id="+strconv.Itoa(int(activeConv.ID)), nil)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", res.Code, res.Body.String())
	}
	var payload struct {
		Workspace struct {
			CurrentID uint `json:"current_id"`
		} `json:"workspace"`
		Sidebar struct {
			Conversations []models.Conversation `json:"conversations"`
		} `json:"sidebar"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.Workspace.CurrentID != otherWS.ID {
		t.Fatalf("bootstrap should switch sidebar workspace to route conversation workspace: got %d want %d", payload.Workspace.CurrentID, otherWS.ID)
	}
	if len(payload.Sidebar.Conversations) < 2 {
		t.Fatalf("expected both workspace conversations, got %+v", payload.Sidebar.Conversations)
	}
	if payload.Sidebar.Conversations[0].ID != activeConv.ID {
		t.Fatalf("latest message activity should sort active conversation first, got %+v", payload.Sidebar.Conversations)
	}
	if !payload.Sidebar.Conversations[0].UpdatedAt.After(old) {
		t.Fatalf("returned updated_at should reflect latest activity, got %s old %s", payload.Sidebar.Conversations[0].UpdatedAt, old)
	}
}
