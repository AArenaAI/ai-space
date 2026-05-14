#!/bin/bash

# AI Space 启动脚本
# 用法: ./start.sh [--no-cf] [前端端口] [后端端口]
# 例如: ./start.sh --no-cf 9090 9091
#
# --no-cf: 不启动临时 Cloudflare 隧道，适合已有固定域名的情况
#          固定域名需要通过外部 Cloudflare Tunnel 配置指向本地端口

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 解析参数
NO_CF=false
ARGS=()

for arg in "$@"; do
    if [ "$arg" = "--no-cf" ]; then
        NO_CF=true
    else
        ARGS+=("$arg")
    fi
done

# 端口配置
FRONTEND_PORT="${ARGS[0]:-9090}"
BACKEND_PORT="${ARGS[1]:-9091}"

# 项目路径
PROJECT_DIR="/workspace/aipool"
FRONTEND_DIR="$PROJECT_DIR/frontend"
BACKEND_DIR="$PROJECT_DIR/backend-go"
BACKEND_BIN="$BACKEND_DIR/aipool"
CF_BIN="/tmp/cloudflared"

# 日志目录
LOG_DIR="/tmp/aipool"
mkdir -p "$LOG_DIR"

# 保存PID文件
PID_FILE="$LOG_DIR/pids.txt"

# 检查是否已有实例在运行
if [ -f "$PID_FILE" ]; then
    echo -e "${YELLOW}[警告] 检测到已有实例在运行，先执行 ./stop.sh 停止${NC}"
    exit 1
fi

echo -e "${BLUE}=== AI Space 启动 ===${NC}"
echo "前端端口: $FRONTEND_PORT"
echo "后端端口: $BACKEND_PORT"
if [ "$NO_CF" = true ]; then
    echo -e "${YELLOW}Cloudflare 临时隧道: 已禁用 (使用固定域名)${NC}"
fi
echo ""

# 1. 检查前端项目
if [ ! -f "$FRONTEND_DIR/package.json" ]; then
    echo -e "${RED}[错误] 前端项目不存在: $FRONTEND_DIR/package.json${NC}"
    echo "请先运行: cd /workspace/aipool/frontend && npm install"
    exit 1
fi

# 2. 检查后端二进制文件
if [ ! -f "$BACKEND_BIN" ]; then
    echo -e "${RED}[错误] 后端二进制文件不存在: $BACKEND_BIN${NC}"
    echo "请先运行: cd /workspace/aipool/backend-go && go build -o aipool-backend ./cmd/main.go"
    exit 1
fi

# 3. 检查 Cloudflared（仅当需要临时隧道时）
if [ "$NO_CF" = false ] && [ ! -f "$CF_BIN" ]; then
    echo -e "${YELLOW}[提示] 未找到 cloudflared，正在下载...${NC}"
    curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o "$CF_BIN" 2>/dev/null || {
        echo -e "${YELLOW}[提示] Cloudflared 下载失败，将不提供外网访问${NC}"
        CF_BIN=""
    }
    [ -f "$CF_BIN" ] && chmod +x "$CF_BIN"
fi

# 4. 检查端口是否被占用
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${RED}[错误] 端口 $port 已被占用${NC}"
        echo "请先执行: lsof -ti:$port | xargs kill -9"
        exit 1
    fi
}

check_port "$FRONTEND_PORT"
check_port "$BACKEND_PORT"

# 5. 启动后端
echo -e "${GREEN}[1/4] 启动后端服务 (Go) 端口: $BACKEND_PORT...${NC}"
cd "$BACKEND_DIR"
$BACKEND_BIN > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" >> "$PID_FILE"

# 等待后端启动
for i in {1..10}; do
    if curl -s "http://localhost:$BACKEND_PORT/health" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ 后端启动成功 (PID: $BACKEND_PID)${NC}"
        break
    fi
    if [ $i -eq 10 ]; then
        echo -e "${RED}❌ 后端启动超时，请检查日志: $LOG_DIR/backend.log${NC}"
        cat "$LOG_DIR/backend.log" | tail -20
        exit 1
    fi
    sleep 1
done

# 6. 启动 Cloudflare 隧道（仅当未禁用时）
BACKEND_URL=""
FRONTEND_URL=""

if [ "$NO_CF" = false ] && [ -n "$CF_BIN" ] && [ -f "$CF_BIN" ]; then
    echo -e "${GREEN}[2/4] 启动 Cloudflare 后端隧道...${NC}"
    $CF_BIN tunnel --url "http://localhost:$BACKEND_PORT" > "$LOG_DIR/cf_backend.log" 2>&1 &
    CF_BACKEND_PID=$!
    echo "$CF_BACKEND_PID" >> "$PID_FILE"
    
    # 等待获取域名
    for i in {1..15}; do
        BACKEND_URL=$(grep -oE 'https://[^ ]*\.trycloudflare\.com' "$LOG_DIR/cf_backend.log" | head -1 || echo "")
        if [ -n "$BACKEND_URL" ]; then
            echo -e "${GREEN}✅ 后端隧道: $BACKEND_URL${NC}"
            break
        fi
        sleep 1
    done
    
    # 开发模式下不需要替换前端API地址，前端通过 next.config.js proxy 或直连后端
    echo -e "${YELLOW}[提示] 开发模式下前端请求 /api 将由 nginx 或 next dev proxy 处理${NC}"
    
    # 启动前端隧道
    echo -e "${GREEN}[4/4] 启动 Cloudflare 前端隧道...${NC}"
    $CF_BIN tunnel --url "http://localhost:$FRONTEND_PORT" > "$LOG_DIR/cf_frontend.log" 2>&1 &
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

# 7. 启动前端开发服务器
# 开发模式下使用 Next.js dev server，不需要静态文件修复

echo -e "${GREEN}🚀 启动前端开发服务器 (Next.js dev) 端口: $FRONTEND_PORT...${NC}"
cd "$FRONTEND_DIR"
npm run dev -- -p "$FRONTEND_PORT" > "$LOG_DIR/frontend.log" 2>&1 &
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
    echo ""
    echo -e "${YELLOW}提示: 如需临时隧道，去掉 --no-cf 参数即可${NC}"
elif [ -n "$FRONTEND_URL" ]; then
    echo -e "${YELLOW}🌐 外网访问 (Cloudflare 隧道):${NC}"
    echo "   前端: $FRONTEND_URL"
    echo "   后端: $BACKEND_URL"
    echo ""
    echo -e "${YELLOW}⚠️  注意: trycloudflare.com 域名可能被部分钱包标记为风险${NC}"
    echo -e "${YELLOW}   建议使用自己的域名绑定 Cloudflare Tunnel${NC}"
else
    echo -e "${YELLOW}⚠️  外网访问: Cloudflare 隧道未能创建，请检查日志${NC}"
fi

echo ""
echo -e "${BLUE}--- 常用命令 ---${NC}"
echo "   查看后端日志: tail -f $LOG_DIR/backend.log"
echo "   停止服务: ./stop.sh"
echo ""

# 保存访问地址到文件
if [ -n "$FRONTEND_URL" ]; then
    echo "$FRONTEND_URL" > "$LOG_DIR/frontend_url.txt"
    echo "$BACKEND_URL" > "$LOG_DIR/backend_url.txt"
fi
