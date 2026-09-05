import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { crmActivities, crmContacts, orders, profiles, users } from '@/db/schema';

// "Order → CRM contact" (docs/ARCHITECTURE.md §8) — called once, from
// src/lib/payments/order-webhooks.ts, the moment a service order's payment
// is captured, so a contact always exists by the time onboarding starts.
// Full CRM self-population from every LATER stage transition, plus the
// dashboard/task tooling around it (§9), is Phase 7's job — this
// function's scope stops at "the contact exists and this order is on its
// timeline."
//
// Deduped on email (crm_contacts_email_uidx): a returning customer placing
// a second order attaches to their existing contact rather than creating a
// duplicate. Also resolves and backfills userId even though email is the
// join key — a contact created before this buyer had an account (e.g. a
// lead-form submission) must not stay permanently unlinked from the order
// that just proved who they are (docs/ARCHITECTURE.md §9).
export async function upsertContactForOrder(orderId: string): Promise<typeof crmContacts.$inferSelect> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error(`No such order: ${orderId}`);

  const [user] = await db.select().from(users).where(eq(users.id, order.userId));
  if (!user) throw new Error(`No such user: ${order.userId}`);

  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, user.id));

  let [contact] = await db.select().from(crmContacts).where(eq(crmContacts.email, user.email));

  if (!contact) {
    const [created] = await db
      .insert(crmContacts)
      .values({ userId: user.id, email: user.email, fullName: profile?.fullName ?? null, stage: 'ONBOARDING' })
      .returning();
    if (!created) throw new Error('Insert did not return a row');
    contact = created;
  } else if (!contact.userId) {
    const [updated] = await db
      .update(crmContacts)
      .set({ userId: user.id, updatedAt: new Date() })
      .where(eq(crmContacts.id, contact.id))
      .returning();
    if (!updated) throw new Error('Update did not return a row');
    contact = updated;
  }

  await db.insert(crmActivities).values({
    contactId: contact.id,
    type: 'order_created',
    toStage: 'ONBOARDING',
    note: `Order ${orderId} paid`,
  });

  return contact;
}
