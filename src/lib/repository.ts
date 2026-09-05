// The repository seam (docs/ARCHITECTURE.md §3): every page and component
// reads content through here, never directly. Phase 1 backs these with the
// static data below; Phase 9 swaps the bodies for `db` queries and changes
// nothing else. Signatures are async from day one for exactly that reason.

export type ServicePlan = {
  id: string;
  name: string;
  pricePaise: number;
};

export type Service = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  longDescriptionHtml: string;
  plans: ServicePlan[];
};

// Placeholder content for Phase 1. Replaced by a `db.select().from(services)...`
// query in Phase 9 — callers of getServices()/getServiceBySlug() do not change.
const STATIC_SERVICES: Service[] = [
  {
    id: 'real-estate-qualified-buyers',
    slug: 'real-estate-qualified-buyers',
    name: 'Real Estate Qualified Buyers',
    shortDescription: 'Pre-qualified buyer leads for builders, developers and brokers.',
    longDescriptionHtml: '<p>Content pending — Phase 1 copy.</p>',
    plans: [{ id: 'reqb-standard', name: 'Standard', pricePaise: 0 }],
  },
  {
    id: 'ai-content-avatar',
    slug: 'ai-content-avatar',
    name: 'AI Content Avatar',
    shortDescription: 'An AI-driven content presence for founders and personal brands.',
    longDescriptionHtml: '<p>Content pending — Phase 1 copy.</p>',
    plans: [{ id: 'aca-standard', name: 'Standard', pricePaise: 0 }],
  },
  {
    id: 'unlimited-video-editing',
    slug: 'unlimited-video-editing',
    name: 'Unlimited Video Editing',
    shortDescription: 'Unlimited-request video editing for agencies and creators.',
    longDescriptionHtml: '<p>Content pending — Phase 1 copy.</p>',
    plans: [{ id: 'uve-standard', name: 'Standard', pricePaise: 0 }],
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
