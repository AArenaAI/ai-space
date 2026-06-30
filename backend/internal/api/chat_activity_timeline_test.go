package api

import (
	"encoding/json"
	"testing"
)

func TestSanitizeChatStatusTimelineJSONDropsDeprecatedCompletedSteps(t *testing.T) {
	raw := `[
		{"id":"waiting_provider:completed","kind":"waiting_provider","status":"completed","startedAt":1,"endedAt":2},
		{"id":"web_search:completed","kind":"web_search","status":"completed","startedAt":2,"endedAt":3,"count":4},
		{"id":"reasoning:completed","kind":"reasoning","status":"completed","startedAt":3,"endedAt":4},
		{"id":"streaming_answer:completed","kind":"streaming_answer","status":"completed","startedAt":4,"endedAt":5},
		{"id":"finalizing:completed","kind":"finalizing","status":"completed","startedAt":5,"endedAt":6}
	]`

	cleaned := sanitizeChatStatusTimelineJSON(raw)
	var steps []chatStatusTimelineStep
	if err := json.Unmarshal([]byte(cleaned), &steps); err != nil {
		t.Fatalf("cleaned timeline should remain valid json: %v", err)
	}
	if len(steps) != 2 {
		t.Fatalf("expected 2 user-facing steps, got %d: %s", len(steps), cleaned)
	}
	if steps[0].Kind != "web_search" || steps[1].Kind != "reasoning" {
		t.Fatalf("unexpected remaining steps: %+v", steps)
	}
}

func TestSanitizeChatStatusTimelineJSONKeepsRunningGeneration(t *testing.T) {
	raw := `[{"id":"streaming_answer:running","kind":"streaming_answer","status":"running","startedAt":1}]`
	cleaned := sanitizeChatStatusTimelineJSON(raw)
	var steps []chatStatusTimelineStep
	if err := json.Unmarshal([]byte(cleaned), &steps); err != nil {
		t.Fatalf("cleaned timeline should remain valid json: %v", err)
	}
	if len(steps) != 1 || steps[0].Kind != "streaming_answer" || steps[0].Status != "running" {
		t.Fatalf("running generation step should remain: %+v", steps)
	}
}
