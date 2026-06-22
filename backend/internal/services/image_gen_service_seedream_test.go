package services

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestGenerateSeedreamImageWithReferencesSendsImageArray(t *testing.T) {
	tmp, err := os.CreateTemp(t.TempDir(), "ref-*.png")
	if err != nil {
		t.Fatalf("CreateTemp() error = %v", err)
	}
	if _, err := tmp.Write([]byte("fake-png-bytes")); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	if err := tmp.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	var gotPath string
	var gotAuth string
	var gotReq seedreamImageRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&gotReq); err != nil {
			t.Fatalf("Decode request error = %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"aGVsbG8="}]}`))
	}))
	defer server.Close()

	url, err := NewImageGenService().GenerateSeedreamImageWithReferences(
		context.Background(),
		server.URL,
		"test-key",
		"doubao-seedream-5-0-260128",
		"生成一张测试图",
		"1024x1024",
		[]string{tmp.Name()},
	)
	if err != nil {
		t.Fatalf("GenerateSeedreamImageWithReferences() error = %v", err)
	}
	if url == "" {
		t.Fatalf("GenerateSeedreamImageWithReferences() returned empty url")
	}
	if gotPath != "/images/generations" {
		t.Fatalf("request path = %q, want /images/generations", gotPath)
	}
	if gotAuth != "Bearer test-key" {
		t.Fatalf("Authorization = %q, want Bearer test-key", gotAuth)
	}
	if gotReq.Prompt != "生成一张测试图" {
		t.Fatalf("Prompt = %q", gotReq.Prompt)
	}
	if gotReq.Size != "1920x1920" {
		t.Fatalf("Size = %q", gotReq.Size)
	}
	if len(gotReq.Image) != 1 {
		t.Fatalf("len(Image) = %d, want 1", len(gotReq.Image))
	}
	if !strings.HasPrefix(gotReq.Image[0], "data:image/png;base64,") {
		t.Fatalf("Image[0] = %q, want png data URL", gotReq.Image[0])
	}
}
