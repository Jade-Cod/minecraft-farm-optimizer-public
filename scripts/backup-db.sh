#!/usr/bin/env bash
# Nightly SQLite backup — run as a cron job on the VPS.
set -euo pipefail
DB=/app/backend/data/history.db
DEST=/app/backend/data/history.db.bak-$(date +%Y%m%d)
sqlite3 "$DB" ".backup $DEST"
echo "Backup written to $DEST"
