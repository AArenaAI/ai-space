package services

type GaokaoMajorPoolTier struct {
	Priority   []string `json:"priority"`
	Acceptable []string `json:"acceptable"`
	Cautious   []string `json:"cautious"`
	Rejected   []string `json:"rejected"`
}

func tierGaokaoMajorPool(profile GaokaoProfile, majors []string) GaokaoMajorPoolTier {
	out := GaokaoMajorPoolTier{Priority: []string{}, Acceptable: []string{}, Cautious: []string{}, Rejected: []string{}}
	seen := map[string]bool{}
	for _, major := range majors {
		if major == "" || major == "院校投档线" || seen[major] {
			continue
		}
		seen[major] = true
		switch {
		case matchesAnyGaokaoText(major, profile.RejectedMajors):
			out.Rejected = append(out.Rejected, major)
		case matchesAnyGaokaoText(major, profile.PreferredMajors):
			out.Priority = append(out.Priority, major)
		case matchesAnyGaokaoText(major, []string{"材料", "化学", "化工", "土木", "护理", "生物", "农学", "环境", "地质", "矿业", "水产"}):
			out.Cautious = append(out.Cautious, major)
		default:
			out.Acceptable = append(out.Acceptable, major)
		}
	}
	return out
}

func matchesAnyGaokaoText(text string, patterns []string) bool {
	for _, pattern := range patterns {
		if pattern == "" {
			continue
		}
		if containsFold(text, pattern) || containsFold(pattern, text) {
			return true
		}
	}
	return false
}

func flattenedRecommendedMajorPool(tier GaokaoMajorPoolTier) []string {
	out := []string{}
	out = append(out, tier.Priority...)
	out = append(out, tier.Acceptable...)
	out = append(out, tier.Cautious...)
	return out
}
