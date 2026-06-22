package api

import (
	"aipool-backend/internal/config"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"google.golang.org/genai"
	"gorm.io/gorm"
)

const (
	liveTranslateModel              = "gemini-3.5-live-translate-preview"
	liveTranslateTicketTTL          = 30 * time.Second
	liveTranslateMaxSessionDuration = 10 * time.Minute
	liveTranslateIdleTimeout        = 45 * time.Second
)

var liveTranslateUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type liveTranslateTicket struct {
	UserID         uint
	Email          string
	TargetLanguage string
	ExpiresAt      time.Time
	Used           bool
}

type LiveTranslateHandler struct {
	db              *gorm.DB
	cfg             *config.Config
	mu              sync.Mutex
	tickets         map[string]*liveTranslateTicket
	activeByUser    map[uint]time.Time
	lastTicketSweep time.Time
}

func NewLiveTranslateHandler(db *gorm.DB, cfg *config.Config) *LiveTranslateHandler {
	return &LiveTranslateHandler{
		db:           db,
		cfg:          cfg,
		tickets:      make(map[string]*liveTranslateTicket),
		activeByUser: make(map[uint]time.Time),
	}
}

func (h *LiveTranslateHandler) CreateTicket(c *gin.Context) {
	userID, ok := getUintContext(c, "userID")
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	email, _ := c.Get("email")

	var req struct {
		TargetLanguage string `json:"target_language"`
	}
	_ = c.ShouldBindJSON(&req)
	targetLanguage := normalizeLiveTargetLanguage(req.TargetLanguage)
	if !ensureModelAccess(c, h.db, userID, liveTranslateModel, 0) {
		return
	}
	ticket, err := newLiveTranslateTicketToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ticket_create_failed"})
		return
	}

	expiresAt := time.Now().Add(liveTranslateTicketTTL)
	h.mu.Lock()
	h.sweepExpiredTicketsLocked(time.Now())
	h.tickets[ticket] = &liveTranslateTicket{
		UserID:         userID,
		Email:          fmt.Sprint(email),
		TargetLanguage: targetLanguage,
		ExpiresAt:      expiresAt,
	}
	h.mu.Unlock()

	c.JSON(http.StatusOK, gin.H{
		"ticket":          ticket,
		"expires_in":      int(liveTranslateTicketTTL.Seconds()),
		"target_language": targetLanguage,
	})
}

func (h *LiveTranslateHandler) WebSocket(c *gin.Context) {
	auth, ok := h.consumeTicket(c.Query("ticket"))
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	if strings.TrimSpace(h.cfg.GeminiKey) == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "gemini_api_key_missing"})
		return
	}

	if !h.tryStartUserSession(auth.UserID) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "live_translate_session_already_active"})
		return
	}
	defer h.endUserSession(auth.UserID)

	targetLanguage := auth.TargetLanguage
	clientConn, err := liveTranslateUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer clientConn.Close()

	ctx, cancel := context.WithTimeout(c.Request.Context(), liveTranslateMaxSessionDuration)
	defer cancel()

	genaiClient, err := h.newLiveGenAIClient(ctx)
	if err != nil {
		_ = clientConn.WriteJSON(gin.H{"type": "error", "error": "google_live_client_failed", "message": sanitizeLiveError(err)})
		return
	}

	echoTargetLanguage := true
	liveSession, err := genaiClient.Live.Connect(ctx, liveTranslateModel, &genai.LiveConnectConfig{
		ResponseModalities:       []genai.Modality{genai.ModalityAudio},
		InputAudioTranscription:  &genai.AudioTranscriptionConfig{},
		OutputAudioTranscription: &genai.AudioTranscriptionConfig{},
		TranslationConfig: &genai.TranslationConfig{
			TargetLanguageCode: targetLanguage,
			EchoTargetLanguage: &echoTargetLanguage,
		},
	})
	if err != nil {
		_ = clientConn.WriteJSON(gin.H{"type": "error", "error": "google_live_connect_failed", "message": sanitizeLiveError(err)})
		return
	}
	defer liveSession.Close()

	_ = clientConn.WriteJSON(gin.H{
		"type":                 "ready",
		"model":                liveTranslateModel,
		"target_language":      targetLanguage,
		"max_session_seconds":  int(liveTranslateMaxSessionDuration.Seconds()),
		"idle_timeout_seconds": int(liveTranslateIdleTimeout.Seconds()),
	})
	log.Printf("live_translate session started user_id=%v target=%s", auth.UserID, targetLanguage)

	var once sync.Once
	var audioChunks int64
	var audioBytes int64
	var googleMessages int64
	var inputTranscripts int64
	var outputTranscripts int64
	var outputAudioChunks int64
	var outputAudioBytes int64
	startedAt := time.Now()
	lastAudioAt := atomic.Int64{}
	lastAudioAt.Store(time.Now().UnixNano())
	paused := atomic.Bool{}
	errCh := make(chan error, 3)
	closeBoth := func() {
		once.Do(func() {
			cancel()
			_ = liveSession.Close()
			_ = clientConn.Close()
			log.Printf("live_translate session ended user_id=%v target=%s duration=%s audio_chunks=%d audio_bytes=%d google_messages=%d input_transcripts=%d output_transcripts=%d output_audio_chunks=%d output_audio_bytes=%d", auth.UserID, targetLanguage, time.Since(startedAt).Truncate(time.Millisecond), atomic.LoadInt64(&audioChunks), atomic.LoadInt64(&audioBytes), atomic.LoadInt64(&googleMessages), atomic.LoadInt64(&inputTranscripts), atomic.LoadInt64(&outputTranscripts), atomic.LoadInt64(&outputAudioChunks), atomic.LoadInt64(&outputAudioBytes))
		})
	}

	go func() {
		defer closeBoth()
		for {
			msgType, payload, readErr := clientConn.ReadMessage()
			if readErr != nil {
				errCh <- fmt.Errorf("client_read: %w", readErr)
				return
			}
			if msgType == websocket.TextMessage {
				var control struct {
					Type string `json:"type"`
				}
				if json.Unmarshal(payload, &control) == nil {
					switch control.Type {
					case "pause":
						paused.Store(true)
						_ = clientConn.WriteJSON(gin.H{"type": "paused"})
					case "resume":
						paused.Store(false)
						lastAudioAt.Store(time.Now().UnixNano())
						_ = clientConn.WriteJSON(gin.H{"type": "resumed"})
					}
				}
				continue
			}
			if msgType != websocket.BinaryMessage || paused.Load() {
				continue
			}
			if len(payload) == 0 {
				_ = clientConn.WriteJSON(gin.H{"type": "error", "error": "invalid_audio_payload"})
				continue
			}
			lastAudioAt.Store(time.Now().UnixNano())
			atomic.AddInt64(&audioChunks, 1)
			atomic.AddInt64(&audioBytes, int64(len(payload)))
			if sendErr := liveSession.SendRealtimeInput(genai.LiveRealtimeInput{
				Audio: &genai.Blob{
					Data:     payload,
					MIMEType: "audio/pcm;rate=16000",
				},
			}); sendErr != nil {
				errCh <- fmt.Errorf("google_send: %w", sendErr)
				return
			}
		}
	}()

	go func() {
		defer closeBoth()
		for {
			msg, recvErr := liveSession.Receive()
			if recvErr != nil {
				errCh <- fmt.Errorf("google_receive: %w", recvErr)
				return
			}
			atomic.AddInt64(&googleMessages, 1)
			hadInput, hadOutput, audioBytesWritten, writeErr := forwardLiveServerMessage(clientConn, msg)
			if hadInput {
				atomic.AddInt64(&inputTranscripts, 1)
			}
			if hadOutput {
				atomic.AddInt64(&outputTranscripts, 1)
			}
			if audioBytesWritten > 0 {
				atomic.AddInt64(&outputAudioChunks, 1)
				atomic.AddInt64(&outputAudioBytes, int64(audioBytesWritten))
			}
			if writeErr != nil {
				errCh <- fmt.Errorf("client_write: %w", writeErr)
				return
			}
		}
	}()

	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				errCh <- ctx.Err()
				return
			case <-ticker.C:
				if paused.Load() {
					continue
				}
				last := time.Unix(0, lastAudioAt.Load())
				if time.Since(last) > liveTranslateIdleTimeout {
					errCh <- fmt.Errorf("idle_timeout_after_%s", liveTranslateIdleTimeout)
					return
				}
			}
		}
	}()

	err = <-errCh
	log.Printf("live_translate session closing user_id=%v target=%s err=%v", auth.UserID, targetLanguage, sanitizeLiveError(err))
	closeBoth()
}

func (h *LiveTranslateHandler) newLiveGenAIClient(ctx context.Context) (*genai.Client, error) {
	clientConfig := &genai.ClientConfig{
		APIKey:  strings.TrimSpace(h.cfg.GeminiKey),
		Backend: genai.BackendGeminiAPI,
		HTTPOptions: genai.HTTPOptions{
			APIVersion: "v1beta",
		},
	}
	if strings.TrimSpace(h.cfg.GeminiBaseURL) != "" {
		clientConfig.HTTPOptions.BaseURL = strings.TrimRight(h.cfg.GeminiBaseURL, "/") + "/"
	}
	return genai.NewClient(ctx, clientConfig)
}

func forwardLiveServerMessage(clientConn *websocket.Conn, msg *genai.LiveServerMessage) (bool, bool, int, error) {
	if msg == nil {
		return false, false, 0, nil
	}
	if msg.SetupComplete != nil {
		return false, false, 0, clientConn.WriteJSON(gin.H{"type": "setup_complete", "session_id": msg.SetupComplete.SessionID})
	}
	if msg.GoAway != nil {
		return false, false, 0, clientConn.WriteJSON(gin.H{"type": "go_away", "time_left_ms": msg.GoAway.TimeLeft.Milliseconds()})
	}
	if msg.ServerContent == nil {
		return false, false, 0, clientConn.WriteJSON(gin.H{"type": "server_message"})
	}

	content := msg.ServerContent
	hadInput := false
	hadOutput := false
	audioBytesWritten := 0
	if content.ModelTurn != nil {
		for _, part := range content.ModelTurn.Parts {
			if part == nil || part.InlineData == nil || len(part.InlineData.Data) == 0 {
				continue
			}
			if !strings.HasPrefix(strings.ToLower(part.InlineData.MIMEType), "audio/pcm") {
				continue
			}
			if err := clientConn.WriteMessage(websocket.BinaryMessage, part.InlineData.Data); err != nil {
				return hadInput, hadOutput, audioBytesWritten, err
			}
			audioBytesWritten += len(part.InlineData.Data)
		}
	}
	if content.InputTranscription != nil && strings.TrimSpace(content.InputTranscription.Text) != "" {
		hadInput = true
		if err := clientConn.WriteJSON(gin.H{
			"type":          "input_transcript",
			"text":          content.InputTranscription.Text,
			"finished":      content.InputTranscription.Finished,
			"language_code": content.InputTranscription.LanguageCode,
		}); err != nil {
			return hadInput, hadOutput, audioBytesWritten, err
		}
	}
	if content.OutputTranscription != nil && strings.TrimSpace(content.OutputTranscription.Text) != "" {
		hadOutput = true
		if err := clientConn.WriteJSON(gin.H{
			"type":          "output_transcript",
			"text":          content.OutputTranscription.Text,
			"finished":      content.OutputTranscription.Finished,
			"language_code": content.OutputTranscription.LanguageCode,
		}); err != nil {
			return hadInput, hadOutput, audioBytesWritten, err
		}
	}
	if content.TurnComplete || content.GenerationComplete || content.WaitingForInput || content.Interrupted {
		return hadInput, hadOutput, audioBytesWritten, clientConn.WriteJSON(gin.H{
			"type":                "server_state",
			"turn_complete":       content.TurnComplete,
			"generation_complete": content.GenerationComplete,
			"waiting_for_input":   content.WaitingForInput,
			"interrupted":         content.Interrupted,
		})
	}
	return hadInput, hadOutput, audioBytesWritten, nil
}

func (h *LiveTranslateHandler) consumeTicket(rawTicket string) (*liveTranslateTicket, bool) {
	ticket := strings.TrimSpace(rawTicket)
	if ticket == "" {
		return nil, false
	}
	now := time.Now()
	h.mu.Lock()
	defer h.mu.Unlock()
	h.sweepExpiredTicketsLocked(now)
	auth, ok := h.tickets[ticket]
	if !ok || auth == nil || auth.Used || now.After(auth.ExpiresAt) {
		delete(h.tickets, ticket)
		return nil, false
	}
	auth.Used = true
	delete(h.tickets, ticket)
	return auth, true
}

func (h *LiveTranslateHandler) tryStartUserSession(userID uint) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, exists := h.activeByUser[userID]; exists {
		return false
	}
	h.activeByUser[userID] = time.Now()
	return true
}

func (h *LiveTranslateHandler) endUserSession(userID uint) {
	h.mu.Lock()
	delete(h.activeByUser, userID)
	h.mu.Unlock()
}

func (h *LiveTranslateHandler) sweepExpiredTicketsLocked(now time.Time) {
	if !h.lastTicketSweep.IsZero() && now.Sub(h.lastTicketSweep) < time.Minute {
		return
	}
	h.lastTicketSweep = now
	for ticket, auth := range h.tickets {
		if auth == nil || auth.Used || now.After(auth.ExpiresAt) {
			delete(h.tickets, ticket)
		}
	}
}

func getUintContext(c *gin.Context, key string) (uint, bool) {
	value, ok := c.Get(key)
	if !ok || value == nil {
		return 0, false
	}
	switch v := value.(type) {
	case uint:
		return v, true
	case int:
		if v <= 0 {
			return 0, false
		}
		return uint(v), true
	case float64:
		if v <= 0 {
			return 0, false
		}
		return uint(v), true
	default:
		return 0, false
	}
}

func newLiveTranslateTicketToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func normalizeLiveTargetLanguage(language string) string {
	normalized := strings.TrimSpace(language)
	if normalized == "" {
		return "en"
	}
	switch strings.ToLower(normalized) {
	case "zh", "zh-cn", "zh_hans", "zh-hans":
		return "zh-CN"
	case "zh-tw", "zh_hant", "zh-hant":
		return "zh-TW"
	case "fil":
		return "tl"
	case "auto":
		return "en"
	default:
		return normalized
	}
}

func sanitizeLiveError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if strings.TrimSpace(message) == "" || errors.Is(err, context.Canceled) {
		return "context canceled"
	}
	return redactCredentialLikeText(message)
}

func redactCredentialLikeText(message string) string {
	parts := []string{"key=", "api_key=", "token=", "access_token=", "ticket="}
	redacted := message
	for _, part := range parts {
		idx := strings.Index(strings.ToLower(redacted), strings.ToLower(part))
		for idx >= 0 {
			start := idx + len(part)
			end := start
			for end < len(redacted) {
				ch := redacted[end]
				if ch == '&' || ch == ' ' || ch == '\n' || ch == '\r' || ch == '\t' || ch == '"' || ch == '\'' {
					break
				}
				end++
			}
			redacted = redacted[:start] + "[REDACTED]" + redacted[end:]
			nextStart := start + len("[REDACTED]")
			if nextStart >= len(redacted) {
				break
			}
			next := strings.Index(strings.ToLower(redacted[nextStart:]), strings.ToLower(part))
			if next < 0 {
				break
			}
			idx = nextStart + next
		}
	}
	return redacted
}
