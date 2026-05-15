#!/bin/bash

# AI Space 停止脚本

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

LOG_DIR="/tmp/aipool"
PID_FILE="$LOG_DIR/pids.txt"

echo -e "${YELLOW}=== AI Space 停止 ===${NC}"

# 方式1: 从 PID 文件读取
if [ -f "$PID_FILE" ]; then
    while IFS= read -r pid; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            echo -e "停止进程 PID: $pid ..."
            kill -TERM "$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null
        fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
fi

# 方式2: 按名字杀掉残留进程
pkill -f "aipool" 2>/dev/null || true
pkill -f "next dev.*9090" 2>/dev/null || true
pkill -f "next dev.*9091" 2>/dev/null || true

sleep 1

# 验证是否停止
PORT_9090=$(lsof -ti:9090 2>/dev/null || echo "")
PORT_9091=$(lsof -ti:9091 2>/dev/null || echo "")

if [ -z "$PORT_9090" ] && [ -z "$PORT_9091" ]; then
    echo -e "${GREEN}✅ 所有服务已停止${NC}"
else
    echo -e "${RED}⚠️  仍有进程占用端口，强制杀掉...${NC}"
    [ -n "$PORT_9090" ] && kill -9 $PORT_9090 2>/dev/null || true
    [ -n "$PORT_9091" ] && kill -9 $PORT_9091 2>/dev/null || true
    echo -e "${GREEN}✅ 已强制清理${NC}"
fi

echo -e "${GREEN}完成${NC}"
