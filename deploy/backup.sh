#!/bin/bash
set -euo pipefail
umask 077

DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKUP_DIR=${BACKUP_DIR:-/var/backups/kmaster}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="$BACKUP_DIR/restaurant_saas_$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { echo 'Another backup is running' >&2; exit 1; }
PARTIAL=$(mktemp "$BACKUP_DIR/.restaurant_saas_XXXXXX.sql.gz.partial")
trap 'rm -f -- "$PARTIAL"' EXIT
cd "$DEPLOY_DIR/.."

docker compose --env-file deploy/.env -f deploy/compose.yml exec -T db \
  sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  | gzip -9 > "$PARTIAL"

gzip -t "$PARTIAL"
gzip -cd "$PARTIAL" | tail -n 8 | grep -q '^-- PostgreSQL database dump complete'
mv -- "$PARTIAL" "$TARGET"
# Keep existing backups during recovery; retention is reviewed separately.
printf 'Backup created: %s\n' "$TARGET"
