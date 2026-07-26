/**
 * Canonical Vite aliases for every renderer-facing surface.
 *
 * Keep these maps outside the individual configs so build-time graph guards
 * inspect the exact aliases Vite consumes instead of reconstructing them from
 * config source text. Object insertion order is significant: the web-only
 * catalog override must match before the generic renderer alias.
 *
 * The caller supplies its config directory so both shipped configs and the
 * graph test instantiate the same mapping without depending on process cwd or
 * duplicating path literals.
 */

import path from 'node:path';

export function createRendererViteAliases(repoRoot: string) {
  return {
    '@': path.resolve(repoRoot, 'src/renderer'),
  } as const;
}

export function createWebViteAliases(repoRoot: string) {
  return {
    '@/plugins/catalog': path.resolve(repoRoot, 'src/web/plugin-catalog.ts'),
    ...createRendererViteAliases(repoRoot),
  } as const;
}
