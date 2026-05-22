#!/bin/bash
set -e

GUEST_ID="test-reasoning-$(date +%s)"
API_URL="http://localhost:9091/api/chat"
LOG_DIR="/workspace/aipool/backend/test_logs"
mkdir -p "$LOG_DIR"

# 通用测试函数
test_model() {
  local model=$1
  local reasoning=$2
  local effort=$3
  local suffix=""
  if [ "$reasoning" = "true" ]; then
    suffix="reasoning-${effort:-on}"
  else
    suffix="no-reasoning"
  fi
  local logfile="$LOG_DIR/${model}_${suffix}.log"

  echo "===== Testing $model | reasoning=$reasoning | effort=$effort ====="

  local body
  if [ -n "$effort" ]; then
    body=$(jq -n \
      --arg model "$model" \
      --arg reasoning "$reasoning" \
      --arg effort "$effort" \
      '{model: $model, messages: [{role:"user",content:"用一句话介绍你自己，然后说明1+1等于几。"}], stream: true, reasoning: ($reasoning == "true"), reasoning_effort: $effort}')
  else
    body=$(jq -n \
      --arg model "$model" \
      --arg reasoning "$reasoning" \
      '{model: $model, messages: [{role:"user",content:"用一句话介绍你自己，然后说明1+1等于几。"}], stream: true, reasoning: ($reasoning == "true")}')
  fi

  curl -s -N \
    -H "Content-Type: application/json" \
    -H "X-Guest-ID: $GUEST_ID" \
    -d "$body" \
    "$API_URL" > "$logfile" 2>&1 || true

  echo "Log saved to $logfile"
  echo "--- Delta types in stream ---"
  grep -oP '(?<=data: )\{.*\}' "$logfile" | while read -r line; do
    echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); delta=d.get('choices',[{}])[0].get('delta',{}); print({k:v for k,v in delta.items() if v})" 2>/dev/null || true
  done
  echo "--- Has reasoning_content? ---"
  grep -q "reasoning_content" "$logfile" && echo "YES" || echo "NO"
  echo "--- Has <think>? ---"
  grep -q "<think>" "$logfile" && echo "YES" || echo "NO"
  echo "--- Done? ---"
  grep -q "\[DONE\]" "$logfile" && echo "YES" || echo "NO"
  echo ""
}

# 1. deepseek-v4-pro + reasoning
test_model "deepseek-v4-pro" "true" "medium"

# 2. deepseek-v4-pro no reasoning
test_model "deepseek-v4-pro" "false" ""

# 3. gpt-5.4 + reasoning
test_model "gpt-5.4" "true" "medium"

# 4. gpt-5.4 no reasoning
test_model "gpt-5.4" "false" ""

# 5. gpt-5.5 + reasoning (medium)
test_model "gpt-5.5" "true" "medium"

# 6. gpt-5.5 no reasoning
test_model "gpt-5.5" "false" ""

# 7. gpt-5.5-pro + reasoning (minimal)
test_model "gpt-5.5-pro" "true" "minimal"

# 8. gpt-5.5-pro no reasoning
test_model "gpt-5.5-pro" "false" ""

# 9. gemini-3.1-pro-preview + reasoning
test_model "gemini-3.1-pro-preview" "true" "medium"

# 10. gemini-3.1-pro-preview no reasoning
test_model "gemini-3.1-pro-preview" "false" ""

echo "All tests completed. Logs in $LOG_DIR"
