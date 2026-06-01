package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ImageHandler struct {
	db           *gorm.DB
	imageService *services.ImageService
	aiService    *services.AIService
	cfg          *config.Config
	usageService *services.UsageService
}

func NewImageHandler(db *gorm.DB, imageService *services.ImageService, aiService *services.AIService, cfg *config.Config, usageService *services.UsageService) *ImageHandler {
	return &ImageHandler{
		db:           db,
		imageService: imageService,
		aiService:    aiService,
		cfg:          cfg,
		usageService: usageService,
	}
}

// 图片生成请求
type GenerateImageRequest struct {
	Prompt             string   `json:"prompt" binding:"required"`
	Size               string   `json:"size"`                 // 兼容旧前端：直接传像素尺寸
	AspectRatio        string   `json:"aspect_ratio"`         // 纵横比：auto, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
	Resolution         string   `json:"resolution"`           // 分辨率：1K, 2K
	Quality            string   `json:"quality"`              // 质量：low, medium, high, auto（默认 medium）
	ReferenceImageURL  string   `json:"reference_image_url"`  // 兼容旧前端：单张参考图
	ReferenceImageURLs []string `json:"reference_image_urls"` // 新前端：多张参考图
}

// roundTo16 将整数四舍五入到最接近的 16 的倍数（gpt-image-2 要求每边像素必须是 16 的倍数）
func roundTo16(v int) int {
	return ((v + 8) / 16) * 16
}

// resolveSize 将 aspect_ratio + resolution 映射为像素尺寸字符串
// 各分辨率 1:1 基准：1K=1024, 2K=2048, 4K=3840
// gpt-image-2 支持 auto 尺寸，auto 直接传 "auto"
func resolveSize(req GenerateImageRequest) string {
	// 如果直接传了 size，优先使用
	if req.Size != "" {
		return req.Size
	}

	// Auto 模式直接传 auto 让模型自动决定
	if req.AspectRatio == "auto" {
		return "auto"
	}

	switch req.Resolution {
	case "2K":
		switch req.AspectRatio {
		case "1:1":
			return "2048x2048"
		case "2:3":
			return "1360x2048"
		case "3:2":
			return "2048x1360"
		case "3:4":
			return "1536x2048"
		case "4:3":
			return "2048x1536"
		case "4:5":
			return "1632x2048"
		case "5:4":
			return "2048x1632"
		case "9:16":
			return "1152x2048"
		case "16:9":
			return "2048x1152"
		case "21:9":
			return "2048x880"
		default:
			return "2048x2048"
		}
	case "4K":
		switch req.AspectRatio {
		case "1:1":
			return "3840x3840"
		case "2:3":
			return "2560x3840"
		case "3:2":
			return "3840x2560"
		case "3:4":
			return "2880x3840"
		case "4:3":
			return "3840x2880"
		case "4:5":
			return "3072x3840"
		case "5:4":
			return "3840x3072"
		case "9:16":
			return "2160x3840"
		case "16:9":
			return "3840x2160"
		case "21:9":
			return "3840x1648"
		default:
			return "3840x3840"
		}
	default: // 1K
		switch req.AspectRatio {
		case "1:1":
			return "1024x1024"
		case "2:3":
			return "688x1024"
		case "3:2":
			return "1024x688"
		case "3:4":
			return "768x1024"
		case "4:3":
			return "1024x768"
		case "4:5":
			return "816x1024"
		case "5:4":
			return "1024x816"
		case "9:16":
			return "576x1024"
		case "16:9":
			return "1024x576"
		case "21:9":
			return "1024x432"
		default:
			return "1024x1024"
		}
	}
}

// generateFileName 生成随机文件名
func generateFileName() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b) + ".png"
}

// resolveBaseURL 从请求中推断 base URL（用于 goroutine 中构建图片访问链接）
func resolveBaseURL(c *gin.Context, cfg *config.Config) string {
	if cfg.BaseURL != "" {
		return strings.TrimSuffix(cfg.BaseURL, "/")
	}
	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	}
	if proto := c.GetHeader("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	}
	host := c.GetHeader("X-Forwarded-Host")
	if host == "" {
		host = c.Request.Host
	}
	return scheme + "://" + host
}

// buildImageURL 构造图片访问 URL（使用相对路径，前端自动补全 origin）
func buildImageURL(baseURL, filename string) string {
	return "/api/images/file/" + filename
}

func detectImageSize(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	cfg, _, err := image.DecodeConfig(file)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%dx%d", cfg.Width, cfg.Height), nil
}

func fitImageEditRequestSize(size image.Point) string {
	if size.X <= 0 || size.Y <= 0 {
		return "1024x1024"
	}

	// OpenAI image edit models only accept a small set of output sizes. Do not
	// pass arbitrary source dimensions such as 4032x3024; the edited result is
	// resized back to the original dimensions after generation.
	aspect := float64(size.X) / float64(size.Y)
	if aspect >= 1.2 {
		return "1536x1024"
	}
	if aspect <= 0.85 {
		return "1024x1536"
	}
	return "1024x1024"
}

type editCanvasTransform struct {
	Original image.Point
	Canvas   image.Point
	Content  image.Rectangle
}

func parseImageSize(size string) (image.Point, bool) {
	var w, h int
	if _, err := fmt.Sscanf(strings.TrimSpace(size), "%dx%d", &w, &h); err != nil || w <= 0 || h <= 0 {
		return image.Point{}, false
	}
	return image.Point{X: w, Y: h}, true
}

func containRect(src, dst image.Point) image.Rectangle {
	if src.X <= 0 || src.Y <= 0 || dst.X <= 0 || dst.Y <= 0 {
		return image.Rect(0, 0, dst.X, dst.Y)
	}
	scaleX := float64(dst.X) / float64(src.X)
	scaleY := float64(dst.Y) / float64(src.Y)
	scale := scaleX
	if scaleY < scale {
		scale = scaleY
	}
	w := int(float64(src.X)*scale + 0.5)
	h := int(float64(src.Y)*scale + 0.5)
	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}
	if w > dst.X {
		w = dst.X
	}
	if h > dst.Y {
		h = dst.Y
	}
	x := (dst.X - w) / 2
	y := (dst.Y - h) / 2
	return image.Rect(x, y, x+w, y+h)
}

func scaleImageNearest(dst *image.RGBA, dstRect image.Rectangle, src image.Image, srcRect image.Rectangle) {
	if dstRect.Empty() || srcRect.Empty() {
		return
	}
	for y := dstRect.Min.Y; y < dstRect.Max.Y; y++ {
		sy := srcRect.Min.Y + (y-dstRect.Min.Y)*srcRect.Dy()/dstRect.Dy()
		if sy >= srcRect.Max.Y {
			sy = srcRect.Max.Y - 1
		}
		for x := dstRect.Min.X; x < dstRect.Max.X; x++ {
			sx := srcRect.Min.X + (x-dstRect.Min.X)*srcRect.Dx()/dstRect.Dx()
			if sx >= srcRect.Max.X {
				sx = srcRect.Max.X - 1
			}
			dst.Set(x, y, src.At(sx, sy))
		}
	}
}

func prepareImageEditCanvas(sourcePath, requestSize string, original image.Point) (string, editCanvasTransform, func(), error) {
	canvas, ok := parseImageSize(requestSize)
	if !ok || original.X <= 0 || original.Y <= 0 || (canvas.X == original.X && canvas.Y == original.Y) {
		return sourcePath, editCanvasTransform{Original: original, Canvas: original, Content: image.Rect(0, 0, original.X, original.Y)}, func() {}, nil
	}
	file, err := os.Open(sourcePath)
	if err != nil {
		return "", editCanvasTransform{}, nil, fmt.Errorf("打开源图失败: %w", err)
	}
	defer file.Close()
	src, _, err := image.Decode(file)
	if err != nil {
		return "", editCanvasTransform{}, nil, fmt.Errorf("解码源图失败: %w", err)
	}
	content := containRect(original, canvas)
	dst := image.NewRGBA(image.Rect(0, 0, canvas.X, canvas.Y))
	scaleImageNearest(dst, content, src, src.Bounds())
	tmp, err := os.CreateTemp("", "aipool-edit-canvas-*.png")
	if err != nil {
		return "", editCanvasTransform{}, nil, fmt.Errorf("创建临时编辑画布失败: %w", err)
	}
	if err := png.Encode(tmp, dst); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
		return "", editCanvasTransform{}, nil, fmt.Errorf("编码临时编辑画布失败: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmp.Name())
		return "", editCanvasTransform{}, nil, fmt.Errorf("写入临时编辑画布失败: %w", err)
	}
	cleanup := func() { _ = os.Remove(tmp.Name()) }
	return tmp.Name(), editCanvasTransform{Original: original, Canvas: canvas, Content: content}, cleanup, nil
}

// saveBase64Image 将 base64 数据保存为本地图片文件，返回文件名
func saveBase64Image(b64Data string) (string, error) {
	if err := os.MkdirAll(imageAssetsDir(), 0755); err != nil {
		return "", fmt.Errorf("创建图片目录失败: %w", err)
	}
	filename := generateFileName()
	path := filepath.Join(imageAssetsDir(), filename)
	data, err := base64.StdEncoding.DecodeString(b64Data)
	if err != nil {
		return "", fmt.Errorf("base64 解码失败: %w", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		return "", fmt.Errorf("写入图片文件失败: %w", err)
	}
	return filename, nil
}

func saveBase64ImageWithTargetSize(b64Data string, target image.Point) (string, error) {
	return saveBase64ImageWithTransform(b64Data, target, editCanvasTransform{})
}

func saveBase64ImageWithTransform(b64Data string, target image.Point, transform editCanvasTransform) (string, error) {
	if target.X <= 0 || target.Y <= 0 {
		return saveBase64Image(b64Data)
	}
	if err := os.MkdirAll(imageAssetsDir(), 0755); err != nil {
		return "", fmt.Errorf("创建图片目录失败: %w", err)
	}
	data, err := base64.StdEncoding.DecodeString(b64Data)
	if err != nil {
		return "", fmt.Errorf("base64 解码失败: %w", err)
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("解码图片失败: %w", err)
	}
	srcBounds := src.Bounds()
	if transform.Original.X == target.X && transform.Original.Y == target.Y && transform.Canvas.X > 0 && transform.Canvas.Y > 0 && !transform.Content.Empty() {
		canvasBounds := image.Rect(0, 0, transform.Canvas.X, transform.Canvas.Y)
		if srcBounds.Dx() != transform.Canvas.X || srcBounds.Dy() != transform.Canvas.Y {
			resizedCanvas := image.NewRGBA(canvasBounds)
			scaleImageNearest(resizedCanvas, canvasBounds, src, srcBounds)
			src = resizedCanvas
			srcBounds = resizedCanvas.Bounds()
		}
		content := transform.Content.Intersect(srcBounds)
		if !content.Empty() {
			dst := image.NewRGBA(image.Rect(0, 0, target.X, target.Y))
			scaleImageNearest(dst, dst.Bounds(), src, content)
			return writePNGImage(dst)
		}
	}
	if srcBounds.Dx() == target.X && srcBounds.Dy() == target.Y {
		filename := generateFileName()
		path := filepath.Join(imageAssetsDir(), filename)
		if err := os.WriteFile(path, data, 0644); err != nil {
			return "", fmt.Errorf("写入图片文件失败: %w", err)
		}
		return filename, nil
	}
	dst := image.NewRGBA(image.Rect(0, 0, target.X, target.Y))
	scaleImageNearest(dst, dst.Bounds(), src, srcBounds)
	return writePNGImage(dst)
}

func writePNGImage(img image.Image) (string, error) {
	filename := generateFileName()
	path := filepath.Join(imageAssetsDir(), filename)
	out, err := os.Create(path)
	if err != nil {
		return "", fmt.Errorf("创建图片文件失败: %w", err)
	}
	defer out.Close()
	if err := png.Encode(out, img); err != nil {
		return "", fmt.Errorf("编码图片失败: %w", err)
	}
	return filename, nil
}

// EditImageRequest 图片编辑请求

type RecognizeMaskRequest struct {
	ImageURL    string `json:"image_url" binding:"required"`
	MaskData    string `json:"mask_data"`
	OverlayData string `json:"overlay_data" binding:"required"`
	EditMode    string `json:"edit_mode"`
}

type RecognizeMaskResponse struct {
	Label           string         `json:"label"`
	Description     string         `json:"description"`
	Confidence      float64        `json:"confidence"`
	ObjectBox       map[string]int `json:"object_box,omitempty"`
	RefinedMaskData string         `json:"refined_mask_data,omitempty"`
	Bounds          map[string]int `json:"bounds,omitempty"`
	Coverage        float64        `json:"coverage,omitempty"`
}

func extractFirstJSONObject(text string) string {
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "```") {
		text = strings.TrimPrefix(text, "```json")
		text = strings.TrimPrefix(text, "```")
		text = strings.TrimSuffix(text, "```")
		text = strings.TrimSpace(text)
	}
	if strings.HasPrefix(text, "{") && strings.HasSuffix(text, "}") {
		return text
	}
	re := regexp.MustCompile(`(?s)\{.*\}`)
	return re.FindString(text)
}

func sanitizeObjectBox(box map[string]int) map[string]int {
	if len(box) == 0 {
		return nil
	}
	x, okX := box["x"]
	y, okY := box["y"]
	w, okW := box["width"]
	h, okH := box["height"]
	if !okX || !okY || !okW || !okH || w <= 4 || h <= 4 {
		return nil
	}
	if x < 0 {
		x = 0
	}
	if y < 0 {
		y = 0
	}
	return map[string]int{"x": x, "y": y, "width": w, "height": h}
}

func (h *ImageHandler) resolveUploadedImagePath(publicID string) (string, error) {
	publicID = strings.TrimSpace(publicID)
	publicID = strings.TrimPrefix(publicID, "/api/files/")
	publicID = strings.TrimSuffix(publicID, "/view")
	publicID = strings.TrimSuffix(publicID, "/download")
	var file models.File
	if err := h.db.Where("public_id = ?", publicID).First(&file).Error; err != nil {
		return "", err
	}
	if file.StoragePath == "" {
		return "", fmt.Errorf("文件路径为空")
	}
	return file.StoragePath, nil
}

func (h *ImageHandler) refineMaskWithScript(imagePath, maskData string, objectBox map[string]int) (string, map[string]int, float64, error) {
	scriptCandidates := []string{
		"./scripts/refine_mask.py",
		"backend/scripts/refine_mask.py",
		"/home/ubuntu/workspace/ai-space/backend/scripts/refine_mask.py",
	}
	script := ""
	for _, cand := range scriptCandidates {
		if _, err := os.Stat(cand); err == nil {
			script = cand
			break
		}
	}
	if script == "" {
		return "", nil, 0, fmt.Errorf("分割脚本不存在")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	args := []string{script, "--image", imagePath, "--mask-data", maskData}
	if len(objectBox) > 0 {
		if bboxBytes, err := json.Marshal(objectBox); err == nil {
			args = append(args, "--object-bbox", string(bboxBytes))
		}
	}
	cmd := exec.CommandContext(ctx, "python3", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	outBytes, err := cmd.Output()
	if err != nil {
		return "", nil, 0, fmt.Errorf("分割脚本失败: %v %s", err, stderr.String())
	}
	var result struct {
		OK              bool           `json:"ok"`
		Error           string         `json:"error"`
		Detail          string         `json:"detail"`
		RefinedMaskData string         `json:"refined_mask_data"`
		Bounds          map[string]int `json:"bounds"`
		Coverage        float64        `json:"coverage"`
	}
	if err := json.Unmarshal(outBytes, &result); err != nil {
		return "", nil, 0, err
	}
	if !result.OK || result.RefinedMaskData == "" {
		if result.Detail != "" {
			return "", nil, 0, fmt.Errorf("%s: %s", result.Error, result.Detail)
		}
		return "", nil, 0, fmt.Errorf("%s", result.Error)
	}
	return result.RefinedMaskData, result.Bounds, result.Coverage, nil
}

func (h *ImageHandler) RecognizeMask(c *gin.Context) {
	var req RecognizeMaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误: " + err.Error()})
		return
	}
	if h.aiService == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "视觉识别服务未初始化"})
		return
	}
	overlay := strings.TrimSpace(req.OverlayData)
	if !strings.HasPrefix(overlay, "data:image/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "overlay_data 必须是图片 data URL"})
		return
	}
	refinedMaskData := ""
	var refinedBounds map[string]int
	refinedCoverage := 0.0
	fmt.Printf("[recognize-mask] request image_url=%q overlay=%d mask=%d\n", req.ImageURL, len(req.OverlayData), len(req.MaskData))

	model := h.cfg.VisionModel
	if model == "" {
		model = "gpt-5.4-mini"
	}
	prompt := `你是图像编辑工具里的物件识别器。用户用半透明紫色笔刷粗略涂抹了想处理的对象或区域。请识别紫色涂抹主要覆盖的“具体物件/主体”，不要只回答“涂抹区域”。

要求：
- 如果涂抹覆盖的是电脑，就返回 label="电脑"；覆盖的是人脸就返回 label="人脸"；覆盖的是衣服就返回 label="衣服"。
- 如果覆盖多个对象，选面积最大或最主要的那个。
- label 用简短中文名词，最多 6 个字。
- description 用一句中文说明你识别到的对象和位置。
- confidence 取 0 到 1。
- object_box 返回该物体尽量贴边的矩形框，坐标以输入 overlay 图片左上角为原点，单位像素，格式 {"x":整数,"y":整数,"width":整数,"height":整数}。只框住这个具体物体，不要把阴影、地面、背景植物框进去。
只输出 JSON，不要 Markdown：{"label":"电脑","description":"紫色涂抹主要覆盖桌面上的电脑","confidence":0.86,"object_box":{"x":120,"y":80,"width":320,"height":220}}`
	resp, err := h.aiService.ChatCompletion(c.Request.Context(), model, []services.Message{
		{Role: "system", Content: "你只输出合法 JSON。"},
		{Role: "user", Content: prompt, Images: []string{overlay}},
	}, false, false, services.ReasoningEffortLow, false, nil)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "物件识别失败: " + err.Error()})
		return
	}
	content := ""
	if resp != nil && resp.Body != nil {
		bodyBytes, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if readErr == nil {
			var raw map[string]any
			if json.Unmarshal(bodyBytes, &raw) == nil {
				content = services.ExtractOpenAIResponseText(raw)
				if content == "" {
					if choices, ok := raw["choices"].([]any); ok && len(choices) > 0 {
						if ch, ok := choices[0].(map[string]any); ok {
							if msg, ok := ch["message"].(map[string]any); ok {
								if c, ok := msg["content"].(string); ok {
									content = c
								}
							}
						}
					}
				}
			}
			if content == "" {
				content = string(bodyBytes)
			}
		}
	}
	jsonText := extractFirstJSONObject(content)
	var out RecognizeMaskResponse
	if jsonText == "" || json.Unmarshal([]byte(jsonText), &out) != nil {
		out = RecognizeMaskResponse{Label: "选中物件", Description: "已识别紫色涂抹覆盖的物件", Confidence: 0.5}
	}
	out.Label = strings.TrimSpace(out.Label)
	out.Description = strings.TrimSpace(out.Description)
	if out.Label == "" {
		out.Label = "选中物件"
	}
	if out.Description == "" {
		out.Description = "已识别紫色涂抹覆盖的物件"
	}
	if out.Confidence < 0 || out.Confidence > 1 {
		out.Confidence = 0.5
	}
	objectBox := sanitizeObjectBox(out.ObjectBox)
	out.ObjectBox = objectBox
	if strings.TrimSpace(req.MaskData) != "" {
		if imagePath, pathErr := h.resolveUploadedImagePath(req.ImageURL); pathErr == nil {
			fmt.Printf("[recognize-mask] resolved image path=%q object_box=%v\n", imagePath, objectBox)
			if maskData, bounds, coverage, refineErr := h.refineMaskWithScript(imagePath, req.MaskData, objectBox); refineErr == nil {
				refinedMaskData = maskData
				refinedBounds = bounds
				refinedCoverage = coverage
				fmt.Printf("[recognize-mask] refined ok bounds=%v coverage=%.2f mask_len=%d\n", bounds, coverage, len(maskData))
			} else {
				fmt.Printf("[recognize-mask] refine failed: %v\n", refineErr)
			}
		} else {
			fmt.Printf("[recognize-mask] image path resolve failed: %v\n", pathErr)
		}
	} else {
		fmt.Printf("[recognize-mask] empty mask_data\n")
	}
	out.RefinedMaskData = refinedMaskData
	out.Bounds = refinedBounds
	out.Coverage = refinedCoverage
	c.JSON(http.StatusOK, out)
}

type EditImageRequest struct {
	Prompt    string `json:"prompt"`                       // 编辑 prompt（替换背景、文字移除时需要）
	Size      string `json:"size"`                         // 尺寸（可选）
	ImageURL  string `json:"image_url"`                    // 源图 URL（可选，和 image_data 二选一）
	ImageData string `json:"image_data"`                   // 源图 base64 数据（可选，和 image_url 二选一）
	MaskURL   string `json:"mask_url"`                     // 蒙版 URL/public_id（局部重绘、区域涂抹）
	MaskData  string `json:"mask_data"`                    // 蒙版 base64 数据（局部重绘、区域涂抹）
	EditMode  string `json:"edit_mode" binding:"required"` // remove-bg / replace-bg / text-removal / upscale / inpaint / region-brush
}

// EditImage 编辑图片（背景移除 / 背景替换 / 文字移除 / 画质提升）
// 支持两种传图方式：
// 1. image_url — 已保存在 data/images/ 目录下的图片文件名（完整 URL）
// 2. image_data — base64 编码的图片数据
func (h *ImageHandler) EditImage(c *gin.Context) {
	userID := getUserID(c)

	var req EditImageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 验证编辑模式
	validModes := map[string]bool{"remove-bg": true, "replace-bg": true, "text-removal": true, "upscale": true, "inpaint": true, "region-brush": true}
	if !validModes[req.EditMode] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "edit_mode 必须是 remove-bg、replace-bg、text-removal、upscale、inpaint 或 region-brush"})
		return
	}

	// 替换背景时必须提供 prompt
	if req.EditMode == "replace-bg" && req.Prompt == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "替换背景时必须提供 prompt 描述新背景"})
		return
	}
	// 文字移除时必须提供 prompt
	if req.EditMode == "text-removal" && req.Prompt == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文字移除时必须提供 prompt 描述要去除的文字"})
		return
	}
	if req.EditMode == "inpaint" && req.Prompt == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "局部重绘时必须提供 prompt 描述要重绘的内容"})
		return
	}
	if (req.EditMode == "inpaint" || req.EditMode == "region-brush") && req.MaskURL == "" && req.MaskData == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请先涂抹需要处理的区域"})
		return
	}

	// 至少需要提供 image_url 或 image_data
	if req.ImageURL == "" && req.ImageData == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "必须提供 image_url 或 image_data"})
		return
	}

	baseURL := resolveBaseURL(c, h.cfg)
	size := req.Size

	var imageFilePath string

	if req.ImageData != "" {
		// 方案 A: 从前端传来的 base64 数据直接保存为本地文件
		cleanData := req.ImageData
		// 处理可能包含的 data:image/xxx;base64, 前缀
		if idx := strings.Index(cleanData, "base64,"); idx != -1 {
			cleanData = cleanData[idx+7:]
		}
		// 去 whitespace
		cleanData = strings.TrimSpace(cleanData)

		var saveErr error
		imageFilePath, saveErr = saveBase64ToImages(cleanData)
		if saveErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存源图失败: " + saveErr.Error()})
			return
		}
	} else {
		// 方案 B: 支持两种方式：
		//   - public_id (以 file_ 开头)：从上传文件库查路径
		//   - URL/文件名：从 data/images/ 目录读取
		var filename string
		if strings.HasPrefix(req.ImageURL, "file_") {
			var file models.File
			if err := h.db.Where("public_id = ?", req.ImageURL).First(&file).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "图片不存在"})
				return
			}
			filename = filepath.Base(file.StoragePath)
		} else {
			parts := strings.Split(req.ImageURL, "/")
			if len(parts) == 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "无效的图片 URL"})
				return
			}
			filename = parts[len(parts)-1]
		}
		if strings.Contains(filename, "..") || strings.Contains(filename, "/") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "非法文件名"})
			return
		}

		imageFilePath = filepath.Join(imageAssetsDir(), filename)
		if _, statErr := os.Stat(imageFilePath); statErr != nil {
			// 如果 data/images/ 没有，去 uploads 目录找
			uploadDir := "./uploads"
			imageFilePath = filepath.Join(uploadDir, filename)
			if _, statErr2 := os.Stat(imageFilePath); statErr2 != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "图片文件不存在"})
				return
			}
		}
	}

	var maskFilePath string
	if req.MaskData != "" {
		cleanMaskData := req.MaskData
		if idx := strings.Index(cleanMaskData, "base64,"); idx != -1 {
			cleanMaskData = cleanMaskData[idx+7:]
		}
		cleanMaskData = strings.TrimSpace(cleanMaskData)
		var saveErr error
		maskFilePath, saveErr = saveBase64ToImages(cleanMaskData)
		if saveErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存蒙版失败: " + saveErr.Error()})
			return
		}
	} else if req.MaskURL != "" {
		var filename string
		if strings.HasPrefix(req.MaskURL, "file_") {
			var file models.File
			if err := h.db.Where("public_id = ?", req.MaskURL).First(&file).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "蒙版不存在"})
				return
			}
			filename = filepath.Base(file.StoragePath)
		} else {
			parts := strings.Split(req.MaskURL, "/")
			filename = parts[len(parts)-1]
		}
		if strings.Contains(filename, "..") || strings.Contains(filename, "/") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "非法蒙版文件名"})
			return
		}
		maskFilePath = filepath.Join(imageAssetsDir(), filename)
		if _, statErr := os.Stat(maskFilePath); statErr != nil {
			uploadDir := "./uploads"
			maskFilePath = filepath.Join(uploadDir, filename)
			if _, statErr2 := os.Stat(maskFilePath); statErr2 != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "蒙版文件不存在"})
				return
			}
		}
	}

	targetSize := image.Point{}
	if detectedSize, sizeErr := detectImageSize(imageFilePath); sizeErr == nil && detectedSize != "" {
		if parts := strings.Split(detectedSize, "x"); len(parts) == 2 {
			fmt.Sscanf(detectedSize, "%dx%d", &targetSize.X, &targetSize.Y)
		}
		if size == "" && (req.EditMode == "remove-bg" || req.EditMode == "inpaint" || req.EditMode == "region-brush") {
			size = fitImageEditRequestSize(targetSize)
			if size != detectedSize {
				fmt.Printf("[图片编辑] source_size=%s request_size=%s mode=%s\n", detectedSize, size, req.EditMode)
			}
		}
	} else if req.EditMode == "remove-bg" || req.EditMode == "inpaint" || req.EditMode == "region-brush" {
		fmt.Printf("[图片编辑] 读取源图尺寸失败 mode=%s path=%s err=%v\n", req.EditMode, imageFilePath, sizeErr)
	}
	if size == "" {
		size = "1024x1024"
	}

	providerImagePath := imageFilePath
	canvasTransform := editCanvasTransform{Original: targetSize, Canvas: targetSize, Content: image.Rect(0, 0, targetSize.X, targetSize.Y)}
	cleanupEditCanvas := func() {}
	if req.EditMode == "remove-bg" && targetSize.X > 0 && targetSize.Y > 0 {
		preparedPath, transform, cleanup, prepErr := prepareImageEditCanvas(imageFilePath, size, targetSize)
		if prepErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "准备原尺寸编辑画布失败: " + prepErr.Error()})
			return
		}
		providerImagePath = preparedPath
		canvasTransform = transform
		cleanupEditCanvas = cleanup
	}

	editPrompt := req.Prompt
	background := ""
	switch req.EditMode {
	case "remove-bg":
		editPrompt = "Remove the background. Keep only the main subject in the exact same position, size, and framing. Do NOT zoom in, crop, or recompose."
		background = "transparent"
	case "text-removal":
		editPrompt = req.Prompt + ". Remove these texts/watermarks from the image. Keep everything else intact."
	case "upscale":
		editPrompt = "Upscale and enhance this image to 4x resolution. Add more detail, sharpen edges, improve clarity while preserving the original style and content."
	case "inpaint":
		editPrompt = "STRICT LOCAL INPAINTING TASK. The provided mask marks the ONLY editable region: transparent pixels in the mask must be replaced, fully opaque pixels must remain unchanged. First remove the original object/content inside the transparent masked area, then replace that same masked area with: " + req.Prompt + ". Do not add the requested object anywhere outside the masked area. Do not keep the original masked object visible. Preserve every unmasked pixel, composition, lighting, perspective, and identity exactly."
	case "region-brush":
		if req.Prompt != "" {
			editPrompt = "Remove the object/content inside the transparent masked area and naturally fill the area using surrounding context. User note: " + req.Prompt + ". Do not add a new object unless explicitly required. Keep all unmasked pixels unchanged."
		} else {
			editPrompt = "Remove the object/content inside the transparent masked area. Fill the area naturally using surrounding context so the selected object disappears. Keep all unmasked pixels unchanged."
		}
	default:
		editPrompt = req.Prompt + ". Keep the subject the same, only change the background."
	}

	gen := &services.ImageGeneration{
		UserID:            userID,
		Prompt:            editPrompt,
		Size:              size,
		ReferenceImageURL: req.ImageURL,
		Status:            "pending",
	}
	switch req.EditMode {
	case "remove-bg":
		gen.Prompt = "[背景移除] " + req.ImageURL
	case "text-removal":
		gen.Prompt = "[文字移除] " + req.ImageURL
	case "upscale":
		gen.Prompt = "[画质提升] " + req.ImageURL
	case "inpaint":
		gen.Prompt = "[局部重绘] " + req.Prompt
	case "region-brush":
		if req.Prompt != "" {
			gen.Prompt = "[区域涂抹] " + req.Prompt
		} else {
			gen.Prompt = "[区域涂抹] " + req.ImageURL
		}
	}
	if err := h.db.Create(gen).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建编辑任务失败: " + err.Error()})
		return
	}

	// 图片编辑耗时可能超过前置代理/Cloudflare 允许的同步等待时间，必须异步处理，前端按 id 轮询状态。
	go func() {
		defer cleanupEditCanvas()
		h.processImageEditJob(gen.ID, editPrompt, size, "medium", []string{providerImagePath}, maskFilePath, baseURL, targetSize, canvasTransform, background)
	}()

	c.JSON(http.StatusOK, gin.H{
		"id":         gen.ID,
		"prompt":     gen.Prompt,
		"size":       gen.Size,
		"status":     gen.Status,
		"created_at": gen.CreatedAt,
	})
}

// saveBase64ToImages 将 base64 数据保存到 data/images/ 目录，返回完整文件路径
func saveBase64ToImages(b64Data string) (string, error) {
	if err := os.MkdirAll(imageAssetsDir(), 0755); err != nil {
		return "", fmt.Errorf("创建图片目录失败: %w", err)
	}
	filename := generateFileName()
	path := filepath.Join(imageAssetsDir(), filename)
	data, err := base64.StdEncoding.DecodeString(b64Data)
	if err != nil {
		return "", fmt.Errorf("base64 解码失败: %w", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		return "", fmt.Errorf("写入图片文件失败: %w", err)
	}
	return path, nil
}

// resolveReferenceImagePath 将参考图 URL 解析为本地文件路径
func (h *ImageHandler) resolveReferenceImagePath(url string) string {
	if url == "" {
		return ""
	}
	if strings.HasPrefix(url, "file_") {
		var file models.File
		if err := h.db.Where("public_id = ?", url).First(&file).Error; err == nil {
			return file.StoragePath
		}
		return ""
	}
	parts := strings.Split(url, "/")
	if len(parts) > 0 {
		filename := parts[len(parts)-1]
		if !strings.Contains(filename, "..") && !strings.Contains(filename, "/") {
			refPath := filepath.Join(imageAssetsDir(), filename)
			if _, statErr := os.Stat(refPath); statErr == nil {
				return refPath
			}
		}
	}
	return ""
}

// GenerateImage 异步生成图片
// 前端提交后立即返回 pending 状态，后端在 goroutine 中完成实际生成
func (h *ImageHandler) GenerateImage(c *gin.Context) {
	userID := getUserID(c)

	var req GenerateImageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	size := resolveSize(req)

	// 质量默认 medium
	quality := req.Quality
	if quality == "" {
		quality = "medium"
	}

	// 处理参考图：支持单张兼容和多张新格式
	var refImagePaths []string
	var refImageURL string

	if len(req.ReferenceImageURLs) > 0 {
		for _, url := range req.ReferenceImageURLs {
			if p := h.resolveReferenceImagePath(url); p != "" {
				refImagePaths = append(refImagePaths, p)
			}
		}
		refImageURL = strings.Join(req.ReferenceImageURLs, ",")
	} else if req.ReferenceImageURL != "" {
		if p := h.resolveReferenceImagePath(req.ReferenceImageURL); p != "" {
			refImagePaths = append(refImagePaths, p)
		}
		refImageURL = req.ReferenceImageURL
	}

	// 创建记录
	gen := &services.ImageGeneration{
		UserID:            userID,
		Prompt:            req.Prompt,
		Size:              size,
		Quality:           quality,
		ReferenceImageURL: refImageURL,
		Status:            "pending",
	}
	if err := h.db.Create(gen).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建记录失败: " + err.Error()})
		return
	}

	// 提前解析 baseURL，因为 goroutine 里 gin.Context 可能已经失效
	baseURL := resolveBaseURL(c, h.cfg)

	// 启动后台 goroutine 异步生成图片
	go h.processImageJob(gen.ID, req.Prompt, size, quality, refImagePaths, baseURL)

	// 立即返回，不等待实际生成
	c.JSON(http.StatusOK, gin.H{
		"id":         gen.ID,
		"prompt":     gen.Prompt,
		"size":       size,
		"status":     "pending",
		"created_at": gen.CreatedAt,
	})
}

// ListImages 获取图片列表
func (h *ImageHandler) ListImages(c *gin.Context) {
	userID := getUserID(c)

	var images []services.ImageGeneration
	h.db.Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&images)

	c.JSON(http.StatusOK, gin.H{"images": images})
}

// DeleteImage 删除图片
func (h *ImageHandler) DeleteImage(c *gin.Context) {
	userID := getUserID(c)
	imageID := c.Param("id")

	result := h.db.Where("id = ? AND user_id = ?", imageID, userID).Delete(&services.ImageGeneration{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "图片不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// GetImage 获取单个图片
func (h *ImageHandler) GetImage(c *gin.Context) {
	userID := getUserID(c)
	imageID := c.Param("id")

	var image services.ImageGeneration
	if err := h.db.Where("id = ? AND user_id = ?", imageID, userID).First(&image).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "图片不存在"})
		return
	}

	c.JSON(http.StatusOK, image)
}

// ServeImageFile 本地图片文件服务
func (h *ImageHandler) ServeImageFile(c *gin.Context) {
	filename := c.Param("filename")
	// 安全校验：防止目录穿越
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "非法文件名"})
		return
	}

	path := filepath.Join(imageAssetsDir(), filename)
	if _, err := os.Stat(path); err != nil {
		// 兼容后端从仓库根目录启动时，图片被保存到 ./data/images，而当前 API 包的相对目录不是同一个目录。
		altPath := filepath.Join("..", "data", "images", filename)
		if _, altErr := os.Stat(altPath); altErr == nil {
			path = altPath
		} else {
			c.JSON(http.StatusNotFound, gin.H{"error": "图片文件不存在"})
			return
		}
	}
	c.File(path)
}

// AutoMigrate 自动迁移数据库表
func (h *ImageHandler) AutoMigrate() error {
	return h.db.AutoMigrate(&services.ImageGeneration{})
}

// processImageJob 后台处理单个图片生成任务（用于异步 goroutine 和启动恢复）
func (h *ImageHandler) processImageJob(recordID uint, prompt, size, quality string, referenceImagePaths []string, baseURL string) {
	h.processImageEditJob(recordID, prompt, size, quality, referenceImagePaths, "", baseURL, image.Point{}, editCanvasTransform{}, "")
}

func (h *ImageHandler) processImageEditJob(recordID uint, prompt, size, quality string, referenceImagePaths []string, maskPath string, baseURL string, targetSize image.Point, transform editCanvasTransform, background string) {
	ctx := context.Background()

	var imageURL, b64Data string
	var err error

	if len(referenceImagePaths) > 0 {
		// image-to-image / mask 编辑模式：基于参考图编辑
		imageURL, b64Data, err = h.imageService.EditImageStream(ctx, prompt, size, quality, referenceImagePaths, maskPath, background, nil)
	} else {
		// 普通文生图模式
		imageURL, b64Data, err = h.imageService.GenerateImage(ctx, prompt, size, quality)
	}

	if err != nil {
		fmt.Printf("[图片生成失败] ID=%d size=%s quality=%s ref=%v err=%v\n", recordID, size, quality, referenceImagePaths, err)
		errMsg := cleanImageGenerationErrorMessage(err)
		if saveErr := h.db.Model(&services.ImageGeneration{}).Where("id = ?", recordID).Updates(map[string]interface{}{
			"status":        "failed",
			"error_message": errMsg,
		}).Error; saveErr != nil {
			fmt.Printf("[更新状态失败] ID=%d err=%v\n", recordID, saveErr)
		}
		// 记录失败用量
		if h.usageService != nil {
			var gen services.ImageGeneration
			if dbErr := h.db.First(&gen, recordID).Error; dbErr == nil {
				_ = h.usageService.RecordImageUsage(gen.UserID, h.cfg.ImageGenModel, 0, nil)
			}
		}
		return
	}

	// 处理 b64_json
	if b64Data != "" {
		filename, err := saveBase64ImageWithTransform(b64Data, targetSize, transform)
		if err != nil {
			fmt.Printf("[保存图片失败] ID=%d err=%v\n", recordID, err)
			if saveErr := h.db.Model(&services.ImageGeneration{}).Where("id = ?", recordID).Updates(map[string]interface{}{
				"status":        "failed",
				"error_message": "图片生成成功了，但保存图片时失败。请稍后重试，",
			}).Error; saveErr != nil {
				fmt.Printf("[更新状态失败] ID=%d err=%v\n", recordID, saveErr)
			}
			if h.usageService != nil {
				var gen services.ImageGeneration
				if dbErr := h.db.First(&gen, recordID).Error; dbErr == nil {
					_ = h.usageService.RecordImageUsage(gen.UserID, h.cfg.ImageGenModel, 0, nil)
				}
			}
			return
		}
		imageURL = buildImageURL(baseURL, filename)
	}

	if imageURL == "" {
		fmt.Printf("[图片生成异常] ID=%d 未获取到 URL 或数据\n", recordID)
		if saveErr := h.db.Model(&services.ImageGeneration{}).Where("id = ?", recordID).Updates(map[string]interface{}{
			"status":        "failed",
			"error_message": defaultImageGenerationErrorMessage,
		}).Error; saveErr != nil {
			fmt.Printf("[更新状态失败] ID=%d err=%v\n", recordID, saveErr)
		}
		if h.usageService != nil {
			var gen services.ImageGeneration
			if dbErr := h.db.First(&gen, recordID).Error; dbErr == nil {
				_ = h.usageService.RecordImageUsage(gen.UserID, h.cfg.ImageGenModel, 0, nil)
			}
		}
		return
	}

	if saveErr := h.db.Model(&services.ImageGeneration{}).Where("id = ?", recordID).Updates(map[string]interface{}{
		"image_url": imageURL,
		"status":    "completed",
	}).Error; saveErr != nil {
		fmt.Printf("[更新记录失败] ID=%d err=%v\n", recordID, saveErr)
	}
	fmt.Printf("[图片生成成功] ID=%d url=%s\n", recordID, imageURL)

	// 记录成功用量
	if h.usageService != nil {
		var gen services.ImageGeneration
		if dbErr := h.db.First(&gen, recordID).Error; dbErr == nil {
			_ = h.usageService.RecordImageUsage(gen.UserID, h.cfg.ImageGenModel, 1, nil)
		}
	}
}

// RecoverPendingJobs 服务启动时扫描并恢复所有 pending 状态的图片生成任务
// 防止进程重启导致异步 goroutine 丢失
func (h *ImageHandler) RecoverPendingJobs() {
	var pending []services.ImageGeneration
	if err := h.db.Where("status = ?", "pending").Find(&pending).Error; err != nil {
		fmt.Printf("[任务恢复] 查询 pending 任务失败: %v\n", err)
		return
	}

	if len(pending) == 0 {
		return
	}

	baseURL := h.cfg.BaseURL
	if baseURL == "" {
		baseURL = "http://localhost:9091"
	}
	baseURL = strings.TrimSuffix(baseURL, "/")

	fmt.Printf("[任务恢复] 发现 %d 个未完成的图片生成任务，正在重新执行...\n", len(pending))
	for _, job := range pending {
		// 从 ReferenceImageURL 提取本地文件路径（支持多张图逗号分隔）
		var referenceImagePaths []string
		if job.ReferenceImageURL != "" {
			urls := strings.Split(job.ReferenceImageURL, ",")
			for _, url := range urls {
				url = strings.TrimSpace(url)
				if url == "" {
					continue
				}
				parts := strings.Split(url, "/")
				if len(parts) > 0 {
					filename := parts[len(parts)-1]
					if !strings.Contains(filename, "..") && !strings.Contains(filename, "/") {
						refPath := filepath.Join(imageAssetsDir(), filename)
						if _, statErr := os.Stat(refPath); statErr == nil {
							referenceImagePaths = append(referenceImagePaths, refPath)
						}
					}
				}
			}
		}
		go h.processImageJob(job.ID, job.Prompt, job.Size, job.Quality, referenceImagePaths, baseURL)
	}
}
