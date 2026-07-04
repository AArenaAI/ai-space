package services

func FilterGaokaoExternalCandidatePlanByTrack(plan GaokaoExternalCandidatePlan, track string) GaokaoExternalCandidatePlan {
	if track == "" {
		return plan
	}
	allowed := map[string]bool{}
	switch track {
	case "本科":
		allowed["本科批次"] = true
	case "专科":
		allowed["专科批次"] = true
	case "补录本科":
		allowed["补录本科"] = true
	case "补录专科":
		allowed["补录专科"] = true
	default:
		return plan
	}
	filtered := plan
	filtered.Items = nil
	filtered.Sections = nil
	for _, section := range plan.Sections {
		items := section.Items
		if !allowed[section.Key] {
			filtered.RejectedCount += len(items)
			items = []GaokaoExternalCandidatePlanItem{}
		} else {
			filtered.Items = append(filtered.Items, items...)
		}
		section.Items = items
		filtered.Sections = append(filtered.Sections, section)
	}
	filtered.UsableCount = len(filtered.Items)
	return filtered
}
