package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

func ServeVideoFile(c *gin.Context) {
	filename := c.Param("filename")
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") || filename == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "非法文件名"})
		return
	}
	path := filepath.Join(videoAssetsDir(), filename)
	if _, err := os.Stat(path); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "视频文件不存在"})
		return
	}
	c.File(path)
}
