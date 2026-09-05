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

Not yet built: admin dashboard, the commission scheduler, and the security
audit. See
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
`/api/ready` are the liveness/readiness endpoints (Phase 11 will move these
into your platform's actual health checks).

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
src/lib/auth/     password, session, cookies, rbac, actor guard, permission catalogue
src/lib/affiliate/    lifecycle state machine, KYC, registration fee flow, commission policy
src/lib/attribution/  click tracking + signed cookie, and the commission ledger engine
src/lib/orders/   order lifecycle state machine, checkout, onboarding draft/submit, meetings, requirements lock
src/lib/crm/      self-populating contact sync (called from transitionOrderStage), manual edits/notes/tasks/assignment
src/lib/training/ access gate (ACTIVE affiliates), published-only reads, authoring/publish guards, progress tracking
src/lib/crypto/   AES-256-GCM PII encryption + keyed-HMAC fingerprinting
src/lib/payments/ PaymentGateway interface, MockPaymentGateway, RazorpayGateway, webhook signature + confirm helpers
src/lib/          repository.ts (content seam), catalogue.ts (bridges it to real DB rows), onboarding-schemas.ts, env.ts (startup validation), db-errors.ts
src/instrumentation.ts   Runs getEnv() once at server boot — refuses to start on bad config
middleware.ts     Coarse UX redirect only — NOT the security boundary, see its own comment
drizzle/manual/   Hand-written SQL for constraints Drizzle's DSL can't express
scripts/seed/     roles-permissions.ts, catalogue.ts (both idempotent, prod-safe)
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
