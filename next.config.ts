import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Removes the "X-Powered-By: Next.js" response header — a small, free
  // reduction in what an attacker learns about the stack for free
  // (docs/ARCHITECTURE.md §27).
  poweredByHeader: false,
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
          // Sent unconditionally — a browser only ever honors
          // Strict-Transport-Security on a response it already received
          // over HTTPS, so this header is inert (not wrong) over the
          // plain-http local dev server.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // Denies every one of these browser features by default for
          // this origin — nothing this app does needs a camera, mic,
          // geolocation, or USB access, so there is no legitimate case an
          // embedded script would need to ask for one.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), usb=(), payment=(self)',
          },
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
