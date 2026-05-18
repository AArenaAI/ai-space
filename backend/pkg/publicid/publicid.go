package publicid

import (
	"crypto/rand"
	"fmt"
	"strings"
	"sync"
	"time"
)

var (
	chars   = []byte("abcdefghijklmnopqrstuvwxyz0123456789")
	charsMu sync.Mutex
)

// GenerateFileID 生成文件的 PublicID，格式为 file_ + 16 位随机字符
// 总长度 21，不可枚举，组合数约 36^16 ≈ 7.9e24
func GenerateFileID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// 如果随机读取失败，用时间戳+随机数作为 fallback
		return fallbackFileID()
	}
	for i := range b {
		b[i] = chars[b[i]%byte(len(chars))]
	}
	return "file_" + string(b)
}

// fallbackFileID 当 crypto/rand 失败时的后备方案
func fallbackFileID() string {
	timestamp := time.Now().UnixNano()
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	randomPart := ""
	for i := range b {
		randomPart += string(chars[b[i]%byte(len(chars))])
	}
	return fmt.Sprintf("file_%d%s", timestamp, randomPart)
}

// IsFileID 检查是否为有效的文件 PublicID
func IsFileID(s string) bool {
	if !strings.HasPrefix(s, "file_") {
		return false
	}
	rest := strings.TrimPrefix(s, "file_")
	if len(rest) < 16 {
		return false
	}
	for _, r := range rest {
		if !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}
