import { db } from '@/db';
import { auditLogs } from '@/db/schema';

// Audits denials as well as successes (docs/ARCHITECTURE.md §4/rule 16) — a
// log containing only successes cannot show an attack in progress. Call
// this from the actor guard and from every permission check, not just from
// "interesting" admin actions.
export async function logAudit(entry: {
  actorUserId?: string | null;
  action: string;
  outcome: 'ALLOWED' | 'DENIED';
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    outcome: entry.outcome,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata,
    ipAddress: entry.ipAddress,
  });
}
