#!/usr/bin/env bash
# Dumps the database to a timestamped, compressed file. Requires DATABASE_URL
# WITHOUT a ?schema= query param — src/lib/env.ts refuses to boot with one
# present specifically because pg_dump rejects it (a mistake this build
# actually made — see docs/ARCHITECTURE.md §15).
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set" >&2
  exit 1
fi

OUT_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT_FILE="$OUT_DIR/groweazzy_${TIMESTAMP}.dump"

echo "==> Dumping to $OUT_FILE"
pg_dump "$DATABASE_URL" --format=custom --file="$OUT_FILE"
echo "==> Done: $(du -h "$OUT_FILE" | cut -f1)"
