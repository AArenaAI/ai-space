package services

import "strings"

type GaokaoAdvisorModelReport struct {
	Provider string                `json:"provider"`
	Role     string                `json:"role"`
	Status   string                `json:"status"`
	Analysis GaokaoAdvisorAnalysis `json:"analysis"`
	Error    string                `json:"error"`
}

func MergeGaokaoAdvisorModelReports(reports []GaokaoAdvisorModelReport, fallback GaokaoAdvisorAnalysis) GaokaoAdvisorAnalysis {
	merged := fallback
	providers := []string{}
	seenTradeoff := map[string]bool{}
	seenRisk := map[string]bool{}
	seenQuestion := map[string]bool{}
	for _, item := range merged.Tradeoffs {
		seenTradeoff[item] = true
	}
	for _, item := range merged.RiskFlags {
		seenRisk[item] = true
	}
	for _, item := range merged.Questions {
		seenQuestion[item] = true
	}
	for _, report := range reports {
		if !strings.HasPrefix(report.Status, "called") && report.Status != "called" {
			continue
		}
		providers = append(providers, report.Provider)
		for _, item := range report.Analysis.Tradeoffs {
			if item != "" && !seenTradeoff[item] {
				merged.Tradeoffs = append(merged.Tradeoffs, item)
				seenTradeoff[item] = true
			}
		}
		for _, item := range report.Analysis.RiskFlags {
			if item != "" && !seenRisk[item] {
				merged.RiskFlags = append(merged.RiskFlags, item)
				seenRisk[item] = true
			}
		}
		for _, item := range report.Analysis.Questions {
			if item != "" && !seenQuestion[item] {
				merged.Questions = append(merged.Questions, item)
				seenQuestion[item] = true
			}
		}
	}
	if len(providers) > 0 {
		merged.Summary = "多模型综合（" + strings.Join(providers, " / ") + "）：" + firstNonEmptySummary(reports, fallback.Summary)
	}
	return merged
}

func firstNonEmptySummary(reports []GaokaoAdvisorModelReport, fallback string) string {
	for _, report := range reports {
		if strings.HasPrefix(report.Status, "called") && strings.TrimSpace(report.Analysis.Summary) != "" {
			return report.Analysis.Summary
		}
	}
	return fallback
}
