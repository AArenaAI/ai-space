package services

import "strings"

func FilterGaokaoRecommendationsByTrack(recs []GaokaoRecommendation, track string) []GaokaoRecommendation {
	track = strings.TrimSpace(track)
	if track == "" {
		return recs
	}
	out := []GaokaoRecommendation{}
	for _, rec := range recs {
		isCollege := isGaokaoCollegeLevel(rec)
		switch track {
		case "本科", "补录本科":
			if !isCollege {
				out = append(out, rec)
			}
		case "专科", "补录专科":
			if isCollege {
				out = append(out, rec)
			}
		default:
			out = append(out, rec)
		}
	}
	return out
}

func isGaokaoCollegeLevel(rec GaokaoRecommendation) bool {
	text := rec.Level + " " + rec.School + " " + rec.Major + " " + rec.SchoolType
	if containsFold(text, "职业技术大学") || containsFold(text, "职业大学") {
		return false
	}
	return containsFold(text, "专科") || containsFold(text, "高职") || containsFold(text, "职业技术学院") || containsFold(text, "高等专科学校") || containsFold(text, "高等职业")
}

func bandGaokaoRankWindow(rank, minRank int) string {
	if rank <= 0 || minRank <= 0 {
		return ""
	}
	ratio := float64(minRank) / float64(rank)
	if rank <= 1000 && ratio >= 0.25 && ratio < 0.95 {
		return "冲"
	}
	switch {
	case ratio < 0.70:
		return ""
	case ratio < 0.95:
		return "冲"
	case ratio < 1.15:
		return "稳"
	case ratio < 1.45:
		return "保"
	case ratio < 1.80:
		return "垫"
	default:
		return ""
	}
}
