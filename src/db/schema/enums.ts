import { pgEnum } from 'drizzle-orm/pg-core';

// --- Auth / RBAC ---
export const sessionRevokedReasonEnum = pgEnum('session_revoked_reason', [
  'LOGOUT',
  'PASSWORD_RESET',
  'SUSPENSION',
  'ABSOLUTE_EXPIRY',
  'IDLE_EXPIRY',
  'ADMIN_REVOKED',
]);

export const authTokenPurposeEnum = pgEnum('auth_token_purpose', [
  'EMAIL_VERIFY',
  'PASSWORD_RESET',
  'MFA_SETUP',
]);

export const fileScanStatusEnum = pgEnum('file_scan_status', ['PENDING', 'CLEAN', 'INFECTED', 'SKIPPED']);

// --- Affiliate ---
export const affiliateStatusEnum = pgEnum('affiliate_status', [
  'REGISTERED',
  'KYC_PENDING',
  'KYC_SUBMITTED',
  'KYC_REJECTED',
  'FEE_PENDING',
  'ACTIVE',
  'SUSPENDED',
  'TERMINATED',
]);

export const kycStatusEnum = pgEnum('kyc_status', ['SUBMITTED', 'APPROVED', 'REJECTED']);

export const commissionEntryTypeEnum = pgEnum('commission_entry_type', ['EARNING', 'REVERSAL', 'ADJUSTMENT']);

export const commissionStatusEnum = pgEnum('commission_status', [
  'PENDING',
  'APPROVED',
  'AVAILABLE',
  'PAID',
  'REVERSED',
  'CANCELLED',
]);

export const payoutStatusEnum = pgEnum('payout_status', [
  'REQUESTED',
  'APPROVED',
  'PROCESSING',
  'PAID',
  'FAILED',
  'REJECTED',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'CREATED',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
]);

export const paymentPurposeEnum = pgEnum('payment_purpose', ['SERVICE_ORDER', 'AFFILIATE_FEE']);

// --- Client workflow ---
export const orderStageEnum = pgEnum('order_stage', [
  'AWAITING_PAYMENT',
  'PAID',
  'ONBOARDING',
  'MEETING_SCHEDULED',
  'REQUIREMENTS_LOCKED',
  'TEAM_ASSIGNED',
  'IN_PROGRESS',
  'REVIEW',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
]);

export const crmStageEnum = pgEnum('crm_stage', [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'ONBOARDING',
  'IN_PROGRESS',
  'REVIEW',
  'DELIVERED',
  'COMPLETED',
  'LOST',
  'CANCELLED',
]);

export const crmTaskStatusEnum = pgEnum('crm_task_status', ['OPEN', 'DONE', 'CANCELLED']);

// --- Training ---
export const publishStatusEnum = pgEnum('publish_status', ['DRAFT', 'PUBLISHED']);

// --- Support ---
export const ticketStatusEnum = pgEnum('ticket_status', ['OPEN', 'PENDING_CUSTOMER', 'RESOLVED', 'CLOSED']);

export const notificationChannelEnum = pgEnum('notification_channel', ['EMAIL', 'IN_APP']);
