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

# 方式2: 按明确命令杀掉残留后端进程，避免 pkill -f "aipool" 误杀当前 /workspace/aipool shell
# 前端静态文件由 nginx 直接映射，stop.sh 不处理 nginx/前端端口。
pkill -f "/workspace/aipool/backend/aipool" 2>/dev/null || true

sleep 1

# 验证后端是否停止；前端 9090 由 nginx 管理，不在这里检查/杀掉
PORT_9091=$(lsof -ti:9091 2>/dev/null || echo "")

if [ -z "$PORT_9091" ]; then
    echo -e "${GREEN}✅ 后端服务已停止${NC}"
else
    echo -e "${RED}⚠️  后端端口 9091 仍被占用，强制杀掉...${NC}"
    [ -n "$PORT_9091" ] && kill -9 $PORT_9091 2>/dev/null || true
    echo -e "${GREEN}✅ 已强制清理${NC}"
fi

echo -e "${GREEN}完成${NC}"
