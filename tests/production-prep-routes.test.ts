import { describe, it, expect } from 'vitest';
import { TEST_SERVER_URL } from './global-setup';

const BASE_URL = TEST_SERVER_URL;

// These are the routes added in Phase 10's production-prep pass
// (docs/ARCHITECTURE.md §28). Each is a build-time correctness check as
// much as a runtime one — sitemap.ts/robots.ts both call getEnv() (full
// cross-checked validation), which had to be moved to render per-request
// (`export const dynamic = 'force-dynamic'`) specifically because `next
// build`'s static-generation pass has no reason to have every required
// secret available; a regression back to the default (implicit static)
// rendering would only surface as a build failure, not a test failure —
// these tests instead cover that the routes work correctly at runtime.
describe('production-prep routes (real server, real Postgres)', () => {
  it('GET /robots.txt returns a robots ruleset disallowing the non-public surface', async () => {
    const res = await fetch(`${BASE_URL}/robots.txt`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Disallow: /admin');
    expect(body).toContain('Disallow: /account');
    expect(body).toContain('Sitemap:');
  });

  it('GET /sitemap.xml lists the public static pages and every active service slug', async () => {
    const res = await fetch(`${BASE_URL}/sitemap.xml`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<urlset');
    expect(body).toContain('/pricing</loc>');
    // Seeded services (scripts/seed/catalogue.ts) — proves the sitemap
    // reads real, live rows rather than a fixed list.
    expect(body).toContain('/ai-content-avatar</loc>');
  });

  it('a nonexistent path renders the branded 404 page, not a bare Next.js default', async () => {
    const res = await fetch(`${BASE_URL}/this-path-does-not-exist-${Date.now()}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('Page not found');
  });

  it('GET /icon returns a PNG', async () => {
    const res = await fetch(`${BASE_URL}/icon`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });
});
