package api

import (
	"context"
	"errors"
	"testing"
)

func TestCleanVideoTaskSubmissionTimeoutMessage(t *testing.T) {
	got := cleanVideoTaskSubmissionErrorMessage(context.DeadlineExceeded)
	want := "视频任务提交超时，请稍后重新提交。"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestCleanVideoTaskSubmissionNonTimeoutMessage(t *testing.T) {
	got := cleanVideoTaskSubmissionErrorMessage(errors.New("quota exceeded"))
	want := "当前生成服务额度不足，暂时无法完成生成。请稍后再试，"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
