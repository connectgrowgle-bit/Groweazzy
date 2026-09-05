import { z } from 'zod';

// One Zod field shape per service, each producing exactly two schemas from
// the SAME definitions (docs/ARCHITECTURE.md §8): a **draft** schema
// (`.partial()` — everything optional, so "save and come back" mid-form
// works) and a **submit** schema (the real, complete requirements). The
// fields are written once, here, and never duplicated into a second
// independently-maintained "what submit actually requires" shape — that
// duplication is exactly how a draft and a submission drift apart.
//
// Field values here are onboarding CONTENT (what the client tells us about
// their business), stored as free-form JSONB — not GrowEazzy's own
// financial transactions, so the integer-paise money rule (docs/ARCHITECTURE.md
// rule 2) doesn't apply to e.g. a client's own target price band; those
// fields are named/typed as plain rupee numbers on purpose, to avoid
// implying they belong to the ledger/payment code paths.
//
// This module has no server-only imports (no `db`, no `next/headers`) so
// the same field specs (below) can also drive form rendering directly from
// a client component — one definition, both jobs.

const realEstateFields = {
  projectName: z.string().min(1).max(200),
  projectLocation: z.string().min(1).max(200),
  priceBandMinInr: z.number().int().positive(),
  priceBandMaxInr: z.number().int().positive(),
  targetBuyerProfile: z.string().min(1).max(2000),
  monthlyLeadTarget: z.number().int().positive(),
};

const aiContentFields = {
  brandName: z.string().min(1).max(200),
  positioningSummary: z.string().min(1).max(2000),
  voiceReferenceUrl: z.string().url(),
  postingCadencePerWeek: z.number().int().positive(),
  platforms: z.array(z.enum(['instagram', 'linkedin', 'youtube_shorts'])).min(1),
};

const videoEditingFields = {
  brandName: z.string().min(1).max(200),
  styleReferenceUrl: z.string().url(),
  typicalVideoLengthMinutes: z.number().positive(),
  footageDeliveryMethod: z.enum(['google_drive', 'dropbox', 'wetransfer', 'other']),
  expectedRequestsPerMonth: z.number().int().positive(),
};

// Keyed by the same service slugs as src/lib/repository.ts's STATIC_SERVICES
// — kept as a separate map rather than attached to the catalogue entries
// themselves, since these shapes are a workflow concern (Phase 6), not
// catalogue/marketing content (Phase 1/9).
const FIELDS_BY_SERVICE_SLUG: Record<string, Record<string, z.ZodTypeAny>> = {
  'real-estate-qualified-buyers': realEstateFields,
  'ai-content-avatar': aiContentFields,
  'unlimited-video-editing': videoEditingFields,
};

export class UnknownOnboardingServiceError extends Error {
  constructor(serviceSlug: string) {
    super(`No onboarding schema defined for service: ${serviceSlug}`);
    this.name = 'UnknownOnboardingServiceError';
  }
}

export function getOnboardingSchemas(serviceSlug: string): { draft: z.ZodTypeAny; submit: z.ZodTypeAny } {
  const fields = FIELDS_BY_SERVICE_SLUG[serviceSlug];
  if (!fields) throw new UnknownOnboardingServiceError(serviceSlug);

  return {
    submit: z.object(fields).strict(),
    draft: z.object(fields).partial().strict(),
  };
}

// Presentation metadata only — never used for validation (getOnboardingSchemas
// above is the only source of truth for that). Lets src/components/OrderWorkspace.tsx
// render each service's form from the same field list instead of a
// hand-copied, driftable one.
export type OnboardingFieldSpec =
  | { name: string; label: string; kind: 'text' | 'textarea' | 'url' | 'number' }
  | { name: string; label: string; kind: 'select' | 'multiselect'; options: string[] };

const FIELD_SPECS_BY_SERVICE_SLUG: Record<string, OnboardingFieldSpec[]> = {
  'real-estate-qualified-buyers': [
    { name: 'projectName', label: 'Project name', kind: 'text' },
    { name: 'projectLocation', label: 'Project location', kind: 'text' },
    { name: 'priceBandMinInr', label: 'Price band — minimum (₹)', kind: 'number' },
    { name: 'priceBandMaxInr', label: 'Price band — maximum (₹)', kind: 'number' },
    { name: 'targetBuyerProfile', label: 'Target buyer profile', kind: 'textarea' },
    { name: 'monthlyLeadTarget', label: 'Monthly lead target', kind: 'number' },
  ],
  'ai-content-avatar': [
    { name: 'brandName', label: 'Brand name', kind: 'text' },
    { name: 'positioningSummary', label: 'Positioning summary', kind: 'textarea' },
    { name: 'voiceReferenceUrl', label: 'Voice/footage reference link', kind: 'url' },
    { name: 'postingCadencePerWeek', label: 'Videos per week', kind: 'number' },
    {
      name: 'platforms',
      label: 'Platforms',
      kind: 'multiselect',
      options: ['instagram', 'linkedin', 'youtube_shorts'],
    },
  ],
  'unlimited-video-editing': [
    { name: 'brandName', label: 'Brand name', kind: 'text' },
    { name: 'styleReferenceUrl', label: 'Style reference link', kind: 'url' },
    { name: 'typicalVideoLengthMinutes', label: 'Typical video length (minutes)', kind: 'number' },
    {
      name: 'footageDeliveryMethod',
      label: 'Footage delivery method',
      kind: 'select',
      options: ['google_drive', 'dropbox', 'wetransfer', 'other'],
    },
    { name: 'expectedRequestsPerMonth', label: 'Expected requests per month', kind: 'number' },
  ],
};

export function getOnboardingFieldSpecs(serviceSlug: string): OnboardingFieldSpec[] {
  const specs = FIELD_SPECS_BY_SERVICE_SLUG[serviceSlug];
  if (!specs) throw new UnknownOnboardingServiceError(serviceSlug);
  return specs;
}
