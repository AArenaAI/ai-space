package api

import "testing"

func TestNormalizeVideoGenerationParamsOfficialSeedanceModels(t *testing.T) {
	tests := []struct {
		name       string
		model      string
		duration   int64
		resolution string
		wantErr    bool
	}{
		{"seedance 2 mini accepts auto duration", "doubao-seedance-2.0-mini", -1, "720p", false},
		{"seedance 2 mini rejects 1080p", "doubao-seedance-2.0-mini", 8, "1080p", true},
		{"seedance 15 pro accepts auto duration", "doubao-seedance-1.5-pro", -1, "1080p", false},
		{"seedance 15 pro rejects 15s", "doubao-seedance-1.5-pro", 15, "720p", true},
		{"seedance 10 pro accepts 2s", "doubao-seedance-1.0-pro", 2, "1080p", false},
		{"seedance 10 pro rejects auto", "doubao-seedance-1.0-pro", -1, "720p", true},
		{"seedance 10 pro fast rejects 1080p", "doubao-seedance-1.0-pro-fast", 6, "1080p", true},
		{"legacy pro alias accepts seedance 2 duration", "doubao-seedance-2-0-pro-260128", 15, "1080p", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, _, err := normalizeVideoGenerationParams(tt.model, "16:9", tt.resolution, tt.duration, 1, 0)
			if (err != nil) != tt.wantErr {
				t.Fatalf("normalizeVideoGenerationParams() err=%v wantErr=%v", err, tt.wantErr)
			}
		})
	}
}
