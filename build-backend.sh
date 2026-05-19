#!/bin/bash

# AI Space 后端编译脚本
# 用法: ./build-backend.sh

set -e

export PATH="/usr/local/go/bin:$PATH"

PROJECT_DIR="/workspace/aipool"
BACKEND_DIR="$PROJECT_DIR/backend"

if ! command -v go >/dev/null 2>&1; then
    echo "❌ 未找到 go，请确认 /usr/local/go/bin/go 是否存在"
    exit 1
fi

echo "Go: $(go version)"
echo "编译后端..."
cd "$BACKEND_DIR"
go build -o aipool ./cmd/
echo "✅ 后端编译完成: $BACKEND_DIR/aipool"
