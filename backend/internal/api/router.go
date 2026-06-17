package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/middleware"
	"aipool-backend/internal/services"
	"aipool-backend/internal/services/embedding"
	"aipool-backend/internal/skills"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func NewRouter(db *gorm.DB, cfg *config.Config) *gin.Engine {
	router := gin.Default()

	// 全局 panic 恢复与统一错误处理
	router.Use(HandlerGuard())

	// IP 限流中间件
	router.Use(middleware.RateLimitMiddleware())

	// CORS
	router.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Guest-ID")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// 健康检查
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":    "ok",
			"timestamp": time.Now().Format(time.RFC3339),
		})
	})

	// 初始化技能加载器
	skillsBasePath := "./skills"
	if err := skills.InitDefaultLoader(skillsBasePath); err != nil {
		// 如果路径不对，尝试后端的相对路径
		skills.InitDefaultLoader("../skills")
	}

	// 注入数据库连接到公共模型接口，使其能读取管理员配置
	InitModelConfigDB(db)

	// AI 服务
	aiService := services.NewAIService(cfg)
	searchService := services.NewSearchService(cfg)

	// Embedding provider（可用但非必需）
	var embedder embedding.Provider
	if cfg.EnableTextEmbedding && embedding.HasConfiguredProviderKey(cfg) {
		var err error
		embedder, err = embedding.NewProvider(cfg)
		if err != nil {
			// 警告但不阻塞启动，无 embedding 时自动降级到关键词检索
			fmt.Printf("[WARN] Embedding provider 初始化失败: %v，将使用关键词检索降级\n", err)
		}
	}

	// 用量记录服务
	usageService := services.NewUsageService(cfg)

	// 专用翻译服务（Google Cloud Translation）
	translateService := services.NewTranslateService(cfg)
	liveTranslateHandler := NewLiveTranslateHandler(cfg)

	// 文件服务
	fileParser := services.NewFileParser(cfg, aiService)
	fileService := services.NewFileService(db, cfg, fileParser, embedder, usageService)

	// 检索服务
	retrievalSvc := services.NewRetrievalService(db, embedder)
	contextBuilder := services.NewContextBuilder()

	// Handler 实例（在外层定义，供公开路由和认证路由共用）
	chatHandler := NewChatHandler(db, cfg, aiService, searchService, fileService, retrievalSvc, contextBuilder, usageService)
	openAIWebhookHandler := NewOpenAIWebhookHandler(db, cfg, aiService, usageService)
	fileHandler := NewFileHandler(fileService)
	// OpenAI Webhook 必须是公开路由，不能走用户 JWT；签名由 OPENAI_WEBHOOK_SECRET 校验。
	router.POST("/api/openai/webhook", openAIWebhookHandler.Handle)

	router.GET("/api/models", GetModelsHandler)
	router.GET("/api/models/chat", GetChatModelsHandler)
	router.GET("/api/models/image", GetImageModelsHandler)
	router.GET("/api/models/video", GetVideoModelsHandler)
	router.GET("/api/locale/detect", DetectLocale)

	// 认证路由
	authHandler := NewAuthHandler(db, cfg)
	router.POST("/api/auth/register", authHandler.Register)
	router.POST("/api/auth/login", authHandler.Login)
	router.POST("/api/auth/refresh", authHandler.Refresh)
	router.POST("/api/auth/logout", authHandler.Logout)

	// 技能公开路由
	skillHandler := NewSkillHandler(db, skills.GetLoader())
	router.GET("/api/skills", skillHandler.ListSkills)
	router.GET("/api/skills/:key", skillHandler.GetSkill)
	router.POST("/api/skills/detect", skillHandler.DetectSkill)

	// 公开路由（可选认证，支持匿名用户与登录用户共用）
	publicWithAuth := router.Group("/api")
	publicWithAuth.Use(middleware.OptionalAuthMiddleware(cfg))
	{
		// 聊天路由
		publicWithAuth.POST("/chat", chatHandler.Chat)

		// 专用翻译路由
		translateHandler := NewTranslateHandler(translateService, usageService)
		publicWithAuth.POST("/translate", translateHandler.Translate)
		publicWithAuth.GET("/translate/languages", translateHandler.SupportedLanguages)
		publicWithAuth.GET("/translate/live/ws", liveTranslateHandler.WebSocket)
		publicWithAuth.GET("/chat/tasks/:message_id", chatHandler.GetTask)
		publicWithAuth.GET("/chat/tasks/:message_id/events", chatHandler.StreamTaskEvents)
		publicWithAuth.GET("/tasks/:task_id", chatHandler.GetGenerationTask)
		publicWithAuth.GET("/tasks/:task_id/stream", chatHandler.StreamGenerationTaskEvents)
		publicWithAuth.POST("/tasks/:task_id/cancel", chatHandler.CancelGenerationTask)

		// 文件上传解析路由
		publicWithAuth.POST("/files/upload", fileHandler.UploadFile)

		// 文件详情（无需认证，未登录用户上传后需要查询解析状态）
		publicWithAuth.GET("/files/:id", fileHandler.GetFile)

		// 文件下载（返回文件二进制，无需认证，图片直接展示）
		publicWithAuth.GET("/files/:id/download", fileHandler.DownloadFile)

		// 文件内联查看（不强制下载，供 <img> 标签预览）
		publicWithAuth.GET("/files/:id/view", fileHandler.ViewFile)
	}

	// 聊天路由（旧位置兼容，已移至 publicWithAuth）
	// chatHandler := NewChatHandler(db, cfg, aiService, searchService, fileService, retrievalSvc, contextBuilder, usageService)
	// router.POST("/api/chat", chatHandler.Chat)

	// 文件上传解析路由（旧位置兼容，已移至 publicWithAuth）
	// fileHandler := NewFileHandler(fileService)
	// router.POST("/api/files/upload", fileHandler.UploadFile)

	// 图片服务
	imageService := services.NewImageService(cfg)
	imageGenSvc := services.NewImageGenService()

	// PPT服务
	pptService := services.NewPPTService(db, cfg, imageService, imageGenSvc)

	// 积分路由
	creditsHandler := NewCreditsHandler(db, cfg)
	router.GET("/api/models/tiers", creditsHandler.GetModelTiers)
	router.GET("/api/plans", creditsHandler.GetPublicPlans)

	// 注册 Bad Case 路由（公开提交，需认证）
	badCaseHandler := NewBadCaseHandler(db)
	publicWithAuth.POST("/bad-cases", badCaseHandler.CreateBadCase)
	publicWithAuth.GET("/bad-cases", badCaseHandler.GetMyBadCases)

	// 注册 Beta 邀请路由（公开申请/验证）
	emailService := services.NewEmailService(cfg)
	betaInviteHandler := NewBetaInviteHandler(db, cfg, emailService)
	publicWithAuth.POST("/beta/apply", betaInviteHandler.SubmitApplication)
	publicWithAuth.POST("/beta/verify-invite", betaInviteHandler.VerifyInvite)
	publicWithAuth.POST("/beta/use-invite", betaInviteHandler.UseInvite)
	publicWithAuth.GET("/beta/application-status", betaInviteHandler.GetApplicationStatus)

	// 初始化 Beta 配置
	betaConfigHandler := NewBetaConfigHandler(db)
	betaConfigHandler.InitDefaultConfigs()
	publicWithAuth.GET("/beta/config", betaConfigHandler.GetPublicConfig)

	// 初始化 Changelog Handler
	changelogHandler := NewChangelogHandler(db)

	// 公开对比问答（支持匿名用户，内部已有额度与权限校验）
	publicWithAuth.POST("/chat/compare", chatHandler.CompareChat)
	publicWithAuth.POST("/chat/:message_id/fork", chatHandler.ForkChat)

	// 对比记录 Handler（供认证路由与公开查看共用）
	compareRecordHandler := NewCompareRecordHandler(db)

	// 需要认证的路由
	authorized := router.Group("/api")
	authorized.Use(middleware.AuthMiddleware(cfg))
	{
		adminHandler := NewAdminHandler(db)
		admin := authorized.Group("/admin")
		admin.Use(middleware.AdminMiddleware(db))
		{
			admin.GET("/me", adminHandler.Me)
			admin.GET("/overview", adminHandler.Overview)
			admin.GET("/users", adminHandler.ListUsers)
			admin.GET("/users/:id", adminHandler.GetUser)
			admin.PATCH("/users/:id", adminHandler.UpdateUser)
			admin.POST("/users/:id/credits/adjust", adminHandler.AdjustCredits)
			admin.GET("/usage/summary", adminHandler.UsageSummary)
			admin.GET("/usage/logs", adminHandler.UsageLogs)
			admin.GET("/usage/users", adminHandler.UsageUsers)
			admin.GET("/usage/users/:id", adminHandler.UsageUserDetail)
			admin.GET("/usage/models", adminHandler.UsageModels)
			admin.GET("/usage/modules", adminHandler.UsageModules)
			admin.GET("/usage/conversations", adminHandler.UsageConversations)
			admin.GET("/usage/conversations/:id", adminHandler.UsageConversationDetail)
			admin.GET("/models", adminHandler.Models)
			admin.GET("/model-configs", adminHandler.ListModelConfigs)
			admin.PATCH("/model-configs/:id", adminHandler.UpdateModelConfig)
			admin.PUT("/model-configs/batch", adminHandler.BatchUpdateModelConfigs)
			admin.GET("/tasks", adminHandler.Tasks)
			admin.GET("/bad-cases", badCaseHandler.ListBadCases)
			admin.PATCH("/bad-cases/:id/review", badCaseHandler.ReviewBadCase)
			admin.GET("/beta-invites", betaInviteHandler.ListInvites)
			admin.POST("/beta-invites/generate", betaInviteHandler.GenerateInvites)
			admin.GET("/beta-applications", betaInviteHandler.ListApplications)
			admin.PATCH("/beta-applications/:id/review", betaInviteHandler.ReviewApplication)
			admin.GET("/beta-configs", betaConfigHandler.ListConfigs)
			admin.PATCH("/beta-configs/:key", betaConfigHandler.UpdateConfig)
			admin.GET("/changelogs", changelogHandler.ListChangelogsAdmin)
			admin.POST("/changelogs", changelogHandler.CreateChangelog)
			admin.PUT("/changelogs/:id", changelogHandler.UpdateChangelog)
			admin.POST("/changelogs/:id/publish", changelogHandler.PublishChangelog)
			admin.POST("/changelogs/:id/unpublish", changelogHandler.UnpublishChangelog)
			admin.DELETE("/changelogs/:id", changelogHandler.DeleteChangelog)
		// Analytics 路由
		analyticsHandler := NewAnalyticsHandler(db)
		admin.GET("/analytics/summary", analyticsHandler.GetAnalyticsSummary)
		admin.GET("/analytics/funnel", analyticsHandler.GetFunnelAnalysis)
		admin.GET("/analytics/model-usage", analyticsHandler.GetModelUsageStats)
		admin.GET("/analytics/retention", analyticsHandler.GetRetentionAnalysis)
		admin.GET("/analytics/realtime", analyticsHandler.GetRealtimeStats)
		}
	convHandler := NewConversationHandler(db)
	notebookHandler := NewNotebookHandler(db, fileService, aiService, imageService)
	documentArtifactHandler := NewDocumentArtifactHandler(db)
	documentArtifactHandler.AutoMigrate()
	authorized.POST("/translate/live/ticket", liveTranslateHandler.CreateTicket)

	authorized.GET("/conversations", convHandler.List)
	authorized.GET("/conversations/search", convHandler.Search)
	authorized.POST("/conversations", convHandler.Create)
	authorized.GET("/conversations/:id", convHandler.Get)
	authorized.PUT("/conversations/:id", convHandler.Update)
	authorized.DELETE("/conversations/:id", convHandler.Delete)
	authorized.GET("/conversations/:id/messages", convHandler.GetMessages)
	authorized.GET("/conversations/:id/messages/:message_id", convHandler.GetMessage)
	authorized.POST("/conversations/:id/messages", convHandler.AddMessage)

	// 笔记本知识库路由
	authorized.GET("/notebooks", notebookHandler.List)
	authorized.POST("/notebooks", notebookHandler.Create)
	authorized.GET("/notebooks/:id", notebookHandler.Get)
	authorized.PUT("/notebooks/:id", notebookHandler.Update)
	authorized.DELETE("/notebooks/:id", notebookHandler.Delete)
	authorized.GET("/notebooks/:id/files", notebookHandler.ListFiles)
	authorized.POST("/notebooks/:id/files", notebookHandler.AddFile)
	authorized.POST("/notebooks/:id/sources/url", notebookHandler.AddURLSource)
	authorized.GET("/notebooks/:id/files/:file_id/content", notebookHandler.GetFileContent)
	authorized.POST("/notebooks/:id/files/:file_id/reindex", notebookHandler.ReindexFile)
	authorized.PUT("/notebooks/:id/files/:file_id", notebookHandler.UpdateFile)
	authorized.DELETE("/notebooks/:id/files/:file_id", notebookHandler.RemoveFile)
	authorized.GET("/notebooks/:id/artifacts", notebookHandler.ListArtifacts)
	authorized.POST("/notebooks/:id/artifacts", notebookHandler.CreateArtifact)
	authorized.POST("/notebooks/:id/artifacts/generate", notebookHandler.GenerateArtifact)
	authorized.POST("/notebooks/:id/report-formats", notebookHandler.SuggestReportFormats)
	authorized.PUT("/notebooks/:id/artifacts/:artifact_id", notebookHandler.UpdateArtifact)
	authorized.DELETE("/notebooks/:id/artifacts/:artifact_id", notebookHandler.DeleteArtifact)

	// 文档研读生成文件路由
	authorized.GET("/document-artifacts", documentArtifactHandler.List)
	authorized.POST("/document-artifacts", documentArtifactHandler.Create)
	authorized.GET("/document-artifacts/:id", documentArtifactHandler.Get)
	authorized.DELETE("/document-artifacts/:id", documentArtifactHandler.Delete)

	// 图片路由
	imageHandler := NewImageHandler(db, imageService, aiService, cfg, usageService)
	imageHandler.AutoMigrate()
	imageHandler.RecoverPendingJobs() // 服务启动时恢复未完成的图片生成任务
	authorized.POST("/images/generate", imageHandler.GenerateImage)
	authorized.POST("/images/recognize-mask", imageHandler.RecognizeMask)
	authorized.POST("/images/edit", imageHandler.EditImage)
	authorized.GET("/images", imageHandler.ListImages)
	authorized.GET("/images/:id", imageHandler.GetImage)
	authorized.DELETE("/images/:id", imageHandler.DeleteImage)

	// 图片会话路由
	videoService := services.NewVideoService(cfg.VolcengineAPIKey, cfg.VolcengineBaseURL)
	imageChatHandler := NewImageChatHandler(db, imageService, videoService, cfg, usageService)
	imageChatHandler.AutoMigrate()
	authorized.GET("/image-chats", imageChatHandler.ListImageChats)
	authorized.POST("/image-chats", imageChatHandler.CreateImageChat)
	authorized.GET("/image-chats/:id", imageChatHandler.GetImageChat)
	authorized.PUT("/image-chats/:id", imageChatHandler.UpdateImageChat)
	authorized.DELETE("/image-chats/:id", imageChatHandler.DeleteImageChat)
	authorized.GET("/image-chats/:id/messages", imageChatHandler.ListImageChatMessages)
	authorized.POST("/image-chats/:id/messages", imageChatHandler.SendImageChatMessage)

	// 视频生成路由（独立任务接口，兼容旧入口）
	videoHandler := NewVideoHandler(db, cfg)
	videoHandler.AutoMigrate()
	authorized.GET("/videos", videoHandler.ListVideos)
	authorized.POST("/videos", videoHandler.CreateVideo)
	authorized.GET("/videos/:id", videoHandler.GetVideo)
	authorized.DELETE("/videos/:id", videoHandler.DeleteVideo)
	authorized.GET("/videos/:id/refresh", videoHandler.RefreshVideoStatus)

	// 视频会话路由
	videoChatHandler := NewVideoChatHandler(db, videoService, cfg)
	videoChatHandler.AutoMigrate()
	authorized.GET("/video-chats", videoChatHandler.ListVideoChats)
	authorized.POST("/video-chats", videoChatHandler.CreateVideoChat)
	authorized.GET("/video-chats/:id", videoChatHandler.GetVideoChat)
	authorized.PUT("/video-chats/:id", videoChatHandler.UpdateVideoChat)
	authorized.DELETE("/video-chats/:id", videoChatHandler.DeleteVideoChat)
	authorized.GET("/video-chats/:id/messages", videoChatHandler.ListVideoChatMessages)
	authorized.POST("/video-chats/:id/messages", videoChatHandler.SendVideoChatMessage)

	// 媒体文件服务（无需认证，直接访问）
	// 浏览器视频/图片元素可能先发 HEAD 探测元数据；HEAD 未注册时 Gin 会返回 404，
	// 导致生成成功的本地视频在会话页显示为黑屏 0:00。
	router.GET("/api/images/file/:filename", imageHandler.ServeImageFile)
	router.HEAD("/api/images/file/:filename", imageHandler.ServeImageFile)
	router.GET("/api/videos/file/:filename", ServeVideoFile)
	router.HEAD("/api/videos/file/:filename", ServeVideoFile)

	// 回答模板路由
	templateHandler := NewTemplateHandler(db)
	templateHandler.AutoMigrate()
	authorized.GET("/templates", templateHandler.ListTemplates)
	authorized.POST("/templates", templateHandler.CreateTemplate)
	authorized.PUT("/templates/:id", templateHandler.UpdateTemplate)
	authorized.DELETE("/templates/:id", templateHandler.DeleteTemplate)

	// PPT路由
	pptHandler := NewPPTHandler(db, pptService, usageService)
	pptHandler.AutoMigrate()
	authorized.GET("/ppt/templates", pptHandler.GetTemplates)
	authorized.POST("/ppt", pptHandler.CreatePPT)
	authorized.GET("/ppt", pptHandler.ListPPTs)
	authorized.GET("/ppt/:id", pptHandler.GetPPT)
	authorized.GET("/ppt/:id/status", pptHandler.GetPPTStatus)
	authorized.GET("/ppt/:id/outline", pptHandler.GetPPTOutline)
	authorized.POST("/ppt/:id/outline", pptHandler.GenerateOutline)
	authorized.POST("/ppt/:id/confirm", pptHandler.ConfirmOutline)
	authorized.PUT("/ppt/:id/slides/:page", pptHandler.UpdateSlide)
	authorized.POST("/ppt/:id/slides/:page/rewrite", pptHandler.RewriteSlide)
	authorized.POST("/ppt/:id/slides/:page/image", pptHandler.RegenerateSlideImage)
	authorized.GET("/ppt/:id/image-jobs", pptHandler.GetPPTImageJobs)
	authorized.GET("/ppt/:id/export/:format", pptHandler.ExportPPT)
	authorized.DELETE("/ppt/:id", pptHandler.DeletePPT)

	// 分享路由（需认证：创建分享）
	shareHandler := NewShareHandler(db)
	authorized.POST("/conversations/:id/share", shareHandler.Create)

	// 对比记录路由（需认证）
	authorized.POST("/compare/record", compareRecordHandler.Save)
	authorized.GET("/compare/records", compareRecordHandler.List)
	authorized.DELETE("/compare/record/:id", compareRecordHandler.Delete)

	// 技能用户自定义路由
	authorized.POST("/skills/custom", skillHandler.CreateUserSkill)
	authorized.PUT("/skills/custom/:key", skillHandler.UpdateUserSkill)
	authorized.DELETE("/skills/custom/:key", skillHandler.DeleteUserSkill)

	// 用户账号路由
	authorized.PUT("/user/profile", authHandler.UpdateProfile)
	authorized.DELETE("/user/account", authHandler.DeleteAccount)

	// 积分认证路由
	authorized.GET("/user/credits", creditsHandler.GetCredits)
	authorized.POST("/user/credits/deduct", creditsHandler.DeductCredits)

	// 文件管理路由
	authorized.GET("/files", fileHandler.ListFiles)
	authorized.DELETE("/files/:id", fileHandler.DeleteFile)

	// 工作区路由
	workspaceHandler := NewWorkspaceHandler(db)
	authorized.GET("/workspaces", workspaceHandler.ListWorkspaces)
	authorized.POST("/workspaces", workspaceHandler.CreateWorkspace)
	authorized.GET("/workspaces/:id", workspaceHandler.GetWorkspace)
	authorized.PUT("/workspaces/:id", workspaceHandler.UpdateWorkspace)
	authorized.DELETE("/workspaces/:id", workspaceHandler.DeleteWorkspace)

	// 收藏路由
	favoriteHandler := NewFavoriteHandler(db)
	authorized.POST("/favorites", favoriteHandler.Create)
	authorized.DELETE("/favorites/:message_id", favoriteHandler.Delete)
	authorized.GET("/favorites", favoriteHandler.List)
	authorized.GET("/favorites/check", favoriteHandler.Check)
	authorized.GET("/favorites/check-batch", favoriteHandler.CheckBatch)
	}

	// 文件详情（无需认证，未登录用户上传后需要查询解析状态）
	// router.GET("/api/files/:id", fileHandler.GetFile)

	// 文件下载（返回文件二进制，无需认证，图片直接展示）
	// router.GET("/api/files/:id/download", fileHandler.DownloadFile)

	// 公开分享路由（无需认证：通过 short slug 访问）
	publicShare := NewShareHandler(db)
	router.GET("/api/share/:slug", publicShare.GetBySlug)

	// 公开对比记录查看路由（无需认证：通过 slug 访问）
	router.GET("/api/compare/share/:slug", compareRecordHandler.GetBySlug)

	// Changelog 公开路由
	router.GET("/api/changelogs", changelogHandler.ListChangelogsPublic)
	router.GET("/api/changelogs/:id", changelogHandler.GetChangelogDetail)
	// 需认证路由
	authorized.GET("/changelogs/unread-count", changelogHandler.GetChangelogUnreadCount)
	authorized.POST("/changelogs/:id/read", changelogHandler.MarkChangelogRead)
	authorized.POST("/changelogs/read-all", changelogHandler.MarkAllChangelogsRead)


	return router
}
