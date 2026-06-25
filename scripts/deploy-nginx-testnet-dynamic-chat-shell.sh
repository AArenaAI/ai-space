#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_CONF="$REPO_DIR/deploy/nginx/testnet-dynamic-chat-shell.conf"
TARGET_CONF="/etc/nginx/sites-enabled/ai-space"
BACKUP_CONF="${TARGET_CONF}.bak.$(date +%Y%m%d%H%M%S)"

if [[ ! -f "$SOURCE_CONF" ]]; then
  echo "missing source config: $SOURCE_CONF" >&2
  exit 1
fi

sudo cp "$TARGET_CONF" "$BACKUP_CONF"
sudo cp "$SOURCE_CONF" "$TARGET_CONF"
sudo nginx -t
sudo systemctl reload nginx

echo "nginx dynamic chat shell config deployed"
echo "backup: $BACKUP_CONF"
curl -sS -I --max-time 10 'https://testnet.ai-space.xyz/chat/?id=909' | sed -n '1,24p'
