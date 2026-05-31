package api

import (
	"io"
	"net/http"
	"strconv"
	"strings"

	"aipool-backend/internal/modelmeta"
	"aipool-backend/internal/services"
	"aipool-backend/pkg/publicid"

	"github.com/gin-gonic/gin"
)

const maxFileSize = 20 * 1024 * 1024       // 20MB
const maxVideoFileSize = 200 * 1024 * 1024 // 200MB

type FileHandler struct {
	fileService *services.FileService
}

func NewFileHandler(fileService *services.FileService) *FileHandler {
	return &FileHandler{fileService: fileService}
}

type UploadResponse struct {
	PublicID       string `json:"public_id"`
	Filename       string `json:"filename"`
	Type           string `json:"type"`
	ContentPreview string `json:"content_preview"`
	Size           int64  `json:"size"`
	ParseStatus    string `json:"parse_status"`
	MimeType       string `json:"mime_type"`
}

func (h *FileHandler) UploadFile(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)

	// 匿名用户必须提供 guestID
	if userID == 0 && guestID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "guest_id_required", "message": "匿名用户请先刷新页面以生成 visitor ID"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无法读取文件"})
		return
	}
	defer file.Close()

	if _, ok := modelmeta.FileTypeByExtension(header.Filename); !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "暂不支持该文件格式"})
		return
	}

	// 限制文件大小：普通文件 20MB，参考视频放宽到 200MB。
	// 部分浏览器/系统拖拽 MP4 时 Content-Type 可能是 application/octet-stream 或为空，
	// 所以不能只依赖 MIME，必须同时按扩展名识别视频参考素材。
	limit := int64(maxFileSize)
	limitLabel := "20MB"
	fileMeta, _ := modelmeta.FileTypeByExtension(header.Filename)
	if strings.HasPrefix(header.Header.Get("Content-Type"), "video/") || fileMeta.InputType == "video" {
		limit = maxVideoFileSize
		limitLabel = "200MB"
	}
	if header.Size > limit {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文件大小不能超过 " + limitLabel})
		return
	}

	data, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件失败"})
		return
	}

	// 支持从 form 中读取 workspace_id
	workspaceIDStr := c.Request.FormValue("workspace_id")
	var workspaceID uint
	if workspaceIDStr != "" {
		wid, err := strconv.ParseUint(workspaceIDStr, 10, 32)
		if err == nil {
			workspaceID = uint(wid)
		}
	}

	f, err := h.fileService.UploadAndParse(c.Request.Context(), userID, guestID, header.Filename, data, workspaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件处理失败: " + err.Error()})
		return
	}

	// 构建 content preview（前 500 字）
	preview := f.Content
	if len(preview) > 500 {
		preview = preview[:500] + "..."
	}

	c.JSON(http.StatusOK, UploadResponse{
		PublicID:       f.PublicID,
		Filename:       f.Filename,
		Type:           inferFileType(header.Filename),
		ContentPreview: preview,
		Size:           f.Size,
		ParseStatus:    f.ParseStatus,
		MimeType:       f.MimeType,
	})
}

func (h *FileHandler) ListFiles(c *gin.Context) {
	userID := getUserID(c)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
		return
	}

	// 支持 workspace_id 过滤
	workspaceIDStr := c.Query("workspace_id")
	var workspaceID uint
	if workspaceIDStr != "" {
		wid, err := strconv.ParseUint(workspaceIDStr, 10, 32)
		if err == nil {
			workspaceID = uint(wid)
		}
	}

	files, err := h.fileService.ListUserFiles(userID, workspaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取文件列表失败"})
		return
	}

	c.JSON(http.StatusOK, files)
}

func (h *FileHandler) DeleteFile(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)
	publicID := c.Param("id")
	if publicID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的文件 ID"})
		return
	}

	// 先验证文件权限
	if _, err := h.fileService.ResolveFileByPublicID(publicID, userID, guestID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在或无权访问"})
		return
	}

	if err := h.fileService.DeleteFileByPublicID(publicID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除文件失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *FileHandler) GetFile(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)
	publicID := c.Param("id")

	file, err := h.fileService.ResolveFileByPublicID(publicID, userID, guestID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在或无权访问"})
		return
	}

	c.JSON(http.StatusOK, file)
}

func (h *FileHandler) DownloadFile(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)
	publicID := c.Param("id")

	file, err := h.fileService.ResolveFileByPublicID(publicID, userID, guestID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在或无权访问"})
		return
	}

	c.FileAttachment(file.StoragePath, file.Filename)
}

// ViewFile 公开查看文件（内联展示，不强制下载）
// 基于 public_id 的不可枚举性提供安全保护，不做用户权限校验
func (h *FileHandler) ViewFile(c *gin.Context) {
	publicID := c.Param("id")
	if !publicid.IsFileID(publicID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的文件 ID"})
		return
	}

	file, err := h.fileService.GetByPublicID(publicID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在"})
		return
	}

	c.File(file.StoragePath)
}
func inferFileType(filename string) string {
	ext := ""
	for i := len(filename) - 1; i >= 0; i-- {
		if filename[i] == '.' {
			ext = filename[i:]
			break
		}
	}
	switch ext {
	case ".txt", ".md", ".json", ".csv", ".js", ".ts", ".go", ".py", ".java",
		".cpp", ".c", ".h", ".hpp", ".rs", ".html", ".css", ".xml", ".yaml",
		".yml", ".log", ".sql", ".sh", ".bash", ".tsx", ".jsx", ".vue", ".php",
		".rb", ".swift", ".kt", ".scala", ".r", ".matlab", ".tex":
		return "text"
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp":
		return "image"
	case ".mp4", ".mov":
		return "video"
	case ".pdf":
		return "pdf"
	case ".docx":
		return "docx"
	case ".pptx":
		return "pptx"
	case ".xlsx":
		return "xlsx"
	default:
		return "text"
	}
}
