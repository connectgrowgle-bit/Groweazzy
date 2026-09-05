-- Hand-written constraints Drizzle's schema DSL cannot express (partial unique
-- indexes, CHECK constraints). Apply with psql AFTER `npm run db:migrate`:
--
--   psql "$DATABASE_URL" -f drizzle/manual/0001_partial_indexes.sql
--
-- Then VERIFY they landed — a database missing these looks identical to one
-- that has them until concurrent load finds the gap:
--
--   psql "$DATABASE_URL" -c "\di commission_one_earning_per_conversion_uidx"
--   psql "$DATABASE_URL" -c "\di payouts_one_open_per_affiliate_uidx"
--   psql "$DATABASE_URL" -c "\di affiliate_kyc_one_active_uidx"
--   psql "$DATABASE_URL" -c "\d payouts" | grep payouts_net_is_gross_minus_tds
--
-- ops/migrate.sh runs both the Drizzle migration and this file, then greps
-- for all four names before reporting success — see that script.

-- One EARNING commission entry per conversion. Application-level "check then
-- insert" is exactly the pattern that fails under concurrent webhook retries;
-- this is the actual enforcement.
CREATE UNIQUE INDEX IF NOT EXISTS commission_one_earning_per_conversion_uidx
  ON commission_entries (conversion_id) WHERE type = 'EARNING';

-- An affiliate may have at most one payout in flight at a time, across the
-- three "not yet settled" states. Prevents a double-payout race between two
-- concurrent payout-batch runs.
CREATE UNIQUE INDEX IF NOT EXISTS payouts_one_open_per_affiliate_uidx
  ON payouts (affiliate_id)
  WHERE status IN ('REQUESTED', 'APPROVED', 'PROCESSING');

-- An affiliate may have at most one KYC record actively under review or
-- approved at a time. A REJECTED record doesn't block a fresh resubmission.
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_kyc_one_active_uidx
  ON affiliate_kyc (affiliate_id) WHERE status IN ('SUBMITTED', 'APPROVED');

-- Idempotent webhook inbox: replays of the same provider event are no-ops.
-- (Declared here as well as in the Drizzle schema's uniqueIndex — kept here
-- too so this file is a complete, standalone record of every hand-verified
-- constraint in one place.)
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_provider_event_uidx
  ON webhook_events (provider, provider_event_id);

-- net_paise must always equal gross_paise - tds_paise. Enforced at the
-- database, not trusted from whatever the payout-creation code computed.
ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_net_is_gross_minus_tds;
ALTER TABLE payouts ADD CONSTRAINT payouts_net_is_gross_minus_tds
  CHECK (net_paise = gross_paise - tds_paise);
