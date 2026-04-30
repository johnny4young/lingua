import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
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
 *
 * Slice 4 — `loadHtmlAndCssAsText` mirrors wrangler.toml's `[[rules]]`
 * Text loader for the email templates. Both sides import the files
 * with NO `?raw` suffix (esbuild does not parse Vite query suffixes)
 * and get the file contents as a string. Without this plugin Vite
 * would treat `.html` / `.css` as asset modules and the snapshot
 * tests in `test/emails/templates.test.ts` would render `[object
 * Object]` instead of the template string.
 */
function loadHtmlAndCssAsText(): Plugin {
  return {
    name: 'lingua-load-html-and-css-as-text',
    enforce: 'pre',
    load(id) {
      const cleanId = id.split('?')[0]!;
      if (!cleanId.endsWith('.html') && !cleanId.endsWith('.css')) return null;
      const source = readFileSync(cleanId, 'utf8');
      return `export default ${JSON.stringify(source)};`;
    },
  };
}

export default defineConfig({
  plugins: [loadHtmlAndCssAsText()],
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
