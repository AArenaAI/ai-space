package api

import (
	"strings"
	"testing"

	"aipool-backend/internal/config"
)

func TestResolveGeneratedVideoReferenceURLRequiresExistingAsset(t *testing.T) {
	_, _, err := resolveVideoReferenceURL(nil, &config.Config{FrontendURL: "https://testnet.ai-space.xyz"}, 1, localVideoURLPrefix+"missing_reference_test.mp4", "video")
	if err == nil {
		t.Fatal("expected missing generated video asset error")
	}
	if !strings.Contains(err.Error(), "参考素材不存在") {
		t.Fatalf("error = %q, want missing asset message", err.Error())
	}
}

func TestResolveGeneratedVideoReferenceURLRejectsUnsupportedExtension(t *testing.T) {
	_, _, err := resolveVideoReferenceURL(nil, &config.Config{FrontendURL: "https://testnet.ai-space.xyz"}, 1, localVideoURLPrefix+"vid_reference_test.webm", "video")
	if err == nil {
		t.Fatal("expected unsupported extension error")
	}
	if !strings.Contains(err.Error(), "参考视频仅支持 mp4、mov 格式") {
		t.Fatalf("error = %q, want unsupported extension message", err.Error())
	}
}
