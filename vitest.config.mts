import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./tests/setup/database.ts'],
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts'],
    // The RLS suite talks to a real Postgres. Running those files in parallel
    // against one database would make failures depend on ordering, which is the
    // last thing you want from the tests that prove tenant isolation.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
