import type { MetadataRoute } from 'next';
import { getEnv } from '@/lib/env';

// Rendered per-request rather than baked in at build time — see
// sitemap.ts's own comment on why getEnv()'s full validation shouldn't run
// during `next build`'s static-generation pass.
export const dynamic = 'force-dynamic';

// Blocks the same non-public surface sitemap.ts leaves out of its listing
// (auth/admin/staff/transactional routes) — belt-and-suspenders with
// middleware.ts's actual auth gate, not a substitute for it: a
// well-behaved crawler honors this; nothing else does.
export default function robots(): MetadataRoute.Robots {
  const { APP_URL } = getEnv();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/account', '/admin', '/crm', '/training', '/checkout', '/login', '/register', '/affiliate/dashboard', '/api/'],
    },
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
