package api

import (
	"strings"
	"testing"
	"time"

	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupChatFilePlanTest(t *testing.T) (*ChatHandler, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite memory db: %v", err)
	}
	if err := db.AutoMigrate(
		&models.User{},
		&models.Conversation{},
		&models.Message{},
		&models.File{},
		&models.FileChunk{},
		&models.ConversationFile{},
		&models.MessageFile{},
	); err != nil {
		t.Fatalf("automigrate: %v", err)
	}

	cfg := &config.Config{FileStorageDir: t.TempDir()}
	fileSvc := services.NewFileService(db, cfg, nil, nil, nil)
	h := &ChatHandler{db: db, cfg: cfg, fileService: fileSvc, retrievalSvc: services.NewRetrievalService(db, nil), contextBuilder: services.NewContextBuilder()}
	return h, db
}

func createTestFile(t *testing.T, db *gorm.DB, publicID, filename, mimeType string, userID uint, guestID string) models.File {
	t.Helper()
	f := models.File{
		PublicID:        publicID,
		UserID:          userID,
		GuestID:         guestID,
		Filename:        filename,
		MimeType:        mimeType,
		StoragePath:     "/tmp/" + filename,
		ParseStatus:     "done",
		EmbeddingStatus: "done",
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create file %s: %v", publicID, err)
	}
	return f
}

func TestBuildFileContextIncludesStartOfLargeMessageAttachment(t *testing.T) {
	h, db := setupChatFilePlanTest(t)
	userID := uint(42)
	file := createTestFile(t, db, "file_large_md", "111.md", "text/markdown", userID, "")

	// 复现 111.md 这类大 Markdown：单个 chunk 可能超过 ContextBuilder 的硬顶。
	// 当前消息刚上传文件后用户只问“这是什么”，此时必须能看到文件开头，
	// 不能只返回“已达到总字数上限”。
	firstChunk := "这是一个名为 111.md 的 Markdown 文件。\n\n关键开头内容：请总结这个文件。\n" + strings.Repeat("后续日志内容 abcdefghijklmnopqrstuvwxyz\n", 20000)
	for idx, content := range []string{firstChunk} {
		if err := db.Create(&models.FileChunk{
			FileID:     file.ID,
			ChunkIndex: idx,
			BlockID:    "p1-b" + string('1'+rune(idx)),
			Page:       1,
			BlockType:  "paragraph",
			Content:    content,
		}).Error; err != nil {
			t.Fatalf("create chunk %d: %v", idx, err)
		}
	}

	ctx := h.buildFileContext([]models.File{file}, map[uint]string{file.ID: file.Filename}, "这是什么", "gpt-5.4", false, "Test")
	if !strings.Contains(ctx, "关键开头内容") {
		t.Fatalf("file context should include the beginning of the uploaded file, got prefix: %q", ctx[:min(len(ctx), 500)])
	}
	if strings.Contains(ctx, "### 文件: 111.md\n\n\n... (已达到总字数上限)") {
		t.Fatalf("file context only contains truncation marker without actual content: %q", ctx[:min(len(ctx), 500)])
	}
}

func TestBuildChatFilePlanPlainTextDoesNotAttachHistoricalFiles(t *testing.T) {
	h, db := setupChatFilePlanTest(t)
	userID := uint(42)
	conv := models.Conversation{UserID: userID, Title: "test", Model: "gpt-5.4"}
	if err := db.Create(&conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	jsonFile := createTestFile(t, db, "file_json", "a.json", "application/json", userID, "")
	csvFile := createTestFile(t, db, "file_csv", "b.csv", "text/csv", userID, "")
	imgFile := createTestFile(t, db, "file_img", "c.png", "image/png", userID, "")
	for _, f := range []models.File{jsonFile, csvFile, imgFile} {
		if err := db.Create(&models.ConversationFile{ConversationID: conv.ID, FileID: f.ID}).Error; err != nil {
			t.Fatalf("create conversation file: %v", err)
		}
	}

	plainReq := ChatRequest{
		ConversationID: conv.ID,
		Messages:       []services.Message{{Role: "user", Content: "继续说"}},
	}
	plan := h.buildChatFilePlan(plainReq, userID, "")
	if len(plan.MessageFiles) != 0 {
		t.Fatalf("plain follow-up should not produce message attachments, got %d", len(plan.MessageFiles))
	}
	if len(plan.RAGFiles) != 0 {
		t.Fatalf("plain follow-up should not auto inject historical files, got %d", len(plan.RAGFiles))
	}

	msg := models.Message{ConversationID: conv.ID, Role: "user", Content: "继续说"}
	if err := db.Create(&msg).Error; err != nil {
		t.Fatalf("create message: %v", err)
	}
	h.saveMessageFiles(msg.ID, plan.MessageFiles)
	var messageFileCount int64
	if err := db.Model(&models.MessageFile{}).Where("message_id = ?", msg.ID).Count(&messageFileCount).Error; err != nil {
		t.Fatalf("count message files: %v", err)
	}
	if messageFileCount != 0 {
		t.Fatalf("plain follow-up persisted message_files = %d, want 0", messageFileCount)
	}
}

func TestBuildChatFilePlanHistoricalRAGOnlyForFileQuestion(t *testing.T) {
	h, db := setupChatFilePlanTest(t)
	userID := uint(42)
	conv := models.Conversation{UserID: userID, Title: "test", Model: "gpt-5.4"}
	if err := db.Create(&conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	jsonFile := createTestFile(t, db, "file_json", "a.json", "application/json", userID, "")
	csvFile := createTestFile(t, db, "file_csv", "b.csv", "text/csv", userID, "")
	imgFile := createTestFile(t, db, "file_img", "c.png", "image/png", userID, "")
	for _, f := range []models.File{jsonFile, csvFile, imgFile} {
		if err := db.Create(&models.ConversationFile{ConversationID: conv.ID, FileID: f.ID}).Error; err != nil {
			t.Fatalf("create conversation file: %v", err)
		}
	}

	fileQuestionReq := ChatRequest{
		ConversationID: conv.ID,
		Messages:       []services.Message{{Role: "user", Content: "上面的文件分别讲什么？"}},
	}
	plan := h.buildChatFilePlan(fileQuestionReq, userID, "")
	if len(plan.MessageFiles) != 0 {
		t.Fatalf("historical RAG should not show files on current bubble, got message files %d", len(plan.MessageFiles))
	}
	if len(plan.RAGFiles) != 3 {
		t.Fatalf("file question should use 3 historical RAG files, got %d", len(plan.RAGFiles))
	}

	seen := map[string]bool{}
	for _, f := range plan.RAGFiles {
		seen[f.PublicID] = true
	}
	for _, id := range []string{"file_json", "file_csv", "file_img"} {
		if !seen[id] {
			t.Fatalf("historical RAG missing %s; got %#v", id, seen)
		}
	}
}
