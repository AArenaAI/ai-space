package models

import (
	"fmt"
	"os"
	"strings"

	"aipool-backend/pkg/publicid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func InitDB(databaseURL string) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(databaseURL), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, err
	}

	DB = db

	// PostgreSQL 连接池配置。
	sqlDB, err := db.DB()
	if err == nil {
		sqlDB.SetMaxOpenConns(20)
		sqlDB.SetMaxIdleConns(5)
		sqlDB.SetConnMaxLifetime(0)
	}

	// 自动迁移
	if err := db.AutoMigrate(
		&User{}, &RefreshToken{}, &Conversation{}, &Message{}, &ConversationShare{},
		&CompareRecord{}, &UserSkill{},
		&Workspace{},
		&File{}, &FileChunk{}, &FileEmbedding{}, &FileEmbeddingJob{}, &ConversationFile{}, &MessageFile{},
		&Notebook{}, &NotebookFile{}, &NotebookConversation{}, &NotebookArtifact{},
		&APIUsageLog{}, &AIBackgroundTask{}, &AIBackgroundTaskEvent{},
		&AdminAuditLog{}, &BillingPlan{}, &BillingOrder{}, &BillingSubscription{}, &PaymentEvent{}, &CreditTransaction{},
		&PPTTemplate{}, &PPTGeneration{}, &PPTSlide{}, &PPTRevision{},
		&ImageChat{}, &ImageChatMessage{},
		&MessageFavorite{},
		&MessageGroup{}, // 新增
		&ModelConfig{}, // 新增：模型配置表
		&BadCase{}, // 新增：Bad Case 提交表
		&BetaInvite{}, // 新增：内测邀请码
		&BetaApplication{}, // 新增：内测申请表
		&BetaConfig{}, // 新增：内测运营配置
		&Changelog{}, // 新增：产品更新日志
		&ChangelogRead{}, // 新增：已读记录
		&AnalyticsEvent{}, // 新增：用户行为事件追踪
		&AlertRule{}, // 新增：告警规则
		&AlertHistory{}, // 新增：告警历史
		&AlertSilence{}, // 新增：告警静默
	); err != nil {
		return nil, err
	}

	// 迁移：为旧消息创建 MessageGroup（一次性）
	if err := migrateMessageGroups(db); err != nil {
		return nil, fmt.Errorf("迁移 MessageGroup 失败: %w", err)
	}

	// 去重：清理已有重复的收藏记录，保留最新一条
	if err := deduplicateFavorites(db); err != nil {
		return nil, fmt.Errorf("清理收藏重复记录失败: %w", err)
	}
	if err := ensureFavoriteIndexes(db); err != nil {
		return nil, fmt.Errorf("创建收藏唯一索引失败: %w", err)
	}

	// 更新旧用户缺失的积分字段
	if err := db.Model(&User{}).Where("basic_credits IS NULL OR basic_credits = 0").Update("basic_credits", 30).Error; err != nil {
		return nil, err
	}
	if err := db.Model(&User{}).Where("plan_tier IS NULL OR plan_tier = ''").Update("plan_tier", "free").Error; err != nil {
		return nil, err
	}
	if err := db.Model(&User{}).Where("role IS NULL OR role = ''").Update("role", "user").Error; err != nil {
		return nil, err
	}

	// 为旧文件补全 PublicID（一次性迁移）
	if err := migrateFilePublicIDs(db); err != nil {
		return nil, fmt.Errorf("迁移文件 PublicID 失败: %w", err)
	}
	if err := migrateUnconfiguredEmbeddingFailures(db); err != nil {
		return nil, fmt.Errorf("迁移未配置 embedding 的文件状态失败: %w", err)
	}

	return db, nil
}

func migrateUnconfiguredEmbeddingFailures(db *gorm.DB) error {
	// Only mark parsed files as embedding-skipped when no configured embedding provider has a usable key.
	// Provider-specific fallback keys (for example GEMINI_API_KEY when TEXT_EMBEDDING_PROVIDER=gemini)
	// must be treated as configured, otherwise a restart would incorrectly skip indexable files.
	if textEmbeddingProviderConfigured() {
		return nil
	}

	if err := db.Model(&File{}).
		Where("parse_status = ? AND embedding_status IN ?", "done", []string{"pending", "indexing", "error"}).
		Update("embedding_status", "skipped").Error; err != nil {
		return err
	}

	return db.Model(&FileEmbeddingJob{}).
		Where("status IN ?", []string{"pending", "running", "error"}).
		Updates(map[string]interface{}{
			"status":        "done",
			"error_message": "skipped: text embedding api key is not configured",
		}).Error
}

func textEmbeddingProviderConfigured() bool {
	if strings.TrimSpace(os.Getenv("TEXT_EMBEDDING_API_KEY")) != "" {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv("TEXT_EMBEDDING_PROVIDER"))) {
	case "gemini":
		return strings.TrimSpace(os.Getenv("GEMINI_API_KEY")) != ""
	case "openai", "":
		return strings.TrimSpace(os.Getenv("OPENAI_API_KEY")) != ""
	default:
		return false
	}
}

func migrateFilePublicIDs(db *gorm.DB) error {
	var files []File
	if err := db.Where("public_id = '' OR public_id IS NULL").Find(&files).Error; err != nil {
		return err
	}

	for _, f := range files {
		publicID := publicid.GenerateFileID()
		for {
			var count int64
			db.Model(&File{}).Where("public_id = ?", publicID).Count(&count)
			if count == 0 {
				break
			}
			publicID = publicid.GenerateFileID()
		}
		if err := db.Model(&File{}).Where("id = ?", f.ID).Update("public_id", publicID).Error; err != nil {
			return err
		}
	}

	return nil
}

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

func deduplicateFavorites(db *gorm.DB) error {
	// 旧收藏记录补齐 group_id，确保对比模式同一轮回答可以按组去重
	if err := db.Exec(`
		UPDATE message_favorites
		SET group_id = COALESCE((SELECT messages.group_id FROM messages WHERE messages.id = message_favorites.message_id), 0)
		WHERE group_id = 0 OR group_id IS NULL
	`).Error; err != nil {
		return err
	}

	// 删除同一 user_id + message_id 的重复记录，保留 id 最大的那条（最新）
	if err := db.Exec(`
		DELETE FROM message_favorites
		WHERE id NOT IN (
			SELECT MAX(id) FROM message_favorites GROUP BY user_id, message_id
		)
	`).Error; err != nil {
		return err
	}

	// 删除对比模式同一 user_id + group_id 的重复记录，保留 id 最大的那条（最新）
	return db.Exec(`
		DELETE FROM message_favorites
		WHERE group_id > 0
		  AND id NOT IN (
			SELECT MAX(id) FROM message_favorites WHERE group_id > 0 GROUP BY user_id, group_id
		)
	`).Error
}

func ensureFavoriteIndexes(db *gorm.DB) error {
	// 对比模式：同一用户同一轮回答只能收藏一次；group_id=0 的普通消息仍走 user_id+message_id 唯一索引
	return db.Exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_user_fav_group_unique
		ON message_favorites(user_id, group_id)
		WHERE group_id > 0
	`).Error
}
