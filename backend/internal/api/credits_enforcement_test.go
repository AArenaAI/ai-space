package api

import (
	"testing"
	"time"

	"aipool-backend/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// setupTestDB 创建内存 SQLite 数据库并迁移所需模型。
func setupTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("打开内存 SQLite 失败: %v", err)
	}

	if err := db.AutoMigrate(
		&models.User{},
		&models.BetaConfig{},
		&models.BetaInvite{},
		&models.AnalyticsEvent{},
	); err != nil {
		t.Fatalf("AutoMigrate 失败: %v", err)
	}

	// 初始化默认 beta 配置（模型成本、阶段额度）
	NewBetaConfigHandler(db).InitDefaultConfigs()

	// 清理前序测试可能残留的共享内存数据
	db.Exec("DELETE FROM users")
	db.Exec("DELETE FROM analytics_events")

	return db
}

// createTestUser 创建测试用户并返回
func createTestUser(db *gorm.DB, email string, overrides func(*models.User)) models.User {
	user := models.User{
		Email:           email,
		Password:        "$2a$10$dummyhash",
		Name:            "测试用户",
		BasicCredits:    3000,
		AdvancedCredits: 0,
		EliteCredits:    0,
		PlanTier:        "free",
	}
	if overrides != nil {
		overrides(&user)
	}
	if err := db.Create(&user).Error; err != nil {
		panic("创建测试用户失败: " + err.Error())
	}
	return user
}

// ========== 测试用例 ==========

// TestCheckAndDeductCredits_AnonymousUser 匿名用户（userID=0）直接放行，不扣减
func TestCheckAndDeductCredits_AnonymousUser(t *testing.T) {
	db := setupTestDB(t)

	result := checkAndDeductCredits(db, 0, "gpt-5.5", 0)
	if !result.OK {
		t.Fatalf("匿名用户应直接放行，但返回失败: %v", result.ErrorResp)
	}
	if result.DeductedFen != 0 {
		t.Fatalf("匿名用户不应扣减积分，但 deducted=%d", result.DeductedFen)
	}
}

// TestCheckAndDeductCredits_BetaUserSufficient 内测用户余额充足 → 扣减成功
func TestCheckAndDeductCredits_BetaUserSufficient(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, "beta@test.com", func(u *models.User) {
		u.BetaBatch = "batch-1"
		u.BetaPhase = "phase_1"
		u.BetaCreditBalance = 10000 // 100 Credit = 10000 分
	})

	result := checkAndDeductCredits(db, user.ID, "gpt-5.5", 0)
	if !result.OK {
		t.Fatalf("内测用户余额充足应成功，但返回: %v", result.ErrorResp)
	}

	// gpt-5.5 成本 50 分
	expectedDeduct := 50
	if result.DeductedFen != expectedDeduct {
		t.Fatalf("扣减金额不匹配: got %d, want %d", result.DeductedFen, expectedDeduct)
	}
	if !result.IsBetaPhase {
		t.Fatal("应标记为内测阶段")
	}

	// 验证数据库余额已更新
	var updated models.User
	db.First(&updated, user.ID)
	expectedBalance := 10000 - expectedDeduct
	if updated.BetaCreditBalance != expectedBalance {
		t.Fatalf("数据库余额不匹配: got %d, want %d", updated.BetaCreditBalance, expectedBalance)
	}
	if updated.BetaCreditUsedTotal != expectedDeduct {
		t.Fatalf("累计消耗不匹配: got %d, want %d", updated.BetaCreditUsedTotal, expectedDeduct)
	}
}

// TestCheckAndDeductCredits_BetaUserInsufficient 内测用户余额不足 → 拒绝
func TestCheckAndDeductCredits_BetaUserInsufficient(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, "beta-poor@test.com", func(u *models.User) {
		u.BetaBatch = "batch-1"
		u.BetaPhase = "phase_1"
		u.BetaCreditBalance = 10 // 0.1 Credit = 10 分，不够任何模型
	})

	result := checkAndDeductCredits(db, user.ID, "gpt-5.5", 0)
	if result.OK {
		t.Fatal("余额不足应拒绝")
	}
	if result.HTTPStatus != 402 {
		t.Fatalf("应返回 402 Payment Required，got %d", result.HTTPStatus)
	}

	errMsg, _ := result.ErrorResp["error"].(string)
	if errMsg != "积分不足" {
		t.Fatalf("错误消息不匹配: got %q, want %q", errMsg, "积分不足")
	}

	// 验证数据库余额未变
	var updated models.User
	db.First(&updated, user.ID)
	if updated.BetaCreditBalance != 10 {
		t.Fatalf("拒绝时余额不应变化: got %d, want 10", updated.BetaCreditBalance)
	}
}

// TestCheckAndDeductCredits_BetaBatchBlocked 内测批次模型限制 → 拒绝
func TestCheckAndDeductCredits_BetaBatchBlocked(t *testing.T) {
	db := setupTestDB(t)
	// batch-1: 禁止 gpt-image-2 和所有 seedance 模型
	user := createTestUser(db, "batch1@test.com", func(u *models.User) {
		u.BetaBatch = "batch-1"
		u.BetaPhase = "phase_1"
		u.BetaCreditBalance = 100000
	})

	result := checkAndDeductCredits(db, user.ID, "gpt-image-2", 0)
	if result.OK {
		t.Fatal("batch-1 应禁止 gpt-image-2")
	}
	if result.HTTPStatus != 403 {
		t.Fatalf("应返回 403 Forbidden，got %d", result.HTTPStatus)
	}

	batch, _ := result.ErrorResp["beta_batch"].(string)
	if batch != "batch-1" {
		t.Fatalf("错误响应应包含 batch-1: got %q", batch)
	}
}

// TestCheckAndDeductCredits_BetaBatch2BlocksChat1 batch-2 锁死 Chat 1
func TestCheckAndDeductCredits_BetaBatch2BlocksChat1(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, "batch2@test.com", func(u *models.User) {
		u.BetaBatch = "batch-2"
		u.BetaPhase = "phase_1"
		u.BetaCreditBalance = 100000
	})

	result := checkAndDeductCredits(db, user.ID, "chat-1", 0)
	if result.OK {
		t.Fatal("batch-2 应禁止 chat-1")
	}
	if result.HTTPStatus != 403 {
		t.Fatalf("应返回 403 Forbidden，got %d", result.HTTPStatus)
	}
}

// TestCheckAndDeductCredits_BetaBatch3AllAllowed batch-3 全开
func TestCheckAndDeductCredits_BetaBatch3AllAllowed(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, "batch3@test.com", func(u *models.User) {
		u.BetaBatch = "batch-3"
		u.BetaPhase = "phase_1"
		u.BetaCreditBalance = 100000
	})

	// batch-3 允许所有模型，包括 chat-1 和 gpt-image-2
	result := checkAndDeductCredits(db, user.ID, "chat-1", 0)
	if !result.OK {
		t.Fatalf("batch-3 应允许 chat-1: %v", result.ErrorResp)
	}

	result2 := checkAndDeductCredits(db, user.ID, "gpt-image-2", 0)
	if !result2.OK {
		t.Fatalf("batch-3 应允许 gpt-image-2: %v", result2.ErrorResp)
	}
}

// TestCheckAndDeductCredits_FreeUserSufficient completed 用户走 free 套餐，基础模型余额充足 → 扣减
func TestCheckAndDeductCredits_FreeUserSufficient(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, "free@test.com", func(u *models.User) {
		u.PlanTier = "free"
		u.BetaPhase = "completed" // 已完成内测，回归会员体系
		u.BasicCredits = 3000
		u.CreditsResetAt = time.Now()
	})

	// gpt-5.4-mini 属 basic 等级，成本 1 分
	result := checkAndDeductCredits(db, user.ID, "gpt-5.4-mini", 0)
	if !result.OK {
		t.Fatalf("completed free 用户基础模型余额充足应成功: %v", result.ErrorResp)
	}
	if result.DeductedFen != 1 {
		t.Fatalf("扣减金额不匹配: got %d, want 1", result.DeductedFen)
	}

	var updated models.User
	db.First(&updated, user.ID)
	if updated.BasicCredits != 2999 {
		t.Fatalf("基础积分未正确扣减: got %d, want 2999", updated.BasicCredits)
	}
}

// TestCheckAndDeductCredits_FreeUserInsufficient completed free 用户高级模型无额度 → 拒绝
func TestCheckAndDeductCredits_FreeUserInsufficient(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, "free-adv@test.com", func(u *models.User) {
		u.PlanTier = "free"
		u.BetaPhase = "completed" // 已完成内测，回归会员体系
		u.BasicCredits = 3000
		u.AdvancedCredits = 0
		u.CreditsResetAt = time.Now()
	})

	// gpt-5.5 属 advanced 等级，free 用户 advanced 额度为 0
	result := checkAndDeductCredits(db, user.ID, "gpt-5.5", 0)
	if result.OK {
		t.Fatal("completed free 用户 advanced 模型无额度应拒绝")
	}
	if result.HTTPStatus != 402 {
		t.Fatalf("应返回 402，got %d", result.HTTPStatus)
	}
}

// TestCheckAndDeductCredits_FreeUserDailyReset completed free 用户每日重置
func TestCheckAndDeductCredits_FreeUserDailyReset(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, "reset@test.com", func(u *models.User) {
		u.PlanTier = "free"
		u.BetaPhase = "completed" // 已完成内测，回归会员体系
		u.BasicCredits = 0 // 已耗尽
		u.CreditsResetAt = time.Now().AddDate(0, 0, -1) // 昨天重置
	})

	// 今天第一次调用应触发每日重置
	result := checkAndDeductCredits(db, user.ID, "gpt-5.4-mini", 0)
	if !result.OK {
		t.Fatalf("每日重置后应成功: %v", result.ErrorResp)
	}

	var updated models.User
	db.First(&updated, user.ID)
	// 重置后 3000 - 扣减 1 = 2999
	if updated.BasicCredits != 2999 {
		t.Fatalf("每日重置后余额不匹配: got %d, want 2999", updated.BasicCredits)
	}
}

// TestCheckAndDeductCredits_NonActivatedUserBlocked 未激活用户（无邀请码）被拦截，无法使用任何模型
func TestCheckAndDeductCredits_NonActivatedUserBlocked(t *testing.T) {
	db := setupTestDB(t)
	// 模拟直接注册的用户：BetaPhase 为空，free 套餐
	user := createTestUser(db, "noinvite@test.com", func(u *models.User) {
		u.PlanTier = "free"
		u.BetaPhase = "" // 从未激活邀请码
		u.BasicCredits = 3000
	})

	// 尝试 basic 模型
	result := checkAndDeductCredits(db, user.ID, "gpt-5.4-mini", 0)
	if result.OK {
		t.Fatal("未激活用户不应能使用任何模型")
	}
	if result.HTTPStatus != 403 {
		t.Fatalf("应返回 403 Forbidden，got %d", result.HTTPStatus)
	}
	errCode, _ := result.ErrorResp["error"].(string)
	if errCode != "not_activated" {
		t.Fatalf("错误码不匹配: got %q, want %q", errCode, "not_activated")
	}
	needInvite, _ := result.ErrorResp["need_invite"].(bool)
	if !needInvite {
		t.Fatal("错误响应应包含 need_invite=true")
	}

	// 尝试 elite 模型也应被拦截（不是 402 积分不足，而是 403 未激活）
	result2 := checkAndDeductCredits(db, user.ID, "chat-1", 0)
	if result2.OK {
		t.Fatal("未激活用户不应能使用 elite 模型")
	}
	if result2.HTTPStatus != 403 {
		t.Fatalf("elite 模型也应返回 403，got %d", result2.HTTPStatus)
	}
}

// TestCheckAndDeductCredits_AdminNotBlocked 管理员不受未激活限制
func TestCheckAndDeductCredits_AdminNotBlocked(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, "admin@test.com", func(u *models.User) {
		u.Role = "admin"
		u.PlanTier = "free"
		u.BetaPhase = "" // 管理员不需要激活
		u.BasicCredits = 3000
		u.CreditsResetAt = time.Now()
	})

	result := checkAndDeductCredits(db, user.ID, "gpt-5.4-mini", 0)
	if !result.OK {
		t.Fatalf("管理员不应受未激活限制: %v", result.ErrorResp)
	}
}

// TestCheckAndDeductCredits_CompletedBetaUser 内测完成后回归会员体系
func TestCheckAndDeductCredits_CompletedBetaUser(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, "completed@test.com", func(u *models.User) {
		u.BetaBatch = "batch-1"
		u.BetaPhase = "completed" // 内测已完成
		u.BetaCreditBalance = 0
		u.PlanTier = "free"
		u.BasicCredits = 3000
		u.CreditsResetAt = time.Now()
	})

	// completed 用户走会员体系，不再受 batch 限制
	result := checkAndDeductCredits(db, user.ID, "gpt-image-2", 0)
	if !result.OK {
		t.Fatalf("completed 用户不应受 batch 限制: %v", result.ErrorResp)
	}
	if result.IsBetaPhase {
		t.Fatal("completed 用户不应标记为内测阶段")
	}
}

// TestCheckAndDeductCredits_ExpensiveModel 昂贵模型（chat-1）正确扣减
func TestCheckAndDeductCredits_ExpensiveModel(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, "rich@test.com", func(u *models.User) {
		u.BetaBatch = "batch-3" // batch-3 允许 chat-1
		u.BetaPhase = "phase_1"
		u.BetaCreditBalance = 50000 // 500 Credit
	})

	result := checkAndDeductCredits(db, user.ID, "chat-1", 0)
	if !result.OK {
		t.Fatalf("chat-1 扣减应成功: %v", result.ErrorResp)
	}
	// chat-1 成本 2200 分 = 22 Credit
	if result.DeductedFen != 2200 {
		t.Fatalf("chat-1 扣减金额不匹配: got %d, want 2200", result.DeductedFen)
	}

	var updated models.User
	db.First(&updated, user.ID)
	expected := 50000 - 2200
	if updated.BetaCreditBalance != expected {
		t.Fatalf("chat-1 扣减后余额不匹配: got %d, want %d", updated.BetaCreditBalance, expected)
	}
}

// TestCheckAndDeductCredits_NonexistentUser 不存在的用户 → 拒绝
func TestCheckAndDeductCredits_NonexistentUser(t *testing.T) {
	db := setupTestDB(t)

	result := checkAndDeductCredits(db, 99999, "gpt-5.5", 0)
	if result.OK {
		t.Fatal("不存在的用户应拒绝")
	}
	if result.HTTPStatus != 404 {
		t.Fatalf("应返回 404，got %d", result.HTTPStatus)
	}
}

// TestCheckAndDeductCredits_CustomAmount 自定义金额覆盖模型默认成本
func TestCheckAndDeductCredits_CustomAmount(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, "custom@test.com", func(u *models.User) {
		u.BetaBatch = "batch-1"
		u.BetaPhase = "phase_1"
		u.BetaCreditBalance = 50000
	})

	// 自定义金额=1000 分（视频模型按秒计费用）
	result := checkAndDeductCredits(db, user.ID, "gpt-5.5", 1000)
	if !result.OK {
		t.Fatalf("自定义金额扣减应成功: %v", result.ErrorResp)
	}
	if result.DeductedFen != 1000 {
		t.Fatalf("自定义扣减金额不匹配: got %d, want 1000", result.DeductedFen)
	}

	var updated models.User
	db.First(&updated, user.ID)
	expected := 50000 - 1000
	if updated.BetaCreditBalance != expected {
		t.Fatalf("自定义金额扣减后余额不匹配: got %d, want %d", updated.BetaCreditBalance, expected)
	}
}

// TestCheckAndDeductCredits_AnalyticsEventRecorded 扣减后记录埋点事件
func TestCheckAndDeductCredits_AnalyticsEventRecorded(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, "event@test.com", func(u *models.User) {
		u.BetaBatch = "batch-1"
		u.BetaPhase = "phase_1"
		u.BetaCreditBalance = 10000
	})

	_ = checkAndDeductCredits(db, user.ID, "gpt-5.5", 0)

	var events []models.AnalyticsEvent
	db.Where("user_id = ? AND event_type = ?", user.ID, "credit_use").Find(&events)
	if len(events) != 1 {
		t.Fatalf("应记录 1 条 credit_use 事件，got %d", len(events))
	}
	if events[0].ModelID != "gpt-5.5" {
		t.Fatalf("事件 model_id 不匹配: got %q, want %q", events[0].ModelID, "gpt-5.5")
	}
}

// TestCheckAndDeductCredits_SequentialDeductions 连续扣减直到余额耗尽
func TestCheckAndDeductCredits_SequentialDeductions(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, "seq@test.com", func(u *models.User) {
		u.BetaBatch = "batch-1"
		u.BetaPhase = "phase_1"
		u.BetaCreditBalance = 150 // 恰好够 3 次 gpt-5.5（50 分/次）
	})

	// 第1次
	r1 := checkAndDeductCredits(db, user.ID, "gpt-5.5", 0)
	if !r1.OK {
		t.Fatalf("第1次扣减应成功: %v", r1.ErrorResp)
	}
	if r1.Remaining != 100 {
		t.Fatalf("第1次扣减后余额: got %d, want 100", r1.Remaining)
	}

	// 第2次
	r2 := checkAndDeductCredits(db, user.ID, "gpt-5.5", 0)
	if !r2.OK {
		t.Fatalf("第2次扣减应成功: %v", r2.ErrorResp)
	}
	if r2.Remaining != 50 {
		t.Fatalf("第2次扣减后余额: got %d, want 50", r2.Remaining)
	}

	// 第3次
	r3 := checkAndDeductCredits(db, user.ID, "gpt-5.5", 0)
	if !r3.OK {
		t.Fatalf("第3次扣减应成功: %v", r3.ErrorResp)
	}
	if r3.Remaining != 0 {
		t.Fatalf("第3次扣减后余额: got %d, want 0", r3.Remaining)
	}

	// 第4次应失败
	r4 := checkAndDeductCredits(db, user.ID, "gpt-5.5", 0)
	if r4.OK {
		t.Fatal("第4次扣减应失败（余额耗尽）")
	}
	if r4.HTTPStatus != 402 {
		t.Fatalf("应返回 402，got %d", r4.HTTPStatus)
	}
}


// ========== 内测截止时间测试 ==========

// TestCheckAndDeductCredits_BetaExpiredDoesNotAffectChat 内测过期不影响已激活用户继续使用（余额还能扣）
func TestCheckAndDeductCredits_BetaExpiredDoesNotAffectChat(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, "expired-active@test.com", func(u *models.User) {
		u.BetaBatch = "batch-1"
		u.BetaPhase = "phase_1"
		u.BetaCreditBalance = 5000
	})

	// 积分扣减不在 checkAndDeductCredits 中检查过期，过期只影响申请/激活/发额度
	// 已激活用户可以继续用完余额
	result := checkAndDeductCredits(db, user.ID, "gpt-5.5", 0)
	if !result.OK {
		t.Fatalf("内测过期后已激活用户应仍能用余额: %v", result.ErrorResp)
	}
	if result.DeductedFen != 50 {
		t.Fatalf("扣减金额: got %d, want 50", result.DeductedFen)
	}
}

// TestBetaConfigEndDate 内测截止时间配置读写与过期判断
func TestBetaConfigEndDate(t *testing.T) {
	db := setupTestDB(t)
	h := NewBetaConfigHandler(db)

	// 默认空配置 → 不过期
	if h.IsBetaExpired() {
		t.Fatal("空配置应返回 not expired")
	}
	zero := h.GetEndDate()
	if !zero.IsZero() {
		t.Fatal("空配置应返回零时间")
	}

	// 设置一个过去时间 → 已过期
	pastTime := "2020-01-01T00:00:00+08:00"
	db.Model(&models.BetaConfig{}).Where("key = ?", models.BetaConfigEndDate).Update("value", pastTime)
	if !h.IsBetaExpired() {
		t.Fatal("2020 年应判定为已过期")
	}

	// 设置一个未来时间 → 未过期
	futureTime := "2099-12-31T23:59:59+08:00"
	db.Model(&models.BetaConfig{}).Where("key = ?", models.BetaConfigEndDate).Update("value", futureTime)
	if h.IsBetaExpired() {
		t.Fatal("2099 年应判定为未过期")
	}
	end := h.GetEndDate()
	if end.Year() != 2099 {
		t.Fatalf("GetEndDate 年份: got %d, want 2099", end.Year())
	}

	// 清空 → 不过期
	db.Model(&models.BetaConfig{}).Where("key = ?", models.BetaConfigEndDate).Update("value", "")
	if h.IsBetaExpired() {
		t.Fatal("清空后应返回 not expired")
	}
}

// TestBetaConfigInvalidDateFormat 非法格式日期被 GetEndDate 忽略（返回零值=不过期）
func TestBetaConfigInvalidDateFormat(t *testing.T) {
	db := setupTestDB(t)
	h := NewBetaConfigHandler(db)

	db.Model(&models.BetaConfig{}).Where("key = ?", models.BetaConfigEndDate).Update("value", "not-a-date")
	if h.IsBetaExpired() {
		t.Fatal("非法格式应返回 not expired（安全降级）")
	}
}
