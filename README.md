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

Not yet built: affiliate system, payments, client workflow, CRM, training,
admin dashboard, the commission scheduler, and the security audit. See
[`docs/ARCHITECTURE.md` §18](docs/ARCHITECTURE.md#18-next-steps) for what
needs business sign-off before Phase 3 (affiliate system) starts.

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

`tests/auth-routes.test.ts` additionally spawns a real `next dev` server on
port 3901 and drives it over HTTP — required because
`src/lib/auth/cookies.ts` uses `next/headers`, which only works inside
Next's own request pipeline, not when a route handler is called as a plain
function. This is also closer to the project brief's own testing
philosophy: real server, real database, no mocks.

## Project layout

```
src/app/          Next.js App Router pages and API routes
src/db/schema/    Drizzle schema, one file per domain (auth, client, affiliate, training, support)
src/lib/auth/     password, session, cookies, rbac, actor guard, permission catalogue
src/lib/          repository.ts (content seam), env.ts (startup validation), db-errors.ts
src/instrumentation.ts   Runs getEnv() once at server boot — refuses to start on bad config
middleware.ts     Coarse UX redirect only — NOT the security boundary, see its own comment
drizzle/manual/   Hand-written SQL for constraints Drizzle's DSL can't express
scripts/seed/     roles-permissions.ts (idempotent, prod-safe)
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
