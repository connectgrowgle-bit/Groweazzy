# GrowEazzy

Single-seller Indian performance marketing platform: three services sold
directly, plus a single-level affiliate programme. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design (schema,
auth model, commission engine, payment flow) and the explicit business
decisions still open.

## Status

- **Phase 0 (Architecture)** — done. Schema, env validation, repository seam,
  health/ready endpoints, ops scripts.
- **Phase 1 (Public website)** — done. 16 pages, all reading catalogue
  content through the repository seam.
- **Phase 2 (Auth & RBAC)** — done. Argon2id, database sessions (sliding +
  absolute + watermark expiry), 39-permission catalogue with 5 default
  roles, enumeration-safe login, `/account` as a real protected page.
- **Phase 3 (Affiliate system)** — done. Lifecycle state machine
  (REGISTERED→KYC_PENDING→KYC_SUBMITTED→(KYC_REJECTED\|FEE_PENDING\|ACTIVE)→(SUSPENDED\|TERMINATED)),
  AES-256-GCM-encrypted KYC with keyed-HMAC duplicate-PAN detection, a
  `PaymentGateway` interface with `MockPaymentGateway`, and the affiliate
  registration fee flow wired end-to-end (mock payment only — Razorpay is
  Phase 5).
- **Phase 4 (Attribution & Commission)** — done. `?ref=CODE` works on any
  public URL via middleware + a signed click-tracking cookie; an
  append-only commission ledger with the CANCELLED-vs-REVERSED distinction
  (§6), proportional and idempotent refund reversal, and the rate locked
  into each entry at creation time.
- **Phase 5 (Razorpay)** — done. `RazorpayGateway` implements the same
  `PaymentGateway` interface `MockPaymentGateway` does — nothing above that
  interface changed. Webhook handler verifies signatures over the raw body,
  has an idempotent inbox (a replayed delivery is a no-op; a delivery that
  crashed mid-processing is retried, not silently dropped), and routes
  `payment.captured`/`payment.failed`/`refund.processed` to the affiliate
  fee flow or the order/commission flow as appropriate. **Not yet verified
  against a real Razorpay account** — this environment has no network path
  to `api.razorpay.com`, so it's tested only against a contract fake; see
  the caveat in `src/lib/payments/razorpay-gateway.ts` and Phase 13 in the
  project brief.
- **Phase 6 (Client workflow)** — done. Real checkout (`/checkout`,
  `POST /api/orders/checkout` + `/confirm`) against a seeded bridge of the
  Phase 1 static catalogue into real `service_plans` rows
  (`scripts/seed/catalogue.ts`); payment capture now runs an order straight
  through `PAID → ONBOARDING` and creates its CRM contact in the same call.
  Service-specific onboarding forms (`src/lib/onboarding-schemas.ts`) with
  one shared draft/submit Zod module per service — submitting does **not**
  lock requirements. Staff-only meeting scheduling and an explicit, one-way
  requirements-lock action, both on permissions Phase 2 already seeded. See
  [`docs/ARCHITECTURE.md` §23](docs/ARCHITECTURE.md#23-phase-6-client-workflow).
- **Phase 7 (CRM)** — done. `syncContactFromOrderStage`
  (`src/lib/crm/sync.ts`) is called from INSIDE `transitionOrderStage`
  itself, so a contact self-populates and advances from ANY legal order
  transition — a webhook, checkout confirm, meeting scheduling,
  requirements-lock, or the new generic `POST /api/orders/[id]/advance`
  (staff-only, drives `TEAM_ASSIGNED → ... → COMPLETED`) — with no call
  site having to remember to do it itself. Staff CRM UI at `/crm` (pipeline
  board) and `/crm/[id]` (activity timeline, notes, tasks, manual
  stage/owner edits), all on Phase 2's existing `crm.*` permissions. See
  [`docs/ARCHITECTURE.md` §24](docs/ARCHITECTURE.md#24-phase-7-crm).
- **Phase 8 (Training portal)** — done. Gated to ACTIVE affiliates (the
  fee's own FAQ copy says it pays for this) or staff who can author, via
  `canAccessTraining` (`src/lib/training/access.ts`) — no new permissions
  needed. Draft content is invisible to learners by construction: every
  read starts from an already-published parent and nests the filter down
  (`src/lib/training/catalogue.ts`), and a video linked to directly gets
  its own full-ancestor-chain check. Publish guards
  (`src/lib/training/authoring.ts`) re-check each parent's CURRENT status
  on every call, not history. Progress is monotonic, clamped to duration,
  and completes at 90% — computed under a row lock
  (`src/lib/training/progress.ts`), not a raw SQL `GREATEST`. See
  [`docs/ARCHITECTURE.md` §25](docs/ARCHITECTURE.md#25-phase-8-training-portal).
- **Phase 9 (Admin dashboard)** — done. The service catalogue actually
  moved into the database — `src/lib/repository.ts` now reads
  `services`/`service_plans` directly, and every public page kept working
  with zero changes (that was the whole point of routing through the seam
  since Phase 1). Plans gained a stable public `key` decoupled from their
  uuid, so an admin renaming a plan or a future reseed can't break an
  existing checkout link. `service.edit` (copy) and `service.pricing`
  (amounts, plans — creating/deactivating/repricing) stay strictly
  separate permissions; every price change requires a reason and writes a
  `service_plan_price_history` row in the same transaction
  (`src/lib/catalogue-admin.ts`). Revenue and affiliate-performance
  reports (`/admin`, `src/lib/admin/revenue.ts`) are summed fresh from
  source rows on every request — nothing cached. See
  [`docs/ARCHITECTURE.md` §26](docs/ARCHITECTURE.md#26-phase-9-admin-dashboard).

- **Phase 10 (Security audit)** — done. Manual audit across the whole
  codebase; every protected route confirmed to gate via
  `requireActor`/`requirePermission`, every public route confirmed to gate
  itself internally. Real findings fixed: two exploitable open redirects
  (client-side in the login/register forms, and a serious server-side one
  in the public `/api/attribution/click`, both closed via
  `src/lib/safe-redirect.ts`); no brute-force protection on
  login/register/contact (added a DB-backed rate limiter,
  `src/lib/rate-limit.ts`, with a real concurrency bug in its own first
  draft caught and fixed before shipping); client IP trusted only when an
  operator explicitly configures `TRUSTED_PROXY_HEADER`
  (`src/lib/net.ts`, fail-closed by default); Argon2 opportunistic rehash
  wired up (existed since Phase 2, was never called); new
  `Strict-Transport-Security`/`Permissions-Policy` headers; a stale
  middleware protected-prefix list, and a sharper prefix-matching bug that
  list fix surfaced. See
  [`docs/ARCHITECTURE.md` §27](docs/ARCHITECTURE.md#27-phase-10-security-audit)
  for the full writeup, including what was deliberately left as an
  accepted trade-off rather than "fixed."

- **Phase 11 (Production prep)** — done. Branded error handling for every
  case Next.js's own boundary hierarchy covers (`not-found.tsx`,
  `error.tsx`, and a bare-bones `global-error.tsx` for a root-layout
  crash); `robots.txt`/`sitemap.xml`/a generated favicon, all previously
  entirely absent; and a real unbounded-growth bug in Phase 10's own
  `rate_limit_buckets` table (a row per distinct key that never gets
  deleted) closed with an opportunistic sweep. See
  [`docs/ARCHITECTURE.md` §28](docs/ARCHITECTURE.md#28-phase-11-production-prep).

- **Phase 12 (Commission scheduler)** — done. `releaseMaturedCommissions`
  (`src/lib/attribution/commission-scheduler.ts`) moves an EARNING entry
  `APPROVED → AVAILABLE` once its hold period has elapsed — but only after
  re-verifying the affiliate, order, and payment fresh from source, since
  none of those retroactively edit the entry itself when they change
  during the hold window. Triggered by an authenticated
  `/api/cron/release-commissions` (bearer `CRON_SECRET`, either GET or
  POST), running under a Postgres advisory lock taken on its own dedicated
  connection (`withAdvisoryLock`, `src/db/index.ts`) so two overlapping
  triggers can never double-process. Every run is recorded in `job_runs`.
  See [`docs/ARCHITECTURE.md` §29](docs/ARCHITECTURE.md#29-phase-12-commission-scheduler).

- **Phase 12, cont'd (TOTP MFA)** — done. Self-service, opt-in
  two-factor auth via `/account` — enroll (`/api/auth/mfa/setup` +
  `/enable`, RFC 6238 TOTP implemented directly against `node:crypto`,
  verified against the RFC's own published test vectors), the login-time
  challenge (`/api/auth/mfa/verify`, accepts a TOTP or a recovery code,
  rate-limited per session), and `/api/auth/mfa/disable` (requires the
  account password AND a fresh code). The secret gets its own
  AES-256-GCM encryption with an independently-derived subkey, separate
  from `encryptPii`. A TOTP code can never be replayed even within its
  own 30-second window (a unique-index insert, not a check-then-act).
  Mandatory MFA for admin roles is a deliberately open business decision,
  not assumed. See [`docs/ARCHITECTURE.md` §30](docs/ARCHITECTURE.md#30-phase-12-contd-totp-mfa).

Not yet built: user management/audit-log/payouts/settings screens (the
permissions exist, Phase 2; no UI yet), payout batch construction and real
disbursement, and real Razorpay gateway verification. See
[`docs/ARCHITECTURE.md` §18](docs/ARCHITECTURE.md#18-next-steps) for the
business decisions (D-1 through D-10) this build still needs sign-off on.

## Stack

Next.js 16 (App Router) + React 19 + TypeScript (strict) · Tailwind CSS 4 ·
PostgreSQL 16 + Drizzle ORM · Argon2id · Razorpay · Zod.

## Getting started

```bash
npm install
cp .env.development.example .env.local
# Fill in SESSION_SECRET, PII_ENCRYPTION_KEY, CRON_SECRET — see the file's
# comments for how to generate each.

# Requires a running Postgres 16 at the DATABASE_URL in .env.local:
npm run db:generate   # generate SQL migrations from src/db/schema
DATABASE_URL=... ./ops/migrate.sh   # apply migrations + hand-written constraints, then verify

npm run dev
```

Visit `http://localhost:3000`. `http://localhost:3000/api/health` and
`/api/ready` are the liveness/readiness endpoints — point your deploy
platform's actual health checks at these.

Seed the permission catalogue and default roles (idempotent, safe to run on
every deploy — see docs/ARCHITECTURE.md and the script's own header for why
this is kept separate from any future demo-data seed):

```bash
npm run db:seed:roles
```

Seed the catalogue bridge (idempotent — creates/updates real `services`/
`service_plans` rows from the Phase 1 static catalogue so orders have a
real plan to point at; see docs/ARCHITECTURE.md §23):

```bash
npm run db:seed:catalogue
```

## Deploying to Vercel

`npm run vercel-build` (auto-detected by Vercel in place of `npm run build`
when present) runs `scripts/deploy-migrate.mjs` — a pure-Node equivalent of
`ops/migrate.sh` for build environments that have Node but not necessarily a
`psql` binary — then both seed scripts, then `next build`. All of it is
safe to run on every single deploy: Drizzle migrations track what's already
applied, every manual SQL statement is `IF NOT EXISTS`/`DROP ... IF EXISTS`
before `ADD`, and both seed scripts are independently idempotent. This
means a fresh Postgres database (nothing run against it yet) goes from
empty to fully migrated, seeded, and built in one deploy — no separate
manual migration step, and no direct network access to the database from
anywhere other than the deploy platform's own build.

1. Provision a Postgres 16 database reachable from the public internet — a
   free serverless provider (e.g. Neon, Supabase) works fine; Razorpay
   stays in mock mode (see below) so nothing here needs a paid tier.
2. Import this repository into Vercel as a new project.
3. Set these environment variables before the first deploy:

   ```
   APP_ENV=staging
   APP_URL=https://<your-project-name>.vercel.app
   DATABASE_URL=<your Postgres connection string>
   DATABASE_SSL=true
   SESSION_SECRET=<openssl rand -hex 32>
   PII_ENCRYPTION_KEY=<openssl rand -hex 32>
   CRON_SECRET=<openssl rand -hex 24>
   PAYMENT_PROVIDER=mock
   PAYMENT_MODE=test
   EMAIL_PROVIDER=console
   STORAGE_DRIVER=local
   TRUSTED_PROXY_HEADER=x-forwarded-for
   ```

   `APP_ENV=staging` rather than `production` is deliberate here — `src/lib/env.ts`
   requires `SENTRY_DSN` in production, and a demo/staging deploy with no
   error-tracking account configured yet shouldn't need one just to boot.
   `PAYMENT_PROVIDER=mock` means checkout, the affiliate registration fee,
   and everything downstream of a "payment" all work end-to-end against
   `MockPaymentGateway` (src/lib/payments/mock-gateway.ts) — no real money
   moves and no Razorpay account is needed until Phase 13 swaps this to
   `razorpay`/`live`.
4. Deploy. If your project name was already taken and Vercel assigned a
   different `.vercel.app` subdomain, update `APP_URL` to match and
   redeploy once — `APP_URL` is used to build absolute links (e.g. the
   attribution cookie's redirect target) and is validated at boot.
5. Register an account on the live site, then grant it the `ADMIN` role
   directly against the database (`scripts/seed/roles-permissions.ts`
   creates the role but assigns it to nobody) to see the admin dashboard,
   CRM, and training-authoring views:

   ```sql
   insert into user_roles (user_id, role_id)
   select u.id, r.id from users u, roles r
   where u.email = 'you@example.com' and r.key = 'ADMIN';
   ```

## Testing

Every suite runs against a **real PostgreSQL** database — nothing is mocked.
Point `DATABASE_URL` at a real, migrated database that is not your dev or
production one (`tests/setup.ts` refuses to run unless the connection string
contains "test", as a guard against pointing this at the wrong database):

```bash
createdb groweazzy_test   # once
DATABASE_URL=postgres://USER:PASS@localhost:5432/groweazzy_test npm run db:migrate
DATABASE_URL=postgres://USER:PASS@localhost:5432/groweazzy_test ./ops/migrate.sh
DATABASE_URL=postgres://USER:PASS@localhost:5432/groweazzy_test npm test
```

`tests/global-setup.ts` builds the app once and starts a single shared
`next start` server (port 3900) for the whole run, torn down after —
`tests/auth-routes.test.ts`, `tests/affiliate-routes.test.ts`, and
`tests/attribution-routes.test.ts` drive it over real HTTP rather than
calling route handlers as plain functions, required because
`src/lib/auth/cookies.ts` uses `next/headers`, which only works inside
Next's own request pipeline. It's one shared server, not one per test file,
because Next.js 16 refuses to run a second `next dev` (or, it turns out,
the naive equivalent) against the same project directory — see
`docs/ARCHITECTURE.md` §20 for what that looked like before this fix, and
§21 for two more sharp edges found in the same harness (a leftover server
surviving between runs, and two processes needing the exact same secret —
now centralized in `tests/test-env-constants.ts`).

## Project layout

```
src/app/          Next.js App Router pages and API routes
src/db/schema/    Drizzle schema, one file per domain (auth, client, affiliate, training, support)
src/lib/auth/     password, session, cookies, rbac, actor guard, permission catalogue, totp.ts + mfa-recovery-codes.ts (Phase 12)
src/lib/affiliate/    lifecycle state machine, KYC, registration fee flow, commission policy
src/lib/attribution/  click tracking + signed cookie, the commission ledger engine, and the release-to-AVAILABLE scheduler (Phase 12)
src/lib/orders/   order lifecycle state machine, checkout, onboarding draft/submit, meetings, requirements lock
src/lib/crm/      self-populating contact sync (called from transitionOrderStage), manual edits/notes/tasks/assignment
src/lib/training/ access gate (ACTIVE affiliates), published-only reads, authoring/publish guards, progress tracking
src/lib/admin/    live (uncached) revenue + affiliate-performance reporting
src/lib/crypto/   AES-256-GCM PII encryption + keyed-HMAC fingerprinting, mfa-secret.ts (its own independently-derived subkey, Phase 12)
src/lib/payments/ PaymentGateway interface, MockPaymentGateway, RazorpayGateway, webhook signature + confirm helpers
src/lib/          repository.ts (content seam, DB-backed since Phase 9), catalogue.ts (plan-key resolver), catalogue-admin.ts (service.edit/service.pricing CRUD + price history), catalogue-seed-data.ts (one-time bootstrap content), onboarding-schemas.ts, env.ts (startup validation), db-errors.ts, net.ts (fail-closed trusted-proxy client IP), rate-limit.ts (DB-backed fixed-window limiter + stale-bucket sweep), safe-redirect.ts (open-redirect-safe `next` handling)
src/app/not-found.tsx, error.tsx, global-error.tsx   Branded error handling (Phase 11)
src/app/sitemap.ts, robots.ts, icon.tsx              Crawler/production hygiene (Phase 11)
src/app/api/cron/release-commissions/  CRON_SECRET-gated trigger for the commission scheduler (Phase 12)
src/app/api/auth/mfa/{setup,enable,verify,disable}/  Self-service TOTP MFA (Phase 12)
src/components/MfaSettings.tsx  /account's MFA enroll/disable UI (Phase 12)
src/instrumentation.ts   Runs getEnv() once at server boot — refuses to start on bad config
middleware.ts     Coarse UX redirect only — NOT the security boundary, see its own comment
drizzle/manual/   Hand-written SQL for constraints Drizzle's DSL can't express
scripts/seed/     roles-permissions.ts, catalogue.ts (both idempotent, prod-safe)
scripts/deploy-migrate.mjs  Pure-Node migrate+verify, for deploy platforms with no psql binary (see Deploying to Vercel)
ops/              migrate.sh, backup.sh, restore.sh
tests/            Vitest suites — all against a real Postgres, see Testing below
docs/             ARCHITECTURE.md
```

## Non-negotiables

The rules in `docs/ARCHITECTURE.md` (money as integer paise, append-only
commission ledger, database-enforced invariants, webhook-verified payments,
permissions not role strings, database sessions) are not style preferences —
each one exists because skipping it is a real defect this kind of build
produces. See `docs/ARCHITECTURE.md` §2 equivalent content and §9-style
"mistakes actually made" notes inline in the schema/env comments.

## Compliance

**Not legal advice.** `docs/ARCHITECTURE.md` §14 lists everything flagged for
legal/CA review (the ₹2,000 affiliate fee in particular) without drawing
conclusions. The user has indicated this review is already underway
separately from this build.
