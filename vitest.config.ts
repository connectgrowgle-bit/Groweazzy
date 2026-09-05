import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Every suite runs against a real PostgreSQL instance (docs/ARCHITECTURE.md
// §7 / project brief §7) — set DATABASE_URL to a real, migrated test
// database before running `npm test`. No mocked database anywhere.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15000,
    // Auth/session tests share tables under concurrent access (e.g. two
    // tests racing to read all rows) — run serially within a file rather
    // than debug cross-test interference for a database-backed suite this
    // size. Revisit if the suite grows large enough for this to matter.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
