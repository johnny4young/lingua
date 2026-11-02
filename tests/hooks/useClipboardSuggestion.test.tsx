import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NON_SECRET_TEST_JWT as JWT } from '../__fixtures__/jwt';

const { read } = vi.hoisted(() => ({ read: vi.fn<() => Promise<string | null>>() }));

vi.mock('../../src/renderer/utils/clipboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/utils/clipboard')>()),
  readFromClipboard: read,
}));

import { useClipboardSuggestion } from '../../src/renderer/hooks/useClipboardSuggestion';
import { useLicenseStore } from '../../src/renderer/stores/licenseStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

function setPro(on: boolean) {
  useLicenseStore.setState(
    on
      ? {
          token: 'test.token',
          lastVerifiedAt: Date.now(),
          status: {
            kind: 'active',
            verification: {
              ok: true,
              state: 'active',
              supportWindowEndsAt: Date.now() + 86_400_000,
              payload: {
                productId: 'lingua-desktop',
                tier: 'pro',
                issuedTo: 'clipboard@example.com',
                issuedAt: new Date().toISOString(),
                supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
                entitlements: [],
              },
            },
          },
        }
      : { token: null, status: { kind: 'free' }, lastVerifiedAt: null }
  );
}

beforeEach(() => {
  read.mockReset();
  read.mockResolvedValue(JWT);
  setPro(true);
  useSettingsStore.setState({ featureFlags: { clipboardChains: true }, utilitiesClipboardOnFocusConsent: 'granted' });
});

afterEach(() => {
  useSettingsStore.setState({ featureFlags: {}, utilitiesClipboardOnFocusConsent: 'declined' });
  setPro(false);
});

const focus = () => act(async () => void window.dispatchEvent(new Event('focus')));

describe('useClipboardSuggestion', () => {
  it('reads when it opens and reports only the kind', async () => {
    const { result } = renderHook(() => useClipboardSuggestion(true));
    await waitFor(() => expect(result.current).toBe('jwt'));
    expect(read).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(useSettingsStore.getState())).not.toContain(JWT);
  });

  it('reads again on window focus, and clears when nothing fits', async () => {
    const { result } = renderHook(() => useClipboardSuggestion(true));
    await waitFor(() => expect(result.current).toBe('jwt'));
    read.mockResolvedValue('const notAToken = 1;');
    await focus();
    await waitFor(() => expect(result.current).toBeNull());
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('clears when the clipboard cannot be read', async () => {
    const { result } = renderHook(() => useClipboardSuggestion(true));
    await waitFor(() => expect(result.current).toBe('jwt'));
    read.mockResolvedValue(null);
    await focus();
    await waitFor(() => expect(result.current).toBeNull());
  });

  it.each([
    ['without the flag', () => useSettingsStore.setState({ featureFlags: {} })],
    ['with consent unset', () => useSettingsStore.setState({ utilitiesClipboardOnFocusConsent: 'unset' })],
    ['with consent declined', () => useSettingsStore.setState({ utilitiesClipboardOnFocusConsent: 'declined' })],
    ['on Free, even with a stale consent', () => setPro(false)],
  ])('never reads %s', async (_name, arrange) => {
    arrange();
    const { result } = renderHook(() => useClipboardSuggestion(true));
    await focus();
    expect(read).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('never reads while Utilities is off screen, and reads on return', async () => {
    const { result, rerender } = renderHook(({ active }) => useClipboardSuggestion(active), { initialProps: { active: false } });
    await focus();
    expect(read).not.toHaveBeenCalled();
    rerender({ active: true });
    await waitFor(() => expect(result.current).toBe('jwt'));
  });

  it('stops listening, and forgets the kind, when access goes away', async () => {
    const { result, rerender } = renderHook(({ active }) => useClipboardSuggestion(active), { initialProps: { active: true } });
    await waitFor(() => expect(result.current).toBe('jwt'));
    rerender({ active: false });
    expect(result.current).toBeNull();
    read.mockClear();
    await focus();
    expect(read).not.toHaveBeenCalled();
  });

  it('keeps the newest read when an older one settles last', async () => {
    let settleFirst: (value: string) => void = () => undefined;
    read.mockReturnValueOnce(new Promise((resolve) => (settleFirst = resolve)));
    read.mockResolvedValueOnce('{"a": [1, 2, 3], "b": "some text here"}');
    const { result } = renderHook(() => useClipboardSuggestion(true));
    await focus();
    await waitFor(() => expect(result.current).toBe('json'));
    await act(async () => settleFirst(JWT));
    expect(result.current).toBe('json');
  });

  it('ignores a read that settles after access went away', async () => {
    let settle: (value: string) => void = () => undefined;
    read.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)));
    const { result, rerender } = renderHook(({ active }) => useClipboardSuggestion(active), { initialProps: { active: true } });
    rerender({ active: false });
    await act(async () => settle(JWT));
    read.mockReturnValueOnce(new Promise(() => undefined));
    rerender({ active: true });
    expect(result.current).toBeNull();
  });

  it('shows no old kind while it reads again on return', async () => {
    const { result, rerender } = renderHook(({ active }) => useClipboardSuggestion(active), { initialProps: { active: true } });
    await waitFor(() => expect(result.current).toBe('jwt'));
    rerender({ active: false });
    read.mockReturnValueOnce(new Promise(() => undefined));
    rerender({ active: true });
    expect(result.current).toBeNull();
  });
});
