package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"html"
	"math/big"
	"net/http"
	"strings"
	"time"

	"aipool-backend/internal/models"
	"aipool-backend/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	EmailCodePurposeRegister       = "register"
	EmailCodePurposeLogin          = "login"
	EmailCodePurposeResetPassword  = "reset_password"
	EmailCodePurposeChangePassword = "change_password"

	emailVerificationTTL         = 3 * time.Minute
	emailVerificationMinInterval = 60 * time.Second
	emailVerificationMaxAttempts = 5
)

var allowedEmailCodePurposes = map[string]bool{
	EmailCodePurposeRegister:       true,
	EmailCodePurposeLogin:          true,
	EmailCodePurposeResetPassword:  true,
	EmailCodePurposeChangePassword: true,
}

type SendEmailCodeRequest struct {
	Email   string `json:"email" binding:"required,email"`
	Purpose string `json:"purpose" binding:"required"`
}

type ResetPasswordRequest struct {
	Email            string `json:"email" binding:"required,email"`
	VerificationCode string `json:"verification_code" binding:"required"`
	Password         string `json:"password" binding:"required,min=6"`
}

type ChangePasswordRequest struct {
	VerificationCode string `json:"verification_code" binding:"required"`
	CurrentPassword  string `json:"current_password"`
	Password         string `json:"password" binding:"required,min=6"`
}

func normalizeEmailCodePurpose(purpose string) string {
	return strings.ToLower(strings.TrimSpace(purpose))
}

func generateNumericCode(length int) (string, error) {
	var b strings.Builder
	for i := 0; i < length; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		b.WriteByte(byte('0' + n.Int64()))
	}
	return b.String(), nil
}

func hashEmailCode(email, purpose, code string) string {
	sum := sha256.Sum256([]byte(normalizeAuthEmail(email) + ":" + normalizeEmailCodePurpose(purpose) + ":" + strings.TrimSpace(code)))
	return hex.EncodeToString(sum[:])
}

func emailPurposeTitle(purpose string) string {
	switch purpose {
	case EmailCodePurposeRegister:
		return "注册确认"
	case EmailCodePurposeLogin:
		return "登录确认"
	case EmailCodePurposeResetPassword:
		return "找回密码"
	case EmailCodePurposeChangePassword:
		return "修改密码"
	default:
		return "邮箱验证"
	}
}

func emailPurposeDescription(purpose string) string {
	switch purpose {
	case EmailCodePurposeRegister:
		return "您正在注册 AI Space 账号，请在注册页输入下方验证码完成邮箱确认。"
	case EmailCodePurposeLogin:
		return "您正在登录 AI Space。为保护账号安全，请在登录页输入下方验证码。"
	case EmailCodePurposeResetPassword:
		return "您正在找回 AI Space 登录密码，请在重置密码页面输入下方验证码。"
	case EmailCodePurposeChangePassword:
		return "您正在修改 AI Space 登录密码，请在账号设置页输入下方验证码。"
	default:
		return "请在页面中输入下方验证码完成验证。"
	}
}

func buildVerificationEmailHTML(purpose, code, frontendURL string) string {
	title := html.EscapeString(emailPurposeTitle(purpose))
	desc := html.EscapeString(emailPurposeDescription(purpose))
	safeCode := html.EscapeString(code)
	logoURL := strings.TrimRight(frontendURL, "/") + "/brand-dark-logo.png"
	if strings.TrimSpace(frontendURL) == "" {
		logoURL = "https://testnet.ai-space.xyz/brand-dark-logo.png"
	}

	return fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body { margin: 0; padding: 0; background: #07070a; color: #f5f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.wrapper { padding: 36px 16px; }
.card { max-width: 560px; margin: 0 auto; background: linear-gradient(180deg, #16161c 0%%, #0f0f14 100%%); border: 1px solid #272733; border-radius: 24px; overflow: hidden; box-shadow: 0 24px 80px rgba(0,0,0,.38); }
.hero { padding: 34px 34px 10px; text-align: center; }
.logo { width: 72px; height: 72px; object-fit: cover; border-radius: 18px; border: 1px solid #30303a; box-shadow: 0 12px 30px rgba(124,58,237,.22); }
.badge { display: inline-block; margin-top: 18px; padding: 6px 12px; border-radius: 999px; background: rgba(124,58,237,.16); color: #c4b5fd; font-size: 12px; font-weight: 700; letter-spacing: .04em; }
h1 { margin: 18px 0 8px; font-size: 24px; line-height: 1.25; color: #fff; }
p { margin: 0; color: #a7a7b5; font-size: 14px; line-height: 1.7; }
.codeBox { margin: 28px 34px 18px; padding: 24px; border-radius: 20px; background: radial-gradient(circle at top left, rgba(124,58,237,.26), transparent 34%%), #111118; border: 1px dashed #4c4c62; text-align: center; }
.codeLabel { color: #8b8ba0; font-size: 12px; margin-bottom: 10px; }
.code { font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 36px; letter-spacing: 10px; font-weight: 800; color: #ffffff; text-shadow: 0 0 24px rgba(124,58,237,.55); }
.hint { margin: 0 34px 28px; padding: 14px 16px; border-radius: 14px; background: rgba(251,191,36,.08); border: 1px solid rgba(251,191,36,.18); color: #d6b46a; font-size: 12px; line-height: 1.6; }
.footer { padding: 20px 34px 30px; border-top: 1px solid #242430; color: #6f6f80; font-size: 12px; line-height: 1.6; text-align: center; }
</style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="hero">
        <img class="logo" src="%s" alt="AI Space" />
        <div class="badge">AI SPACE SECURE VERIFY</div>
        <h1>%s</h1>
        <p>%s</p>
      </div>
      <div class="codeBox">
        <div class="codeLabel">3 分钟内有效 · 请勿转发给他人</div>
        <div class="code" id="code">%s</div>
      </div>
      <div class="hint">请手动复制上方 6 位数字验证码并填入页面。验证码 3 分钟内有效，过期后需要重新发送邮件。</div>
      <div class="footer">此邮件由 AI Space 系统自动发送，请勿回复。若不是您本人操作，可以忽略这封邮件。</div>
    </div>
  </div>
</body>
</html>`, html.EscapeString(logoURL), title, desc, safeCode)
}

func (h *AuthHandler) SendEmailCode(c *gin.Context) {
	var req SendEmailCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	email := normalizeAuthEmail(req.Email)
	purpose := normalizeEmailCodePurpose(req.Purpose)
	if !allowedEmailCodePurposes[purpose] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的验证码用途"})
		return
	}

	var user models.User
	userErr := h.db.Where("email = ?", email).First(&user).Error
	if purpose == EmailCodePurposeRegister && userErr == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该邮箱已被注册"})
		return
	}
	if purpose != EmailCodePurposeRegister && userErr != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "该邮箱尚未注册"})
		return
	}

	var recent models.EmailVerification
	if err := h.db.Where("email = ? AND purpose = ? AND consumed_at IS NULL", email, purpose).
		Order("created_at DESC").First(&recent).Error; err == nil && time.Since(recent.CreatedAt) < emailVerificationMinInterval {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "验证码发送过于频繁，请稍后再试"})
		return
	}

	code, err := generateNumericCode(6)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成验证码失败"})
		return
	}

	now := time.Now()
	if err := h.db.Model(&models.EmailVerification{}).
		Where("email = ? AND purpose = ? AND consumed_at IS NULL", email, purpose).
		Update("consumed_at", now).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建验证码失败"})
		return
	}

	verification := models.EmailVerification{
		Email:     email,
		Purpose:   purpose,
		CodeHash:  hashEmailCode(email, purpose, code),
		ExpiresAt: now.Add(emailVerificationTTL),
	}
	if err := h.db.Create(&verification).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建验证码失败"})
		return
	}

	emailService := services.NewEmailService(h.cfg)
	subject := fmt.Sprintf("【AI Space】%s验证码：%s", emailPurposeTitle(purpose), code)
	if err := emailService.SendEmail(email, subject, buildVerificationEmailHTML(purpose, code, h.cfg.FrontendURL)); err != nil {
		fmt.Printf("[EmailVerification] send failed purpose=%s to=%s err=%v\n", purpose, email, err)
		message := "验证码邮件发送失败，请稍后再试"
		if strings.Contains(err.Error(), "邮件服务未配置") {
			message = "邮件服务未配置，请联系管理员配置 SMTP 发信账号"
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": message})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "验证码已发送", "expires_in": int(emailVerificationTTL.Seconds())})
}

func (h *AuthHandler) verifyEmailCode(tx *gorm.DB, email, purpose, code string) error {
	email = normalizeAuthEmail(email)
	purpose = normalizeEmailCodePurpose(purpose)
	code = strings.TrimSpace(code)
	if code == "" {
		return fmt.Errorf("请输入邮箱验证码")
	}

	var verification models.EmailVerification
	if err := tx.Where("email = ? AND purpose = ? AND consumed_at IS NULL", email, purpose).
		Order("created_at DESC").First(&verification).Error; err != nil {
		return fmt.Errorf("验证码无效或已过期")
	}
	if time.Now().After(verification.ExpiresAt) {
		return fmt.Errorf("验证码已过期，请重新获取")
	}
	if verification.Attempts >= emailVerificationMaxAttempts {
		return fmt.Errorf("验证码错误次数过多，请重新获取")
	}
	if verification.CodeHash != hashEmailCode(email, purpose, code) {
		tx.Model(&verification).Update("attempts", gorm.Expr("attempts + 1"))
		return fmt.Errorf("验证码错误")
	}
	now := time.Now()
	return tx.Model(&verification).Update("consumed_at", now).Error
}

func (h *AuthHandler) ResetPassword(c *gin.Context) {
	var req ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Email = normalizeAuthEmail(req.Email)

	var user models.User
	if err := h.db.Where("email = ?", req.Email).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "该邮箱尚未注册"})
		return
	}

	if err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := h.verifyEmailCode(tx, req.Email, EmailCodePurposeResetPassword, req.VerificationCode); err != nil {
			return err
		}
		user.Password = req.Password
		if err := user.HashPassword(); err != nil {
			return err
		}
		if err := tx.Save(&user).Error; err != nil {
			return err
		}
		return tx.Model(&models.RefreshToken{}).Where("user_id = ? AND revoked_at IS NULL", user.ID).Update("revoked_at", time.Now()).Error
	}); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "密码已重置，请重新登录"})
}

func (h *AuthHandler) ChangePassword(c *gin.Context) {
	userIDValue, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}
	userID, ok := userIDValue.(uint)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "认证信息无效"})
		return
	}

	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := h.db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}
	if strings.TrimSpace(req.CurrentPassword) != "" && !user.CheckPassword(req.CurrentPassword) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "当前密码错误"})
		return
	}

	if err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := h.verifyEmailCode(tx, user.Email, EmailCodePurposeChangePassword, req.VerificationCode); err != nil {
			return err
		}
		user.Password = req.Password
		if err := user.HashPassword(); err != nil {
			return err
		}
		if err := tx.Save(&user).Error; err != nil {
			return err
		}
		return tx.Model(&models.RefreshToken{}).Where("user_id = ? AND id <> ? AND revoked_at IS NULL", user.ID, 0).Update("revoked_at", time.Now()).Error
	}); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "密码已修改"})
}
