import { describe, expect, it } from 'vitest';

import { injectRuntimePreconnect } from '../../build/runtimePreconnect.mts';

const HEAD = [
  '    <link rel="preconnect" href="https://licenses.linguacode.dev" crossorigin />',
  '    <link rel="preconnect" href="https://updates.linguacode.dev" crossorigin />',
  '    <link rel="preload" as="font" href="/fonts/x.woff2" crossorigin />',
].join('\n');

describe('runtimePreconnect', () => {
  it('adds a crossorigin preconnect for the runtime origin after the first-party ones', () => {
    const html = injectRuntimePreconnect(
      HEAD,
      'https://downloads.linguacode.dev/web-runtime'
    );
    const preconnects = html.match(/<link[^>]*rel="preconnect"[^>]*>/g) ?? [];
    expect(preconnects).toHaveLength(3);
    expect(preconnects[2]).toBe(
      '<link rel="preconnect" href="https://downloads.linguacode.dev" crossorigin />'
    );
    // Only the origin is preconnected, never the path.
    expect(html).not.toContain('web-runtime');
  });

  it('is idempotent', () => {
    const once = injectRuntimePreconnect(HEAD, 'https://downloads.linguacode.dev');
    expect(injectRuntimePreconnect(once, 'https://downloads.linguacode.dev')).toBe(once);
  });

  it('fails loudly when the anchor moved', () => {
    expect(() =>
      injectRuntimePreconnect('<head></head>', 'https://downloads.linguacode.dev')
    ).toThrow(/anchor/u);
  });
});
