// The repository seam (docs/ARCHITECTURE.md §3): every page and component
// reads catalogue/editorial content through here, never directly. Phase 1
// backs these with the static data below; Phase 9 swaps the bodies for `db`
// queries and changes nothing else. Signatures are async from day one for
// exactly that reason.
//
// Purely legal/static marketing copy (terms, privacy, refund policy pages)
// is NOT routed through this seam — those are versioned documents (see
// docs/ARCHITECTURE.md D-7) rendered directly in their page files, since
// their lifecycle (legal review, dated versions) differs from the
// admin-editable catalogue this file models.

export type ServicePlan = {
  id: string;
  name: string;
  pricePaise: number;
  billingNote: string;
};

export type Service = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  shortDescription: string;
  audience: string;
  features: string[];
  howItWorks: string[];
  plans: ServicePlan[];
};

const STATIC_SERVICES: Service[] = [
  {
    id: 'real-estate-qualified-buyers',
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
    plans: [
      { id: 'reqb-standard', name: 'Standard', pricePaise: 2499900, billingNote: 'per month' },
    ],
  },
  {
    id: 'ai-content-avatar',
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
    plans: [
      { id: 'aca-standard', name: 'Standard', pricePaise: 1499900, billingNote: 'per month' },
    ],
  },
  {
    id: 'unlimited-video-editing',
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
    plans: [
      { id: 'uve-standard', name: 'Standard', pricePaise: 3499900, billingNote: 'per month' },
    ],
  },
];

export async function getServices(): Promise<Service[]> {
  return STATIC_SERVICES;
}

export async function getServiceBySlug(slug: string): Promise<Service | null> {
  return STATIC_SERVICES.find((s) => s.slug === slug) ?? null;
}

export async function getServicePlan(planId: string): Promise<{ service: Service; plan: ServicePlan } | null> {
  for (const service of STATIC_SERVICES) {
    const plan = service.plans.find((p) => p.id === planId);
    if (plan) return { service, plan };
  }
  return null;
}

export type FaqItem = {
  id: string;
  question: string;
  answer: string;
  category: 'general' | 'services' | 'affiliate' | 'billing';
};

const STATIC_FAQS: FaqItem[] = [
  {
    id: 'what-does-groweazzy-do',
    question: 'What does GrowEazzy actually do?',
    answer:
      'We run three performance marketing services directly — Real Estate Qualified Buyers, AI Content Avatar, and Unlimited Video Editing. We are not a marketplace connecting you to other vendors; you work with our team throughout.',
    category: 'general',
  },
  {
    id: 'how-fast-onboarding',
    question: 'How soon after I sign up does work start?',
    answer:
      'Once your payment is confirmed, you get an onboarding form immediately and our team schedules a kickoff call within 2 business days.',
    category: 'services',
  },
  {
    id: 'affiliate-fee-why',
    question: 'Why is there a registration fee for the affiliate programme?',
    answer:
      'The fee covers the training and onboarding materials that come with joining as an affiliate. It is fully optional to become an affiliate, is shown before you pay, and can be waived at GrowEazzy’s discretion — see the Affiliate Terms for the current policy.',
    category: 'affiliate',
  },
  {
    id: 'affiliate-multi-level',
    question: 'Do I earn from affiliates I recruit?',
    answer:
      'No. GrowEazzy’s programme is single-level: you earn commission only on sales you personally refer, never from other affiliates’ activity.',
    category: 'affiliate',
  },
  {
    id: 'refund-policy-summary',
    question: 'What is the refund policy?',
    answer: 'See the full Refund Policy page for current terms and eligibility windows.',
    category: 'billing',
  },
  {
    id: 'payout-schedule',
    question: 'When do affiliates get paid?',
    answer:
      'Approved commissions are paid out fortnightly, once your available balance is above the minimum payout threshold shown on your affiliate dashboard.',
    category: 'affiliate',
  },
];

export async function getFaqs(): Promise<FaqItem[]> {
  return STATIC_FAQS;
}
