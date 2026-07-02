#!/bin/bash

# AI Space 启动脚本 (前端静态文件由 nginx 直接映射)
# 用法: ./start.sh [前端 nginx 端口(仅展示)] [后端端口]

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

FRONTEND_PORT="${1:-9090}"
BACKEND_PORT="${2:-9091}"
PROJECT_DIR="/workspace/aipool"
FRONTEND_DIR="$PROJECT_DIR/frontend"
BACKEND_DIR="$PROJECT_DIR/backend"
BACKEND_BIN="$BACKEND_DIR/aipool"
export PATH="/usr/local/go/bin:$PATH"
RUN_DIR="$PROJECT_DIR/run"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$RUN_DIR" "$LOG_DIR" /tmp/aipool
PID_FILE="$RUN_DIR/backend.pid"
LEGACY_PID_FILE="/tmp/aipool/pids.txt"
BACKEND_LOG="$LOG_DIR/backend.log"
BUILD_LOG="$LOG_DIR/build.log"

echo -e "${BLUE}=== AI Space 启动 ===${NC}"
echo "前端端口: $FRONTEND_PORT (由 nginx 映射静态目录，不在脚本中启动前端 Node 服务)"
echo "后端端口: $BACKEND_PORT"
echo ""

# 清理旧进程
for file in "$PID_FILE" "$LEGACY_PID_FILE"; do
    if [ -f "$file" ]; then
        while IFS= read -r pid; do
            kill "$pid" 2>/dev/null || true
        done < "$file"
        rm -f "$file"
    fi
done

# 清理后端端口占用；前端端口由 nginx 管理，不要在这里清理/抢占
for port in "$BACKEND_PORT"; do
    pid=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo -e "${YELLOW}⚠️  端口 $port 被占用，强制杀掉 PID $pid...${NC}"
        kill -9 "$pid" 2>/dev/null || true
        sleep 1
    fi
done

# [1/2] 编译并启动后端
echo -e "${GREEN}[1/2] 编译后端服务 (Go)...${NC}"
cd "$BACKEND_DIR"
go build -o aipool ./cmd/
echo -e "${GREEN}✅ 后端编译完成${NC}"

echo -e "${GREEN}[1/2] 启动后端服务 (Go) 端口: $BACKEND_PORT...${NC}"
{
    echo ""
    echo "========== $(date -Is) starting aipool port=$BACKEND_PORT =========="
} >> "$BACKEND_LOG"
# 显式加载 .env，避免父进程中空的同名环境变量遮蔽 godotenv.Load() 读取到的配置。
# set -a 会把 .env 中的变量导出给后端进程；日志不要打印任何敏感值。
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
fi
PORT="$BACKEND_PORT" nohup "$BACKEND_BIN" >> "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$PID_FILE"
echo "$BACKEND_PID" > "$LEGACY_PID_FILE"
echo -e "${GREEN}✅ 后端启动成功 (PID: $BACKEND_PID)${NC}"
echo ""

# [2/2] 构建前端静态文件；nginx 直接映射 frontend/out
echo -e "${GREEN}📦 构建静态文件...${NC}"
cd "$FRONTEND_DIR"
npm run build > "$BUILD_LOG" 2>&1
BUILD_EXIT=$?
if [ $BUILD_EXIT -ne 0 ]; then
    echo -e "${RED}❌ 构建失败，查看日志: tail -20 $BUILD_LOG${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 构建完成${NC}"
echo -e "${GREEN}✅ 前端静态文件已输出到: $FRONTEND_DIR/out${NC}"
echo -e "${YELLOW}ℹ️  前端由 nginx 直接映射该目录，启动脚本不再启动 Node/Next 前端服务${NC}"

echo ""
echo -e "${BLUE}=======================================${NC}"
echo -e "${GREEN}       AI Space 启动成功！${NC}"
echo -e "${BLUE}=======================================${NC}"
echo ""
echo -e "${YELLOW}💻 本地访问:${NC}"
echo "   前端: http://localhost:$FRONTEND_PORT (nginx)"
echo "   后端: http://localhost:$BACKEND_PORT"
echo ""
echo -e "${YELLOW}--- 常用命令 ---${NC}"
echo -e "${YELLOW}   查看后端日志: tail -f $BACKEND_LOG${NC}"
echo -e "${YELLOW}   查看构建日志: tail -f $BUILD_LOG${NC}"
echo -e "${YELLOW}   停止服务: ./stop.sh${NC}"
