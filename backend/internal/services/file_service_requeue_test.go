package services

import (
	"testing"

	"aipool-backend/internal/models"
)

func TestCanRequeueEmbeddingRequiresParsedFile(t *testing.T) {
	cases := []struct {
		name string
		file models.File
		want bool
	}{
		{name: "parsed indexing error", file: models.File{ParseStatus: "done", EmbeddingStatus: "error"}, want: true},
		{name: "parsed skipped", file: models.File{ParseStatus: "done", EmbeddingStatus: "skipped"}, want: true},
		{name: "parsed pending", file: models.File{ParseStatus: "done", EmbeddingStatus: "pending"}, want: true},
		{name: "parse error", file: models.File{ParseStatus: "error", EmbeddingStatus: "error"}, want: false},
		{name: "still parsing", file: models.File{ParseStatus: "parsing", EmbeddingStatus: "pending"}, want: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := canRequeueEmbedding(tc.file); got != tc.want {
				t.Fatalf("canRequeueEmbedding(%+v) = %v, want %v", tc.file, got, tc.want)
			}
		})
	}
}
