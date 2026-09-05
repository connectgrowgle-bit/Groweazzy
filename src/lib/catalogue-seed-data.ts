// The actual, real marketing copy for GrowEazzy's three services — this
// was Phase 1's STATIC_SERVICES array, living directly in
// src/lib/repository.ts. Phase 9 moves the catalogue into the database
// (docs/ARCHITECTURE.md §11, §25), so repository.ts's getServices/
// getServiceBySlug/getServicePlan now read from `services`/`service_plans`
// instead of this array — this file is what seedCatalogueFromRepository()
// (src/lib/catalogue.ts) writes into the database, once, and from then on
// the database (edited through /admin/services, gated on service.edit and
// service.pricing) is the live source. Re-running the seed re-syncs from
// here, so this file is still where a copy/price FIX before the admin UI
// existed would go — not where an ongoing content change should go once
// staff are editing through /admin/services directly.

export type SeedServicePlan = {
  key: string; // the STABLE public identifier — checkout links use this, never the DB row's own uuid
  name: string;
  pricePaise: number;
  billingNote: string;
};

export type SeedService = {
  slug: string;
  name: string;
  tagline: string;
  shortDescription: string;
  audience: string;
  features: string[];
  howItWorks: string[];
  plans: SeedServicePlan[];
};

export const SEED_SERVICES: SeedService[] = [
  {
    slug: 'real-estate-qualified-buyers',
    name: 'Real Estate Qualified Buyers',
    tagline: 'Stop paying for clicks. Start paying for buyers who show up.',
    shortDescription: 'Pre-qualified buyer leads for builders, developers and brokers.',
    audience: 'Builders, developers and brokers',
    features: [
      'Leads screened for budget, timeline and intent before you see them',
      'Delivered directly to your CRM or WhatsApp — no lead dashboard to babysit',
      'Weekly reporting on lead quality and conversion, not just volume',
    ],
    howItWorks: [
      'Tell us your project, price band and target buyer profile',
      'We run targeted campaigns and qualify every response by phone before handoff',
      'You receive only leads that meet your criteria, ready for a site visit',
    ],
    plans: [{ key: 'reqb-standard', name: 'Standard', pricePaise: 2499900, billingNote: 'per month' }],
  },
  {
    slug: 'ai-content-avatar',
    name: 'AI Content Avatar',
    tagline: 'A consistent content presence, without being on camera every day.',
    shortDescription: 'An AI-driven content presence for founders and personal brands.',
    audience: 'Founders and personal brands',
    features: [
      'Your voice and likeness, produced into short-form video on a schedule',
      'Scripts written from your positioning, not generic templates',
      'Platform-ready exports for Instagram, LinkedIn and YouTube Shorts',
    ],
    howItWorks: [
      'One onboarding session to capture your voice, footage and positioning',
      'We script, produce and deliver a batch of videos every cycle',
      'You review and approve — nothing posts without your sign-off',
    ],
    plans: [{ key: 'aca-standard', name: 'Standard', pricePaise: 1499900, billingNote: 'per month' }],
  },
  {
    slug: 'unlimited-video-editing',
    name: 'Unlimited Video Editing',
    tagline: 'Send a request, get an edit back — as many times as you need.',
    shortDescription: 'Unlimited-request video editing for agencies and creators.',
    audience: 'Agencies and creators',
    features: [
      'Unlimited editing requests, one at a time, with a fixed monthly cost',
      'Typical 48-hour turnaround per request',
      'Dedicated editor who learns your style across requests',
    ],
    howItWorks: [
      'Submit a request through your dashboard with raw footage and notes',
      'Your editor delivers a draft; request unlimited revisions until it is right',
      'Approve and move straight to the next request',
    ],
    plans: [{ key: 'uve-standard', name: 'Standard', pricePaise: 3499900, billingNote: 'per month' }],
  },
];
