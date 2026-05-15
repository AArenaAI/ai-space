package api

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// CompareTask 表示一个对比任务。
type CompareTask struct {
	Index int
	Run   func(ctx context.Context) (string, error)
}

// CompareExecutor 安全地并行执行对比任务，带 panic 恢复和超时控制。
type CompareExecutor struct {
	timeout time.Duration
}

// NewCompareExecutor 创建对比执行器，默认 5 分钟超时。
func NewCompareExecutor() *CompareExecutor {
	return &CompareExecutor{timeout: 5 * time.Minute}
}

// Execute 并行执行 tasks，返回按索引排序的结果。
func (e *CompareExecutor) Execute(ctx context.Context, tasks []CompareTask) ([]string, []error) {
	n := len(tasks)
	type result struct {
		index   int
		content string
		err     error
	}

	results := make(chan result, n)
	var wg sync.WaitGroup

	for _, task := range tasks {
		wg.Add(1)
		go func(t CompareTask) {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					results <- result{
						index: t.Index,
						err:   fmt.Errorf("panic in model call: %v", r),
					}
				}
			}()

			ctx, cancel := context.WithTimeout(ctx, e.timeout)
			defer cancel()

			content, err := t.Run(ctx)
			results <- result{index: t.Index, content: content, err: err}
		}(task)
	}

	go func() {
		wg.Wait()
		close(results)
	}()

	contents := make([]string, n)
	errs := make([]error, n)
	for r := range results {
		contents[r.index] = r.content
		errs[r.index] = r.err
	}

	return contents, errs
}
