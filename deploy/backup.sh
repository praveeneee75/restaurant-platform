#!/bin/sh
set -eu
umask 077

DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKUP_DIR=${BACKUP_DIR:-/var/backups/kmaster}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="$BACKUP_DIR/restaurant_saas_$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"
cd "$DEPLOY_DIR/.."

docker compose --env-file deploy/.env -f deploy/compose.yml exec -T db \
  pg_dump -U "$(sed -n 's/^DB_USER=//p' deploy/.env)" \
  -d "$(sed -n 's/^DB_NAME=//p' deploy/.env)" \
  --clean --if-exists | gzip -9 > "$TARGET"

test -s "$TARGET"
find "$BACKUP_DIR" -type f -name 'restaurant_saas_*.sql.gz' -mtime +14 -delete
printf 'Backup created: %s\n' "$TARGET"
