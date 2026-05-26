package api

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
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
