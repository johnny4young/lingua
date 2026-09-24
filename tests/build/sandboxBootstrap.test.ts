// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { IFRAME_CONTENT_SECURITY_POLICY } from '../../src/renderer/components/BrowserPreview/iframeBridge';

const html = readFileSync(
  path.resolve(__dirname, '../../src/renderer/runtime/lingua-sandbox.htm'),
  'utf8'
);
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
function bootstrap({ top = false, origin = 'null', token = 'current' } = {}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const parent = { postMessage: vi.fn() };
  const document = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
  const window = {
    origin,
    addEventListener: (name: string, handler: (event: unknown) => void) =>
      listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  vm.runInNewContext(script, {
    window,
    parent: top ? window : parent,
    document,
    URL,
    location: { href: `https://app.test/assets/lingua-sandbox-hash.htm?load=${token}` },
  });
  return { parent, document, listeners };
}

describe('independent sandbox bootstrap', () => {
  it('keeps the same no-network, no-nested-frame policy as preview documents', () => {
    expect(html).toContain(`content="${IFRAME_CONTENT_SECURITY_POLICY}"`);
    const headers = readFileSync(path.resolve(__dirname, '../../public/_headers'), 'utf8');
    expect(headers).toContain(
      "/assets/lingua-sandbox-*\n  ! X-Frame-Options\n  Content-Security-Policy: frame-ancestors 'self'"
    );
    expect(headers).toContain('X-Frame-Options: DENY');
  });
  it.each([{ top: true }, { origin: 'https://app.test' }, { token: '' }])(
    'refuses an unisolated or unidentified document: %j',
    options => {
      const { parent, document, listeners } = bootstrap(options);
      expect(parent.postMessage).not.toHaveBeenCalled();
      expect(document.write).not.toHaveBeenCalled();
      expect(listeners.size).toBe(0);
    }
  );
  it('accepts only its parent, exact token and a string document, once', () => {
    const { parent, document, listeners } = bootstrap();
    expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith(
      { type: 'lingua-sandbox-ready', token: 'current' },
      '*'
    );
    const data = { type: 'lingua-sandbox-document', token: 'current', html: '<p>user content</p>' };
    for (const event of [
      { source: {}, data },
      { source: parent, data: null },
      { source: parent, data: { ...data, type: 'other' } },
      { source: parent, data: { ...data, token: 'stale' } },
      { source: parent, data: { ...data, html: {} } },
    ])
      listeners.get('message')!(event);
    expect(document.write).not.toHaveBeenCalled();
    listeners.get('message')!({ source: parent, data });
    expect(document.open).toHaveBeenCalledOnce();
    expect(document.write).toHaveBeenCalledExactlyOnceWith(data.html);
    expect(document.close).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });
});
