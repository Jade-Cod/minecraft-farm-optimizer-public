#!/usr/bin/env bash
# Push the public fork to the production VPS and deploy.
# Usage:  ./scripts/push-to-vps.sh
# Override host with:  VPS_HOST=root@1.2.3.4 ./scripts/push-to-vps.sh
set -euo pipefail

VPS_HOST=${VPS_HOST:-root@165.22.167.85}
DEST="$VPS_HOST:~   
DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Syncing code to $VPS_HOST..."
rsync -avz --delete \
  --exclude='.venv/' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  --exclude='.DS_Store' \
  --exclude='backend/data/' \
  --exclude='.git/' \
  --exclude='.env' \
  --exclude='deploy/.env' \
  "$DIR/" "$DEST/"

echo ""
echo "==> Deploying on server..."
ssh "$VPS_HOST" 'cd ~/mclabs-public/deploy && docker compose up -d --build 2>&1 | tail -20'

echo ""
echo "==> Done. Visit https://labs.faded.me"
