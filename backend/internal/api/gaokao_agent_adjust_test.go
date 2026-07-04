package api

import "testing"

func TestGaokaoAgentProfilePatchRerunsAdvisor(t *testing.T) {
	profile := map[string]interface{}{"schoolType": "不限", "preferredMajors": []interface{}{"计算机"}, "tuitionLimit": 25000.0}
	updated, patch, actions := gaokaoAgentProfilePatch("不要民办，学费最多15000，只要湖南省内，可以接受专科", profile)
	if updated["schoolType"] != "只看公办" || patch["schoolType"] != "只看公办" {
		t.Fatalf("expected public-only patch, updated=%#v patch=%#v", updated, patch)
	}
	if updated["tuitionLimit"] != 15000 || patch["tuitionLimit"] != 15000 {
		t.Fatalf("expected tuition patch, updated=%#v patch=%#v", updated, patch)
	}
	if len(actions) < 3 {
		t.Fatalf("expected multiple actions, got %#v", actions)
	}
}
