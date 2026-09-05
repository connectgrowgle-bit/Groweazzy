// Drizzle's node-postgres driver wraps the real pg error: `err.message` is
// just "Failed query: <sql>" and `err.code`/`err.constraint` are undefined
// at the top level. The actual pg error — with `.code` ('23505' for a
// unique violation) and `.constraint` (the index/constraint name) — lives
// at `err.cause`. Checking `err.message` for "duplicate key" (as a naive
// first attempt did) never fires; this is mistake #4 from
// docs/ARCHITECTURE.md §15, confirmed against a real Postgres instance.
//
// Use this everywhere a unique-index violation needs to become a clean
// 409/validation error instead of an uncaught 500 — e.g. duplicate email on
// registration, duplicate referral code, the partial unique indexes in
// drizzle/manual/0001_partial_indexes.sql.
export function isUniqueViolation(err: unknown, constraintName?: string): boolean {
  if (!(err instanceof Error)) return false;
  const cause = err.cause as { code?: string; constraint?: string } | undefined;
  if (cause?.code !== '23505') return false;
  return constraintName ? cause.constraint === constraintName : true;
}
