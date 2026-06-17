package services

import "strings"

const (
	ImageEditIntentRemoveBackground   = "remove_background"
	ImageEditIntentReplaceBackground  = "replace_background"
	ImageEditIntentRemoveText         = "remove_text"
	ImageEditIntentFaithfulEnhance    = "faithful_enhance"
	ImageEditIntentAIUpscale          = "ai_upscale"
	ImageEditIntentLocalReplace       = "local_replace"
	ImageEditIntentLocalModify        = "local_modify"
	ImageEditIntentLocalAdd           = "local_add"
	ImageEditIntentLocalRepair        = "local_repair"
	ImageEditIntentObjectRemoveRepair = "object_remove_repair"
)

// ImageEditRoute is the normalized intent/router decision for one image edit request.
// Task 1 only establishes the schema and safe fallback. Concrete provider/algorithm
// branching is intentionally added in later tasks so existing edit behavior stays unchanged.
type ImageEditRoute struct {
	EditMode string `json:"edit_mode"`
	SubMode  string `json:"sub_mode"`
	Intent   string `json:"intent"`
}

type imageEditSubModeRoute struct {
	SubMode string
	Intent  string
}

var defaultImageEditRoutes = map[string]imageEditSubModeRoute{
	"remove-bg":    {SubMode: "standard", Intent: ImageEditIntentRemoveBackground},
	"replace-bg":   {SubMode: "realistic", Intent: ImageEditIntentReplaceBackground},
	"text-removal": {SubMode: "auto", Intent: ImageEditIntentRemoveText},
	"upscale":      {SubMode: "faithful", Intent: ImageEditIntentFaithfulEnhance},
	"inpaint":      {SubMode: "replace", Intent: ImageEditIntentLocalReplace},
	"region-brush": {SubMode: "remove", Intent: ImageEditIntentObjectRemoveRepair},
}

var imageEditSubModeRoutes = map[string]map[string]string{
	"remove-bg": {
		"standard":     ImageEditIntentRemoveBackground,
		"fine-hair":    ImageEditIntentRemoveBackground,
		"product-edge": ImageEditIntentRemoveBackground,
		"defringe":     ImageEditIntentRemoveBackground,
	},
	"replace-bg": {
		"solid":     ImageEditIntentReplaceBackground,
		"commerce":  ImageEditIntentReplaceBackground,
		"studio":    ImageEditIntentReplaceBackground,
		"realistic": ImageEditIntentReplaceBackground,
		"stylized":  ImageEditIntentReplaceBackground,
	},
	"text-removal": {
		"auto":       ImageEditIntentRemoveText,
		"screenshot": ImageEditIntentRemoveText,
		"poster":     ImageEditIntentRemoveText,
		"watermark":  ImageEditIntentRemoveText,
	},
	"upscale": {
		"faithful": ImageEditIntentFaithfulEnhance,
		"ai":       ImageEditIntentAIUpscale,
	},
	"inpaint": {
		"replace": ImageEditIntentLocalReplace,
		"modify":  ImageEditIntentLocalModify,
		"add":     ImageEditIntentLocalAdd,
		"repair":  ImageEditIntentLocalRepair,
	},
	"region-brush": {
		"remove":         ImageEditIntentObjectRemoveRepair,
		"include-shadow": ImageEditIntentObjectRemoveRepair,
		"strong-cleanup": ImageEditIntentObjectRemoveRepair,
	},
}

// ResolveImageEditRoute normalizes frontend edit_mode/sub_mode/intent into a stable route.
// Unknown sub_mode or intent values fall back to the edit mode default rather than failing,
// preserving compatibility with older clients and current six-tool behavior.
func ResolveImageEditRoute(editMode, subMode, requestedIntent string) ImageEditRoute {
	mode := strings.ToLower(strings.TrimSpace(editMode))
	defaults, ok := defaultImageEditRoutes[mode]
	if !ok {
		return ImageEditRoute{EditMode: mode, SubMode: strings.TrimSpace(subMode), Intent: strings.TrimSpace(requestedIntent)}
	}

	normalizedSubMode := strings.ToLower(strings.TrimSpace(subMode))
	intent := strings.TrimSpace(requestedIntent)
	if normalizedSubMode == "" {
		normalizedSubMode = defaults.SubMode
	}

	if subModes, ok := imageEditSubModeRoutes[mode]; ok {
		if mappedIntent, ok := subModes[normalizedSubMode]; ok {
			if intent == "" || intent != mappedIntent {
				intent = mappedIntent
			}
			return ImageEditRoute{EditMode: mode, SubMode: normalizedSubMode, Intent: intent}
		}
	}

	return ImageEditRoute{EditMode: mode, SubMode: defaults.SubMode, Intent: defaults.Intent}
}
