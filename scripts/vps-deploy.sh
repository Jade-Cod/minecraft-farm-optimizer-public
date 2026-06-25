#!/usr/bin/env bash
# Run from the repo root on the VPS after git clone / git pull.
# Usage: bash scripts/vps-deploy.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$REPO_ROOT/deploy"
DB_PATH="/var/lib/docker/volumes/deploy_mclabs-data/_data/history.db"

# 1. Pull latest code
git -C "$REPO_ROOT" pull

# 2. Pre-deploy DB backup (if data volume exists)
if [ -f "$DB_PATH" ]; then
  cp "$DB_PATH" "${DB_PATH}.bak-$(date +%Y%m%d-%H%M)"
  echo "DB backed up."
fi

# 3. Rebuild and restart (deploy/docker-compose.yml is standalone — includes Caddy)
docker compose -f "$DEPLOY_DIR/docker-compose.yml" up -d --build

echo ""
echo "Done. https://labs.faded.me"
