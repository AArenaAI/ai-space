package services

import "strings"

func missingOpenAICompletedSuffix(streamed, final string) string {
	streamed = strings.TrimSpace(streamed)
	final = strings.TrimSpace(final)
	if final == "" || streamed == final {
		return ""
	}
	if streamed == "" {
		return final
	}
	if strings.HasPrefix(final, streamed) {
		return strings.TrimPrefix(final, streamed)
	}
	if strings.Contains(streamed, final) {
		return ""
	}

	// OpenAI completed text can differ around the boundary from emitted deltas
	// (trimmed whitespace, punctuation normalization, or duplicate fragments).
	// Append only the missing tail instead of replaying the whole final answer.
	streamedRunes := []rune(streamed)
	finalRunes := []rune(final)
	maxOverlap := len(streamedRunes)
	if len(finalRunes) < maxOverlap {
		maxOverlap = len(finalRunes)
	}
	for overlap := maxOverlap; overlap > 0; overlap-- {
		if string(streamedRunes[len(streamedRunes)-overlap:]) == string(finalRunes[:overlap]) {
			return string(finalRunes[overlap:])
		}
	}
	return final
}
