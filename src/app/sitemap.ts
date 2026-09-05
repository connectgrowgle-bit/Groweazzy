import type { MetadataRoute } from 'next';
import { getEnv } from '@/lib/env';
import { getServices } from '@/lib/repository';

// Forces this to render per-request instead of once at build time. Two
// independent reasons, either one enough on its own: (1) it has to reflect
// whatever service rows are live right now, matching this build's
// "nothing admin-facing is cached" stance (§11/§25) rather than baking in
// whatever the catalogue looked like at deploy time; (2) getEnv() runs its
// full cross-checked validation (every required secret, not just
// APP_URL) — fine at real request time on a properly configured deploy,
// but `next build`'s static-generation pass has no reason to have those
// secrets available, and did not before this route existed.
export const dynamic = 'force-dynamic';

// Static list of public, crawlable pages — deliberately excludes anything
// behind auth (`/account`, `/admin`, `/crm`, `/training`), transactional
// (`/checkout`, `/login`, `/register`), or gated (affiliate dashboard):
// none of those should be discoverable via search, and several would just
// bounce an anonymous crawler to /login anyway (middleware.ts). Kept as a
// literal list rather than derived from the filesystem — this file is the
// one place that has to make the "should this be public" judgment call per
// route, same reasoning as middleware.ts's own hand-kept PROTECTED_PREFIXES.
const STATIC_PATHS = ['/', '/services', '/pricing', '/about', '/faq', '/contact', '/affiliate', '/terms', '/privacy', '/refund-policy'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { APP_URL } = getEnv();
  const services = await getServices();

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${APP_URL}${path}`,
    lastModified: new Date(),
  }));

  // Every active service's own `/[slug]` page — inactive services are
  // correctly left out since getServices() already filters isActive,
  // matching what an anonymous visitor (and a crawler) can actually reach.
  const serviceEntries: MetadataRoute.Sitemap = services.map((service) => ({
    url: `${APP_URL}/${service.slug}`,
    lastModified: new Date(),
  }));

  return [...staticEntries, ...serviceEntries];
}
