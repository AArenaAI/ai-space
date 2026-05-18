package services

import "testing"

func TestIsDocumentOverviewQuery(t *testing.T) {
	cases := []struct {
		query string
		want  bool
	}{
		{"这是什么？", true},
		{"总结一下", true},
		{"分析这个日志", true},
		{"帮我看下这个文件", true},
		{"提取重点", true},
		{"文档内容是什么", true},
		{"整理一下", true},
		{"summary", true},
		{"what is this", true},
		{"Batch 3 耗时多少？", false},
		{"DB_KEY_NOT_FOUND 是什么？", false},
		{"你好", false},
		{"", false},
	}

	for _, c := range cases {
		got := IsDocumentOverviewQuery(c.query)
		if got != c.want {
			t.Errorf("IsDocumentOverviewQuery(%q) = %v, want %v", c.query, got, c.want)
		}
	}
}
