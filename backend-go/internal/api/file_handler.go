package api

import (
	"net/http"

	"aipool-backend/internal/services"

	"github.com/gin-gonic/gin"
)

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
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无法读取文件"})
		return
	}
	defer file.Close()

	// 暂不限制文件大小（后续如需恢复，取消下面注释即可）
	// const maxSize = 10 * 1024 * 1024
	// if header.Size > maxSize {
	// 	c.JSON(http.StatusBadRequest, gin.H{"error": "文件大小不能超过 10MB"})
	// 	return
	// }

	data := make([]byte, header.Size)
	_, err = file.Read(data)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件失败"})
		return
	}

	userID := getUserID(c)
	if userID == 0 {
		// 未登录用户也允许上传，使用 0 作为 userID
		userID = 0
	}

	f, err := h.fileService.UploadAndParse(c.Request.Context(), userID, header.Filename, data)
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

	files, err := h.fileService.ListUserFiles(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取文件列表失败"})
		return
	}

	c.JSON(http.StatusOK, files)
}

func (h *FileHandler) DeleteFile(c *gin.Context) {
	publicID := c.Param("id")
	if publicID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的文件 ID"})
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
	publicID := c.Param("id")

	file, err := h.fileService.ResolveFileByPublicID(publicID, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在或无权访问"})
		return
	}

	c.JSON(http.StatusOK, file)
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
