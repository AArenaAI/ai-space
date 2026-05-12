#!/bin/bash

# AI Space 生产环境启动脚本

export NODE_ENV=production
export DATABASE_URL="file:./dev.db"

# 启动后端 (端口 9091)
echo "启动后端服务 (9091)..."
cd /workspace/aipool/backend
PORT=9091 node dist/index.js &
BACKEND_PID=$!

sleep 3

# 启动前端 (端口 9090)
echo "启动前端服务 (9090)..."
cd /workspace/aipool/frontend
PORT=9090 npm start &
FRONTEND_PID=$!

echo ""
echo "================================"
echo "AI Space 已启动:"
echo "- 后端: http://localhost:9091"
echo "- 前端: http://localhost:9090"
echo "================================"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 等待进程
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT TERM
wait
