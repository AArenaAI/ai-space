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

func createTestFileWithImages(t *testing.T, db *gorm.DB, publicID, filename, mimeType string, userID uint, guestID string) models.File {
	t.Helper()
	f := createTestFile(t, db, publicID, filename, mimeType, userID, guestID)
	f.HasImages = true
	if err := db.Save(&f).Error; err != nil {
		t.Fatalf("mark file %s has images: %v", publicID, err)
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

func TestPDFWithEmbeddedImagesIsTreatedAsDocumentContext(t *testing.T) {
	h, db := setupChatFilePlanTest(t)
	userID := uint(42)
	pdfFile := createTestFileWithImages(t, db, "file_pdf_with_images", "氧化锆-dual-translated(1).pdf", "application/pdf", userID, "")

	if err := db.Create(&models.FileChunk{
		FileID:     pdfFile.ID,
		ChunkIndex: 0,
		BlockID:    "pdf-p1",
		Page:       1,
		BlockType:  "paragraph",
		Content:    "牙科氧化锆论文：介绍氧化锆陶瓷、表面处理、粘接强度和临床修复。",
	}).Error; err != nil {
		t.Fatalf("create pdf chunk: %v", err)
	}

	ctx := h.buildFileContext([]models.File{pdfFile}, map[uint]string{pdfFile.ID: pdfFile.Filename}, "这个的主要内容是什么", "deepseek-v4-pro", false, "Test")
	if !strings.Contains(ctx, "牙科氧化锆论文") {
		t.Fatalf("pdf with HasImages=true should use document chunks, got: %q", ctx)
	}

	msg := models.Message{ConversationID: 1, Role: "user", Content: "这个的主要内容是什么"}
	if err := db.Create(&msg).Error; err != nil {
		t.Fatalf("create message: %v", err)
	}
	h.saveMessageFiles(msg.ID, []models.File{pdfFile})

	var mf models.MessageFile
	if err := db.Where("message_id = ?", msg.ID).First(&mf).Error; err != nil {
		t.Fatalf("load message file: %v", err)
	}
	if mf.Type != "document" {
		t.Fatalf("pdf with embedded images should persist as document, got %q", mf.Type)
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
	if len(plan.HistoricalFiles) != 0 {
		t.Fatalf("plain follow-up should not auto inject historical files, got %d", len(plan.HistoricalFiles))
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

func TestBuildChatFilePlanCurrentAttachmentIsIsolatedFromHistoricalAndContextFiles(t *testing.T) {
	h, db := setupChatFilePlanTest(t)
	userID := uint(42)
	conv := models.Conversation{UserID: userID, Title: "test", Model: "gpt-5.4"}
	if err := db.Create(&conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	oldFile := createTestFile(t, db, "file_old_a", "A.pdf", "application/pdf", userID, "")
	newFile := createTestFile(t, db, "file_new_b", "B.md", "text/markdown", userID, "")
	if err := db.Create(&models.ConversationFile{ConversationID: conv.ID, FileID: oldFile.ID}).Error; err != nil {
		t.Fatalf("create old conversation file: %v", err)
	}

	req := ChatRequest{
		ConversationID:  conv.ID,
		MessageFileIDs:  []string{newFile.PublicID},
		ContextFileIDs:  []string{oldFile.PublicID},
		ContextPolicy:   FileContextPolicy{UseConversationFiles: "always"},
		Messages:        []services.Message{{Role: "user", Content: "总结这个文件"}},
	}
	plan := h.buildChatFilePlan(req, userID, "")
	if len(plan.MessageFiles) != 1 || plan.MessageFiles[0].PublicID != newFile.PublicID {
		t.Fatalf("current turn should attach only new file B, got %#v", plan.MessageFiles)
	}
	if len(plan.ContextFiles) != 1 || plan.ContextFiles[0].PublicID != oldFile.PublicID {
		t.Fatalf("explicit context files should still be resolved for audit, got %#v", plan.ContextFiles)
	}
	if len(plan.HistoricalFiles) != 0 {
		t.Fatalf("current attachment turn must not inject old historical/context files, got %#v", plan.HistoricalFiles)
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
	if len(plan.HistoricalFiles) != 3 {
		t.Fatalf("file question should use 3 historical RAG files, got %d", len(plan.HistoricalFiles))
	}

	seen := map[string]bool{}
	for _, f := range plan.HistoricalFiles {
		seen[f.PublicID] = true
	}
	for _, id := range []string{"file_json", "file_csv", "file_img"} {
		if !seen[id] {
			t.Fatalf("historical RAG missing %s; got %#v", id, seen)
		}
	}
}
