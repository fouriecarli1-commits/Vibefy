import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `@/` is how everything in `apps/web` imports its own modules. Without it
  // here, a module a test imports has to be written in relative paths for the
  // test's benefit — and then the app has two conventions, one of which exists
  // because of the test runner.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) },
  },
  test: {
    globalSetup: ['./tests/setup/database.ts'],
    /*
     * `apps/web` is in the list for the files that can only be tested from
     * inside it: `proxy.ts` imports `next/server`, which is a dependency of
     * that app and not of the workspace root, so a test in `tests/` cannot
     * resolve it. `apps/mobile` is deliberately absent — `expo-device` pulls in
     * `react-native`, which is written in Flow and will not parse.
     */
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts', 'apps/web/**/*.test.ts'],
    // The RLS suite talks to a real Postgres. Running those files in parallel
    // against one database would make failures depend on ordering, which is the
    // last thing you want from the tests that prove tenant isolation.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
