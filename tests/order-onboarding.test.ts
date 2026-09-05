import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '@/db';
import { onboardingSubmissions, orders } from '@/db/schema';
import { resolveServicePlan, seedCatalogueFromRepository } from '@/lib/catalogue';
import { RequirementsLockedError, saveOnboardingDraft, submitOnboarding } from '@/lib/orders/onboarding';
import { lockRequirements, OnboardingNotSubmittedError } from '@/lib/orders/lock';
import { transitionOrderStage } from '@/lib/orders/lifecycle';
import { createTestUser, deleteTestOrder, deleteTestUser } from './helpers';

const COMPLETE_BRIEF = {
  brandName: 'Test Brand',
  positioningSummary: 'Testing the onboarding lib directly',
  voiceReferenceUrl: 'https://example.test/voice-sample',
  postingCadencePerWeek: 3,
  platforms: ['instagram'],
};

const createdUserIds: string[] = [];
const createdOrderIds: string[] = [];

// These tests exercise service-specific validation (src/lib/onboarding-schemas.ts),
// so — unlike tests/helpers.ts's generic getOrCreateTestServicePlan fixture
// — orders here must point at a real, seeded ai-content-avatar plan.
async function createAiContentOrder(userId: string, stage: string = 'ONBOARDING') {
  const { plan } = await resolveServicePlan('aca-standard');
  const [order] = await db
    .insert(orders)
    .values({
      userId,
      servicePlanId: plan.id,
      amountPaise: plan.pricePaise,
      stage: stage as typeof orders.$inferInsert.stage,
    })
    .returning();
  if (!order) throw new Error('failed to create test order');
  createdOrderIds.push(order.id);
  return order;
}

beforeAll(async () => {
  await seedCatalogueFromRepository();
});

afterEach(async () => {
  while (createdOrderIds.length) {
    const id = createdOrderIds.pop();
    if (id) await deleteTestOrder(id);
  }
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

describe('onboarding draft/submit (src/lib/orders/onboarding.ts)', () => {
  it('draft schema accepts a partial payload', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createAiContentOrder(user.id);

    const row = await saveOnboardingDraft(order.id, { brandName: 'Just One Field' });
    expect(row.isDraft).toBe('true');
    expect((row.data as Record<string, unknown>).brandName).toBe('Just One Field');
  });

  it('submit schema rejects an incomplete payload', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createAiContentOrder(user.id);

    await expect(submitOnboarding(order.id, { brandName: 'Only One Field' })).rejects.toThrow(ZodError);
  });

  it('submit schema accepts a complete payload and does not lock requirements', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createAiContentOrder(user.id);

    const row = await submitOnboarding(order.id, COMPLETE_BRIEF);
    expect(row.isDraft).toBe('false');
    expect(row.submittedAt).not.toBeNull();

    const [orderRow] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(orderRow?.requirementsLockedAt).toBeNull();
    expect(orderRow?.stage).toBe('ONBOARDING');
  });

  it('a second submit overwrites the first, not a second row (one-row-per-order)', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createAiContentOrder(user.id);

    await submitOnboarding(order.id, COMPLETE_BRIEF);
    await submitOnboarding(order.id, { ...COMPLETE_BRIEF, brandName: 'Revised Brand' });

    const rows = await db.select().from(onboardingSubmissions).where(eq(onboardingSubmissions.orderId, order.id));
    expect(rows).toHaveLength(1);
    expect((rows[0]?.data as Record<string, unknown>).brandName).toBe('Revised Brand');
  });

  it('refuses to save a draft or submit once requirements are locked', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createAiContentOrder(user.id, 'REQUIREMENTS_LOCKED');
    await db.update(orders).set({ requirementsLockedAt: new Date() }).where(eq(orders.id, order.id));

    await expect(saveOnboardingDraft(order.id, { brandName: 'Too late' })).rejects.toThrow(RequirementsLockedError);
    await expect(submitOnboarding(order.id, COMPLETE_BRIEF)).rejects.toThrow(RequirementsLockedError);
  });
});

describe('lockRequirements (src/lib/orders/lock.ts)', () => {
  it('refuses to lock when there is no onboarding submission at all', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createAiContentOrder(user.id, 'MEETING_SCHEDULED');

    await expect(lockRequirements(order.id)).rejects.toThrow(OnboardingNotSubmittedError);
  });

  it('refuses to lock when the submission is still only a draft', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createAiContentOrder(user.id, 'MEETING_SCHEDULED');
    await saveOnboardingDraft(order.id, { brandName: 'Draft only' });

    await expect(lockRequirements(order.id)).rejects.toThrow(OnboardingNotSubmittedError);
  });

  it('locks once submitted and at MEETING_SCHEDULED, setting requirementsLockedAt and the stage together', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createAiContentOrder(user.id, 'MEETING_SCHEDULED');
    await submitOnboarding(order.id, COMPLETE_BRIEF);

    const updated = await lockRequirements(order.id);
    expect(updated.stage).toBe('REQUIREMENTS_LOCKED');
    expect(updated.requirementsLockedAt).not.toBeNull();
  });

  it('still refuses on the order lifecycle\'s own terms — e.g. locking straight from ONBOARDING', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createAiContentOrder(user.id, 'ONBOARDING');
    await submitOnboarding(order.id, COMPLETE_BRIEF);

    // Submitted, but the order itself never went through MEETING_SCHEDULED —
    // transitionOrderStage's own ALLOWED_TRANSITIONS map is what rejects
    // this, not lockRequirements duplicating that check.
    await expect(lockRequirements(order.id)).rejects.toThrow();
  });
});

// Sanity check that the two libraries actually compose the way the API
// routes assume: transitioning to MEETING_SCHEDULED via the real lifecycle
// function, then locking.
describe('onboarding + lifecycle composed', () => {
  it('ONBOARDING -> MEETING_SCHEDULED -> submit -> lock succeeds end to end', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createAiContentOrder(user.id, 'ONBOARDING');

    await transitionOrderStage(order.id, 'MEETING_SCHEDULED');
    await submitOnboarding(order.id, COMPLETE_BRIEF);
    const locked = await lockRequirements(order.id);

    expect(locked.stage).toBe('REQUIREMENTS_LOCKED');
  });
});
