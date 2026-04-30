import { defineConfig } from 'vitest/config';

/**
 * Vitest config for update-server.
 *
 * Slice 5 of RL-061 introduces the first set of tests for this worker
 * (the `/web/version` endpoint). The handler does not touch any
 * Cloudflare-specific bindings — it only uses `caches.default` (which
 * we mock in the helper) and `fetch` (which we stub via `vi.stubGlobal`).
 * That keeps us on plain vitest and avoids the heavier
 * `@cloudflare/vitest-pool-workers` dependency.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
