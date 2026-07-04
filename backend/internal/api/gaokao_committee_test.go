package api

import "testing"

func TestAdvisorCommitteeDefaultExcludesKimi(t *testing.T) {
	tasks := advisorCommitteeTasks("committee")
	if len(tasks) != 2 {
		t.Fatalf("expected 2 committee tasks, got %#v", tasks)
	}
	if tasks[0][0] != "deepseek" || tasks[1][0] != "openai" {
		t.Fatalf("expected deepseek/openai, got %#v", tasks)
	}
}
