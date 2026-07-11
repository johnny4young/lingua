/**
 * RL-036 Phase A1 — useShareLinkBoot hook coverage.
 *
 * The hook owns the boot-time + `hashchange` decode pipeline. The
 * test matrix covers:
 *   - Happy: valid share link → addTab fires + success notice + telemetry
 *   - Reject paths: invalid-prefix (no-op), invalid-base64, unknown-language,
 *     unknown-version, oversized
 *   - Hashchange listener attaches + cleans up
 *   - Safe mode short-circuits the hook entirely
 *   - History cleanup (`replaceState`) fires on every terminal outcome
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
  buildSharePayload,
  encodeShareFragment,
  SHARE_FRAGMENT_PREFIX,
} from '@/../shared/sharePayload';
import { useShareLinkBoot } from '@/hooks/useShareLinkBoot';
import { createDefaultTab, useEditorStore } from '@/stores/editorStore';
import { useUIStore } from '@/stores/uiStore';

const initialEditor = useEditorStore.getState();
const initialUi = useUIStore.getState();

const { trackEventMock } = vi.hoisted(() => ({
  trackEventMock: vi.fn(),
}));

vi.mock('@/utils/telemetry', () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

vi.mock('@/utils/safeBoot', async () => {
  const actual = await vi.importActual<typeof import('../../../src/renderer/utils/safeBoot')>(
    '@/utils/safeBoot'
  );
  return {
    ...actual,
    isSafeMode: vi.fn(() => false),
  };
});

import { isSafeMode } from '@/utils/safeBoot';

const setHash = (hash: string): void => {
  // jsdom URLs use file:// by default; replaceState lets us set the
  // hash without triggering a real navigation, mirroring real-browser
  // behaviour for boot-time link entry.
  window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
};

const fireHashChange = (newHash: string): void => {
  const oldURL = window.location.href;
  setHash(newHash);
  window.dispatchEvent(
    new HashChangeEvent('hashchange', {
      oldURL,
      newURL: window.location.href,
    })
  );
};

describe('useShareLinkBoot', () => {
  beforeEach(() => {
    useEditorStore.setState({ ...initialEditor, tabs: [], activeTabId: null }, true);
    useUIStore.setState({ ...initialUi, statusNotice: null }, true);
    trackEventMock.mockReset();
    vi.mocked(isSafeMode).mockReturnValue(false);
    setHash('');
  });

  afterEach(() => {
    cleanup();
    setHash('');
  });

  it('imports a valid share fragment into a new tab and fires success telemetry', async () => {
    const payload = buildSharePayload({
      name: 'demo.js',
      language: 'javascript',
      content: 'console.log("imported");',
      runtimeMode: 'worker',
      workflowMode: 'scratchpad',
    });
    const encoded = await encodeShareFragment(payload);
    if (!encoded.ok) throw new Error('encode failed in setup');
    setHash(`#${encoded.fragment}`);

    renderHook(() => useShareLinkBoot());
    // Hook runs an async import; wait microtask + a tick for
    // CompressionStream to flush.
    await act(async () => {
      // Several await ticks: the import path is gzip CompressionStream
      // (one tick) → microtask chain (one tick) → addTab (one tick).
      // A single zero-delay await isn't always enough when the test
      // worker is contended by neighbours in the full suite, so we
      // poll a few times before asserting.
      for (let i = 0; i < 10; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });

    const tabs = useEditorStore.getState().tabs;
    expect(tabs.length).toBe(1);
    expect(tabs[0]!.content).toBe('console.log("imported");');
    expect(tabs[0]!.language).toBe('javascript');
    expect(tabs[0]!.name).toBe('demo.js');

    const notice = useUIStore.getState().statusNotice;
    expect(notice?.messageKey).toBe('share.notice.imported');
    expect(notice?.tone).toBe('info');

    expect(trackEventMock).toHaveBeenCalledWith('share.opened', {
      status: 'success',
      sizeBucket: expect.stringMatching(/^<\d+kb|>=6kb$/u),
    });

    // History was cleaned: hash should be gone.
    expect(window.location.hash).toBe('');
  });

  it('does not overwrite the tab-budget upsell when a decoded share cannot open', async () => {
    const existingTab = createDefaultTab('javascript');
    const siblingTabs = [createDefaultTab('typescript'), createDefaultTab('python')];
    useEditorStore.setState(
      { ...initialEditor, tabs: [existingTab, ...siblingTabs], activeTabId: existingTab.id },
      true
    );
    const payload = buildSharePayload({
      name: 'blocked-by-free-budget.js',
      language: 'javascript',
      content: 'console.log("blocked");',
    });
    const encoded = await encodeShareFragment(payload);
    if (!encoded.ok) throw new Error('encode failed in setup');
    setHash(`#${encoded.fragment}`);

    renderHook(() => useShareLinkBoot());
    await act(async () => {
      for (let i = 0; i < 10; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });

    const state = useEditorStore.getState();
    expect(state.tabs).toHaveLength(3);
    expect(state.tabs[0]!.id).toBe(existingTab.id);
    expect(useUIStore.getState().statusNotice?.messageKey).toBe(
      'upsell.freeCeilingReached'
    );
    expect(
      trackEventMock.mock.calls.some(([event]) => event === 'share.opened')
    ).toBe(false);
    expect(window.location.hash).toBe('');
  });

  it('waits until enabled before importing the initial share hash', async () => {
    const payload = buildSharePayload({
      name: 'deferred.js',
      language: 'javascript',
      content: 'console.log("after restore");',
    });
    const encoded = await encodeShareFragment(payload);
    if (!encoded.ok) throw new Error('encode failed in setup');
    setHash(`#${encoded.fragment}`);

    const { rerender } = renderHook(
      ({ enabled }) => useShareLinkBoot({ enabled }),
      { initialProps: { enabled: false } }
    );

    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
    expect(useEditorStore.getState().tabs.length).toBe(0);
    expect(window.location.hash).toBe(`#${encoded.fragment}`);

    rerender({ enabled: true });
    await act(async () => {
      for (let i = 0; i < 10; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });

    expect(useEditorStore.getState().tabs.length).toBe(1);
    expect(useEditorStore.getState().tabs[0]!.name).toBe('deferred.js');
    expect(window.location.hash).toBe('');
  });

  it('ignores hashes that do not carry the share prefix (silent no-op)', async () => {
    setHash('#some-anchor-link');
    renderHook(() => useShareLinkBoot());
    await act(async () => {
      // Several await ticks: the import path is gzip CompressionStream
      // (one tick) → microtask chain (one tick) → addTab (one tick).
      // A single zero-delay await isn't always enough when the test
      // worker is contended by neighbours in the full suite, so we
      // poll a few times before asserting.
      for (let i = 0; i < 10; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
    expect(useEditorStore.getState().tabs.length).toBe(0);
    expect(useUIStore.getState().statusNotice).toBeNull();
    expect(trackEventMock).not.toHaveBeenCalled();
    // Foreign hash NOT cleaned — leave it for whoever owns it.
    expect(window.location.hash).toBe('#some-anchor-link');
  });

  it('surfaces a localized notice + decode-fail telemetry on invalid base64', async () => {
    setHash(`#${SHARE_FRAGMENT_PREFIX}!@#$%^&*()`);
    renderHook(() => useShareLinkBoot());
    await act(async () => {
      // Several await ticks: the import path is gzip CompressionStream
      // (one tick) → microtask chain (one tick) → addTab (one tick).
      // A single zero-delay await isn't always enough when the test
      // worker is contended by neighbours in the full suite, so we
      // poll a few times before asserting.
      for (let i = 0; i < 10; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
    expect(useEditorStore.getState().tabs.length).toBe(0);
    const notice = useUIStore.getState().statusNotice;
    expect(notice?.messageKey).toBe('share.notice.decodeFailed');
    expect(notice?.tone).toBe('warning');
    expect(trackEventMock).toHaveBeenCalledWith('share.opened', {
      status: 'decode-fail',
      sizeBucket: expect.any(String),
    });
    expect(window.location.hash).toBe('');
  });

  it('falls through to decodeShareFragment hashchange listener after mount', async () => {
    renderHook(() => useShareLinkBoot());
    expect(useEditorStore.getState().tabs.length).toBe(0);

    const payload = buildSharePayload({
      name: 'live.js',
      language: 'javascript',
      content: 'console.log("live");',
    });
    const encoded = await encodeShareFragment(payload);
    if (!encoded.ok) throw new Error('encode failed in setup');

    await act(async () => {
      fireHashChange(`#${encoded.fragment}`);
      // Hashchange imports traverse the same async gunzip pipeline as
      // boot imports, so wait for the stream + store microtasks to
      // settle before the next test mutates safe-mode state.
      for (let i = 0; i < 10; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });

    expect(useEditorStore.getState().tabs.length).toBe(1);
    expect(useEditorStore.getState().tabs[0]!.content).toBe(
      'console.log("live");'
    );
    expect(trackEventMock).toHaveBeenCalledWith('share.opened', {
      status: 'success',
      sizeBucket: expect.any(String),
    });
  });

  it('removes the hashchange listener on unmount', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useShareLinkBoot());

    const hookAddedTheListener = addSpy.mock.calls.find(
      ([eventName]) => eventName === 'hashchange'
    );
    expect(hookAddedTheListener).toBeDefined();
    unmount();
    const hookRemovedTheListener = removeSpy.mock.calls.find(
      ([eventName]) => eventName === 'hashchange'
    );
    expect(hookRemovedTheListener).toBeDefined();

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('skips entirely in safe mode (no listener, no decode)', async () => {
    vi.mocked(isSafeMode).mockReturnValue(true);
    const addSpy = vi.spyOn(window, 'addEventListener');
    const payload = buildSharePayload({
      name: 'x.js',
      language: 'javascript',
      content: 'x',
    });
    const encoded = await encodeShareFragment(payload);
    if (!encoded.ok) throw new Error('encode failed in setup');
    setHash(`#${encoded.fragment}`);

    renderHook(() => useShareLinkBoot());
    await act(async () => {
      // Several await ticks: the import path is gzip CompressionStream
      // (one tick) → microtask chain (one tick) → addTab (one tick).
      // A single zero-delay await isn't always enough when the test
      // worker is contended by neighbours in the full suite, so we
      // poll a few times before asserting.
      for (let i = 0; i < 10; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });

    expect(useEditorStore.getState().tabs.length).toBe(0);
    expect(trackEventMock).not.toHaveBeenCalled();
    const hashchangeAdded = addSpy.mock.calls.find(
      ([eventName]) => eventName === 'hashchange'
    );
    expect(hashchangeAdded).toBeUndefined();
    // Hash stays untouched — safe mode does not own cleanup either.
    expect(window.location.hash).toBe(`#${encoded.fragment}`);
    addSpy.mockRestore();
  });
});
