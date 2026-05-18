#!/bin/bash
# AI Pool 健康检查自恢复脚本
# 每 3 分钟检查前端和后端，挂了自动重启

BACKEND_PORT=9091
FRONTEND_PORT=9090
BACKEND_DIR="/workspace/aipool/backend"
FRONTEND_DIR="/workspace/aipool"

# 检查后端
if ! curl -sf http://localhost:$BACKEND_PORT/health > /dev/null 2>&1; then
    echo "[$(date)] 后端 $BACKEND_PORT 挂了，正在重启..."
    cd "$BACKEND_DIR" && PORT=$BACKEND_PORT nohup ./aipool > /dev/null 2>&1 &
    echo "[$(date)] 后端已重启"
fi

# 检查前端
if ! curl -sf -o /dev/null http://localhost:$FRONTEND_PORT/ > /dev/null 2>&1; then
    echo "[$(date)] 前端 $FRONTEND_PORT 挂了，正在重启..."
    cd "$FRONTEND_DIR" && nohup node server.js > /dev/null 2>&1 &
    echo "[$(date)] 前端已重启"
fi
