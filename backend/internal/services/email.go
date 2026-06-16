package services

import (
	"fmt"
	"net/smtp"

	"aipool-backend/internal/config"
)

// EmailService 邮件发送服务
type EmailService struct {
	cfg *config.Config
}

// NewEmailService 创建邮件服务
func NewEmailService(cfg *config.Config) *EmailService {
	return &EmailService{cfg: cfg}
}

// IsEnabled 检查邮件服务是否可用
func (s *EmailService) IsEnabled() bool {
	return s.cfg.SMTPHost != "" && s.cfg.SMTPUser != "" && s.cfg.SMTPPassword != ""
}

// SendEmail 发送纯文本邮件
func (s *EmailService) SendEmail(to, subject, body string) error {
	if !s.IsEnabled() {
		return fmt.Errorf("邮件服务未配置")
	}

	addr := fmt.Sprintf("%s:%s", s.cfg.SMTPHost, s.cfg.SMTPPort)
	auth := smtp.PlainAuth("", s.cfg.SMTPUser, s.cfg.SMTPPassword, s.cfg.SMTPHost)

	msg := []byte(fmt.Sprintf(
		"To: %s\r\n"+
			"From: %s\r\n"+
			"Subject: %s\r\n"+
			"Content-Type: text/html; charset=UTF-8\r\n"+
			"\r\n"+
			"%s",
		to, s.cfg.SMTPFrom, subject, body,
	))

	return smtp.SendMail(addr, auth, s.cfg.SMTPFrom, []string{to}, msg)
}

// SendBetaInviteEmail 发送内测激活码邮件
func (s *EmailService) SendBetaInviteEmail(to, name, inviteCode, frontendURL string) error {
	subject := "【AI Space】内测白名单激活码"
	body := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 40px 20px; }
.container { max-width: 600px; margin: 0 auto; background: #141414; border-radius: 16px; padding: 40px; border: 1px solid #262626; }
.header { text-align: center; margin-bottom: 32px; }
.logo { font-size: 24px; font-weight: 700; color: #fff; }
.tagline { font-size: 14px; color: #888; margin-top: 4px; }
.title { font-size: 20px; font-weight: 600; margin-bottom: 16px; color: #fff; }
.content { font-size: 14px; line-height: 1.7; color: #aaa; margin-bottom: 24px; }
.code-box { background: #1a1a1a; border: 1px dashed #444; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
.code { font-family: 'SF Mono', monospace; font-size: 28px; font-weight: 700; color: #10b981; letter-spacing: 4px; }
.cta { display: inline-block; background: #10b981; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-size: 15px; font-weight: 600; margin: 16px 0; }
.footer { text-align: center; font-size: 12px; color: #666; margin-top: 32px; padding-top: 24px; border-top: 1px solid #262626; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo">AI Space</div>
    <div class="tagline">寻找被大模型"逻辑硬伤"折磨的重度用户</div>
  </div>
  <div class="title">%s，恭喜通过审核</div>
  <div class="content">
    您的内测申请已通过人工审核。您被选中参与 AI Space 封闭测试，这是对我们产品能力的最高认可。
    <br><br>
    请使用下方激活码完成账户注册，初始测试额度将自动发放。
  </div>
  <div class="code-box">
    <div class="code">%s</div>
  </div>
  <div style="text-align: center;">
    <a href="%s" class="cta">立即激活账户</a>
  </div>
  <div class="footer">
    激活链接：%s<br>
    此邮件由 AI Space 系统自动发送，请勿回复。
  </div>
</div>
</body>
</html>
`, name, inviteCode, frontendURL, frontendURL)

	return s.SendEmail(to, subject, body)
}

// SendBetaRejectedEmail 发送申请被拒邮件
func (s *EmailService) SendBetaRejectedEmail(to, name, reviewNote string) error {
	subject := "【AI Space】内测申请审核结果"
	body := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 40px 20px; }
.container { max-width: 600px; margin: 0 auto; background: #141414; border-radius: 16px; padding: 40px; border: 1px solid #262626; }
.header { text-align: center; margin-bottom: 32px; }
.logo { font-size: 24px; font-weight: 700; color: #fff; }
.title { font-size: 20px; font-weight: 600; margin-bottom: 16px; color: #fff; }
.content { font-size: 14px; line-height: 1.7; color: #aaa; margin-bottom: 24px; }
.note-box { background: #1a1a1a; border-left: 3px solid #ef4444; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 13px; color: #888; }
.footer { text-align: center; font-size: 12px; color: #666; margin-top: 32px; padding-top: 24px; border-top: 1px solid #262626; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo">AI Space</div>
  </div>
  <div class="title">%s，感谢您的申请</div>
  <div class="content">
    非常抱歉，您的内测申请未通过本次审核。内测名额有限，我们优先选择了与当前测试目标最匹配的用户群体。
  </div>
  <div class="note-box">
    <strong>审核意见：</strong><br>%s
  </div>
  <div class="content">
    产品正式上线后，我们会第一时间通知您。期待届时与您相见。
  </div>
  <div class="footer">
    此邮件由 AI Space 系统自动发送，请勿回复。
  </div>
</div>
</body>
</html>
`, name, reviewNote)

	return s.SendEmail(to, subject, body)
}

// SendBugFixedEmail 发送 Bug 修复通知邮件（Changelog）
func (s *EmailService) SendBugFixedEmail(to, name, bugSummary, frontendURL string) error {
	subject := fmt.Sprintf("【AI Space】您反馈的「%s」问题已修复", bugSummary)
	body := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 40px 20px; }
.container { max-width: 600px; margin: 0 auto; background: #141414; border-radius: 16px; padding: 40px; border: 1px solid #262626; }
.header { text-align: center; margin-bottom: 32px; }
.logo { font-size: 24px; font-weight: 700; color: #fff; }
.badge { display: inline-block; background: #10b98120; color: #10b981; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 20px; }
.title { font-size: 20px; font-weight: 600; margin-bottom: 16px; color: #fff; }
.content { font-size: 14px; line-height: 1.7; color: #aaa; margin-bottom: 24px; }
.highlight { color: #10b981; font-weight: 600; }
.cta { display: inline-block; background: #10b981; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-size: 15px; font-weight: 600; margin: 16px 0; }
.footer { text-align: center; font-size: 12px; color: #666; margin-top: 32px; padding-top: 24px; border-top: 1px solid #262626; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo">AI Space</div>
  </div>
  <div class="badge">底层逻辑已修复</div>
  <div class="title">%s，您提交的反馈已被解决</div>
  <div class="content">
    昨日您提交的关于 <span class="highlight">「%s」</span> 的 Bug 已在底层逻辑中修复。
    <br><br>
    技术团队对您的反馈进行了针对性微调（LoRA/SFT），模型在该场景下的推理准确性已显著提升。
    <br><br>
    我们为您发放了临时测试额度，请重新验证该场景。
  </div>
  <div style="text-align: center;">
    <a href="%s" class="cta">重新测试验证</a>
  </div>
  <div class="footer">
    此邮件由 AI Space 系统自动发送，请勿回复。
  </div>
</div>
</body>
</html>
`, name, bugSummary, frontendURL)

	return s.SendEmail(to, subject, body)
}

// SendCreditGrantedEmail 发送额度发放通知
func (s *EmailService) SendCreditGrantedEmail(to, name string, basic, advanced, elite int) error {
	subject := "【AI Space】测试额度已发放"
	body := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 40px 20px; }
.container { max-width: 600px; margin: 0 auto; background: #141414; border-radius: 16px; padding: 40px; border: 1px solid #262626; }
.header { text-align: center; margin-bottom: 32px; }
.logo { font-size: 24px; font-weight: 700; color: #fff; }
.title { font-size: 20px; font-weight: 600; margin-bottom: 16px; color: #fff; }
.content { font-size: 14px; line-height: 1.7; color: #aaa; margin-bottom: 24px; }
.credits { display: flex; gap: 12px; justify-content: center; margin: 24px 0; }
.credit-item { background: #1a1a1a; border-radius: 10px; padding: 16px 24px; text-align: center; min-width: 80px; }
.credit-value { font-size: 24px; font-weight: 700; color: #10b981; }
.credit-label { font-size: 12px; color: #888; margin-top: 4px; }
.footer { text-align: center; font-size: 12px; color: #666; margin-top: 32px; padding-top: 24px; border-top: 1px solid #262626; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo">AI Space</div>
  </div>
  <div class="title">%s，额度已到账</div>
  <div class="content">
    您的内测账户已获得新的测试额度，可以继续深入测试 AI Space 的各项能力。
  </div>
  <div class="credits">
    <div class="credit-item"><div class="credit-value">%d</div><div class="credit-label">基础</div></div>
    <div class="credit-item"><div class="credit-value">%d</div><div class="credit-label">高级</div></div>
    <div class="credit-item"><div class="credit-value">%d</div><div class="credit-label">精英</div></div>
  </div>
  <div class="footer">
    此邮件由 AI Space 系统自动发送，请勿回复。
  </div>
</div>
</body>
</html>
`, name, basic, advanced, elite)

	return s.SendEmail(to, subject, body)
}

// SendCreditExhaustedReminder 发送额度耗尽提醒（投名状）
func (s *EmailService) SendCreditExhaustedReminder(to, name string) error {
	subject := "【AI Space】您的测试额度已耗尽"
	body := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 40px 20px; }
.container { max-width: 600px; margin: 0 auto; background: #141414; border-radius: 16px; padding: 40px; border: 1px solid #262626; }
.header { text-align: center; margin-bottom: 32px; }
.logo { font-size: 24px; font-weight: 700; color: #fff; }
.alert { display: inline-block; background: #ef444420; color: #ef4444; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 20px; }
.title { font-size: 20px; font-weight: 600; margin-bottom: 16px; color: #fff; }
.content { font-size: 14px; line-height: 1.7; color: #aaa; margin-bottom: 24px; }
.cta { display: inline-block; background: #ef4444; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-size: 15px; font-weight: 600; margin: 16px 0; }
.footer { text-align: center; font-size: 12px; color: #666; margin-top: 32px; padding-top: 24px; border-top: 1px solid #262626; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo">AI Space</div>
  </div>
  <div class="alert">额度耗尽</div>
  <div class="title">%s，您的初始测试额度已用完</div>
  <div class="content">
    若需解锁下一阶段的 Token，请前往产品界面提交您在使用中发现的模型逻辑错误（Bad Case）。
    <br><br>
    请指明模型的错误点，并提供您认为的"人类专家级正确推演"。敷衍填写将失去测试资格。
  </div>
  <div style="text-align: center;">
    <a href="#" class="cta">提交 Bad Case 解锁额度</a>
  </div>
  <div class="footer">
    此邮件由 AI Space 系统自动发送，请勿回复。
  </div>
</div>
</body>
</html>
`, name)

	return s.SendEmail(to, subject, body)
}
