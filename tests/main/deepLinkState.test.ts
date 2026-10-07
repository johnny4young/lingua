import { describe, expect, it, vi } from 'vitest';
import {
  consumePendingDeepLink,
  createDeepLinkRuntimeState,
  handleIncomingDeepLink,
  markDeepLinkRendererReady,
  primeDeepLinkFromArgv,
} from '../../src/main/deepLinkState';

describe('deepLinkState', () => {
  it('queues incoming links until the renderer is ready', () => {
    const state = createDeepLinkRuntimeState();
    const dispatch = vi.fn(() => true);

    const target = handleIncomingDeepLink(
      state,
      'lingua://new?lang=python',
      dispatch
    );

    expect(target).toEqual({
      kind: 'new-file',
      language: 'python',
      rawUrl: 'lingua://new?lang=python',
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(consumePendingDeepLink(state)).toEqual(target);
    expect(consumePendingDeepLink(state)).toBeNull();
  });

  it('dispatches immediately once the renderer is ready', () => {
    const state = createDeepLinkRuntimeState();
    const dispatch = vi.fn(() => true);
    markDeepLinkRendererReady(state, true);

    const target = handleIncomingDeepLink(
      state,
      'lingua://snippet?id=snippet-42',
      dispatch
    );

    expect(dispatch).toHaveBeenCalledWith(target);
    expect(consumePendingDeepLink(state)).toBeNull();
  });

  it('re-queues the target when dispatch fails', () => {
    const state = createDeepLinkRuntimeState();
    markDeepLinkRendererReady(state, true);

    const target = handleIncomingDeepLink(
      state,
      'lingua://open?file=/tmp/demo.ts',
      () => false
    );

    expect(consumePendingDeepLink(state)).toEqual(target);
  });

  it('primes the pending target from process argv', () => {
    const state = createDeepLinkRuntimeState();

    const target = primeDeepLinkFromArgv(state, [
      'electron',
      '.',
      'lingua://open?file=/tmp/demo.ts',
    ]);

    expect(target).toEqual({
      kind: 'open-file',
      filePath: '/tmp/demo.ts',
      rawUrl: 'lingua://open?file=/tmp/demo.ts',
    });
    expect(consumePendingDeepLink(state)).toEqual(target);
  });
  it('routes an emailed license link to the renderer as a token-only target', () => {
    const state = createDeepLinkRuntimeState();
    const dispatch = vi.fn(() => true);

    expect(primeDeepLinkFromArgv(state, ['lingua', 'lingua://license?token=pay.sig'])).toEqual({
      kind: 'license-token',
      token: 'pay.sig',
    });
    expect(consumePendingDeepLink(state)).toEqual({ kind: 'license-token', token: 'pay.sig' });

    markDeepLinkRendererReady(state, true);
    handleIncomingDeepLink(state, 'lingua://license?token=pay.sig', dispatch);
    expect(dispatch).toHaveBeenCalledWith({ kind: 'license-token', token: 'pay.sig' });
    expect(handleIncomingDeepLink(state, 'lingua://license?token=not-a-token', dispatch)).toBeNull();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
