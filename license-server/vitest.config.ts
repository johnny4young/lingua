import { defineConfig } from 'vitest/config';

/**
 * Vitest config for license-server.
 *
 * Slice 1 doesn't touch the D1 binding, so we run tests against the Hono
 * `app.request(...)` API directly (vanilla vitest). The Hono app is just
 * a function — `await app.request(url, init, env)` returns a Response.
 *
 * Slice 2 will need real D1 + KV emulation to exercise the trial table
 * and rate-limiter. At that point we promote to
 * `@cloudflare/vitest-pool-workers`, which spins miniflare under each
 * test. Slice 1 deliberately stays on plain vitest to keep the bundle
 * + setup minimal.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
