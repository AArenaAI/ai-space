package api

import (
	"bytes"
	"crypto"
	"crypto/md5"
	cryptorand "crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"html"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"aipool-backend/internal/config"
	"aipool-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	paymentProviderFubei = "fubei"
	orderStatusPending   = "pending"
	orderStatusPaid      = "paid"
	orderStatusFailed    = "failed"
)

type PaymentHandler struct {
	db  *gorm.DB
	cfg *config.Config
}

type planDef struct {
	Code            string
	Name            string
	AmountCents     int64
	BasicCredits    int
	AdvancedCredits int
	EliteCredits    int
}

func NewPaymentHandler(db *gorm.DB, cfg *config.Config) *PaymentHandler {
	return &PaymentHandler{db: db, cfg: cfg}
}

func (h *PaymentHandler) planCatalog() map[string]planDef {
	return map[string]planDef{
		"basic": {
			Code: "basic", Name: "Basic", AmountCents: h.cfg.FubeiPlanBasicCents,
			BasicCredits: 10000, AdvancedCredits: 2500,
		},
		"plus": {
			Code: "plus", Name: "Plus", AmountCents: h.cfg.FubeiPlanPlusCents,
			BasicCredits: 30000, AdvancedCredits: 10000,
		},
		"ultra": {
			Code: "ultra", Name: "Ultra", AmountCents: h.cfg.FubeiPlanUltraCents,
			BasicCredits: -1, AdvancedCredits: 26000,
		},
	}
}

func (h *PaymentHandler) resolvePlan(code string) (planDef, error) {
	normalized := strings.ToLower(strings.TrimSpace(code))
	if normalized == "" || normalized == "free" {
		return planDef{}, errors.New("不支持的会员套餐")
	}
	plan, ok := h.planCatalog()[normalized]
	if !ok {
		return planDef{}, errors.New("不支持的会员套餐")
	}

	var dbPlan models.BillingPlan
	if err := h.db.Where("code = ? AND enabled = ? AND public_visible = ?", normalized, true, true).First(&dbPlan).Error; err == nil {
		plan.Name = firstNonEmpty(dbPlan.Name, plan.Name)
		plan.AmountCents = dbPlan.PriceCents
		if dbPlan.BasicCredits != 0 {
			plan.BasicCredits = dbPlan.BasicCredits
		}
		if dbPlan.AdvancedCredits != 0 {
			plan.AdvancedCredits = dbPlan.AdvancedCredits
		}
		if dbPlan.EliteCredits != 0 {
			plan.EliteCredits = dbPlan.EliteCredits
		}
	}
	if plan.AmountCents <= 0 {
		return planDef{}, errors.New("支付价格尚未配置，暂不能创建订单")
	}
	return plan, nil
}

type createFubeiAlipayOrderRequest struct {
	PlanCode string `json:"plan_code" binding:"required"`
}

func (h *PaymentHandler) CreateFubeiAlipayOrder(c *gin.Context) {
	userIDAny, _ := c.Get("userID")
	userID, _ := userIDAny.(uint)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
		return
	}

	var req createFubeiAlipayOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择会员套餐"})
		return
	}
	plan, err := h.resolvePlan(req.PlanCode)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(h.cfg.PublicAppURL) == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "PUBLIC_APP_URL 未配置，无法生成扫码支付链接"})
		return
	}

	var user models.User
	if err := h.db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}

	orderNo := generateBillingOrderNo()
	order := models.BillingOrder{
		OrderNo:     orderNo,
		UserID:      user.ID,
		AmountCents: plan.AmountCents,
		Currency:    "CNY",
		Status:      orderStatusPending,
		Provider:    paymentProviderFubei,
		Channel:     "alipay",
		PlanCode:    plan.Code,
		PlanName:    plan.Name,
	}
	if err := h.db.Create(&order).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建订单失败"})
		return
	}

	mobileURL := strings.TrimRight(h.cfg.PublicAppURL, "/") + "/payment/alipay/?order_no=" + url.QueryEscape(orderNo)
	c.JSON(http.StatusOK, gin.H{
		"order_no":       orderNo,
		"status":         order.Status,
		"plan_code":      plan.Code,
		"plan_name":      plan.Name,
		"amount_cents":   plan.AmountCents,
		"amount_display": float64(plan.AmountCents) / 100.0,
		"currency":       order.Currency,
		"mobile_pay_url": mobileURL,
	})
}

func (h *PaymentHandler) GetPaymentOrder(c *gin.Context) {
	userIDAny, _ := c.Get("userID")
	userID, _ := userIDAny.(uint)
	orderNo := strings.TrimSpace(c.Param("order_no"))
	if orderNo == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "订单号不能为空"})
		return
	}
	var order models.BillingOrder
	if err := h.db.Where("order_no = ? AND user_id = ?", orderNo, userID).First(&order).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "订单不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"order_no":          order.OrderNo,
		"status":            order.Status,
		"provider_order_id": order.ProviderOrderID,
		"plan_code":         order.PlanCode,
		"plan_name":         order.PlanName,
		"amount_cents":      order.AmountCents,
		"amount_display":    float64(order.AmountCents) / 100.0,
		"currency":          order.Currency,
		"paid_at":           order.PaidAt,
	})
}

func (h *PaymentHandler) AlipayAuth(c *gin.Context) {
	orderNo := strings.TrimSpace(c.Query("order_no"))
	if orderNo == "" {
		c.String(http.StatusBadRequest, "缺少订单号")
		return
	}
	var order models.BillingOrder
	if err := h.db.Where("order_no = ? AND provider = ?", orderNo, paymentProviderFubei).First(&order).Error; err != nil {
		c.String(http.StatusNotFound, "订单不存在")
		return
	}
	if order.Status == orderStatusPaid {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(http.StatusOK, paidHTML(order.OrderNo))
		return
	}
	if strings.TrimSpace(h.cfg.AlipayAppID) == "" {
		c.String(http.StatusServiceUnavailable, "支付宝应用 AppID 未配置")
		return
	}
	redirectURI := strings.TrimRight(h.cfg.PublicAppURL, "/") + "/api/payments/fubei/alipay/callback?order_no=" + url.QueryEscape(orderNo)
	authURL := "https://openauth.alipay.com/oauth2/publicAppAuthorize.htm?" + url.Values{
		"app_id":       {h.cfg.AlipayAppID},
		"scope":        {"auth_base"},
		"redirect_uri": {redirectURI},
	}.Encode()
	c.Redirect(http.StatusFound, authURL)
}

func (h *PaymentHandler) AlipayCallback(c *gin.Context) {
	orderNo := strings.TrimSpace(c.Query("order_no"))
	authCode := firstNonEmpty(c.Query("auth_code"), c.Query("app_auth_code"))
	if orderNo == "" || authCode == "" {
		c.String(http.StatusBadRequest, "缺少支付宝授权参数")
		return
	}
	var order models.BillingOrder
	if err := h.db.Where("order_no = ? AND provider = ?", orderNo, paymentProviderFubei).First(&order).Error; err != nil {
		c.String(http.StatusNotFound, "订单不存在")
		return
	}
	if order.Status == orderStatusPaid {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(http.StatusOK, paidHTML(order.OrderNo))
		return
	}

	alipayUserID, err := h.exchangeAlipayUserID(authCode)
	if err != nil {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(http.StatusBadGateway, errorHTML("支付宝授权失败", err.Error()))
		return
	}
	prepayID, providerOrderID, rawResp, err := h.createFubeiAlipayPrepay(&order, alipayUserID)
	if err != nil {
		_ = h.db.Model(&order).Updates(map[string]interface{}{"failed_reason": err.Error(), "provider_raw_response": rawResp}).Error
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(http.StatusBadGateway, errorHTML("创建支付订单失败", err.Error()))
		return
	}
	_ = h.db.Model(&order).Updates(map[string]interface{}{
		"provider_order_id":     providerOrderID,
		"provider_customer_id":  alipayUserID,
		"provider_raw_response": rawResp,
	}).Error

	c.Header("Content-Type", "text/html; charset=utf-8")
	c.String(http.StatusOK, alipayTradePayHTML(order.OrderNo, prepayID))
}

func (h *PaymentHandler) FubeiNotify(c *gin.Context) {
	bodyBytes, _ := io.ReadAll(c.Request.Body)
	contentType := c.GetHeader("Content-Type")
	params := map[string]string{}
	if strings.Contains(contentType, "application/json") {
		var raw map[string]interface{}
		_ = json.Unmarshal(bodyBytes, &raw)
		for k, v := range raw {
			params[k] = fmt.Sprint(v)
		}
	} else {
		values, _ := url.ParseQuery(string(bodyBytes))
		for k, v := range values {
			if len(v) > 0 {
				params[k] = v[0]
			}
		}
	}
	if len(params) == 0 {
		c.String(http.StatusBadRequest, "empty notify")
		return
	}
	if !h.verifyFubeiSign(params) {
		c.String(http.StatusBadRequest, "invalid sign")
		return
	}
	payloadJSON := string(bodyBytes)
	eventID := firstNonEmpty(params["order_sn"], params["merchant_order_sn"], params["ins_order_sn"], fmt.Sprintf("fubei_%d", time.Now().UnixNano()))
	event := models.PaymentEvent{Provider: paymentProviderFubei, EventID: eventID, EventType: "payment_notify", Status: "received", PayloadJSON: payloadJSON}
	_ = h.db.FirstOrCreate(&event, models.PaymentEvent{Provider: paymentProviderFubei, EventID: eventID}).Error

	biz := extractFubeiBusinessData(params)
	orderNo := firstNonEmpty(biz["merchant_order_sn"], params["merchant_order_sn"])
	if orderNo == "" {
		now := time.Now()
		_ = h.db.Model(&event).Updates(map[string]interface{}{"status": "ignored", "error_message": "missing merchant_order_sn", "processed_at": &now}).Error
		c.String(http.StatusOK, "success")
		return
	}
	paid := isFubeiPaid(biz, params)
	if !paid {
		now := time.Now()
		_ = h.db.Model(&event).Updates(map[string]interface{}{"status": "ignored", "error_message": "not paid", "processed_at": &now}).Error
		c.String(http.StatusOK, "success")
		return
	}
	if err := h.markOrderPaid(orderNo, firstNonEmpty(biz["order_sn"], params["order_sn"])); err != nil {
		now := time.Now()
		_ = h.db.Model(&event).Updates(map[string]interface{}{"status": "failed", "error_message": err.Error(), "processed_at": &now}).Error
		c.String(http.StatusInternalServerError, "fail")
		return
	}
	now := time.Now()
	_ = h.db.Model(&event).Updates(map[string]interface{}{"status": "processed", "processed_at": &now}).Error
	c.String(http.StatusOK, "success")
}

func (h *PaymentHandler) markOrderPaid(orderNo string, providerOrderID string) error {
	return h.db.Transaction(func(tx *gorm.DB) error {
		var order models.BillingOrder
		if err := tx.Where("order_no = ?", orderNo).First(&order).Error; err != nil {
			return err
		}
		if order.Status == orderStatusPaid {
			return nil
		}
		plan, ok := h.planCatalog()[order.PlanCode]
		if !ok {
			return fmt.Errorf("unknown plan code %s", order.PlanCode)
		}
		var user models.User
		if err := tx.First(&user, order.UserID).Error; err != nil {
			return err
		}
		now := time.Now()
		updates := map[string]interface{}{
			"status":  orderStatusPaid,
			"paid_at": &now,
		}
		if providerOrderID != "" {
			updates["provider_order_id"] = providerOrderID
		}
		if err := tx.Model(&order).Updates(updates).Error; err != nil {
			return err
		}
		user.PlanTier = plan.Code
		user.BasicCredits = plan.BasicCredits
		user.AdvancedCredits = plan.AdvancedCredits
		user.EliteCredits = plan.EliteCredits
		user.CreditsResetAt = now
		if err := tx.Save(&user).Error; err != nil {
			return err
		}
		if plan.BasicCredits > 0 {
			if err := tx.Create(&models.CreditTransaction{UserID: user.ID, Type: "grant", Tier: "basic", Amount: plan.BasicCredits, BalanceAfter: user.BasicCredits, Reason: "会员套餐支付成功", SourceType: "order", SourceID: order.OrderNo}).Error; err != nil {
				return err
			}
		}
		if plan.AdvancedCredits > 0 {
			if err := tx.Create(&models.CreditTransaction{UserID: user.ID, Type: "grant", Tier: "advanced", Amount: plan.AdvancedCredits, BalanceAfter: user.AdvancedCredits, Reason: "会员套餐支付成功", SourceType: "order", SourceID: order.OrderNo}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (h *PaymentHandler) exchangeAlipayUserID(authCode string) (string, error) {
	if strings.TrimSpace(h.cfg.AlipayAppID) == "" || strings.TrimSpace(h.cfg.AlipayPrivateKey) == "" {
		return "", errors.New("支付宝应用配置不完整")
	}
	params := map[string]string{
		"app_id":     h.cfg.AlipayAppID,
		"method":     "alipay.system.oauth.token",
		"format":     "JSON",
		"charset":    "utf-8",
		"sign_type":  "RSA2",
		"timestamp":  time.Now().Format("2006-01-02 15:04:05"),
		"version":    "1.0",
		"grant_type": "authorization_code",
		"code":       authCode,
	}
	sign, err := alipaySign(params, h.cfg.AlipayPrivateKey)
	if err != nil {
		return "", err
	}
	params["sign"] = sign
	endpoint := firstNonEmpty(h.cfg.AlipayGatewayURL, "https://openapi.alipay.com/gateway.do")
	resp, err := http.PostForm(endpoint, toURLValues(params))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("支付宝授权接口 HTTP %d: %s", resp.StatusCode, string(data))
	}
	var parsed map[string]json.RawMessage
	if err := json.Unmarshal(data, &parsed); err != nil {
		return "", err
	}
	var tokenResp struct {
		UserID string `json:"user_id"`
		Code   string `json:"code"`
		Msg    string `json:"msg"`
		SubMsg string `json:"sub_msg"`
	}
	if raw := parsed["alipay_system_oauth_token_response"]; len(raw) > 0 {
		_ = json.Unmarshal(raw, &tokenResp)
	}
	if tokenResp.UserID == "" {
		return "", fmt.Errorf("支付宝授权未返回 user_id: %s %s", tokenResp.Msg, tokenResp.SubMsg)
	}
	return tokenResp.UserID, nil
}

func (h *PaymentHandler) createFubeiAlipayPrepay(order *models.BillingOrder, alipayUserID string) (prepayID string, providerOrderID string, rawResp string, err error) {
	if strings.TrimSpace(h.cfg.FubeiGatewayURL) == "" || strings.TrimSpace(h.cfg.FubeiAppID) == "" || strings.TrimSpace(h.cfg.FubeiAppSecret) == "" {
		return "", "", "", errors.New("付呗配置不完整")
	}
	if h.cfg.FubeiStoreID == 0 {
		return "", "", "", errors.New("FUBEI_STORE_ID 未配置")
	}
	biz := map[string]interface{}{
		"merchant_order_sn": order.OrderNo,
		"pay_type":          "alipay",
		"total_amount":      fmt.Sprintf("%.2f", float64(order.AmountCents)/100.0),
		"store_id":          h.cfg.FubeiStoreID,
		"user_id":           alipayUserID,
		"body":              "AI Space " + order.PlanName + " 会员套餐",
		"attach":            fmt.Sprintf(`{"user_id":%d,"plan":"%s"}`, order.UserID, order.PlanCode),
		"notify_url":        strings.TrimRight(h.cfg.PublicAppURL, "/") + "/api/payments/fubei/notify",
		"timeout_express":   time.Now().Add(15 * time.Minute).Format("20060102150405"),
	}
	bizBytes, _ := json.Marshal(biz)
	params := map[string]string{
		"app_id":      h.cfg.FubeiAppID,
		"method":      firstNonEmpty(h.cfg.FubeiOrderCreateMethod, "fbpay.order.create"),
		"format":      "json",
		"sign_method": "md5",
		"nonce":       randomNonce(24),
		"version":     "1.0",
		"biz_content": string(bizBytes),
	}
	params["sign"] = fubeiSign(params, h.cfg.FubeiAppSecret)
	reqBytes, _ := json.Marshal(params)
	resp, err := http.Post(h.cfg.FubeiGatewayURL, "application/json; charset=utf-8", bytes.NewReader(reqBytes))
	if err != nil {
		return "", "", "", err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	rawResp = string(data)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", rawResp, fmt.Errorf("付呗统一下单 HTTP %d: %s", resp.StatusCode, rawResp)
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return "", "", rawResp, err
	}
	if !isFubeiSuccess(parsed) {
		return "", "", rawResp, fmt.Errorf("付呗统一下单失败: %v", firstNonEmpty(fmt.Sprint(parsed["result_message"]), fmt.Sprint(parsed["message"])))
	}
	dataMap := fubeiDataMap(parsed["data"])
	prepayID = firstNonEmpty(toString(dataMap["prepay_id"]), toString(dataMap["trade_no"]), toString(dataMap["tradeNO"]), toString(dataMap["ins_order_sn"]))
	providerOrderID = firstNonEmpty(toString(dataMap["order_sn"]), toString(dataMap["ins_order_sn"]))
	if prepayID == "" {
		return "", providerOrderID, rawResp, fmt.Errorf("付呗未返回 prepay_id/tradeNO: %s", rawResp)
	}
	return prepayID, providerOrderID, rawResp, nil
}

func fubeiSign(params map[string]string, secret string) string {
	keys := make([]string, 0, len(params))
	for k, v := range params {
		if k == "sign" || v == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+params[k])
	}
	s := strings.Join(parts, "&") + secret
	sum := md5.Sum([]byte(s))
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

func (h *PaymentHandler) verifyFubeiSign(params map[string]string) bool {
	sign := strings.TrimSpace(params["sign"])
	if sign == "" || strings.TrimSpace(h.cfg.FubeiAppSecret) == "" {
		return false
	}
	return strings.EqualFold(sign, fubeiSign(params, h.cfg.FubeiAppSecret))
}

func alipaySign(params map[string]string, privateKeyPEM string) (string, error) {
	keys := make([]string, 0, len(params))
	for k := range params {
		if k != "sign" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+params[k])
	}
	content := strings.Join(parts, "&")
	key, err := parseRSAPrivateKey(privateKeyPEM)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256([]byte(content))
	sig, err := rsa.SignPKCS1v15(cryptorand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(sig), nil
}

func parseRSAPrivateKey(raw string) (*rsa.PrivateKey, error) {
	trimmed := strings.TrimSpace(raw)
	candidates := []string{trimmed}
	if !strings.Contains(trimmed, "BEGIN") {
		wrapped := wrapPEM(trimmed)
		candidates = []string{
			"-----" + "BEGIN PRIVATE KEY" + "-----\n" + wrapped + "\n-----" + "END PRIVATE KEY" + "-----",
			"-----" + "BEGIN RSA PRIVATE KEY" + "-----\n" + wrapped + "\n-----" + "END RSA PRIVATE KEY" + "-----",
		}
	}
	var lastErr error
	for _, candidate := range candidates {
		block, _ := pem.Decode([]byte(candidate))
		if block == nil {
			lastErr = errors.New("无法解析支付宝应用私钥 PEM")
			continue
		}
		if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
			if rsaKey, ok := key.(*rsa.PrivateKey); ok {
				return rsaKey, nil
			}
		} else {
			lastErr = err
		}
		if rsaKey, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
			return rsaKey, nil
		} else {
			lastErr = err
		}
	}
	return nil, lastErr
}

func wrapPEM(s string) string {
	s = strings.ReplaceAll(s, "\n", "")
	var b strings.Builder
	for len(s) > 64 {
		b.WriteString(s[:64])
		b.WriteByte('\n')
		s = s[64:]
	}
	b.WriteString(s)
	return b.String()
}

func toURLValues(m map[string]string) url.Values {
	v := url.Values{}
	for k, val := range m {
		v.Set(k, val)
	}
	return v
}

func generateBillingOrderNo() string {
	return fmt.Sprintf("AIS%s%06d%06d", time.Now().Format("20060102150405"), time.Now().UnixNano()%1000000, rand.IntN(1000000))
}

func randomNonce(n int) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	var b strings.Builder
	for i := 0; i < n; i++ {
		b.WriteByte(alphabet[rand.IntN(len(alphabet))])
	}
	return b.String()
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" && strings.TrimSpace(v) != "<nil>" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func toString(v interface{}) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case json.Number:
		return x.String()
	default:
		if v == nil {
			return ""
		}
		return fmt.Sprint(v)
	}
}

func isFubeiSuccess(parsed map[string]interface{}) bool {
	code := firstNonEmpty(toString(parsed["result_code"]), toString(parsed["status"]), toString(parsed["code"]))
	return code == "200" || code == "0" || strings.EqualFold(code, "SUCCESS") || strings.EqualFold(code, "success")
}

func fubeiDataMap(v interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	switch x := v.(type) {
	case map[string]interface{}:
		return x
	case string:
		_ = json.Unmarshal([]byte(x), &out)
	}
	return out
}

func extractFubeiBusinessData(params map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range params {
		out[k] = v
	}
	if raw := strings.TrimSpace(params["data"]); raw != "" {
		var m map[string]interface{}
		if err := json.Unmarshal([]byte(raw), &m); err == nil {
			for k, v := range m {
				out[k] = toString(v)
			}
		}
	}
	return out
}

func isFubeiPaid(biz map[string]string, params map[string]string) bool {
	status := strings.ToUpper(firstNonEmpty(biz["order_status"], biz["status"], params["order_status"]))
	resultCode := firstNonEmpty(params["result_code"], biz["result_code"])
	return status == "SUCCESS" || strings.EqualFold(resultCode, "200") || strings.EqualFold(resultCode, "SUCCESS")
}

func alipayTradePayHTML(orderNo, tradeNO string) string {
	orderEsc := html.EscapeString(orderNo)
	tradeEsc := html.EscapeString(tradeNO)
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Space 支付</title><style>body{margin:0;background:#0b0b0c;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}.card{padding:28px;border:1px solid #2a2a2d;border-radius:18px;background:#171719;max-width:360px;text-align:center}.muted{color:#9ca3af;font-size:13px}.btn{margin-top:18px;border:0;border-radius:12px;background:#1677ff;color:white;padding:12px 18px;font-size:15px}</style></head><body><div class="card"><h2>正在拉起支付宝支付</h2><p class="muted">订单 ` + orderEsc + `</p><button class="btn" onclick="pay()">继续支付</button><p id="msg" class="muted"></p></div><script>function pay(){function run(){if(!window.AlipayJSBridge){document.getElementById('msg').innerText='请使用支付宝扫码打开本页面';return;}AlipayJSBridge.call('tradePay',{tradeNO:'` + tradeEsc + `'},function(result){document.getElementById('msg').innerText='支付结果：'+JSON.stringify(result);});}if(window.AlipayJSBridge){run()}else{document.addEventListener('AlipayJSBridgeReady',run,false)}}pay();</script></body></html>`
}

func paidHTML(orderNo string) string {
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Space 支付</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0b0b0c;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center"><div><h2>订单已支付</h2><p>` + html.EscapeString(orderNo) + `</p></div></body></html>`
}

func errorHTML(title, msg string) string {
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Space 支付</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0b0b0c;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center"><div style="max-width:360px;padding:24px"><h2>` + html.EscapeString(title) + `</h2><p style="color:#9ca3af">` + html.EscapeString(msg) + `</p></div></body></html>`
}
