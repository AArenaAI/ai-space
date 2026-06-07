package services

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCreateVideoTaskRequestsLastFrame(t *testing.T) {
	var requestBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/contents/generations/tasks" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"task-last-frame"}`))
	}))
	defer server.Close()

	svc := NewVideoService("test-api-key", server.URL)
	_, err := svc.CreateVideoTask(context.Background(), CreateVideoTaskRequest{
		Model:           "doubao-seedance-2-0-fast-260128",
		Prompt:          "生成一段视频",
		Duration:        5,
		ReturnLastFrame: true,
	})
	if err != nil {
		t.Fatalf("CreateVideoTask returned error: %v", err)
	}

	if got, ok := requestBody["return_last_frame"].(bool); !ok || !got {
		t.Fatalf("return_last_frame = %#v, want true", requestBody["return_last_frame"])
	}
}

func TestGetVideoTaskReturnsLastFrameURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/contents/generations/tasks/task-last-frame" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"task-last-frame",
			"status":"succeeded",
			"content":{
				"video_url":"https://example.test/video.mp4",
				"last_frame_url":"https://example.test/last-frame.png"
			},
			"usage":{"completion_tokens":123}
		}`))
	}))
	defer server.Close()

	svc := NewVideoService("test-api-key", server.URL)
	result, err := svc.GetVideoTask(context.Background(), "task-last-frame")
	if err != nil {
		t.Fatalf("GetVideoTask returned error: %v", err)
	}
	if result.VideoURL != "https://example.test/video.mp4" {
		t.Fatalf("VideoURL = %q", result.VideoURL)
	}
	if result.LastFrameURL != "https://example.test/last-frame.png" {
		t.Fatalf("LastFrameURL = %q", result.LastFrameURL)
	}
}

func TestCreateVideoTaskReferenceImageRoleModes(t *testing.T) {
	tests := []struct {
		name   string
		mode   string
		images []string
		want   []string
	}{
		{
			name:   "auto_one_image_is_reference",
			mode:   "",
			images: []string{"https://example.test/a.png"},
			want:   []string{"reference_image"},
		},
		{
			name:   "auto_two_images_are_multimodal_references",
			mode:   "",
			images: []string{"https://example.test/a.png", "https://example.test/b.png"},
			want:   []string{"reference_image", "reference_image"},
		},
		{
			name:   "explicit_first_last_frame",
			mode:   "first_last_frame",
			images: []string{"https://example.test/a.png", "https://example.test/b.png"},
			want:   []string{"first_frame", "last_frame"},
		},
		{
			name:   "explicit_first_frame",
			mode:   "first_frame",
			images: []string{"https://example.test/a.png", "https://example.test/b.png"},
			want:   []string{"first_frame", "reference_image"},
		},
		{
			name:   "explicit_reference",
			mode:   "reference",
			images: []string{"https://example.test/a.png", "https://example.test/b.png"},
			want:   []string{"reference_image", "reference_image"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var requestBody map[string]any
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.Path != "/contents/generations/tasks" {
					t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
				}
				if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
					t.Fatalf("decode request body: %v", err)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"task-role-mode"}`))
			}))
			defer server.Close()

			svc := NewVideoService("test-api-key", server.URL)
			_, err := svc.CreateVideoTask(context.Background(), CreateVideoTaskRequest{
				Model:                  "doubao-seedance-2-0-fast-260128",
				Prompt:                 "生成一段视频",
				Duration:               5,
				ReferenceImages:        tt.images,
				ReferenceImageRoleMode: tt.mode,
			})
			if err != nil {
				t.Fatalf("CreateVideoTask returned error: %v", err)
			}

			content, ok := requestBody["content"].([]any)
			if !ok {
				t.Fatalf("content = %#v", requestBody["content"])
			}
			roles := make([]string, 0, len(content))
			for _, item := range content {
				m, ok := item.(map[string]any)
				if !ok || m["type"] != "image_url" {
					continue
				}
				role, _ := m["role"].(string)
				roles = append(roles, role)
			}
			if len(roles) != len(tt.want) {
				t.Fatalf("image roles = %#v, want %#v", roles, tt.want)
			}
			for i := range tt.want {
				if roles[i] != tt.want[i] {
					t.Fatalf("image roles = %#v, want %#v", roles, tt.want)
				}
			}
		})
	}
}

func TestCreateVideoTaskReferenceImageRolesOverrideMode(t *testing.T) {
	var requestBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/contents/generations/tasks" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"task-role-override"}`))
	}))
	defer server.Close()

	svc := NewVideoService("test-api-key", server.URL)
	_, err := svc.CreateVideoTask(context.Background(), CreateVideoTaskRequest{
		Model:                  "doubao-seedance-2-0-fast-260128",
		Prompt:                 "生成一段视频",
		Duration:               5,
		ReferenceImages:        []string{"https://example.test/a.png", "https://example.test/b.png", "https://example.test/c.png"},
		ReferenceImageRoles:    []string{"reference_image", "last_frame", "first_frame"},
		ReferenceImageRoleMode: "reference",
	})
	if err != nil {
		t.Fatalf("CreateVideoTask returned error: %v", err)
	}

	content, ok := requestBody["content"].([]any)
	if !ok {
		t.Fatalf("content = %#v", requestBody["content"])
	}
	roles := make([]string, 0, len(content))
	for _, item := range content {
		m, ok := item.(map[string]any)
		if !ok || m["type"] != "image_url" {
			continue
		}
		role, _ := m["role"].(string)
		roles = append(roles, role)
	}
	want := []string{"reference_image", "last_frame", "first_frame"}
	if len(roles) != len(want) {
		t.Fatalf("image roles = %#v, want %#v", roles, want)
	}
	for i := range want {
		if roles[i] != want[i] {
			t.Fatalf("image roles = %#v, want %#v", roles, want)
		}
	}
}
