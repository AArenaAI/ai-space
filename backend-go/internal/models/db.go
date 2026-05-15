package models

import (
	"fmt"
	"os"
	"path/filepath"

	"aipool-backend/pkg/publicid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func InitDB(dbPath string) (*gorm.DB, error) {
	// 确保目录存在
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}

	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, err
	}

	DB = db

	// 自动迁移
	if err := db.AutoMigrate(
		&User{}, &Conversation{}, &Message{}, &ConversationShare{},
		&CompareRecord{}, &UserSkill{},
		&File{}, &FileChunk{}, &FileEmbedding{}, &FileEmbeddingJob{}, &ConversationFile{}, &MessageFile{},
	); err != nil {
		return nil, err
	}

	// 更新旧用户缺失的积分字段
	if err := db.Model(&User{}).Where("basic_credits IS NULL OR basic_credits = 0").Update("basic_credits", 30).Error; err != nil {
		return nil, err
	}
	if err := db.Model(&User{}).Where("plan_tier IS NULL OR plan_tier = ''").Update("plan_tier", "free").Error; err != nil {
		return nil, err
	}

	// 为旧文件补全 PublicID（一次性迁移）
	if err := migrateFilePublicIDs(db); err != nil {
		return nil, fmt.Errorf("迁移文件 PublicID 失败: %w", err)
	}

	return db, nil
}

// migrateFilePublicIDs 为没有 PublicID 的旧文件生成唯一 PublicID
func migrateFilePublicIDs(db *gorm.DB) error {
	var files []File
	if err := db.Where("public_id = '' OR public_id IS NULL").Find(&files).Error; err != nil {
		return err
	}

	for _, f := range files {
		publicID := publicid.GenerateFileID()
		// 确保唯一性，如果重复则重新生成
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
