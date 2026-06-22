package api

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"aipool-backend/internal/config"
)

func TestResolveGeneratedVideoReferenceURLRequiresExistingAsset(t *testing.T) {
	_, _, err := resolveVideoReferenceURL(nil, &config.Config{FrontendURL: "https://testnet.ai-space.xyz"}, 1, localVideoURLPrefix+"missing_reference_test.mp4", "video", 0)
	if err == nil {
		t.Fatal("expected missing generated video asset error")
	}
	if !strings.Contains(err.Error(), "参考素材") {
		t.Fatalf("error = %q, want missing asset message", err.Error())
	}
}

func TestResolveGeneratedVideoReferenceURLRejectsUnsupportedExtension(t *testing.T) {
	_, _, err := resolveVideoReferenceURL(nil, &config.Config{FrontendURL: "https://testnet.ai-space.xyz"}, 1, localVideoURLPrefix+"vid_reference_test.webm", "video", 0)
	if err == nil {
		t.Fatal("expected unsupported extension error")
	}
	if !strings.Contains(err.Error(), "mp4、mov") {
		t.Fatalf("error = %q, want unsupported extension message", err.Error())
	}
}

func TestResolveGeneratedImageReferenceURLFallsBackToDataURL(t *testing.T) {
	dir := imageAssetsDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	filename := "img_reference_test.png"
	path := filepath.Join(dir, filename)
	if err := os.WriteFile(path, []byte{0x89, 0x50, 0x4e, 0x47}, 0644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(path) })

	resolved, _, err := resolveVideoReferenceURL(nil, &config.Config{}, 1, localImageURLPrefix+filename, "image", 0)
	if err != nil {
		t.Fatalf("resolve image reference: %v", err)
	}
	if !strings.HasPrefix(resolved, "data:image/png;base64,") {
		t.Fatalf("resolved = %q, want image data URL", resolved)
	}
}

func TestResolveGeneratedImageReferenceURLAcceptsBareLocalFilename(t *testing.T) {
	dir := imageAssetsDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	filename := "img_reference_bare_test.png"
	path := filepath.Join(dir, filename)
	if err := os.WriteFile(path, []byte{0x89, 0x50, 0x4e, 0x47}, 0644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(path) })

	resolved, _, err := resolveVideoReferenceURL(nil, &config.Config{}, 1, filename, "image", 0)
	if err != nil {
		t.Fatalf("resolve bare image filename: %v", err)
	}
	if !strings.HasPrefix(resolved, "data:image/png;base64,") {
		t.Fatalf("resolved = %q, want image data URL", resolved)
	}
}

func TestResolveGeneratedImageReferenceURLRejectsUnsupportedExtension(t *testing.T) {
	_, _, err := resolveVideoReferenceURL(nil, &config.Config{}, 1, localImageURLPrefix+"img_reference_test.gif", "image", 0)
	if err == nil {
		t.Fatal("expected unsupported extension error")
	}
	if !strings.Contains(err.Error(), "jpg、jpeg、png、webp") {
		t.Fatalf("error = %q, want unsupported extension message", err.Error())
	}
}
