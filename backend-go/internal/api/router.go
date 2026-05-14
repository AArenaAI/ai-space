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

	// CORS
	router.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

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

	// AI 服务
	aiService := services.NewAIService(cfg)
	searchService := services.NewSearchService(cfg)

	// Embedding provider（可用但非必需）
	var embedder embedding.Provider
	if cfg.EnableEmbedding && cfg.OpenAIKey != "" {
		var err error
		embedder, err = embedding.NewProvider(cfg)
		if err != nil {
			// 警告但不阻塞启动，无 embedding 时自动降级到关键词检索
			fmt.Printf("[WARN] Embedding provider 初始化失败: %v，将使用关键词检索降级\n", err)
		}
	}

	// 文件服务
	fileParser := services.NewFileParser(cfg, aiService)
	fileService := services.NewFileService(db, cfg, fileParser, embedder)

	// 检索服务
	retrievalSvc := services.NewRetrievalService(db, embedder)
	contextBuilder := services.NewContextBuilder()

	// 公开路由 - 模型列表
	router.GET("/api/models", GetModelsHandler)
	router.GET("/api/models/chat", GetChatModelsHandler)
	router.GET("/api/models/image", GetImageModelsHandler)

	// 认证路由
	authHandler := NewAuthHandler(db, cfg)
	router.POST("/api/auth/register", authHandler.Register)
	router.POST("/api/auth/login", authHandler.Login)
	router.GET("/api/users/count", authHandler.GetUserCount)
	router.GET("/api/users", authHandler.GetUsers)

	// 技能公开路由
	skillHandler := NewSkillHandler(db, skills.GetLoader())
	router.GET("/api/skills", skillHandler.ListSkills)
	router.GET("/api/skills/:key", skillHandler.GetSkill)
	router.POST("/api/skills/detect", skillHandler.DetectSkill)

	// 聊天路由
	chatHandler := NewChatHandler(db, cfg, aiService, searchService, fileService, retrievalSvc, contextBuilder)
	router.POST("/api/chat", chatHandler.Chat)

	// 文件上传解析路由
	fileHandler := NewFileHandler(fileService)
	router.POST("/api/files/upload", fileHandler.UploadFile)

	// PPT服务
	pptService := services.NewPPTService(cfg)

	// 图片服务
	imageService := services.NewImageService(cfg)

	// 积分路由
	creditsHandler := NewCreditsHandler(db, cfg)
	router.GET("/api/models/tiers", creditsHandler.GetModelTiers)
	router.GET("/api/plans", creditsHandler.GetPublicPlans)

	// 需要认证的路由
	authorized := router.Group("/api")
	authorized.Use(middleware.AuthMiddleware(cfg))
	{
		convHandler := NewConversationHandler(db)
		authorized.GET("/conversations", convHandler.List)
		authorized.POST("/conversations", convHandler.Create)
		authorized.GET("/conversations/:id", convHandler.Get)
		authorized.PUT("/conversations/:id", convHandler.Update)
		authorized.DELETE("/conversations/:id", convHandler.Delete)
		authorized.GET("/conversations/:id/messages", convHandler.GetMessages)
		authorized.POST("/conversations/:id/messages", convHandler.AddMessage)

	// 图片路由
	imageHandler := NewImageHandler(db, imageService, cfg)
	imageHandler.AutoMigrate()
	imageHandler.RecoverPendingJobs() // 服务启动时恢复未完成的图片生成任务
	authorized.POST("/images/generate", imageHandler.GenerateImage)
	authorized.GET("/images", imageHandler.ListImages)
	authorized.GET("/images/:id", imageHandler.GetImage)
	authorized.DELETE("/images/:id", imageHandler.DeleteImage)

	// 图片文件服务（无需认证，直接访问）
	router.GET("/api/images/file/:filename", imageHandler.ServeImageFile)

		// PPT路由
		pptHandler := NewPPTHandler(db, pptService)
		authorized.GET("/ppt/templates", pptHandler.GetTemplates)
		authorized.POST("/ppt/generate", pptHandler.GeneratePPT)
		authorized.GET("/ppt", pptHandler.ListPPTs)
		authorized.GET("/ppt/:id", pptHandler.GetPPT)
		authorized.DELETE("/ppt/:id", pptHandler.DeletePPT)

		// 分享路由（需认证：创建分享）
		shareHandler := NewShareHandler(db)
		authorized.POST("/conversations/:id/share", shareHandler.Create)

		// 对比记录路由（需认证）
		compareRecordHandler := NewCompareRecordHandler(db)
		authorized.POST("/compare/record", compareRecordHandler.Save)
		authorized.GET("/compare/records", compareRecordHandler.List)
		authorized.DELETE("/compare/record/:id", compareRecordHandler.Delete)

		// 模板路由
		templateHandler := NewTemplateHandler(db)
		templateHandler.AutoMigrate()
		authorized.GET("/templates", templateHandler.ListTemplates)
		authorized.POST("/templates", templateHandler.CreateTemplate)
		authorized.PUT("/templates/:id", templateHandler.UpdateTemplate)
		authorized.DELETE("/templates/:id", templateHandler.DeleteTemplate)

		// 对比问答（需认证，因为涉及模板和配额）
		authorized.POST("/chat/compare", chatHandler.CompareChat)

		// 技能用户自定义路由
		authorized.POST("/skills/custom", skillHandler.CreateUserSkill)
		authorized.PUT("/skills/custom/:key", skillHandler.UpdateUserSkill)
		authorized.DELETE("/skills/custom/:key", skillHandler.DeleteUserSkill)

		// 积分认证路由
		authorized.GET("/user/credits", creditsHandler.GetCredits)
		authorized.POST("/user/credits/deduct", creditsHandler.DeductCredits)

		// 文件管理路由
		authorized.GET("/files", fileHandler.ListFiles)
		authorized.DELETE("/files/:id", fileHandler.DeleteFile)
	}

	// 文件详情（无需认证，未登录用户上传后需要查询解析状态）
	router.GET("/api/files/:id", fileHandler.GetFile)

	// 公开分享路由（无需认证：通过 short slug 访问）
	publicShare := NewShareHandler(db)
	router.GET("/api/share/:slug", publicShare.GetBySlug)

	// 公开对比记录查看路由（无需认证：通过 slug 访问）
	publicCompareRecord := NewCompareRecordHandler(db)
	router.GET("/api/compare/share/:slug", publicCompareRecord.GetBySlug)

	return router
}
