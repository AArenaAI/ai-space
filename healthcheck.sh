#!/bin/bash
# AI Space 后端健康检查自恢复脚本（测试环境：非 systemd）
# 用法: ./healthcheck.sh
# 说明: 前端静态文件由 nginx 映射，脚本只检查/恢复后端。

BACKEND_PORT="${BACKEND_PORT:-9091}"
PROJECT_DIR="/workspace/aipool"
BACKEND_DIR="$PROJECT_DIR/backend"
BACKEND_BIN="$BACKEND_DIR/aipool"
RUN_DIR="$PROJECT_DIR/run"
LOG_DIR="$PROJECT_DIR/logs"
BACKEND_LOG="$LOG_DIR/backend.log"
PID_FILE="$RUN_DIR/backend.pid"
LEGACY_PID_FILE="/tmp/aipool/pids.txt"

mkdir -p "$RUN_DIR" "$LOG_DIR" /tmp/aipool

if ! curl -sf "http://127.0.0.1:$BACKEND_PORT/health" > /dev/null 2>&1; then
    {
        echo ""
        echo "========== $(date -Is) healthcheck restarting aipool port=$BACKEND_PORT =========="
    } >> "$BACKEND_LOG"

    pid=$(lsof -ti :"$BACKEND_PORT" 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo "[$(date -Is)] cleaning stale port $BACKEND_PORT pid=$pid" >> "$BACKEND_LOG"
        kill -9 $pid 2>/dev/null || true
        sleep 1
    fi

    cd "$BACKEND_DIR" || exit 1
    PORT="$BACKEND_PORT" nohup "$BACKEND_BIN" >> "$BACKEND_LOG" 2>&1 &
    BACKEND_PID=$!
    echo "$BACKEND_PID" > "$PID_FILE"
    echo "$BACKEND_PID" > "$LEGACY_PID_FILE"
    echo "[$(date -Is)] backend restarted pid=$BACKEND_PID log=$BACKEND_LOG" >> "$BACKEND_LOG"
fi
