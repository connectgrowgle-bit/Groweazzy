import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { crmContacts } from '@/db/schema';
import { requirePermission } from '@/lib/auth/actor';

// The pipeline list — every contact, newest-touched first. Filtering by
// stage/owner is left to the client for now (the table is small enough at
// this phase's scale); pagination can be added when it isn't.
export async function GET() {
  const actor = await requirePermission('crm.view');
  if (actor instanceof Response) return actor;

  const contacts = await db.select().from(crmContacts).orderBy(desc(crmContacts.updatedAt)).limit(200);
  return Response.json({ contacts });
}
