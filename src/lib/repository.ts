// The repository seam (docs/ARCHITECTURE.md §3): every page and component
// reads catalogue/editorial content through here, never directly. Phase 1
// backed these with a static array; Phase 9 swapped the bodies for `db`
// queries (docs/ARCHITECTURE.md §25) and nothing above this file changed —
// that was the whole point of routing through a seam from day one. The
// original static content now lives in src/lib/catalogue-seed-data.ts,
// used only to bootstrap the database once (scripts/seed/catalogue.ts) —
// the database, edited via /admin/services (service.edit/service.pricing),
// is the live source from here on.
//
// Purely legal/static marketing copy (terms, privacy, refund policy pages)
// is NOT routed through this seam — those are versioned documents (see
// docs/ARCHITECTURE.md D-7) rendered directly in their page files, since
// their lifecycle (legal review, dated versions) differs from the
// admin-editable catalogue this file models.

import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { services as servicesTable, servicePlans as servicePlansTable } from '@/db/schema';

export type ServicePlan = {
  id: string; // the plan's STABLE key (service_plans.key), never the row's own uuid
  name: string;
  pricePaise: number;
  billingNote: string;
};

export type Service = {
  id: string; // the slug, kept as `id` for backward-compatible callers (e.g. React list keys)
  slug: string;
  name: string;
  tagline: string;
  shortDescription: string;
  audience: string;
  features: string[];
  howItWorks: string[];
  plans: ServicePlan[];
};

function toServicePlan(row: typeof servicePlansTable.$inferSelect): ServicePlan {
  return { id: row.key, name: row.name, pricePaise: row.pricePaise, billingNote: row.billingNote };
}

async function toService(row: typeof servicesTable.$inferSelect): Promise<Service> {
  const plans = await db
    .select()
    .from(servicePlansTable)
    .where(and(eq(servicePlansTable.serviceId, row.id), eq(servicePlansTable.isActive, 'true')))
    .orderBy(asc(servicePlansTable.createdAt));

  return {
    id: row.slug,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    shortDescription: row.shortDescription,
    audience: row.audience,
    features: row.features,
    howItWorks: row.howItWorks,
    plans: plans.map(toServicePlan),
  };
}

// Public catalogue reads — active services/plans only. An admin can take a
// service or plan out of the public catalogue (service.edit / service.pricing,
// docs/ARCHITECTURE.md §11) without deleting the row, since existing orders'
// servicePlanId FK still points at it.
export async function getServices(): Promise<Service[]> {
  const rows = await db
    .select()
    .from(servicesTable)
    .where(eq(servicesTable.isActive, 'true'))
    .orderBy(asc(servicesTable.createdAt));
  return Promise.all(rows.map(toService));
}

export async function getServiceBySlug(slug: string): Promise<Service | null> {
  const [row] = await db
    .select()
    .from(servicesTable)
    .where(and(eq(servicesTable.slug, slug), eq(servicesTable.isActive, 'true')));
  return row ? toService(row) : null;
}

// Looked up by the plan's stable key, not the underlying uuid — see
// service_plans.key's own schema comment. Unlike getServices/getServiceBySlug
// this does NOT filter on isActive: a plan that's been taken out of new
// checkout circulation should still be displayable for whatever already
// references it (e.g. an existing order's summary). The actual "can this be
// bought right now" gate is src/lib/catalogue.ts's resolveServicePlan,
// which does filter on isActive — that's the one checkout calls.
export async function getServicePlan(planKey: string): Promise<{ service: Service; plan: ServicePlan } | null> {
  const [row] = await db
    .select({ service: servicesTable, plan: servicePlansTable })
    .from(servicePlansTable)
    .innerJoin(servicesTable, eq(servicesTable.id, servicePlansTable.serviceId))
    .where(eq(servicePlansTable.key, planKey));
  if (!row) return null;

  return { service: await toService(row.service), plan: toServicePlan(row.plan) };
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
