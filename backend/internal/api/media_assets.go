package api

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const (
	localImageURLPrefix = "/api/images/file/"
	localVideoURLPrefix = "/api/videos/file/"
	maxVideoAssetBytes  = 1024 * 1024 * 1024 // 1GB
)

func dataDirPath(parts ...string) string {
	candidates := []string{
		filepath.Join(append([]string{"data"}, parts...)...),
		filepath.Join(append([]string{"backend", "data"}, parts...)...),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			if abs, absErr := filepath.Abs(candidate); absErr == nil {
				return abs
			}
		}
	}
	abs, err := filepath.Abs(candidates[0])
	if err != nil {
		return candidates[0]
	}
	return abs
}

func imageAssetsDir() string {
	return dataDirPath("images")
}

func videoAssetsDir() string {
	return dataDirPath("videos")
}

func randomHex(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

func localAssetFilenameFromURL(rawURL, prefix string) (string, bool) {
	if rawURL == "" {
		return "", false
	}
	if strings.HasPrefix(rawURL, prefix) {
		filename := strings.TrimPrefix(rawURL, prefix)
		if filename != "" && !strings.Contains(filename, "/") && !strings.Contains(filename, "..") {
			return filename, true
		}
	}
	parsed, err := url.Parse(rawURL)
	if err == nil && strings.HasPrefix(parsed.Path, prefix) {
		filename := strings.TrimPrefix(parsed.Path, prefix)
		if filename != "" && !strings.Contains(filename, "/") && !strings.Contains(filename, "..") {
			return filename, true
		}
	}
	return "", false
}

func deleteLocalAsset(rawURL, prefix, dir string) {
	filename, ok := localAssetFilenameFromURL(rawURL, prefix)
	if !ok {
		return
	}
	_ = os.Remove(filepath.Join(dir, filename))
}

func videoExtensionFromURL(rawURL string, contentType string) string {
	if parsed, err := url.Parse(rawURL); err == nil {
		ext := strings.ToLower(filepath.Ext(parsed.Path))
		switch ext {
		case ".mp4", ".mov", ".webm", ".m4v":
			return ext
		}
	}
	contentType = strings.ToLower(contentType)
	switch {
	case strings.Contains(contentType, "quicktime"):
		return ".mov"
	case strings.Contains(contentType, "webm"):
		return ".webm"
	default:
		return ".mp4"
	}
}

func persistRemoteVideoAsset(rawURL string) (string, error) {
	if rawURL == "" {
		return "", fmt.Errorf("视频地址为空")
	}
	if strings.HasPrefix(rawURL, localVideoURLPrefix) {
		return rawURL, nil
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return rawURL, nil
	}

	client := &http.Client{Timeout: 10 * time.Minute}
	resp, err := client.Get(rawURL)
	if err != nil {
		return "", fmt.Errorf("下载视频失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("下载视频失败: HTTP %d", resp.StatusCode)
	}

	dir := videoAssetsDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("创建视频目录失败: %w", err)
	}
	ext := videoExtensionFromURL(rawURL, resp.Header.Get("Content-Type"))
	filename := fmt.Sprintf("vid_%d_%s%s", time.Now().Unix(), randomHex(6), ext)
	path := filepath.Join(dir, filename)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0644)
	if err != nil {
		return "", fmt.Errorf("创建视频文件失败: %w", err)
	}
	defer file.Close()

	written, err := io.Copy(file, io.LimitReader(resp.Body, maxVideoAssetBytes+1))
	if err != nil {
		_ = os.Remove(path)
		return "", fmt.Errorf("保存视频失败: %w", err)
	}
	if written > maxVideoAssetBytes {
		_ = os.Remove(path)
		return "", fmt.Errorf("视频文件过大")
	}
	return localVideoURLPrefix + filename, nil
}

func videoAssetPersistenceErrorMessage(err error) string {
	if err == nil {
		return ""
	}

	msg := err.Error()
	lower := strings.ToLower(msg)

	switch {
	case strings.Contains(msg, "视频地址为空"):
		return "视频生成成功了，但服务商没有返回可下载的视频地址。请稍后重试；如果反复出现，请联系管理员检查服务商返回结果。"
	case strings.Contains(lower, "http 403") || strings.Contains(lower, "http 401"):
		return "视频生成成功了，但服务商的视频下载链接已失效或无权访问。请尽快重试；如果仍失败，需要重新生成视频。"
	case strings.Contains(lower, "http 404"):
		return "视频生成成功了，但服务商返回的视频文件不存在或已过期。请重新生成视频。"
	case strings.Contains(lower, "http 429"):
		return "视频生成成功了，但下载视频时触发服务商限流。请稍后刷新或重试保存。"
	case strings.Contains(lower, "http 5"):
		return "视频生成成功了，但服务商视频下载服务暂时异常。请稍后刷新或重试保存。"
	case strings.Contains(lower, "timeout") || strings.Contains(lower, "deadline exceeded") || strings.Contains(lower, "context deadline exceeded"):
		return "视频生成成功了，但下载视频超时。请稍后刷新重试，系统会重新尝试保存生成结果。"
	case strings.Contains(lower, "connection reset") || strings.Contains(lower, "connection refused") || strings.Contains(lower, "network") || strings.Contains(lower, "temporary failure"):
		return "视频生成成功了，但下载视频时网络连接不稳定。请稍后刷新重试，系统会重新尝试保存生成结果。"
	case strings.Contains(msg, "创建视频目录失败"):
		return "视频生成成功了，但服务器无法创建视频保存目录。请联系管理员检查存储目录权限。"
	case strings.Contains(msg, "创建视频文件失败"):
		if errors.Is(err, syscall.ENOSPC) || strings.Contains(lower, "no space left") {
			return "视频生成成功了，但服务器存储空间不足，无法保存视频文件。请清理空间后重试保存或重新生成。"
		}
		if errors.Is(err, syscall.EACCES) || errors.Is(err, syscall.EPERM) || strings.Contains(lower, "permission denied") {
			return "视频生成成功了，但服务器没有权限写入视频文件。请联系管理员检查保存目录权限。"
		}
		return "视频生成成功了，但服务器创建本地视频文件失败。请稍后重试；如果反复出现，请联系管理员。"
	case strings.Contains(msg, "保存视频失败"):
		if errors.Is(err, syscall.ENOSPC) || strings.Contains(lower, "no space left") {
			return "视频生成成功了，但服务器存储空间不足，无法完整保存视频文件。请清理空间后重试保存或重新生成。"
		}
		if errors.Is(err, syscall.EACCES) || errors.Is(err, syscall.EPERM) || strings.Contains(lower, "permission denied") {
			return "视频生成成功了，但服务器没有权限写入视频文件。请联系管理员检查保存目录权限。"
		}
		return "视频生成成功了，但写入本地视频文件时中断。请稍后刷新重试，系统会重新尝试保存生成结果。"
	case strings.Contains(msg, "视频文件过大"):
		return "视频生成成功了，但返回的视频文件超过服务器保存上限。请降低分辨率或时长后重新生成。"
	default:
		return "视频生成成功了，但保存视频文件时失败。请稍后刷新重试；如果反复出现，请联系管理员查看保存日志。"
	}
}
