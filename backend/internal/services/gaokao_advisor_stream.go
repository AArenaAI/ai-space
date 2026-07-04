package services

import "encoding/json"

func EncodeGaokaoAdvisorSSEEvent(event string, payload interface{}) string {
	data, err := json.Marshal(payload)
	if err != nil {
		data = []byte(`{"error":"encode_failed"}`)
	}
	return "event: " + event + "\n" + "data: " + string(data) + "\n\n"
}
