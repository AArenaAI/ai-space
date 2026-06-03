#!/bin/bash

# AI Space 后端启动脚本（测试环境：非 systemd，持久日志文件）
# 用法: ./start-backend.sh [后端端口]

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BACKEND_PORT="${1:-9091}"
PROJECT_DIR="/workspace/aipool"
BACKEND_DIR="$PROJECT_DIR/backend"
BACKEND_BIN="$BACKEND_DIR/aipool"
RUN_DIR="$PROJECT_DIR/run"
LOG_DIR="$PROJECT_DIR/logs"
BACKEND_LOG="$LOG_DIR/backend.log"
PID_FILE="$RUN_DIR/backend.pid"
LEGACY_PID_FILE="/tmp/aipool/pids.txt"

mkdir -p "$RUN_DIR" "$LOG_DIR"

if [ ! -x "$BACKEND_BIN" ]; then
    echo -e "${RED}❌ 后端二进制不存在或不可执行: $BACKEND_BIN${NC}"
    echo "请先运行: ./build-backend.sh"
    exit 1
fi

echo -e "${BLUE}=== AI Space 后端启动 ===${NC}"
echo "后端端口: $BACKEND_PORT"
echo "日志文件: $BACKEND_LOG"
echo "PID 文件: $PID_FILE"

# 清理 PID 文件记录的旧进程
for file in "$PID_FILE" "$LEGACY_PID_FILE"; do
    if [ -f "$file" ]; then
        while IFS= read -r pid; do
            if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                echo -e "${YELLOW}⚠️  停止旧后端 PID $pid...${NC}"
                kill "$pid" 2>/dev/null || true
            fi
        done < "$file"
        rm -f "$file"
    fi
done

# 清理后端端口占用
pid=$(lsof -ti :"$BACKEND_PORT" 2>/dev/null || true)
if [ -n "$pid" ]; then
    echo -e "${YELLOW}⚠️  端口 $BACKEND_PORT 被占用，强制杀掉 PID $pid...${NC}"
    kill -9 $pid 2>/dev/null || true
    sleep 1
fi

{
    echo ""
    echo "========== $(date -Is) starting aipool port=$BACKEND_PORT =========="
} >> "$BACKEND_LOG"

cd "$BACKEND_DIR"
PORT="$BACKEND_PORT" nohup "$BACKEND_BIN" >> "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$PID_FILE"
mkdir -p "$(dirname "$LEGACY_PID_FILE")"
echo "$BACKEND_PID" > "$LEGACY_PID_FILE"

READY=0
for _ in $(seq 1 15); do
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        break
    fi
    if curl -sf "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1; then
        READY=1
        break
    fi
    sleep 1
done

if [ "$READY" = "1" ]; then
    echo -e "${GREEN}✅ 后端启动成功 (PID: $BACKEND_PID)${NC}"
    echo -e "${YELLOW}查看日志: tail -f $BACKEND_LOG${NC}"
else
    echo -e "${RED}❌ 后端启动失败，最近日志:${NC}"
    tail -80 "$BACKEND_LOG" || true
    exit 1
fi
