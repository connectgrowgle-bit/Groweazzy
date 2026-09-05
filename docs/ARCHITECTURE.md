# GrowEazzy — Architecture (Phase 0)

Status: **draft for business sign-off**. This document exists so the decisions
below get made *before* code depends on them, not discovered mid-build.

## 1. What this platform is

GrowEazzy is a single-seller Indian performance marketing platform. It sells
three of its own services and runs a single-level affiliate programme on top.
It is explicitly **not** a marketplace — there is one seller (GrowEazzy
itself), and affiliates refer buyers to GrowEazzy's own services for a
commission. Nobody earns from recruiting other affiliates.

**Services**: Real Estate Qualified Buyers, AI Content Avatar, Unlimited Video
Editing.

**Affiliate programme**: 10% commission (admin-configurable), single-level
only, ₹2,000 registration fee (admin-configurable, switchable off), fortnightly
payouts above a ₹1,000 minimum, TDS deducted.

Market: India. Currency: INR, stored as integer paise. Timezone: IST for all
scheduling and display. Language: English UI, Hinglish support conversations.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript (strict) | Server components + route handlers cover both the public site and the API surface without a separate backend |
| Styling | Tailwind CSS 4 | CSS-first config, no build-time content scanning surprises |
| Database | PostgreSQL 16 | Transactions + partial unique indexes are load-bearing for the commission ledger |
| ORM | **Drizzle**, not Prisma | Prisma's schema engine fetches platform binaries at install time and fails behind restrictive networks; Drizzle is pure TypeScript and its explicit SQL is what the ledger needs |
| Password hashing | Argon2id (m=19456, t=2, p=1) | Current OWASP recommendation |
| Payments | Razorpay (Orders API + Standard Checkout) | INR-native, webhook-driven |
| Validation | Zod at every input boundary | Client input is never trusted, including *which plan* vs *what it costs* |

## 3. The seam that makes Phase 9 not a rewrite

No page or component reads content directly. Everything — service copy,
pricing, training courses — goes through `src/lib/repository.ts`, which
exposes `async` functions from day one (`getServices()`, `getServicePlan(id)`,
...) even while Phase 1 backs them with static data. Phase 9 swaps the
function bodies for database queries. **No page changes.** This is the
single highest-leverage structural decision in the build, so it's built in
Phase 1, not retrofitted.

## 4. Auth model

- Sessions are **database rows**, not JWTs — `sessions` table, only
  `sha256(token)` stored. A suspended user loses access on their *next*
  request, not at token expiry.
- Three independent expiry mechanisms per session: a sliding window (extends
  on activity), an absolute cap (expires regardless of activity), and a
  `sessionsValidFrom` watermark on the user row that invalidates every
  existing session at once on password reset or suspension.
- RBAC is **permissions, not role strings**. 36+ permissions in a catalogue,
  roles are compositions of permissions, and `can(actor, "payout.approve")`
  resolves from the database per request — so access changes are a data
  change, not a deploy.
- **Middleware is not the security boundary.** Next.js middleware runs on the
  edge with no database connection; it may do coarse routing (e.g. redirect
  unauthenticated users away from `/dashboard`), but every page and route
  handler re-checks authorization server-side. Deleting middleware should
  make nothing *more* accessible, only less convenient.
- Account enumeration is closed: unknown email and wrong password return
  byte-identical responses; a resource that isn't yours returns 404, not 403.
- MFA (TOTP, RFC 6238) is enforced in the actor-resolution guard every page
  and API route already passes through, not in the login route — so it
  applies to routes added after this document is forgotten.

## 5. Affiliate lifecycle

```
REGISTERED → KYC_PENDING → KYC_SUBMITTED → (KYC_REJECTED | FEE_PENDING) → ACTIVE → (SUSPENDED | TERMINATED)
```

**KYC happens before the fee is charged.** A rejected KYC after a paid fee
creates a refund obligation and a compliance headache; rejecting first is
strictly safer.

KYC (PAN, bank details) is encrypted at rest with AES-256-GCM. Only the last 4
characters are stored in a readable column for display; a keyed HMAC
fingerprint of the full value lets the system detect duplicate identities
without ever decrypting stored data for that check.

Payment collection goes through a `PaymentGateway` interface. Phase 3 ships a
`MockPaymentGateway`; the Razorpay adapter (Phase 5) implements the same
interface, so nothing above the interface changes when the real gateway lands.

## 6. Attribution & commission engine

Each service has its own referral link shape: `/ai-content-avatar?ref=GEA10245`
must work from any public URL, not just a dedicated landing page. Flow:

1. Next.js middleware detects `?ref=` on any request.
2. It hands off to a Node route handler (middleware itself cannot write to
   Postgres) which records the click and sets a signed, httpOnly cookie.
3. The route **redirects to the same URL with `ref` stripped**, so a page
   refresh is not a second click and a copy-pasted/shared URL doesn't
   re-attribute to whoever shares it next.

Commission entries move through:

```
PENDING → APPROVED → AVAILABLE → PAID
                                → REVERSED (money was earned, then clawed back)
PENDING → CANCELLED (order never completed — nothing was earned)
```

**CANCELLED and REVERSED are not the same state under a different name.**
Cancelled: the underlying order never completed, so no earning ever existed —
no negative ledger row is written, because there is nothing to reverse.
Reversed: a payment was captured, a commission was earned, and it is now being
clawed back (e.g. a later refund) — both the original earning row and the
reversal row stay in the ledger permanently. Deleting or editing the original
row on reversal is exactly the mistake §9 of the build notes warns about.

**Partial refunds reverse a proportional share of the commission**, not the
whole thing, and the proportion is computed from Razorpay's own cumulative
`amount_refunded` on the payment — not a locally incremented counter, which
drifts permanently the first time a webhook delivery is missed.

### The ledger itself

- **Append-only.** No mutable balance column anywhere. An earning is a
  positive `commission_entries` row; a reversal or refund adjustment is a
  *new* negative row referencing the same conversion. The original row is
  never edited or deleted.
- Balance for any affiliate, at any point in time, is `SUM(amount_paise)`
  over their rows — computed on read, not maintained incrementally.
- **"One earning per conversion" is a database constraint**, not an
  application-level check:
  ```sql
  CREATE UNIQUE INDEX commission_one_earning_per_conversion_uidx
    ON commission_entries (conversion_id) WHERE type = 'EARNING';
  ```
  Application code racing under concurrent load is exactly the condition
  this exists to survive.

## 7. Payment flow

Razorpay Orders API for collection (never Route/split settlement — see
decision D-1 below), Standard Checkout in the browser, all amounts in integer
paise end to end.

- A payment is marked successful **only** by a signature-verified webhook or a
  server-to-server status fetch. The frontend's `payment.success` callback is
  a hint to poll, never a source of truth.
- Webhook signatures are verified over the **raw request body** — Next.js
  route handlers must read the raw bytes before any JSON parsing touches them,
  since re-serialized JSON does not reproduce the same digest.
- The webhook secret and the API key secret are separate values from separate
  Razorpay dashboard pages; a config that conflates them makes every webhook
  fail closed (i.e., safe, but confusing to debug — call this out in setup
  docs so it isn't mistaken for a real outage).
- Every webhook delivery is idempotent via a uniquely-indexed `webhook_events`
  inbox keyed on the provider's event id. A replayed delivery is a no-op, not
  a re-processed event.
- A payment created without an `order_id` cannot be captured server-side and
  is auto-refunded by Razorpay — so an order row is always created before
  checkout opens, never after.
- `PAYMENT_MODE` (`test`/`live`) has no default and is cross-checked against
  the Razorpay key prefix at boot (`rzp_test_...` vs `rzp_live_...`); a
  mismatch refuses to boot rather than silently taking real payments in test
  mode or vice versa.

## 8. Client workflow

```
Service → checkout → payment → verification → order → CRM contact →
onboarding → meeting → requirements locked → team assigned → work →
review → delivery → completion
```

Each service has its own onboarding form with two Zod schemas over the same
JSON shape: a **draft schema** (everything optional, so "save and come back"
works mid-form) and a **submit schema** (the real, complete requirements).
Both are validated in exactly one shared module — duplicating the shape
invites drift between what's enforced and what's stored.

Submitting the brief does **not** lock requirements — the kick-off call
happens between submission and locking, and there is no transition back from
`requirements locked` to an editable state (a locked brief that needs to
change becomes a new, explicit change request, not a silent edit).

## 9. CRM

```
NEW → CONTACTED → QUALIFIED → ONBOARDING → IN_PROGRESS → REVIEW → DELIVERED → COMPLETED
```
Plus `LOST` and `CANCELLED` as terminal states reachable from most of the
above.

**The CRM fills itself from the workflow — it is not a separate system
someone has to remember to update.** Buying a service creates/advances a
contact; every delivery-stage transition moves it. Contacts are de-duplicated
on email, and the user account is resolved by email even when no `userId` is
supplied on order creation — otherwise a contact can show zero orders while
the actual work sits one join away, undiscoverable from the CRM screen.

## 10. Training portal

10 courses → modules → lessons (videos). Draft content is **absent from every
query a learner's screen can see**, not merely hidden by a UI flag — a lesson
cannot be published before its parent module and course are. Progress per
lesson is monotonic (`GREATEST(new_progress, old_progress)`, never
regresses), sticky once marked complete, and clamped to the lesson's actual
duration. A lesson completes at 90% watched, not 100% — video players
routinely under-report the final second or two.

## 11. Admin dashboard

Phase 9 moves the service catalogue (from the Phase 1 repository seam) into
the database. `service.edit` (copy, images, FAQ) and `service.pricing`
(amounts, plans) are **separate permissions** — someone trusted to fix a typo
in a tagline is not thereby trusted to reprice the catalogue.

Every price change requires a reason and writes a `service_plan_price_history`
row in the same transaction as the price update — so "what did this cost on
the day this specific order was placed" is always answerable, and existing
orders are never retroactively repriced (orders store their own amount at
purchase time regardless of what the catalogue says later).

Revenue metrics count only `CAPTURED` payments with refunds subtracted, and
**nothing is cached** — every admin-facing number is summed from source rows
on read. A cached number that is wrong looks exactly like a correct one.

## 12. Commission scheduler

`releaseMaturedCommissions` does not release everything past its hold date —
it re-verifies from source per entry: conversion status, affiliate status,
order stage, payment status, the refund window, and that no payout already
claims the entry. Each entry is processed in its own transaction with
`SELECT ... FOR UPDATE` and a repeated `WHERE` clause, so a refund landing
mid-run makes that entry's release a no-op instead of a race.

Reversal failures during the run are **logged, not thrown** — a CRM hiccup
during reversal must never roll back an otherwise-successful release/payout of
unrelated entries. The corollary: a refunded payment whose reversal failed
sits at `PENDING` and gets swept up on the *next* scheduled run, so reversal
failures need their own alerting, not just log lines nobody reads.

The scheduler's advisory lock is taken on a **dedicated connection**, not
borrowed from the pool — Postgres advisory locks are session-scoped and
re-entrant, so a pooled connection can hand the "same" lock to a second
concurrent run and let it sail through. That isn't a rare edge case in a
pooled environment; it is the default behavior of `pg_advisory_lock` used
against a pool.

The endpoint is authenticated with a constant-time comparison against
`CRON_SECRET`; with no secret configured it returns 503 rather than running
unauthenticated.

## 13. Explicit decisions the business must make before/during Phase 0

| # | Decision | Default this build assumes | Why it matters |
|---|---|---|---|
| D-1 | Razorpay Route (split settlement) vs. collect-and-disburse separately | **Do not use Route.** Collect full amount, hold it, disburse via RazorpayX/Cashfree Payouts | Route splits at capture time — incompatible with hold periods, refund reversals, manual payout approval, and batched TDS-net payouts |
| D-2 | ₹2,000 affiliate registration fee — keep, reduce, or remove | Kept, but **admin-configurable and switchable to ₹0** | Largest compliance risk in the whole product — see §14 |
| D-3 | Commission rate | 10%, admin-configurable | Needs to be changeable without a deploy for pricing experiments |
| D-4 | Payout cadence & minimum | Fortnightly, ₹1,000 minimum | Affects affiliate cash flow and support volume around payout dates |
| D-5 | TDS rate & threshold | Not hardcoded — configurable per current Income Tax rules | Tax rates change; hardcoding invites a future silent compliance miss |
| D-6 | Who can approve payouts vs. who can edit service pricing | Separate permissions (`payout.approve`, `service.pricing`) | A shared "admin" role is a bigger blast radius than the business likely intends |
| D-7 | Cooling-off period length for affiliate registration | Not yet set — **legal input required**, see §14 | Directly mitigates D-2's risk |
| D-8 | Named grievance officer for affiliate disputes | Not yet assigned | Required groundwork regardless of the fee's legal status |
| D-9 | GST registration/treatment for commission payouts and the registration fee | Not yet determined — **accountant input required** | Affects invoicing fields the schema needs to carry (GSTIN, HSN/SAC, etc.) |
| D-10 | File/video storage: local disk vs. S3 for Phase 8 training videos and Phase 6 deliverables | S3-shaped interface (`STORAGE_DRIVER=local\|s3`) from day one, local for dev | Avoids a rewrite when moving off a single server |

## 14. Compliance — flagged, not concluded

**This section is not legal advice and settles nothing on its own.** The user
has indicated legal/CA review is already underway for this platform; the
items below are exactly what should be in front of that review, listed so
nothing here is discovered only after launch.

- **The ₹2,000 affiliate registration fee is the largest non-technical risk
  in this product.** The Consumer Protection (Direct Selling) Rules, 2021
  restrict entry fees charged to direct sellers, and the Prize Chits and
  Money Circulation Schemes (Banning) Act, 1978 criminalizes pay-to-join
  structures where return depends on recruiting others. This programme is
  single-level (no recruitment override) and the fee is framed against
  training delivered, which are the right structural mitigations to *discuss*
  with counsel — they are not a substitute for counsel's sign-off.
- Mitigations this build implements regardless of the fee's ultimate legal
  treatment: the fee is admin-configurable and can be switched to ₹0 entirely
  without a deploy; the programme is single-level only, enforced in the
  commission engine itself (there is no code path that pays an affiliate for
  another affiliate's recruitment); real training content is delivered for
  the fee (Phase 8); a cooling-off period, versioned/dated terms-of-service
  records, and a named grievance officer are schema-supported (D-7, D-8) even
  before the exact period/officer are decided.
- Also flagged for the same review, not resolved here: the 10% commission
  model's characterization for tax purposes, the refund policy's enforceability
  as drafted, affiliate terms generally, payout terms and TDS deduction
  mechanics, KYC/PII retention periods under Indian data protection law, GST
  treatment (D-9), the specific wording of real-estate lead/buyer-qualification
  claims (advertising/RERA-adjacent risk), customer service terms, and general
  privacy obligations for PII collected (KYC documents, contact details).

## 15. Known gaps, shipped consciously

Carried forward from the build brief, not accidents to be "discovered" later:

- Rate limiting is in-memory in this build — fine for a single instance,
  useless across multiple; needs Redis before horizontal scaling.
- CSP still allows `'unsafe-inline'` for scripts because Next's own bootstrap
  script needs it without a nonce-based CSP wired through `next.config`.
- No virus scanning on uploads — files sit at `scanStatus: PENDING`
  indefinitely until that's wired to a scanning service.
- No CSRF token layer — `SameSite=Lax` cookies plus requiring JSON
  `Content-Type` on state-changing requests is one layer, not two.
- `PII_ENCRYPTION_KEY` is not rotatable in this build; there is no
  re-encryption tooling yet. Rotating it without that tooling makes existing
  KYC records unreadable.
- Tailwind 4 targets Safari 16.4+; on macOS 12 and older the page renders
  unstyled. Decide whether that matters for the target audience before
  launch.

## 16. High-level ERD

```mermaid
erDiagram
  USERS ||--o{ SESSIONS : has
  USERS ||--o| AFFILIATES : "may be"
  USERS ||--o{ ORDERS : places
  AFFILIATES ||--o{ AFFILIATE_LINKS : owns
  AFFILIATES ||--o| AFFILIATE_KYC : submits
  AFFILIATE_LINKS ||--o{ AFFILIATE_CLICKS : records
  AFFILIATE_CLICKS ||--o{ AFFILIATE_LEADS : may_become
  AFFILIATE_LEADS ||--o| AFFILIATE_CONVERSIONS : may_become
  AFFILIATE_CONVERSIONS ||--o{ COMMISSION_ENTRIES : generates
  AFFILIATES ||--o{ COMMISSION_ENTRIES : earns
  COMMISSION_ENTRIES }o--o| PAYOUTS : "grouped into"
  ORDERS ||--|| AFFILIATE_CONVERSIONS : "may attribute"
  ORDERS ||--o{ PAYMENTS : "paid via"
  PAYMENTS ||--o{ PAYMENT_TRANSACTIONS : "webhook events for"
  ORDERS ||--o{ ONBOARDING_SUBMISSIONS : has
  ORDERS ||--o{ ORDER_ASSIGNMENTS : has
  ORDERS ||--o{ DELIVERABLES : produces
  ORDERS ||--|| CRM_CONTACTS : "advances"
  SERVICES ||--o{ SERVICE_PLANS : offers
  SERVICE_PLANS ||--o{ SERVICE_PLAN_PRICE_HISTORY : "priced over time"
  SERVICE_PLANS ||--o{ ORDERS : "purchased as"
  TRAINING_COURSES ||--o{ TRAINING_MODULES : contains
  TRAINING_MODULES ||--o{ TRAINING_VIDEOS : contains
  TRAINING_VIDEOS ||--o{ TRAINING_PROGRESS : "tracked per user"
```

See `src/db/schema/` for the full 47-table Drizzle schema and
`drizzle/manual/*.sql` for the hand-written constraints Drizzle's DSL cannot
express (partial unique indexes, CHECK constraints).

## 17. API surface (by phase)

Full route list lives alongside each phase's code as it's built. At a glance:

- **Public** (Phase 1): service pages, `/api/contact`, `/[service]?ref=...`
  attribution redirect
- **Auth** (Phase 2): `/api/auth/{register,login,logout,session,mfa/*}`
- **Affiliate** (Phase 3): `/api/affiliate/{register,kyc,fee-payment,links,dashboard}`
- **Client** (Phase 6): `/api/checkout`, `/api/orders/*`, `/api/onboarding/*`
- **Payments** (Phase 5): `/api/payments/webhook` (Razorpay), `/api/payments/verify`
- **CRM/Admin** (Phase 7, 9): `/api/admin/*` behind permission checks, not role checks
- **Training** (Phase 8): `/api/training/*`, `/api/progress`
- **Ops** (Phase 11): `/api/health`, `/api/ready`, `/api/cron/release-commissions`

## 18. Next steps

Phase 0 sign-off needs answers to D-1 through D-10 (§13) — none of them block
starting Phase 1's static pages, but D-1, D-2, D-3 and D-5 shape the schema
Phase 4 builds on, so they should land before Phase 3 starts in earnest.

Build order from here follows the phases in the project brief: Phase 1
(public site + repository seam), Phase 2 (auth & RBAC), Phase 3 (affiliate
system) — all done, see §19-§20 — then Phase 4 (attribution & commission)
next.

## 19. Phase 2 notes: two real mistakes caught before they shipped

In the spirit of §9's "mistakes this build actually made" — these were
caught during Phase 2, not hypothetical:

1. **`src/db/index.ts` eagerly called the full `getEnv()`** just to read
   `DATABASE_URL`/`DATABASE_SSL`, so any standalone script importing `db`
   (the roles/permissions seed, in this case) failed validation for
   Razorpay keys, session secret, etc. it had no reason to need. Fixed by
   having the db module read those two vars directly from `process.env`,
   and moving the actual "refuse to boot on bad config" enforcement to
   `src/instrumentation.ts`'s `register()` hook, which Next.js runs once at
   real server boot. `drizzle.config.ts` already followed this narrower
   pattern; `src/db/index.ts` now matches it.
2. **Confirmed, against a real Postgres instance, that Drizzle's
   node-postgres driver puts the actual pg error (with `.code` and
   `.constraint`) at `err.cause`, not on `err.message`** — checking
   `err.message.includes('duplicate key')`, this build's first instinct,
   never fires (`err.message` is just `"Failed query: <sql>"`). This is
   verbatim mistake #4 from §9 of the original brief; `src/lib/db-errors.ts`
   (`isUniqueViolation`) exists specifically so this check is written once,
   correctly, and reused everywhere a unique-index violation needs to
   become a clean error response.

Both are covered by regression tests (`tests/db-errors.test.ts`; the seed
script running successfully with only `DATABASE_URL` set is exercised by
`npm run db:seed:roles` in the getting-started flow) so they can't silently
reappear.

## 20. Phase 3 notes

Phase 3 (affiliate lifecycle, encrypted KYC, the `PaymentGateway` interface
and its `MockPaymentGateway`, and the registration fee flow) deliberately
built `activateFromVerifiedPayment` (`src/lib/affiliate/fee.ts`) to *re-read
the payment row from the database and check its status, purpose, and
affiliate linkage itself* before activating anything — this is verbatim
mistake #7 from §9 of the original brief ("`activateFromVerifiedPayment`
never read the payment row — it trusted the id despite its name"), and it
was written defensively from the start rather than caught after the fact.
`tests/affiliate-fee.test.ts` has a test named for exactly this: confirming
a payment the mock gateway reports as `failed` must not activate the
affiliate no matter how confirm is called — if the guard is ever removed,
that test fails immediately.

Two schema-level things worth calling out, neither a bug so much as a
deliberate choice that test cleanup had to respect: `payments.affiliate_id`
and `affiliate_kyc.reviewed_by_user_id` are plain foreign keys, not
`ON DELETE CASCADE` — a payment or a KYC review decision is a financial/audit
record that must survive even if the account referencing it is later
removed. `tests/helpers.ts`'s `deleteTestUser` unwinds these explicitly
(delete the affiliate's payments, null out any KYC rows this user reviewed,
then delete the user) rather than relying on cascade, which is exactly what
a real "close this account" admin action would also have to do.

Also new in this phase: `src/lib/crypto/pii.ts` derives two independent
subkeys (encryption, HMAC fingerprinting) from the single
`PII_ENCRYPTION_KEY` via HKDF with a fixed, empty salt — deliberately
deterministic (the same master key must always yield the same subkeys, or
existing encrypted KYC data becomes unreadable), which is the opposite of
HKDF's usual randomized-salt use case. Tested directly in `tests/pii.test.ts`,
including that a tampered ciphertext fails GCM's auth tag check rather than
silently decrypting to garbage.

### A real infrastructure mistake this build made, found and fixed live

The first version of the HTTP-level test suite had `tests/auth-routes.test.ts`
and `tests/affiliate-routes.test.ts` each spawn their own `next dev` server
on a different port in their own `beforeAll`. Running both together
deadlocked the entire suite: **Next.js 16 refuses to run a second `next dev`
against the same project directory at all**, regardless of port — it
detects an existing instance via a `.next/dev/lock` file and either hands
back the running one or hangs waiting on the lock. The symptom looked
exactly like a real bug (tests timing out, a `next-server` process pinned
at 80%+ CPU indefinitely) with no error surfaced until the *other* file's
server startup finally logged `Another next dev server is already running`.

Fixed by not doing that: `tests/global-setup.ts` builds the app once and
starts a **single shared server** (`next start`, not `next dev` — no
dev-mode file-watcher lock, and no lazy per-route compilation, so it's also
faster) for the entire test run via Vitest's `globalSetup`, torn down once
at the end. Every HTTP-level test file now points at that one server
instead of spawning its own. This dropped the HTTP suites from
multi-second-per-test (cold dev-mode compilation) to ~500ms for 9 tests
combined, and eliminated the deadlock entirely — a good reminder that a
"real running server" requirement doesn't mean *one per test file*.
