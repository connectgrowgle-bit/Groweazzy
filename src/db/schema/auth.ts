import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { authTokenPurposeEnum, fileScanStatusEnum, sessionRevokedReasonEnum } from './enums';

// A suspended/reset user must lose access on their very next request. Every
// session check compares `sessions.createdAt` against `users.sessionsValidFrom`
// as well as its own expiry — bumping the watermark invalidates every
// existing session at once without touching the sessions table.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 320 }).notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  passwordHash: text('password_hash').notNull(), // argon2id
  sessionsValidFrom: timestamp('sessions_valid_from', { withTimezone: true }).notNull().defaultNow(),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  mfaSecretEncrypted: text('mfa_secret_encrypted'), // AES-256-GCM, null until enrolled
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailUidx: uniqueIndex('users_email_uidx').on(t.email),
}));

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  fullName: varchar('full_name', { length: 200 }),
  phone: varchar('phone', { length: 20 }),
  avatarFileId: uuid('avatar_file_id'), // FK to files, added after files is defined below
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userUidx: uniqueIndex('profiles_user_uidx').on(t.userId),
}));

// Composed of permissions, never branched on by name in application code.
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 100 }).notNull(), // e.g. "STAFF", "ADMIN" — a label, not a check
  label: varchar('label', { length: 200 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  keyUidx: uniqueIndex('roles_key_uidx').on(t.key),
}));

// The 36+ permission catalogue. `can(actor, "payout.approve")` resolves
// through role_permissions -> user_roles per request.
export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 150 }).notNull(), // e.g. "payout.approve", "service.pricing"
  description: text('description').notNull(),
}, (t) => ({
  keyUidx: uniqueIndex('permissions_key_uidx').on(t.key),
}));

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: uniqueIndex('role_permissions_pk').on(t.roleId, t.permissionId),
}));

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: uniqueIndex('user_roles_pk').on(t.userId, t.roleId),
}));

// Database rows, not JWTs. Only sha256(token) is stored — the raw token is
// shown to the client exactly once, at creation.
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(), // sha256 hex
  ipAddress: varchar('ip_address', { length: 64 }),
  userAgent: text('user_agent'),
  // MFA-aware sessions: a session that hasn't answered its challenge yet is
  // refused by the actor guard exactly like an expired one.
  mfaVerifiedAt: timestamp('mfa_verified_at', { withTimezone: true }),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
  slidingExpiresAt: timestamp('sliding_expires_at', { withTimezone: true }).notNull(),
  absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: sessionRevokedReasonEnum('revoked_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tokenHashUidx: uniqueIndex('sessions_token_hash_uidx').on(t.tokenHash),
  userIdx: index('sessions_user_idx').on(t.userId),
}));

// Single-use tokens for email verification / password reset / MFA setup —
// separate from sessions so a leaked verification link can't be replayed as
// a login token.
export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: authTokenPurposeEnum('purpose').notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tokenHashUidx: uniqueIndex('auth_tokens_token_hash_uidx').on(t.tokenHash),
}));

// Uploaded files. Type is classified from magic bytes at upload time and
// stored here — never trust Content-Type or the filename.
export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  storageDriver: varchar('storage_driver', { length: 20 }).notNull(), // "local" | "s3"
  storageKey: text('storage_key').notNull(),
  detectedMimeType: varchar('detected_mime_type', { length: 150 }).notNull(),
  originalFilename: text('original_filename').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  scanStatus: fileScanStatusEnum('scan_status').notNull().default('PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Append-only. Audits denials as well as successes — a log of only
// successes cannot show an attack in progress.
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 150 }).notNull(), // e.g. "payout.approve"
  outcome: varchar('outcome', { length: 20 }).notNull(), // "ALLOWED" | "DENIED"
  targetType: varchar('target_type', { length: 100 }),
  targetId: uuid('target_id'),
  metadata: jsonb('metadata'),
  ipAddress: varchar('ip_address', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  actorIdx: index('audit_logs_actor_idx').on(t.actorUserId),
  createdAtIdx: index('audit_logs_created_at_idx').on(t.createdAt),
}));

// MFA recovery codes are bearer credentials — hashed with Argon2id, not
// just stored/compared in plaintext.
export const mfaRecoveryCodes = pgTable('mfa_recovery_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull(), // argon2id
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Replay protection for TOTP: a (userId, timeStep) pair can be consumed once.
export const mfaUsedCodes = pgTable('mfa_used_codes', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  timeStep: bigint('time_step', { mode: 'number' }).notNull(), // floor(unixTime / 30)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uidx: uniqueIndex('mfa_used_codes_uidx').on(t.userId, t.timeStep),
}));

// Records of scheduled job executions (commission release, payout batches,
// etc.) — lets the ops dashboard show "did the 2am run actually happen".
export const jobRuns = pgTable('job_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobName: varchar('job_name', { length: 150 }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: varchar('status', { length: 20 }).notNull().default('RUNNING'), // RUNNING | SUCCEEDED | FAILED
  itemsProcessed: integer('items_processed').notNull().default(0),
  itemsFailed: integer('items_failed').notNull().default(0),
  errorSummary: text('error_summary'),
}, (t) => ({
  jobNameIdx: index('job_runs_job_name_idx').on(t.jobName),
}));
