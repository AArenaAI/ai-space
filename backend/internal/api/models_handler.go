package api

import (
	"net/http"

	"aipool-backend/internal/modelmeta"

	"github.com/gin-gonic/gin"
)

func GetModelsHandler(c *gin.Context) {
	c.JSON(http.StatusOK, modelmeta.AllModels())
}

func GetChatModelsHandler(c *gin.Context) {
	c.JSON(http.StatusOK, modelmeta.ChatModels())
}

func GetImageModelsHandler(c *gin.Context) {
	c.JSON(http.StatusOK, modelmeta.ImageModels())
}
