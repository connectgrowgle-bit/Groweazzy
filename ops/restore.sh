#!/usr/bin/env bash
# Restores a dump produced by ops/backup.sh into DATABASE_URL. Destructive —
# confirms before running unless FORCE=1 is set (for scripted/CI use).
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set" >&2
  exit 1
fi

DUMP_FILE="${1:-}"
if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "Usage: ops/restore.sh <path-to-dump-file>" >&2
  exit 1
fi

if [ "${FORCE:-}" != "1" ]; then
  echo "This will overwrite the database at: $DATABASE_URL"
  read -r -p "Type 'yes' to continue: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "==> Restoring $DUMP_FILE"
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$DUMP_FILE"

echo "==> Re-applying manual constraints (restores can predate them)"
./ops/migrate.sh
