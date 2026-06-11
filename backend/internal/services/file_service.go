package services

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"aipool-backend/internal/config"
	"aipool-backend/internal/modelmeta"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services/embedding"
	"aipool-backend/pkg/publicid"
	"gorm.io/gorm"
)

// FileService 文件存储与检索服务
type FileService struct {
	db           *gorm.DB
	cfg          *config.Config
	parser       *FileParser
	storageDir   string
	embedder     embedding.Provider
	usageService *UsageService
}

// NewFileService 创建文件服务
func NewFileService(db *gorm.DB, cfg *config.Config, parser *FileParser, embedder embedding.Provider, usageService *UsageService) *FileService {
	storageDir := cfg.FileStorageDir
	if storageDir == "" {
		storageDir = "./uploads"
	}
	// 确保目录存在
	os.MkdirAll(storageDir, 0755)

	// 自动迁移表结构
	db.AutoMigrate(&models.File{})
	db.AutoMigrate(&models.FileChunk{})
	db.Exec("CREATE INDEX IF NOT EXISTS idx_file_chunks_file_created ON file_chunks(file_id, created_at)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_file_chunks_file_block_created ON file_chunks(file_id, block_type, created_at)")
	db.AutoMigrate(&models.FileEmbedding{})
	db.AutoMigrate(&models.FileEmbeddingJob{})

	s := &FileService{
		db:           db,
		cfg:          cfg,
		parser:       parser,
		storageDir:   storageDir,
		embedder:     embedder,
		usageService: usageService,
	}

	// 补全旧文件的 PublicID（一次性迁移）
	s.migratePublicIDs()

	// 启动后台 embedding worker
	go s.startEmbeddingWorker()

	return s
}

// UploadAndParse 上传并解析文件
func (s *FileService) UploadAndParse(ctx context.Context, userID uint, guestID, filename string, data []byte, workspaceID ...uint) (*models.File, error) {
	// 1. 保存原始文件到磁盘
	timestamp := time.Now().UnixNano()
	safeName := fmt.Sprintf("%d_%d%s", userID, timestamp, filepath.Ext(filename))
	storagePath := filepath.Join(s.storageDir, safeName)

	if err := os.WriteFile(storagePath, data, 0644); err != nil {
		return nil, fmt.Errorf("保存文件失败: %w", err)
	}

	// 获取 workspace_id（可选参数）
	wid := uint(0)
	if len(workspaceID) > 0 {
		wid = workspaceID[0]
	}

	// 2. 创建数据库记录
	file := &models.File{
		PublicID:        publicid.GenerateFileID(),
		UserID:          userID,
		WorkspaceID:     wid,
		GuestID:         guestID,
		Filename:        filename,
		Size:            int64(len(data)),
		StoragePath:     storagePath,
		ParseStatus:     "pending",
		EmbeddingStatus: "pending",
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}
	if err := s.db.Create(file).Error; err != nil {
		os.Remove(storagePath)
		return nil, fmt.Errorf("保存文件记录失败: %w", err)
	}

	// 3. 异步解析（不阻塞上传响应）
	go func() {
		// 标记为 parsing
		s.db.Model(file).Update("parse_status", "parsing")

		result, err := s.parser.Parse(context.WithoutCancel(ctx), data, filename)
		if err != nil {
			s.db.Model(file).Updates(map[string]interface{}{
				"parse_status":     "error",
				"embedding_status": "error",
				"error_message":    err.Error(),
				"updated_at":       time.Now(),
			})
			return
		}

		// 更新文件解析结果
		mimeType := inferMimeType(filename)
		updates := map[string]interface{}{
			"parse_status": "done",
			"content":      result.Content,
			"page_count":   result.Pages,
			"summary":      result.Summary,
			"mime_type":    mimeType,
			"has_images":   result.HasImages,
			"has_tables":   result.HasTables,
			"token_count":  result.TokenCount,
			"updated_at":   time.Now(),
		}
		if result.VisionUsage != nil {
			updates["vision_prompt_tokens"] = result.VisionUsage.PromptTokens
			updates["vision_completion_tokens"] = result.VisionUsage.CompletionTokens
			updates["vision_total_tokens"] = result.VisionUsage.TotalTokens
			updates["vision_cost_rmb"] = result.VisionUsage.CostRMB
			if s.usageService != nil {
				tu := &TokenUsage{
					PromptTokens:     result.VisionUsage.PromptTokens,
					CompletionTokens: result.VisionUsage.CompletionTokens,
					TotalTokens:      result.VisionUsage.TotalTokens,
				}
				_ = s.usageService.RecordVisionUsageWithContext(file.UserID, s.cfg.VisionModel, file.ID, UsageContext{GuestID: guestID, ResourceType: "file", ResourceID: file.ID, Module: "work", Feature: "document_reader", Operation: "file_vision_parse"}, tu)
			}
		}
		s.db.Model(file).Updates(updates)

		// 保存 chunks（带上结构化字段）
		for _, chunk := range result.Chunks {
			s.db.Create(&models.FileChunk{
				FileID:     file.ID,
				ChunkIndex: chunk.Index,
				BlockID:    chunk.BlockID,
				Page:       chunk.Page,
				Slide:      chunk.Slide,
				SheetName:  chunk.SheetName,
				BlockType:  chunk.BlockType,
				Content:    chunk.Text,
				Markdown:   chunk.Markdown,
				TokenCount: chunk.TokenCount,
				TextHash:   hashText(chunk.Text),
				Metadata:   chunk.Metadata,
			})
		}

		// 创建 embedding job：所有已解析出有效文本 chunk 的文件都进入统一 RAG。
		// 图片在解析阶段已通过 Vision 转成 image_caption 文本，因此也可以 embedding。
		embeddableChunkCount := 0
		for _, chunk := range result.Chunks {
			if strings.TrimSpace(chunk.Text) != "" {
				embeddableChunkCount++
			}
		}
		if s.embedder != nil && embeddableChunkCount > 0 {
			modelInfo := s.embedder.ModelInfo()
			s.db.Create(&models.FileEmbeddingJob{
				FileID:    file.ID,
				Provider:  modelInfo.Provider,
				Model:     modelInfo.Model,
				Dimension: modelInfo.Dimension,
				Status:    "pending",
			})
		} else {
			// 未配置 embedder 或没有可 embedding 的文本 chunk，跳过 embedding。
			// 注意：这里不再按 MIME 类型把图片特殊跳过；图片如果 Vision 解析出 image_caption 文本，也会创建 job。
			s.db.Model(file).Update("embedding_status", "skipped")
		}

		// 异步生成文件摘要（如果摘要为空且内容较长）
		if result.Summary == "" && len(result.Content) > 200 {
			go s.generateFileSummary(file.ID, result.Content)
		}
	}()

	return file, nil
}

// GetFileContent 获取文件解析后的完整内容
func (s *FileService) GetFileContent(fileID uint) (string, error) {
	var file models.File
	if err := s.db.First(&file, fileID).Error; err != nil {
		return "", err
	}
	if file.ParseStatus != "done" {
		return "", fmt.Errorf("文件尚未解析完成")
	}
	return file.Content, nil
}

// GetFileChunks 获取文件的所有 chunks
func (s *FileService) GetFileChunks(fileID uint) ([]models.FileChunk, error) {
	var chunks []models.FileChunk
	if err := s.db.Where("file_id = ?", fileID).Order("chunk_index").Find(&chunks).Error; err != nil {
		return nil, err
	}
	return chunks, nil
}

// GetFileContext 获取文件上下文（MVP：返回最近的 N 个 chunk）
func (s *FileService) GetFileContext(fileIDs []uint, maxChunksPerFile int) (string, error) {
	var context strings.Builder

	for _, fileID := range fileIDs {
		var file models.File
		if err := s.db.First(&file, fileID).Error; err != nil {
			continue
		}
		if file.ParseStatus != "done" {
			continue
		}

		var chunks []models.FileChunk
		dbQuery := s.db.Where("file_id = ?", fileID).Order("chunk_index")
		if maxChunksPerFile > 0 {
			dbQuery = dbQuery.Limit(maxChunksPerFile)
		}
		if err := dbQuery.Find(&chunks).Error; err != nil {
			continue
		}

		if len(chunks) == 0 {
			continue
		}

		context.WriteString(fmt.Sprintf("\n\n===== 文件: %s =====\n", file.Filename))
		for _, chunk := range chunks {
			if chunk.Page > 0 {
				context.WriteString(fmt.Sprintf("\n--- 页码: %d ---\n", chunk.Page))
			}
			context.WriteString(chunk.Content)
			context.WriteString("\n")
		}
	}

	return context.String(), nil
}

// GetFileContextWithQuery 根据查询检索相关 chunks（MVP：关键词过滤）
func (s *FileService) GetFileContextWithQuery(fileIDs []uint, query string, maxChunksPerFile int) (string, error) {
	var context strings.Builder

	for _, fileID := range fileIDs {
		var file models.File
		if err := s.db.First(&file, fileID).Error; err != nil {
			continue
		}
		if file.ParseStatus != "done" {
			continue
		}

		var chunks []models.FileChunk
		if err := s.db.Where("file_id = ?", fileID).Order("chunk_index").Find(&chunks).Error; err != nil {
			continue
		}

		// 关键词过滤
		queryWords := extractKeywords(query)
		var filtered []models.FileChunk
		for _, chunk := range chunks {
			if containsAny(chunk.Content, queryWords) {
				filtered = append(filtered, chunk)
			}
		}

		// 如果没匹配到，返回全部
		if len(filtered) == 0 {
			filtered = chunks
		}

		if maxChunksPerFile > 0 && len(filtered) > maxChunksPerFile {
			filtered = filtered[:maxChunksPerFile]
		}

		if len(filtered) == 0 {
			continue
		}

		context.WriteString(fmt.Sprintf("\n\n===== 文件: %s =====\n", file.Filename))
		for _, chunk := range filtered {
			if chunk.Page > 0 {
				context.WriteString(fmt.Sprintf("\n--- 页码: %d ---\n", chunk.Page))
			}
			context.WriteString(chunk.Content)
			context.WriteString("\n")
		}
	}

	return context.String(), nil
}

// ListUserFiles 列出用户的文件
func (s *FileService) ListUserFiles(userID uint, workspaceID ...uint) ([]models.File, error) {
	var files []models.File
	query := s.db.Where("user_id = ?", userID)
	if len(workspaceID) > 0 && workspaceID[0] > 0 {
		query = query.Where("workspace_id = ?", workspaceID[0])
	}
	if err := query.Order("created_at DESC").Find(&files).Error; err != nil {
		return nil, err
	}
	return files, nil
}

// GetFile 查询单个文件
func (s *FileService) GetFile(fileID uint, file *models.File) error {
	return s.db.First(file, fileID).Error
}

// DeleteFile 删除文件
func (s *FileService) DeleteFile(fileID uint) error {
	var file models.File
	if err := s.db.First(&file, fileID).Error; err != nil {
		return err
	}

	// 删除磁盘文件
	os.Remove(file.StoragePath)

	// 删除数据库记录（chunks、embeddings 和 jobs 会级联删除）
	s.db.Where("file_id = ?", fileID).Delete(&models.FileChunk{})
	s.db.Where("file_id = ?", fileID).Delete(&models.FileEmbedding{})
	s.db.Where("file_id = ?", fileID).Delete(&models.FileEmbeddingJob{})
	return s.db.Delete(&file).Error
}

// GetFileBase64DataURI 读取文件内容并返回 base64 data URI
func (s *FileService) GetFileBase64DataURI(fileID uint) (string, string, error) {
	var file models.File
	if err := s.db.First(&file, fileID).Error; err != nil {
		return "", "", err
	}
	data, err := os.ReadFile(file.StoragePath)
	if err != nil {
		return "", "", fmt.Errorf("读取文件失败: %w", err)
	}
	mimeType := file.MimeType
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = inferMimeType(file.Filename)
	}
	b64 := base64.StdEncoding.EncodeToString(data)
	dataURI := fmt.Sprintf("data:%s;base64,%s", mimeType, b64)
	return dataURI, mimeType, nil
}

// IsImageFile 判断文件是否为图片
func (s *FileService) IsImageFile(fileID uint) (bool, error) {
	var file models.File
	if err := s.db.First(&file, fileID).Error; err != nil {
		return false, err
	}
	// 兼容 "image" (旧格式) 和 "image/jpeg" 等标准 MIME type
	return file.MimeType == "image" || strings.HasPrefix(file.MimeType, "image/"), nil
}

// inferMimeType 推断 MIME 类型
func inferMimeType(filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	}
	return modelmeta.MimeTypeForFile(filename)
}

// generateFileSummary 异步生成文件摘要（简单版：截取前 500 字符作为摘要）
func (s *FileService) generateFileSummary(fileID uint, content string) {
	// 移除 Markdown 格式符号，取纯文本
	plain := strings.ReplaceAll(content, "#", "")
	plain = strings.ReplaceAll(plain, "*", "")
	plain = strings.ReplaceAll(plain, "`", "")
	plain = strings.ReplaceAll(plain, "|", " ")
	plain = strings.Join(strings.Fields(plain), " ")

	maxLen := 500
	runes := []rune(plain)
	summary := plain
	if len(runes) > maxLen {
		// 找到最近的句号截断
		cut := maxLen
		for i := maxLen; i > maxLen-100 && i > 0; i-- {
			if runes[i] == '。' || runes[i] == '.' || runes[i] == '！' || runes[i] == '!' {
				cut = i + 1
				break
			}
		}
		summary = string(runes[:cut]) + "..."
	}

	s.db.Model(&models.File{}).Where("id = ?", fileID).Update("summary", summary)
}

// extractKeywords 从查询中提取关键词（简单实现）
func extractKeywords(query string) []string {
	// 去除标点后按空格分割
	cleaned := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || (r >= 0x4e00 && r <= 0x9fff) || r == ' ' {
			return r
		}
		return ' '
	}, query)

	words := strings.Fields(cleaned)
	var result []string
	for _, w := range words {
		w = strings.ToLower(w)
		if len(w) > 1 {
			result = append(result, w)
		}
	}
	return result
}

// containsAny 检查字符串是否包含任意关键词
func containsAny(text string, words []string) bool {
	text = strings.ToLower(text)
	for _, w := range words {
		if strings.Contains(text, w) {
			return true
		}
	}
	return len(words) == 0 // 没有关键词时返回 true
}

// GetByPublicID 通过 PublicID 获取文件
func (s *FileService) GetByPublicID(publicID string) (*models.File, error) {
	var file models.File
	if err := s.db.Where("public_id = ?", publicID).First(&file).Error; err != nil {
		return nil, err
	}
	return &file, nil
}

// ResolveFileByPublicID 通过 PublicID 解析文件，并进行权限校验
// userID = 0 表示未登录用户，guestID 用于匿名用户权限校验
func (s *FileService) ResolveFileByPublicID(publicID string, userID uint, guestID string) (*models.File, error) {
	file, err := s.GetByPublicID(publicID)
	if err != nil {
		return nil, fmt.Errorf("文件不存在: %w", err)
	}

	// 登录用户：只能查看自己的文件
	if userID > 0 {
		if file.UserID > 0 && file.UserID != userID {
			return nil, fmt.Errorf("无权访问该文件")
		}
		return file, nil
	}

	// 匿名用户：guest_id 匹配或文件本身也是匿名上传
	if file.UserID == 0 && file.GuestID != "" && file.GuestID != guestID {
		return nil, fmt.Errorf("无权访问该文件")
	}

	return file, nil
}

// GetByPublicIDOrID 兼容公共 ID 和旧版数字 ID（仅用于内部过渡）
func (s *FileService) GetByPublicIDOrID(id string) (*models.File, error) {
	if publicid.IsFileID(id) {
		return s.GetByPublicID(id)
	}
	// 尝试按数字 ID 查找（旧版兼容）
	var numericID uint
	if _, err := fmt.Sscanf(id, "%d", &numericID); err == nil && numericID > 0 {
		var file models.File
		if err := s.db.First(&file, numericID).Error; err == nil {
			return &file, nil
		}
	}
	return nil, fmt.Errorf("文件不存在")
}

// GetFileByPublicID 通过 PublicID 获取文件内容
func (s *FileService) GetFileByPublicID(publicID string) (string, error) {
	file, err := s.GetByPublicID(publicID)
	if err != nil {
		return "", err
	}
	if file.ParseStatus != "done" {
		return "", fmt.Errorf("文件尚未解析完成")
	}
	return file.Content, nil
}

// GetFileBase64DataURIByPublicID 通过 PublicID 获取文件 base64 data URI
func (s *FileService) GetFileBase64DataURIByPublicID(publicID string) (string, string, error) {
	var file models.File
	if err := s.db.Where("public_id = ?", publicID).First(&file).Error; err != nil {
		return "", "", err
	}
	data, err := os.ReadFile(file.StoragePath)
	if err != nil {
		return "", "", fmt.Errorf("读取文件失败: %w", err)
	}
	mimeType := file.MimeType
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = inferMimeType(file.Filename)
	}
	b64 := base64.StdEncoding.EncodeToString(data)
	dataURI := fmt.Sprintf("data:%s;base64,%s", mimeType, b64)
	return dataURI, mimeType, nil
}

// IsImageFileByPublicID 通过 PublicID 判断是否为图片
func (s *FileService) IsImageFileByPublicID(publicID string) (bool, error) {
	var file models.File
	if err := s.db.Where("public_id = ?", publicID).First(&file).Error; err != nil {
		return false, err
	}
	return file.MimeType == "image" || strings.HasPrefix(file.MimeType, "image/"), nil
}

// DeleteFileByPublicID 通过 PublicID 删除文件
func (s *FileService) DeleteFileByPublicID(publicID string) error {
	var file models.File
	if err := s.db.Where("public_id = ?", publicID).First(&file).Error; err != nil {
		return err
	}

	// 删除磁盘文件
	os.Remove(file.StoragePath)

	// 删除数据库记录（chunks 和 embeddings 会级联删除）
	s.db.Where("file_id = ?", file.ID).Delete(&models.FileChunk{})
	s.db.Where("file_id = ?", file.ID).Delete(&models.FileEmbedding{})
	s.db.Where("file_id = ?", file.ID).Delete(&models.FileEmbeddingJob{})
	return s.db.Delete(&file).Error
}

// ListPendingEmbeddingJobs 列出待处理的 embedding jobs
func (s *FileService) ListPendingEmbeddingJobs(limit int) ([]models.FileEmbeddingJob, error) {
	var jobs []models.FileEmbeddingJob
	query := s.db.Where("status = ?", "pending").Order("created_at").Limit(limit)
	if err := query.Find(&jobs).Error; err != nil {
		return nil, err
	}
	return jobs, nil
}

// UpdateEmbeddingJobStatus 更新 embedding job 状态
func (s *FileService) UpdateEmbeddingJobStatus(jobID uint, status string, errMsg string) error {
	updates := map[string]interface{}{
		"status":        status,
		"error_message": errMsg,
		"updated_at":    time.Now(),
	}
	if status == "running" {
		now := time.Now()
		updates["started_at"] = &now
	}
	if status == "done" || status == "error" {
		now := time.Now()
		updates["finished_at"] = &now
	}
	return s.db.Model(&models.FileEmbeddingJob{}).Where("id = ?", jobID).Updates(updates).Error
}

// SaveFileEmbeddings 保存文件 chunks 的 embeddings
func (s *FileService) SaveFileEmbeddings(fileID uint, chunkIDs []uint, vectors [][]float32, textHashes []string, provider, model string, dimension int) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		for i, chunkID := range chunkIDs {
			if i >= len(vectors) || i >= len(textHashes) {
				break
			}
			vectorBytes := embedding.EncodeVector(vectors[i])
			if err := tx.Create(&models.FileEmbedding{
				FileID:    fileID,
				ChunkID:   chunkID,
				Provider:  provider,
				Model:     model,
				Dimension: dimension,
				TextHash:  textHashes[i],
				Vector:    vectorBytes,
			}).Error; err != nil {
				return err
			}
			// 更新 chunk 的 embedding 状态
			tx.Model(&models.FileChunk{}).Where("id = ?", chunkID).Update("embedding_status", "done")
		}
		return nil
	})
}

// startEmbeddingWorker 后台定期轮询处理 pending 的 embedding jobs
func (s *FileService) startEmbeddingWorker() {
	// 未配置 embedder，不启动 worker
	if s.embedder == nil {
		fmt.Println("[Embedding Worker] embedder 未配置，不启动 embedding worker")
		return
	}

	// 等待服务初始化完成
	time.Sleep(3 * time.Second)

	// 首先恢复服务重启前未完成的 jobs
	s.RecoverEmbeddingJobs()

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		jobs, err := s.ListPendingEmbeddingJobs(1)
		if err != nil {
			continue
		}
		if len(jobs) == 0 {
			continue
		}
		for _, job := range jobs {
			if err := s.ProcessEmbeddingJob(job); err != nil {
				fmt.Printf("[Embedding Worker] job %d 失败: %v\n", job.ID, err)
			}
		}
	}
}

// ProcessEmbeddingJob 处理单个 embedding job（batch 串行）
func (s *FileService) ProcessEmbeddingJob(job models.FileEmbeddingJob) error {
	if s.embedder == nil {
		return fmt.Errorf("embedder 未配置")
	}

	ctx := context.Background()

	// 标记为 running
	if err := s.UpdateEmbeddingJobStatus(job.ID, "running", ""); err != nil {
		return fmt.Errorf("更新 job 状态失败: %w", err)
	}

	// 更新文件 embedding 状态为 indexing
	s.db.Model(&models.File{}).Where("id = ?", job.FileID).Update("embedding_status", "indexing")

	// 获取文件的所有 pending chunks
	var chunks []models.FileChunk
	if err := s.db.Where("file_id = ? AND embedding_status = ?", job.FileID, "pending").Order("chunk_index").Find(&chunks).Error; err != nil {
		s.UpdateEmbeddingJobStatus(job.ID, "error", err.Error())
		s.db.Model(&models.File{}).Where("id = ?", job.FileID).Update("embedding_status", "error")
		return fmt.Errorf("查询 chunks 失败: %w", err)
	}

	if len(chunks) == 0 {
		// 所有 chunks 都已处理完毕，直接标记 done
		s.UpdateEmbeddingJobStatus(job.ID, "done", "")
		s.db.Model(&models.File{}).Where("id = ?", job.FileID).Update("embedding_status", "done")
		fmt.Printf("[Embedding Worker] job %d 已完成（无待处理 chunks）\n", job.ID)
		return nil
	}

	// 提取文本内容
	contents := make([]string, len(chunks))
	chunkIDs := make([]uint, len(chunks))
	for i, chunk := range chunks {
		contents[i] = chunk.Content
		chunkIDs[i] = chunk.ID
	}

	// batch 生成 embedding（串行处理，避免并发 RPM 限制）
	vectors, embedUsage, err := s.embedder.EmbedDocuments(ctx, contents)
	if err != nil {
		s.UpdateEmbeddingJobStatus(job.ID, "error", err.Error())
		s.db.Model(&models.FileChunk{}).Where("file_id = ? AND embedding_status = ?", job.FileID, "pending").Update("embedding_status", "error")
		s.db.Model(&models.File{}).Where("id = ?", job.FileID).Update("embedding_status", "error")
		return fmt.Errorf("embedding 生成失败: %w", err)
	}

	modelInfo := s.embedder.ModelInfo()

	// 记录 embedding 用量
	if s.usageService != nil && embedUsage != nil {
		// 通过 FileID 获取 UserID
		var file models.File
		if err := s.db.First(&file, job.FileID).Error; err == nil {
			_ = s.usageService.RecordEmbeddingUsageWithContext(file.UserID, modelInfo.Model, job.FileID, embedUsage.TotalTokens, UsageContext{ResourceType: "file", ResourceID: file.ID, Module: "work", Feature: "document_reader", Operation: "file_embedding"})
		}
	}

	// 计算 text hash
	textHashes := make([]string, len(chunks))
	for i, content := range contents {
		textHashes[i] = hashText(content)
	}

	// 保存 embeddings
	vectorFloats := make([][]float32, len(vectors))
	for i, v := range vectors {
		vectorFloats[i] = []float32(v)
	}
	if err := s.SaveFileEmbeddings(job.FileID, chunkIDs, vectorFloats, textHashes, modelInfo.Provider, modelInfo.Model, modelInfo.Dimension); err != nil {
		s.UpdateEmbeddingJobStatus(job.ID, "error", err.Error())
		s.db.Model(&models.File{}).Where("id = ?", job.FileID).Update("embedding_status", "error")
		return fmt.Errorf("保存 embeddings 失败: %w", err)
	}

	// 标记 job 完成
	if err := s.UpdateEmbeddingJobStatus(job.ID, "done", ""); err != nil {
		s.db.Model(&models.File{}).Where("id = ?", job.FileID).Update("embedding_status", "error")
		return fmt.Errorf("更新 job 状态失败: %w", err)
	}

	// 更新文件 embedding 状态为 done
	s.db.Model(&models.File{}).Where("id = ?", job.FileID).Update("embedding_status", "done")

	fmt.Printf("[Embedding Worker] job %d 完成，文件 %d，chunks %d\n", job.ID, job.FileID, len(chunks))
	return nil
}

// RecoverEmbeddingJobs 服务启动时恢复所有 pending 状态的 embedding jobs
func (s *FileService) RecoverEmbeddingJobs() {
	var pending []models.FileEmbeddingJob
	if err := s.db.Where("status = ?", "pending").Find(&pending).Error; err != nil {
		fmt.Printf("[Embedding 任务恢复] 查询 pending jobs 失败: %v\n", err)
		return
	}
	if len(pending) == 0 {
		return
	}
	fmt.Printf("[Embedding 任务恢复] 发现 %d 个未完成的 embedding jobs，加入处理队列...\n", len(pending))
	// 这些 jobs 会被 startEmbeddingWorker 的 ticker 自动处理
}

// migratePublicIDs 补全旧文件的 PublicID（一次性迁移）
// 服务启动时检查并补全 public_id 为空的记录
func (s *FileService) migratePublicIDs() {
	var files []models.File
	if err := s.db.Where("public_id = ? OR public_id IS NULL", "").Find(&files).Error; err != nil {
		fmt.Printf("[PublicID 迁移] 查询失败: %v\n", err)
		return
	}
	if len(files) == 0 {
		return
	}

	fmt.Printf("[PublicID 迁移] 发现 %d 条旧记录缺少 PublicID，开始补全...\n", len(files))
	for _, file := range files {
		publicID := publicid.GenerateFileID()
		if err := s.db.Model(&file).Update("public_id", publicID).Error; err != nil {
			fmt.Printf("[PublicID 迁移] 文件 %d 补全失败: %v\n", file.ID, err)
		}
	}
	fmt.Printf("[PublicID 迁移] 完成\n")
}

// hashText 计算文本的 SHA-256 hash，取前 16 字节 hex 作为简短标识
func hashText(text string) string {
	h := sha256.Sum256([]byte(text))
	return hex.EncodeToString(h[:16])
}
