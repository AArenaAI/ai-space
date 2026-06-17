package services

import "testing"

func TestResolveImageEditRouteDefaults(t *testing.T) {
	tests := []struct {
		name    string
		mode    string
		subMode string
		intent  string
		want    ImageEditRoute
	}{
		{
			name: "upscale defaults to faithful enhance",
			mode: "upscale",
			want: ImageEditRoute{EditMode: "upscale", SubMode: "faithful", Intent: ImageEditIntentFaithfulEnhance},
		},
		{
			name:    "inpaint replace maps to local replace",
			mode:    "inpaint",
			subMode: "replace",
			want:    ImageEditRoute{EditMode: "inpaint", SubMode: "replace", Intent: ImageEditIntentLocalReplace},
		},
		{
			name:    "unknown sub mode falls back safely",
			mode:    "region-brush",
			subMode: "unknown",
			intent:  "unexpected_intent",
			want:    ImageEditRoute{EditMode: "region-brush", SubMode: "remove", Intent: ImageEditIntentObjectRemoveRepair},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveImageEditRoute(tt.mode, tt.subMode, tt.intent)
			if got != tt.want {
				t.Fatalf("ResolveImageEditRoute() = %#v, want %#v", got, tt.want)
			}
		})
	}
}
