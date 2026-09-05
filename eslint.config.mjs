import nextConfig from 'eslint-config-next';

const config = [
  ...nextConfig,
  {
    rules: {
      // String-interpolated SQL is exactly the mistake docs/ARCHITECTURE.md
      // §9 flags (mistake #2) — Drizzle's sql`` tagged template is safe,
      // raw string concatenation into a query is not. No auto-fixable rule
      // enforces this perfectly, so it's called out here and caught in review.
    },
  },
];

export default config;
