package models

import (
	"fmt"
	"gorm.io/gorm"
)

// ApplySQLiteTuning 启用 SQLite WAL 模式并优化并发性能。
func ApplySQLiteTuning(db *gorm.DB) error {
	pragmaStatements := []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA synchronous = NORMAL",
		"PRAGMA cache_size = -64000",
		"PRAGMA temp_store = MEMORY",
		"PRAGMA mmap_size = 268435456",
	}

	for _, stmt := range pragmaStatements {
		if err := db.Exec(stmt).Error; err != nil {
			return fmt.Errorf("SQLite 调优失败 (%s): %w", stmt, err)
		}
	}
	return nil
}
