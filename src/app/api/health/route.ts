// Liveness only — touches nothing (no DB, no config validation). Distinct
// from /api/ready on purpose: a process that can answer HTTP at all is
// "alive" even while its database is unreachable, and a load balancer
// should not restart it for that.
export async function GET() {
  return Response.json({ status: 'ok' });
}
