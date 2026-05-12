package main

import (
	"aipool-backend/internal/api"
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"log"
)

func main() {
	cfg := config.Load()

	db, err := models.InitDB(cfg.DatabasePath)
	if err != nil {
		log.Fatalf("数据库初始化失败: %v", err)
	}

	router := api.NewRouter(db, cfg)

	addr := ":" + cfg.Port
	log.Printf("🚀 AI Pool API Gateway running on port %s", cfg.Port)
	log.Printf("📋 Health check: http://localhost%s/health", addr)
	log.Printf("💬 Chat API:      http://localhost%s/api/chat", addr)
	log.Printf("🔐 Auth API:      http://localhost%s/api/auth", addr)

	if err := router.Run("0.0.0.0" + addr); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}
