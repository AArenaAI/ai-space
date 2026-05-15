#!/bin/bash

# AI Space 启动脚本 (静态文件模式)
# 用法: ./start.sh [--no-cf] [前端端口] [后端端口]
# --no-cf: 不启动临时 Cloudflare 隧道，适合已有固定域名的情况

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

NO_CF=false
ARGS=()
for arg in "$@"; do
    [ "$arg" = "--no-cf" ] && NO_CF=true || ARGS+=("$arg")
done

FRONTEND_PORT="${ARGS[0]:-9090}"
BACKEND_PORT="${ARGS[1]:-9091}"
PROJECT_DIR="/workspace/aipool"
FRONTEND_DIR="$PROJECT_DIR/frontend"
BACKEND_DIR="$PROJECT_DIR/backend-go"
BACKEND_BIN="$BACKEND_DIR/aipool"
CF_BIN="/tmp/cloudflared"
LOG_DIR="/tmp/aipool"
mkdir -p "$LOG_DIR"
PID_FILE="$LOG_DIR/pids.txt"

echo -e "${BLUE}=== AI Space 启动 ===${NC}"
echo "前端端口: $FRONTEND_PORT"
echo "后端端口: $BACKEND_PORT"
echo ""

# 清理旧进程
if [ -f "$PID_FILE" ]; then
    while IFS= read -r pid; do
        kill "$pid" 2>/dev/null || true
    done < "$PID_FILE"
    rm -f "$PID_FILE"
fi

# 清理端口占用
for port in "$FRONTEND_PORT" "$BACKEND_PORT"; do
    pid=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo -e "${YELLOW}⚠️  端口 $port 被占用，强制杀掉 PID $pid...${NC}"
        kill -9 "$pid" 2>/dev/null || true
        sleep 1
    fi
done

# [1/4] 启动后端
echo -e "${GREEN}[1/4] 启动后端服务 (Go) 端口: $BACKEND_PORT...${NC}"
cd "$BACKEND_DIR"
PORT="$BACKEND_PORT" nohup "$BACKEND_BIN" > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" >> "$PID_FILE"
echo -e "${GREEN}✅ 后端启动成功 (PID: $BACKEND_PID)${NC}"

# Cloudflare 后端隧道
if [ "$NO_CF" = false ]; then
    echo -e "${GREEN}[2/4] 启动 Cloudflare 后端隧道...${NC}"
    nohup "$CF_BIN" tunnel --url "http://localhost:$BACKEND_PORT" > "$LOG_DIR/cf_backend.log" 2>&1 &
    CF_BACKEND_PID=$!
    echo "$CF_BACKEND_PID" >> "$PID_FILE"
    for i in {1..15}; do
        BACKEND_URL=$(grep -oE 'https://[^ ]*\.trycloudflare\.com' "$LOG_DIR/cf_backend.log" | head -1 || echo "")
        if [ -n "$BACKEND_URL" ]; then
            echo -e "${GREEN}✅ 后端隧道: $BACKEND_URL${NC}"
            break
        fi
        sleep 1
    done
fi

# Cloudflare 前端隧道
if [ "$NO_CF" = false ]; then
    echo -e "${GREEN}[3/4] 启动 Cloudflare 前端隧道...${NC}"
    nohup "$CF_BIN" tunnel --url "http://localhost:$FRONTEND_PORT" > "$LOG_DIR/cf_frontend.log" 2>&1 &
    CF_FRONTEND_PID=$!
    echo "$CF_FRONTEND_PID" >> "$PID_FILE"
    for i in {1..15}; do
        FRONTEND_URL=$(grep -oE 'https://[^ ]*\.trycloudflare\.com' "$LOG_DIR/cf_frontend.log" | head -1 || echo "")
        if [ -n "$FRONTEND_URL" ]; then
            echo -e "${GREEN}✅ 前端隧道: $FRONTEND_URL${NC}"
            break
        fi
        sleep 1
    done
else
    echo -e "${YELLOW}[2/4] 跳过 Cloudflare 隧道 (使用固定域名)${NC}"
fi

# [4/4] 构建静态文件并启动前端
echo -e "${GREEN}📦 构建静态文件...${NC}"
cd "$FRONTEND_DIR"
npm run build > "$LOG_DIR/build.log" 2>&1
BUILD_EXIT=$?
if [ $BUILD_EXIT -ne 0 ]; then
    echo -e "${RED}❌ 构建失败，查看日志: tail -20 $LOG_DIR/build.log${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 构建完成${NC}"

echo -e "${GREEN}🚀 启动前端服务 (Node.js + API proxy) 端口: $FRONTEND_PORT...${NC}"
cd "$PROJECT_DIR"
nohup node server.js > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" >> "$PID_FILE"
echo -e "${GREEN}✅ 前端启动成功 (PID: $FRONTEND_PID)${NC}"

echo ""
echo -e "${BLUE}=======================================${NC}"
echo -e "${GREEN}       AI Space 启动成功！${NC}"
echo -e "${BLUE}=======================================${NC}"
echo ""
echo -e "${YELLOW}💻 本地访问:${NC}"
echo "   前端: http://localhost:$FRONTEND_PORT"
echo "   后端: http://localhost:$BACKEND_PORT"
echo ""
if [ "$NO_CF" = true ]; then
    echo -e "${GREEN}🌐 固定域名访问:${NC}"
    echo "   前端: https://mideastsim.clawdbotgame.com/"
    echo "   (确保外部 Cloudflare Tunnel 已配置指向 localhost:$FRONTEND_PORT)"
fi
echo ""
echo -e "${YELLOW}--- 常用命令 ---${NC}"
echo -e "${YELLOW}   查看后端日志: tail -f $LOG_DIR/backend.log${NC}"
echo -e "${YELLOW}   停止服务: ./stop.sh${NC}"
