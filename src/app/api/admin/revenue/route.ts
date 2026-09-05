import { requireActor } from '@/lib/auth/actor';
import { can } from '@/lib/auth/rbac';
import { getAffiliatePerformance, getRevenueSummary } from '@/lib/admin/revenue';

// report.revenue.view and report.affiliate.view are separate permissions
// (docs/ARCHITECTURE.md §13 D-6's spirit — narrow, purpose-specific grants
// rather than one broad "can see admin numbers" flag) — each section of
// the response is included only if the actor holds the matching one, so a
// FINANCE-only actor (revenue, no affiliate report) gets just their half.
export async function GET() {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  const [canViewRevenue, canViewAffiliateReport] = await Promise.all([
    can(actor.user.id, 'report.revenue.view'),
    can(actor.user.id, 'report.affiliate.view'),
  ]);

  if (!canViewRevenue && !canViewAffiliateReport) {
    return Response.json({ error: 'Not permitted' }, { status: 403 });
  }

  const [revenue, affiliatePerformance] = await Promise.all([
    canViewRevenue ? getRevenueSummary() : Promise.resolve(null),
    canViewAffiliateReport ? getAffiliatePerformance() : Promise.resolve(null),
  ]);

  return Response.json({ revenue, affiliatePerformance });
}
