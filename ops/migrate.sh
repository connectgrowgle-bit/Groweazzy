#!/usr/bin/env bash
# Runs the Drizzle-generated migrations, then the hand-written constraints
# Drizzle's DSL can't express, then VERIFIES the latter actually landed.
# A database missing the manual constraints looks fine until concurrent
# load finds the gap — never skip the verify step.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set" >&2
  exit 1
fi

echo "==> Running Drizzle migrations"
npm run db:migrate

echo "==> Applying hand-written manual SQL (drizzle/manual/*.sql)"
for f in drizzle/manual/*.sql; do
  echo "    $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> Verifying money-invariant indexes/constraints landed"
REQUIRED_INDEXES=(
  commission_one_earning_per_conversion_uidx
  payouts_one_open_per_affiliate_uidx
  affiliate_kyc_one_active_uidx
  webhook_events_provider_event_uidx
)

MISSING=0
for idx in "${REQUIRED_INDEXES[@]}"; do
  FOUND=$(psql "$DATABASE_URL" -t -A -c "select 1 from pg_indexes where indexname = '$idx'")
  if [ "$FOUND" != "1" ]; then
    echo "    MISSING: $idx" >&2
    MISSING=1
  fi
done

CONSTRAINT_FOUND=$(psql "$DATABASE_URL" -t -A -c "select 1 from pg_constraint where conname = 'payouts_net_is_gross_minus_tds'")
if [ "$CONSTRAINT_FOUND" != "1" ]; then
  echo "    MISSING: payouts_net_is_gross_minus_tds CHECK constraint" >&2
  MISSING=1
fi

if [ "$MISSING" != "0" ]; then
  echo "==> FAILED: one or more manual constraints did not land. Do not consider migration complete." >&2
  exit 1
fi

echo "==> All manual constraints verified present."
