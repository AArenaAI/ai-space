package api

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestInjectChatBootstrapPayload(t *testing.T) {
	payload := gin.H{"auth_status": "authenticated", "content": "</script><!--"}
	out, err := injectChatBootstrapPayload([]byte("<html><head><title>x</title></head><body>app</body></html>"), payload)
	if err != nil {
		t.Fatalf("inject: %v", err)
	}
	if !bytes.Contains(out, []byte(`id="__AI_SPACE_BOOTSTRAP__"`)) {
		t.Fatalf("missing bootstrap script: %s", string(out))
	}
	if bytes.Contains(out, []byte(`</script><!--`)) {
		t.Fatalf("unescaped script-breaking payload: %s", string(out))
	}
	start := bytes.Index(out, []byte(`type="application/json">`))
	if start < 0 {
		t.Fatalf("missing json script type: %s", string(out))
	}
	start += len(`type="application/json">`)
	end := bytes.Index(out[start:], []byte(`</script>`))
	if end < 0 {
		t.Fatalf("missing script end: %s", string(out))
	}
	var decoded map[string]any
	if err := json.Unmarshal(out[start:start+end], &decoded); err != nil {
		t.Fatalf("json payload does not decode: %v payload=%s", err, string(out[start:start+end]))
	}
	if decoded["auth_status"] != "authenticated" {
		t.Fatalf("unexpected decoded payload: %+v", decoded)
	}
}
