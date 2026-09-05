import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users, files } from './auth';
import { crmStageEnum, crmTaskStatusEnum, orderStageEnum } from './enums';

// The Phase 1 repository seam backs these with static data; Phase 9 moves
// the catalogue here without touching any page. Slugs are what public URLs
// and referral links (`/[slug]?ref=...`) use.
export const services = pgTable('services', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 100 }).notNull(), // "real-estate-qualified-buyers" | "ai-content-avatar" | "unlimited-video-editing"
  name: varchar('name', { length: 200 }).notNull(),
  shortDescription: text('short_description').notNull(),
  longDescriptionHtml: text('long_description_html').notNull(),
  isActive: varchar('is_active', { length: 5 }).notNull().default('true'), // "true"/"false" kept simple for the catalogue toggle
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  slugUidx: uniqueIndex('services_slug_uidx').on(t.slug),
}));

// service.edit (name/description/isActive) and service.pricing (this table)
// are gated by separate permissions — see docs/ARCHITECTURE.md §11.
export const servicePlans = pgTable('service_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  // All money as integer paise in bigint. Never a float, never rupees.
  pricePaise: bigint('price_paise', { mode: 'number' }).notNull(),
  isActive: varchar('is_active', { length: 5 }).notNull().default('true'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  serviceIdx: index('service_plans_service_idx').on(t.serviceId),
  // Doubles as the idempotency key scripts/seed/catalogue.ts upserts on —
  // (service, plan name) is what identifies "the same plan" across reseeds,
  // since a plan has no other stable natural key before Phase 9 gives the
  // catalogue a real admin UI.
  serviceNameUidx: uniqueIndex('service_plans_service_name_uidx').on(t.serviceId, t.name),
}));

// Written in the same transaction as any price update. "What did this plan
// cost on the day this order was placed" is answered from the order's own
// stored amount, never by looking this table up — this exists for the
// catalogue's own audit trail, not for repricing past orders.
export const servicePlanPriceHistory = pgTable('service_plan_price_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  servicePlanId: uuid('service_plan_id').notNull().references(() => servicePlans.id, { onDelete: 'cascade' }),
  oldPricePaise: bigint('old_price_paise', { mode: 'number' }).notNull(),
  newPricePaise: bigint('new_price_paise', { mode: 'number' }).notNull(),
  reason: text('reason').notNull(),
  changedByUserId: uuid('changed_by_user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Orders store their own amount — set at purchase time from the plan's
// price then, and never rewritten by a later catalogue price change.
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  servicePlanId: uuid('service_plan_id').notNull().references(() => servicePlans.id),
  amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
  stage: orderStageEnum('stage').notNull().default('AWAITING_PAYMENT'),
  requirementsLockedAt: timestamp('requirements_locked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index('orders_user_idx').on(t.userId),
}));

// Append-only timeline of stage transitions — this is what drives CRM
// self-population (§9) rather than a separate manually-maintained log.
export const orderEvents = pgTable('order_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  fromStage: orderStageEnum('from_stage'),
  toStage: orderStageEnum('to_stage').notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orderIdx: index('order_events_order_idx').on(t.orderId),
}));

export const orderAssignments = pgTable('order_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  assignedUserId: uuid('assigned_user_id').notNull().references(() => users.id),
  role: varchar('role', { length: 100 }).notNull(), // e.g. "editor", "account_manager"
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  unassignedAt: timestamp('unassigned_at', { withTimezone: true }),
}, (t) => ({
  orderIdx: index('order_assignments_order_idx').on(t.orderId),
}));

export const orderFiles = pgTable('order_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id').notNull().references(() => files.id),
  uploadedByUserId: uuid('uploaded_by_user_id').notNull().references(() => users.id),
  kind: varchar('kind', { length: 50 }).notNull(), // "client_upload" | "deliverable_asset"
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orderIdx: index('order_files_order_idx').on(t.orderId),
}));

// Draft schema (everything optional) and submit schema validate the same
// JSON shape in exactly one shared Zod module (src/lib/onboarding-schemas.ts,
// added in Phase 6) — this table just stores whichever was last saved.
export const onboardingSubmissions = pgTable('onboarding_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  data: jsonb('data').notNull().default({}),
  isDraft: varchar('is_draft', { length: 5 }).notNull().default('true'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orderUidx: uniqueIndex('onboarding_submissions_order_uidx').on(t.orderId),
}));

export const meetings = pgTable('meetings', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  scheduledByUserId: uuid('scheduled_by_user_id').references(() => users.id),
  meetingLink: text('meeting_link'),
  heldAt: timestamp('held_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orderIdx: index('meetings_order_idx').on(t.orderId),
}));

export const deliverables = pgTable('deliverables', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id').references(() => files.id),
  description: text('description'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  clientApprovedAt: timestamp('client_approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orderIdx: index('deliverables_order_idx').on(t.orderId),
}));

// Fills itself from order lifecycle events, not maintained by hand.
// Deduped on email; resolves the user account by email even when no userId
// is supplied at order creation (see docs/ARCHITECTURE.md §9).
export const crmContacts = pgTable('crm_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  email: varchar('email', { length: 320 }).notNull(),
  fullName: varchar('full_name', { length: 200 }),
  phone: varchar('phone', { length: 20 }),
  stage: crmStageEnum('stage').notNull().default('NEW'),
  ownerUserId: uuid('owner_user_id').references(() => users.id), // assigned account manager
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailUidx: uniqueIndex('crm_contacts_email_uidx').on(t.email),
}));

export const crmActivities = pgTable('crm_activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id').notNull().references(() => crmContacts.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 50 }).notNull(), // "stage_change" | "order_created" | "call_logged" | ...
  fromStage: crmStageEnum('from_stage'),
  toStage: crmStageEnum('to_stage'),
  note: text('note'),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contactIdx: index('crm_activities_contact_idx').on(t.contactId),
}));

export const crmNotes = pgTable('crm_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id').notNull().references(() => crmContacts.id, { onDelete: 'cascade' }),
  authorUserId: uuid('author_user_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contactIdx: index('crm_notes_contact_idx').on(t.contactId),
}));

export const crmTasks = pgTable('crm_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id').notNull().references(() => crmContacts.id, { onDelete: 'cascade' }),
  assignedUserId: uuid('assigned_user_id').references(() => users.id),
  title: varchar('title', { length: 300 }).notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  status: crmTaskStatusEnum('status').notNull().default('OPEN'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contactIdx: index('crm_tasks_contact_idx').on(t.contactId),
}));
