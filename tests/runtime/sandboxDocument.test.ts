import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSandboxDocument,
  getSandboxDocument,
  setSandboxDocument,
} from '../../src/renderer/runtime/sandboxDocument';

function frame() {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  document.body.appendChild(iframe);
  return iframe;
}
function ready(iframe: HTMLIFrameElement, token: string, overrides: MessageEventInit = {}) {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: iframe.contentWindow,
      origin: 'null',
      data: { type: 'lingua-sandbox-ready', token },
      ...overrides,
    })
  );
}
const tokenFor = (iframe: HTMLIFrameElement) => new URL(iframe.src).searchParams.get('load')!;

afterEach(() => {
  document.querySelectorAll('iframe').forEach(clearSandboxDocument);
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('opaque sandbox document transport', () => {
  it('sends once to its opaque frame only after the matching ready handshake', () => {
    const iframe = frame();
    setSandboxDocument(iframe, '<p>selected document</p>');
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
    const token = tokenFor(iframe);
    expect(iframe.hasAttribute('srcdoc')).toBe(false);
    expect(post).not.toHaveBeenCalled();
    ready(iframe, 'old-token');
    ready(iframe, token, { origin: window.location.origin });
    ready(iframe, token, { source: window });
    ready(iframe, token, { data: null });
    expect(post).not.toHaveBeenCalled();
    ready(iframe, token);
    ready(iframe, token);
    expect(post).toHaveBeenCalledExactlyOnceWith(
      { type: 'lingua-sandbox-document', token, html: '<p>selected document</p>' },
      '*'
    );
  });

  it('does not deliver a canceled document or let its cleanup clear the next run', () => {
    const iframe = frame();
    const cancelA = setSandboxDocument(iframe, 'A');
    const tokenA = tokenFor(iframe);
    const navigate = vi.spyOn(iframe, 'src', 'set');
    const cancelB = setSandboxDocument(iframe, 'B');
    // Replacement is a single full navigation, not an intermediate blank.
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]![0]).not.toBe('about:blank');
    const tokenB = tokenFor(iframe);
    expect(tokenA).not.toBe(tokenB);
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
    cancelA();
    ready(iframe, tokenA);
    expect(post).not.toHaveBeenCalled();
    expect(getSandboxDocument(iframe)).toBe('B');
    ready(iframe, tokenB);
    expect(post).toHaveBeenCalledExactlyOnceWith(
      { type: 'lingua-sandbox-document', token: tokenB, html: 'B' },
      '*'
    );
    cancelB();
    expect(getSandboxDocument(iframe)).toBe('');
    expect(iframe.src).toBe('about:blank');
  });

  it('cancels preparation and clears executable content on teardown', () => {
    const iframe = frame();
    const cancel = setSandboxDocument(iframe, 'never execute');
    const token = tokenFor(iframe);
    cancel();
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
    ready(iframe, token);
    expect(post).not.toHaveBeenCalled();
    expect(getSandboxDocument(iframe)).toBe('');
    expect(iframe.src).toBe('about:blank');
  });
});
