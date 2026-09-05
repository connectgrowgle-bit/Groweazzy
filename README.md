# GrowEazzy

Single-seller Indian performance marketing platform: three services sold
directly, plus a single-level affiliate programme. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design (schema,
auth model, commission engine, payment flow) and the explicit business
decisions still open.

## Status

**Phase 0 (Architecture) — scaffolded.** Schema, env validation, repository
seam, health/ready endpoints, and ops scripts exist. No auth, no payments, no
public pages beyond a placeholder home page yet — that's Phase 1 onward.

See [`docs/ARCHITECTURE.md` §18](docs/ARCHITECTURE.md#18-next-steps) for what
needs business sign-off before Phase 3 (affiliate system) starts, and the
project brief's own phase list for build order.

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

## Project layout

```
src/app/          Next.js App Router pages and API routes
src/db/schema/    Drizzle schema, one file per domain (auth, client, affiliate, training, support)
src/lib/          repository.ts (content seam), env.ts (startup validation)
drizzle/manual/   Hand-written SQL for constraints Drizzle's DSL can't express
ops/              migrate.sh, backup.sh, restore.sh
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
