package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"mime"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"aipool-backend/pkg/publicid"

	"gorm.io/gorm"
)

const (
	maxInlineReferenceImageBytes   = 10 * 1024 * 1024
	publicReferenceURLCheckTimeout = 5 * time.Second

	maxReferenceVideoBytes       = 200 * 1024 * 1024
	minReferenceVideoDurationSec = 2.0
	maxReferenceVideoDurationSec = 15.0
	maxReferenceVideoTotalSec    = 15.0
	minReferenceVideoAspectRatio = 0.4
	maxReferenceVideoAspectRatio = 2.5
	minReferenceVideoSidePx      = 300
	maxReferenceVideoSidePx      = 6000
	minReferenceVideoPixels      = 640 * 640
	maxReferenceVideoPixels      = 2206 * 946
	minReferenceVideoFPS         = 24.0
	maxReferenceVideoFPS         = 60.0
)

func normalizedReferenceImageRoles(roles []string, count int) []string {
	if count <= 0 || len(roles) == 0 {
		return nil
	}
	result := make([]string, 0, count)
	for i := 0; i < count && i < len(roles); i++ {
		role := strings.TrimSpace(roles[i])
		switch role {
		case "first_frame", "last_frame", "reference_image":
			result = append(result, role)
		case "reference":
			result = append(result, "reference_image")
		default:
			result = append(result, "reference_image")
		}
	}
	return result
}

// resolveVideoReferenceURLs converts frontend file public IDs into provider-readable URLs.
// External http(s) URLs are kept as-is. Internal file_xxx IDs are resolved to either:
// 1) an absolute public /api/files/:id/view URL when BASE_URL/FRONTEND_URL is configured; or
// 2) a data URL fallback for small images in local/dev environments.
func resolveVideoReferenceURLs(db *gorm.DB, cfg *config.Config, userID uint, refs []string, mediaKind string) ([]string, error) {
	result := make([]string, 0, len(refs))
	var totalVideoDuration float64
	for _, ref := range refs {
		resolved, duration, err := resolveVideoReferenceURL(db, cfg, userID, strings.TrimSpace(ref), mediaKind)
		if err != nil {
			return nil, err
		}
		if resolved != "" {
			result = append(result, resolved)
		}
		if mediaKind == "video" && duration > 0 {
			totalVideoDuration += duration
			if totalVideoDuration > maxReferenceVideoTotalSec+0.001 {
				return nil, fmt.Errorf("参考视频总时长不能超过 15 秒，当前已上传 %.1f 秒", totalVideoDuration)
			}
		}
	}
	return result, nil
}

func resolveVideoReferenceURL(db *gorm.DB, cfg *config.Config, userID uint, ref string, mediaKind string) (string, float64, error) {
	if ref == "" {
		return "", 0, nil
	}
	if mediaKind == "video" {
		if resolved, ok, err := resolveGeneratedVideoAssetReferenceURL(cfg, ref); ok || err != nil {
			return resolved, 0, err
		}
	}
	if strings.HasPrefix(ref, "http://") || strings.HasPrefix(ref, "https://") || strings.HasPrefix(ref, "data:") {
		if mediaKind == "video" && !isSupportedVideoURL(ref) {
			return "", 0, fmt.Errorf("参考视频仅支持 mp4、mov 格式")
		}
		return ref, 0, nil
	}

	publicID := strings.TrimPrefix(ref, "/api/files/")
	publicID = strings.TrimSuffix(publicID, "/view")
	publicID = strings.TrimSuffix(publicID, "/download")
	if !publicid.IsFileID(publicID) {
		return ref, 0, nil
	}

	var file models.File
	if err := db.Where("public_id = ?", publicID).First(&file).Error; err != nil {
		return "", 0, fmt.Errorf("参考素材不存在: %s", publicID)
	}
	if file.UserID > 0 && file.UserID != userID {
		return "", 0, fmt.Errorf("无权访问参考素材: %s", publicID)
	}

	var videoDuration float64
	if mediaKind == "video" {
		meta, err := validateLocalReferenceVideo(file)
		if err != nil {
			return "", 0, err
		}
		videoDuration = meta.Duration
	}

	if base := publicBaseURL(cfg); base != "" {
		publicURL := strings.TrimRight(base, "/") + "/api/files/" + url.PathEscape(publicID) + "/view"
		if isPublicReferenceURLReachable(publicURL) {
			return publicURL, videoDuration, nil
		}
		if mediaKind != "image" {
			return "", 0, fmt.Errorf("参考视频需要公网可访问 URL；当前 BASE_URL/FRONTEND_URL 对外不可访问，火山无法下载素材")
		}
	}

	if mediaKind == "image" {
		inline, err := inlineReferenceImage(file)
		return inline, 0, err
	}

	return "", 0, fmt.Errorf("参考视频必须使用公网可访问 URL；当前缺少可访问的 BASE_URL/FRONTEND_URL，无法把本地文件传给火山")
}

func inlineReferenceImage(file models.File) (string, error) {
	data, err := os.ReadFile(file.StoragePath)
	if err != nil {
		return "", fmt.Errorf("读取参考图失败: %w", err)
	}
	if len(data) > maxInlineReferenceImageBytes {
		return "", fmt.Errorf("参考图过大，请配置可公网访问的 BASE_URL 后再生成视频")
	}
	mimeType := file.MimeType
	if mimeType == "" {
		mimeType = mime.TypeByExtension(strings.ToLower(filepath.Ext(file.Filename)))
	}
	if mimeType == "" {
		mimeType = "image/jpeg"
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func isPublicReferenceURLReachable(publicURL string) bool {
	client := &http.Client{Timeout: publicReferenceURLCheckTimeout}
	req, err := http.NewRequest(http.MethodHead, publicURL, nil)
	if err != nil {
		return false
	}
	resp, err := client.Do(req)
	if err == nil {
		resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 400 {
			return true
		}
	}

	req, err = http.NewRequest(http.MethodGet, publicURL, nil)
	if err != nil {
		return false
	}
	req.Header.Set("Range", "bytes=0-0")
	resp, err = client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 400
}

func publicBaseURL(cfg *config.Config) string {
	candidates := []string{""}
	if cfg != nil {
		candidates = []string{cfg.BaseURL, cfg.FrontendURL}
	}
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		parsed, err := url.Parse(candidate)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			continue
		}
		host := strings.ToLower(parsed.Hostname())
		if host == "localhost" || host == "127.0.0.1" || strings.HasPrefix(host, "10.") || strings.HasPrefix(host, "192.168.") || strings.HasPrefix(host, "172.16.") || strings.HasPrefix(host, "172.17.") || strings.HasPrefix(host, "172.18.") || strings.HasPrefix(host, "172.19.") || strings.HasPrefix(host, "172.2") || strings.HasPrefix(host, "172.3") {
			continue
		}
		return candidate
	}
	return ""
}

type referenceVideoMetadata struct {
	Duration    float64
	Width       int
	Height      int
	FPS         float64
	VideoCodec  string
	AudioCodecs []string
}

type ffprobeOutput struct {
	Streams []struct {
		CodecType    string `json:"codec_type"`
		CodecName    string `json:"codec_name"`
		Width        int    `json:"width"`
		Height       int    `json:"height"`
		AvgFrameRate string `json:"avg_frame_rate"`
	} `json:"streams"`
	Format struct {
		Duration string `json:"duration"`
	} `json:"format"`
}

func isSupportedVideoURL(ref string) bool {
	parsed, err := url.Parse(ref)
	if err != nil {
		return false
	}
	ext := strings.ToLower(filepath.Ext(parsed.Path))
	return ext == ".mp4" || ext == ".mov"
}

func resolveGeneratedVideoAssetReferenceURL(cfg *config.Config, ref string) (string, bool, error) {
	filename, ok := localAssetFilenameFromURL(ref, localVideoURLPrefix)
	if !ok {
		return "", false, nil
	}
	if !isSupportedVideoURL(localVideoURLPrefix + filename) {
		return "", true, fmt.Errorf("参考视频仅支持 mp4、mov 格式")
	}
	path := filepath.Join(videoAssetsDir(), filename)
	if _, err := os.Stat(path); err != nil {
		return "", true, fmt.Errorf("参考素材不存在: %s", filename)
	}
	base := publicBaseURL(cfg)
	if base == "" {
		return "", true, fmt.Errorf("参考视频必须使用公网可访问 URL；当前缺少可访问的 BASE_URL/FRONTEND_URL，无法把本地文件传给火山")
	}
	publicURL := strings.TrimRight(base, "/") + localVideoURLPrefix + url.PathEscape(filename)
	if !isPublicReferenceURLReachable(publicURL) {
		return "", true, fmt.Errorf("参考视频需要公网可访问 URL；当前 BASE_URL/FRONTEND_URL 对外不可访问，火山无法下载素材")
	}
	return publicURL, true, nil
}

func validateLocalReferenceVideo(file models.File) (referenceVideoMetadata, error) {
	var meta referenceVideoMetadata
	if file.Size > maxReferenceVideoBytes {
		return meta, fmt.Errorf("参考视频不能超过 200 MB，当前文件 %.1f MB", float64(file.Size)/(1024*1024))
	}
	mimeType := strings.ToLower(strings.TrimSpace(file.MimeType))
	ext := strings.ToLower(filepath.Ext(file.Filename))
	if !((ext == ".mp4" || mimeType == "video/mp4") || (ext == ".mov" || mimeType == "video/quicktime")) {
		return meta, fmt.Errorf("参考视频仅支持 mp4、mov 格式")
	}
	if _, err := os.Stat(file.StoragePath); err != nil {
		return meta, fmt.Errorf("读取参考视频失败: %w", err)
	}

	cmd := exec.Command("ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", file.StoragePath)
	out, err := cmd.Output()
	if err != nil {
		return meta, fmt.Errorf("解析参考视频失败，请确认视频文件可正常播放")
	}
	var probe ffprobeOutput
	if err := json.Unmarshal(out, &probe); err != nil {
		return meta, fmt.Errorf("解析参考视频元数据失败")
	}
	meta.Duration, _ = strconv.ParseFloat(probe.Format.Duration, 64)
	for _, stream := range probe.Streams {
		switch stream.CodecType {
		case "video":
			if meta.VideoCodec == "" {
				meta.VideoCodec = strings.ToLower(stream.CodecName)
				meta.Width = stream.Width
				meta.Height = stream.Height
				meta.FPS = parseFrameRate(stream.AvgFrameRate)
			}
		case "audio":
			meta.AudioCodecs = append(meta.AudioCodecs, strings.ToLower(stream.CodecName))
		}
	}

	if meta.Duration < minReferenceVideoDurationSec || meta.Duration > maxReferenceVideoDurationSec+0.001 {
		return meta, fmt.Errorf("参考视频单个时长必须在 2-15 秒之间，当前 %.1f 秒", meta.Duration)
	}
	if meta.VideoCodec != "h264" && meta.VideoCodec != "hevc" && meta.VideoCodec != "h265" {
		return meta, fmt.Errorf("参考视频编码仅支持 H.264/AVC、H.265/HEVC，当前为 %s", meta.VideoCodec)
	}
	for _, codec := range meta.AudioCodecs {
		if codec != "aac" && codec != "mp3" {
			return meta, fmt.Errorf("参考视频音频编码仅支持 AAC、MP3，当前为 %s", codec)
		}
	}
	if meta.Width < minReferenceVideoSidePx || meta.Width > maxReferenceVideoSidePx || meta.Height < minReferenceVideoSidePx || meta.Height > maxReferenceVideoSidePx {
		return meta, fmt.Errorf("参考视频宽高必须在 300-6000 px 之间，当前 %dx%d", meta.Width, meta.Height)
	}
	aspect := float64(meta.Width) / float64(meta.Height)
	if aspect < minReferenceVideoAspectRatio || aspect > maxReferenceVideoAspectRatio {
		return meta, fmt.Errorf("参考视频宽高比必须在 0.4-2.5 之间，当前 %.2f", aspect)
	}
	pixels := meta.Width * meta.Height
	if pixels < minReferenceVideoPixels || pixels > maxReferenceVideoPixels {
		return meta, fmt.Errorf("参考视频总像素数必须在 409600-2086876 之间，当前 %d", pixels)
	}
	if meta.FPS < minReferenceVideoFPS || meta.FPS > maxReferenceVideoFPS {
		return meta, fmt.Errorf("参考视频帧率必须在 24-60 FPS 之间，当前 %.2f", meta.FPS)
	}
	return meta, nil
}

func parseFrameRate(value string) float64 {
	value = strings.TrimSpace(value)
	if value == "" || value == "0/0" {
		return 0
	}
	parts := strings.Split(value, "/")
	if len(parts) == 2 {
		numerator, _ := strconv.ParseFloat(parts[0], 64)
		denominator, _ := strconv.ParseFloat(parts[1], 64)
		if denominator == 0 {
			return 0
		}
		return math.Round((numerator/denominator)*100) / 100
	}
	fps, _ := strconv.ParseFloat(value, 64)
	return math.Round(fps*100) / 100
}
