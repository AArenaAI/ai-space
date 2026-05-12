package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/middleware"
	"aipool-backend/internal/services"
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

	// AI 服务
	aiService := services.NewAIService(cfg)
	searchService := services.NewSearchService(cfg)

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

	// 聊天路由
	chatHandler := NewChatHandler(db, cfg, aiService, searchService)
	router.POST("/api/chat", chatHandler.Chat)

	// PPT服务
	pptService := services.NewPPTService(cfg)

	// 图片服务
	imageService := services.NewImageService(cfg)

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
		imageHandler := NewImageHandler(db, imageService)
		authorized.POST("/images/generate", imageHandler.GenerateImage)
		authorized.GET("/images", imageHandler.ListImages)
		authorized.GET("/images/:id", imageHandler.GetImage)
		authorized.DELETE("/images/:id", imageHandler.DeleteImage)

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
	}

	// 公开分享路由（无需认证：通过 short slug 访问）
	publicShare := NewShareHandler(db)
	router.GET("/api/share/:slug", publicShare.GetBySlug)

	// 公开对比记录查看路由（无需认证：通过 slug 访问）
	publicCompareRecord := NewCompareRecordHandler(db)
	router.GET("/api/compare/share/:slug", publicCompareRecord.GetBySlug)

	return router
}
