package middleware

import (
	"net/http"
	"testing"
)

func TestShouldSkipIPRateLimitForChatShellAndHighFrequencyReads(t *testing.T) {
	cases := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/chat/"},
		{http.MethodGet, "/_next/static/chunks/app.js"},
		{http.MethodGet, "/api/chat/bootstrap"},
		{http.MethodGet, "/api/notebooks"},
		{http.MethodGet, "/api/models/chat"},
		{http.MethodGet, "/api/templates"},
		{http.MethodGet, "/api/workspaces"},
		{http.MethodGet, "/api/user/credits"},
		{http.MethodGet, "/api/beta/config"},
		{http.MethodGet, "/api/changelogs/unread-count"},
	}
	for _, tc := range cases {
		if !shouldSkipIPRateLimit(tc.method, tc.path) {
			t.Fatalf("expected %s %s to skip IP rate limit", tc.method, tc.path)
		}
	}
}

func TestShouldKeepMutatingAPIUnderIPRateLimit(t *testing.T) {
	cases := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/chat"},
		{http.MethodPost, "/api/auth/login"},
		{http.MethodPost, "/api/files/upload"},
		{http.MethodGet, "/api/admin/users"},
	}
	for _, tc := range cases {
		if shouldSkipIPRateLimit(tc.method, tc.path) {
			t.Fatalf("expected %s %s to remain IP rate limited", tc.method, tc.path)
		}
	}
}
