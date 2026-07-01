package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"aipool-backend/internal/config"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const chatBootstrapScriptID = "__AI_SPACE_BOOTSTRAP__"

type ChatShellHandler struct {
	bootstrap *ChatBootstrapHandler
	outDir    string
}

func NewChatShellHandler(db *gorm.DB, cfg *config.Config) *ChatShellHandler {
	outDir := strings.TrimSpace(os.Getenv("CHAT_SHELL_OUT_DIR"))
	if outDir == "" {
		outDir = filepath.Clean(filepath.Join("..", "frontend", "out"))
	}
	return &ChatShellHandler{bootstrap: NewChatBootstrapHandler(db, cfg), outDir: outDir}
}

func (h *ChatShellHandler) ServeChat(c *gin.Context) {
	h.serve(c, filepath.Join(h.outDir, "chat", "index.html"))
}

func (h *ChatShellHandler) ServeSkillChat(c *gin.Context) {
	h.serve(c, filepath.Join(h.outDir, "skills", "chat", "index.html"))
}

func (h *ChatShellHandler) serve(c *gin.Context, indexPath string) {
	indexHTML, err := os.ReadFile(indexPath)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "chat shell unavailable", "path": indexPath})
		return
	}
	payload, _, ok := h.bootstrap.BuildPayload(c)
	if !ok || payload == nil {
		payload = gin.H{"auth_status": "unknown", "http_status": http.StatusInternalServerError, "error": "bootstrap unavailable"}
	}
	injected, err := injectChatBootstrapPayload(indexHTML, payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "chat shell inject failed"})
		return
	}
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Header("Cache-Control", "no-store, no-cache, must-revalidate")
	c.Header("Pragma", "no-cache")
	c.Header("X-AI-Space-Dynamic-Shell", "chat-bootstrap")
	c.String(http.StatusOK, string(injected))
}

func injectChatBootstrapPayload(indexHTML []byte, payload gin.H) ([]byte, error) {
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	jsonBytes = bytes.ReplaceAll(jsonBytes, []byte("</"), []byte("<\\/"))
	jsonBytes = bytes.ReplaceAll(jsonBytes, []byte("<!--"), []byte("<\\!--"))
	script := []byte(`<script id="` + chatBootstrapScriptID + `" type="application/json">` + string(jsonBytes) + `</script>`)
	if bytes.Contains(indexHTML, []byte(`id="`+chatBootstrapScriptID+`"`)) || bytes.Contains(indexHTML, []byte(`id='`+chatBootstrapScriptID+`'`)) {
		return indexHTML, nil
	}
	if idx := bytes.Index(indexHTML, []byte("</head>")); idx >= 0 {
		out := make([]byte, 0, len(indexHTML)+len(script)+1)
		out = append(out, indexHTML[:idx]...)
		out = append(out, script...)
		out = append(out, '\n')
		out = append(out, indexHTML[idx:]...)
		return out, nil
	}
	out := make([]byte, 0, len(script)+1+len(indexHTML))
	out = append(out, script...)
	out = append(out, '\n')
	out = append(out, indexHTML...)
	return out, nil
}
