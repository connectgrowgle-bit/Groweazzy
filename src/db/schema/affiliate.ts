import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { orders, services } from './client';
import {
  affiliateStatusEnum,
  commissionEntryTypeEnum,
  commissionStatusEnum,
  kycStatusEnum,
  paymentPurposeEnum,
  paymentStatusEnum,
  payoutStatusEnum,
} from './enums';

export const affiliates = pgTable('affiliates', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: affiliateStatusEnum('status').notNull().default('REGISTERED'),
  referralCode: varchar('referral_code', { length: 20 }).notNull(), // e.g. "GEA10245"
  // Bank details for payout — encrypted at rest, last-4 kept readable for display.
  bankAccountEncrypted: text('bank_account_encrypted'),
  bankAccountLast4: varchar('bank_account_last4', { length: 4 }),
  bankIfsc: varchar('bank_ifsc', { length: 11 }),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  terminatedAt: timestamp('terminated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userUidx: uniqueIndex('affiliates_user_uidx').on(t.userId),
  referralCodeUidx: uniqueIndex('affiliates_referral_code_uidx').on(t.referralCode),
}));

// PAN encrypted with AES-256-GCM; only last 4 chars readable. A keyed HMAC
// fingerprint (panFingerprint) detects duplicate identities across
// affiliates without ever decrypting stored values for that comparison.
// "One active KYC per affiliate" is a partial unique index — see
// drizzle/manual/0001_partial_indexes.sql.
export const affiliateKyc = pgTable('affiliate_kyc', {
  id: uuid('id').primaryKey().defaultRandom(),
  affiliateId: uuid('affiliate_id').notNull().references(() => affiliates.id, { onDelete: 'cascade' }),
  panEncrypted: text('pan_encrypted').notNull(),
  panLast4: varchar('pan_last4', { length: 4 }).notNull(),
  panFingerprint: varchar('pan_fingerprint', { length: 64 }).notNull(), // hmac-sha256, hex
  status: kycStatusEnum('status').notNull().default('SUBMITTED'),
  reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  affiliateIdx: index('affiliate_kyc_affiliate_idx').on(t.affiliateId),
  fingerprintIdx: index('affiliate_kyc_fingerprint_idx').on(t.panFingerprint),
}));

// Per-service referral links: /[service-slug]?ref=<referralCode>.
export const affiliateLinks = pgTable('affiliate_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  affiliateId: uuid('affiliate_id').notNull().references(() => affiliates.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id').references(() => services.id), // null = site-wide link
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  affiliateIdx: index('affiliate_links_affiliate_idx').on(t.affiliateId),
}));

export const affiliateClicks = pgTable('affiliate_clicks', {
  id: uuid('id').primaryKey().defaultRandom(),
  affiliateLinkId: uuid('affiliate_link_id').notNull().references(() => affiliateLinks.id, { onDelete: 'cascade' }),
  cookieId: uuid('cookie_id').notNull(), // value inside the signed attribution cookie
  landingPath: text('landing_path').notNull(),
  ipAddress: varchar('ip_address', { length: 64 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  linkIdx: index('affiliate_clicks_link_idx').on(t.affiliateLinkId),
  cookieIdx: index('affiliate_clicks_cookie_idx').on(t.cookieId),
}));

// A lead is a click that identified itself (e.g. submitted contact/checkout
// form) before converting. Not every click becomes a lead; not every lead
// converts.
export const affiliateLeads = pgTable('affiliate_leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  affiliateClickId: uuid('affiliate_click_id').notNull().references(() => affiliateClicks.id),
  email: varchar('email', { length: 320 }),
  phone: varchar('phone', { length: 20 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// The conversion is the join point between an order and the affiliate who
// gets credit for it. One order attributes to at most one conversion.
export const affiliateConversions = pgTable('affiliate_conversions', {
  id: uuid('id').primaryKey().defaultRandom(),
  affiliateId: uuid('affiliate_id').notNull().references(() => affiliates.id),
  affiliateLeadId: uuid('affiliate_lead_id').references(() => affiliateLeads.id),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orderUidx: uniqueIndex('affiliate_conversions_order_uidx').on(t.orderId),
  affiliateIdx: index('affiliate_conversions_affiliate_idx').on(t.affiliateId),
}));

// Append-only ledger. No balance column anywhere — balance is SUM() over
// these rows, computed on read (see docs/ARCHITECTURE.md §6).
//
// "One EARNING row per conversion" is a partial unique index, not an
// application check — see drizzle/manual/0001_partial_indexes.sql.
export const commissionEntries = pgTable('commission_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  affiliateId: uuid('affiliate_id').notNull().references(() => affiliates.id),
  conversionId: uuid('conversion_id').notNull().references(() => affiliateConversions.id),
  type: commissionEntryTypeEnum('type').notNull(),
  status: commissionStatusEnum('status').notNull().default('PENDING'),
  amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(), // negative for REVERSAL rows
  commissionRateBasisPoints: bigint('commission_rate_basis_points', { mode: 'number' }).notNull(), // 1000 = 10%
  holdReleaseAt: timestamp('hold_release_at', { withTimezone: true }), // when it may move PENDING/APPROVED -> AVAILABLE
  reversalOfEntryId: uuid('reversal_of_entry_id'), // self-reference, set for REVERSAL rows
  payoutId: uuid('payout_id'), // FK added once payouts is declared below
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  affiliateIdx: index('commission_entries_affiliate_idx').on(t.affiliateId),
  conversionIdx: index('commission_entries_conversion_idx').on(t.conversionId),
}));

// Historical/admin-configurable commission rate and fee settings, versioned
// so past commissions remain explainable even after a rate change.
export const commissionPolicies = pgTable('commission_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  commissionRateBasisPoints: bigint('commission_rate_basis_points', { mode: 'number' }).notNull().default(1000),
  registrationFeePaise: bigint('registration_fee_paise', { mode: 'number' }).notNull().default(200000), // ₹2,000
  registrationFeeEnabled: varchar('registration_fee_enabled', { length: 5 }).notNull().default('true'),
  minPayoutPaise: bigint('min_payout_paise', { mode: 'number' }).notNull().default(100000), // ₹1,000
  holdPeriodDays: bigint('hold_period_days', { mode: 'number' }).notNull().default(15),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// "One open payout per affiliate" is a partial unique index — see
// drizzle/manual/0001_partial_indexes.sql. net = gross - tds is a CHECK
// constraint in the same file, not just application arithmetic.
export const payouts = pgTable('payouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  affiliateId: uuid('affiliate_id').notNull().references(() => affiliates.id),
  batchId: uuid('batch_id'), // FK added once payoutBatches is declared below
  grossPaise: bigint('gross_paise', { mode: 'number' }).notNull(),
  tdsPaise: bigint('tds_paise', { mode: 'number' }).notNull(),
  netPaise: bigint('net_paise', { mode: 'number' }).notNull(),
  status: payoutStatusEnum('status').notNull().default('REQUESTED'),
  // Idempotency key must vary across retries of a failed transfer, not
  // just be derived from the entry set — see docs/ARCHITECTURE.md mistake #6.
  transferIdempotencyKey: varchar('transfer_idempotency_key', { length: 100 }).notNull(),
  gatewayTransferId: text('gateway_transfer_id'), // RazorpayX/Cashfree reference once sent
  approvedByUserId: uuid('approved_by_user_id').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  affiliateIdx: index('payouts_affiliate_idx').on(t.affiliateId),
  idempotencyUidx: uniqueIndex('payouts_idempotency_uidx').on(t.transferIdempotencyKey),
}));

// Groups payouts processed together in one fortnightly run.
export const payoutBatches = pgTable('payout_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('OPEN'), // OPEN | PROCESSING | CLOSED
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One row per Razorpay order/payment attempt. Never marked CAPTURED except
// by a verified webhook or a server-to-server status fetch.
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  purpose: paymentPurposeEnum('purpose').notNull(),
  orderId: uuid('order_id').references(() => orders.id), // set when purpose = SERVICE_ORDER
  affiliateId: uuid('affiliate_id').references(() => affiliates.id), // set when purpose = AFFILIATE_FEE
  amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
  amountRefundedPaise: bigint('amount_refunded_paise', { mode: 'number' }).notNull().default(0), // mirrors Razorpay's cumulative figure, never a locally-incremented counter
  status: paymentStatusEnum('status').notNull().default('CREATED'),
  razorpayOrderId: varchar('razorpay_order_id', { length: 100 }).notNull(),
  razorpayPaymentId: varchar('razorpay_payment_id', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  razorpayOrderUidx: uniqueIndex('payments_razorpay_order_uidx').on(t.razorpayOrderId),
}));

// Raw event log per payment — every status transition Razorpay reports,
// kept even after payments.status has moved on, for dispute/debug purposes.
export const paymentTransactions = pgTable('payment_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id').notNull().references(() => payments.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 100 }).notNull(), // e.g. "payment.captured"
  rawPayload: jsonb('raw_payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  paymentIdx: index('payment_transactions_payment_idx').on(t.paymentId),
}));

// Idempotent webhook inbox keyed on the provider's own event id. A replayed
// delivery is a no-op — see drizzle/manual/0001_partial_indexes.sql for the
// unique index (kept alongside the others even though this one is a plain
// unique index, not partial).
export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: varchar('provider', { length: 30 }).notNull().default('razorpay'),
  providerEventId: varchar('provider_event_id', { length: 150 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  rawBody: text('raw_body').notNull(), // exact bytes received, for signature re-verification/debugging
  processedAt: timestamp('processed_at', { withTimezone: true }),
  processingError: text('processing_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerEventUidx: uniqueIndex('webhook_events_provider_event_uidx').on(t.provider, t.providerEventId),
}));

// Admin-configurable key/value settings (commission rate overrides, feature
// flags, etc.) distinct from commissionPolicies' versioned history.
export const settings = pgTable('settings', {
  key: varchar('key', { length: 150 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const settingsHistory = pgTable('settings_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 150 }).notNull(),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value').notNull(),
  changedByUserId: uuid('changed_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  keyIdx: index('settings_history_key_idx').on(t.key),
}));
