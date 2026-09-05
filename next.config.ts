import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Phase 12 note (docs/ARCHITECTURE.md §15): CSP still allows
  // 'unsafe-inline' for scripts here because Next's own bootstrap script
  // needs it without a nonce wired through headers() below. Tightening this
  // requires a per-request nonce threaded into both this header and every
  // <Script> tag — tracked as a known gap, not an oversight.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "connect-src 'self' https://api.razorpay.com",
              "frame-src https://api.razorpay.com",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
