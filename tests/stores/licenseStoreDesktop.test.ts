/**
 * RL-059 Slice 0 — renderer licenseStore against the desktop IPC bridge.
 *
 * The store auto-detects `window.lingua.license` at module-load time. When
 * the bridge is present (packaged desktop / `npm run dev:desktop:pro`),
 * every mutation flows through main and the renderer keeps a mirror of
 * the snapshot — no localStorage, no local verifier.
 *
 * Ensures parity with the web-mode store on the public contract:
 *   setLicenseToken / revalidate return a `LicenseStatus`, `clearLicense`
 *   resets to free, and the bootstrap snapshot is mirrored before the
 *   first user interaction.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockBridge {
  getState: ReturnType<typeof vi.fn>;
  applyToken: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  revalidate: ReturnType<typeof vi.fn>;
}

function installBridge(snapshot: { token: string | null; status: { kind: string }; deviceId: string; lastVerifiedAt: number | null }): MockBridge {
  const bridge: MockBridge = {
    getState: vi.fn().mockResolvedValue(snapshot),
    applyToken: vi.fn(),
    clear: vi.fn().mockResolvedValue({ ok: true, snapshot }),
    revalidate: vi.fn(),
  };
  // Mount on window before the store module loads.
  (window as unknown as { lingua: { license: MockBridge } }).lingua = { license: bridge };
  return bridge;
}

describe('licenseStore — desktop IPC bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as unknown as { lingua?: unknown }).lingua;
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { lingua?: unknown }).lingua;
  });

  it('mirrors the main snapshot into the renderer state on bootstrap', async () => {
    const snapshot = {
      token: 'abc.def',
      status: { kind: 'active' as const, verification: { ok: true as const, payload: {} as never, state: 'active' as const, supportWindowEndsAt: 1 } },
      deviceId: 'device-uuid',
      lastVerifiedAt: 1234,
    };
    installBridge(snapshot);
    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');
    await vi.waitFor(() => {
      expect(useLicenseStore.getState().token).toBe('abc.def');
      expect(useLicenseStore.getState().status.kind).toBe('active');
    });
  });

  it('setLicenseToken delegates to bridge.applyToken and updates the mirror', async () => {
    const initial = {
      token: null,
      status: { kind: 'free' as const },
      deviceId: 'device-uuid',
      lastVerifiedAt: null,
    };
    const next = {
      token: 'aaa.bbb',
      status: { kind: 'active' as const, verification: { ok: true as const, payload: {} as never, state: 'active' as const, supportWindowEndsAt: 1 } },
      deviceId: 'device-uuid',
      lastVerifiedAt: 9999,
    };
    const bridge = installBridge(initial);
    bridge.applyToken.mockResolvedValueOnce({ ok: true, status: next.status, snapshot: next });

    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');
    const status = await useLicenseStore.getState().setLicenseToken('aaa.bbb');
    expect(bridge.applyToken).toHaveBeenCalledWith('aaa.bbb');
    expect(status.kind).toBe('active');
    expect(useLicenseStore.getState().token).toBe('aaa.bbb');
    expect(useLicenseStore.getState().lastVerifiedAt).toBe(9999);
  });

  it('setLicenseToken surfaces a bridge failure as an invalid status without persisting a token', async () => {
    const bridge = installBridge({
      token: null,
      status: { kind: 'free' as const },
      deviceId: 'device-uuid',
      lastVerifiedAt: null,
    });
    bridge.applyToken.mockResolvedValueOnce({ ok: false, reason: 'apply-failed', message: 'boom' });

    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');
    const status = await useLicenseStore.getState().setLicenseToken('aaa.bbb');
    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') {
      expect(status.reason).toBe('apply-failed');
      expect(status.message).toBe('boom');
    }
    expect(useLicenseStore.getState().token).toBeNull();
  });

  it('setLicenseToken keeps the previous active snapshot when main rejects an invalid replacement token', async () => {
    const persisted = {
      token: 'old.token',
      status: { kind: 'active' as const, verification: { ok: true as const, payload: {} as never, state: 'active' as const, supportWindowEndsAt: 1 } },
      deviceId: 'device-uuid',
      lastVerifiedAt: 5000,
    };
    const bridge = installBridge(persisted);
    bridge.applyToken.mockResolvedValueOnce({
      ok: true,
      status: { kind: 'invalid' as const, reason: 'malformed' },
      snapshot: persisted,
    });

    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');
    await vi.waitFor(() => expect(useLicenseStore.getState().token).toBe('old.token'));

    const status = await useLicenseStore.getState().setLicenseToken('aaa.bbb');
    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') expect(status.reason).toBe('malformed');
    expect(useLicenseStore.getState().token).toBe('old.token');
    expect(useLicenseStore.getState().status.kind).toBe('active');
  });

  it('setLicenseToken converts bridge transport rejections into invalid status instead of leaking an unhandled promise', async () => {
    const bridge = installBridge({
      token: null,
      status: { kind: 'free' as const },
      deviceId: 'device-uuid',
      lastVerifiedAt: null,
    });
    bridge.applyToken.mockRejectedValueOnce(new Error('ipc down'));

    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');
    const status = await useLicenseStore.getState().setLicenseToken('aaa.bbb');
    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') {
      expect(status.reason).toBe('apply-failed');
      expect(status.message).toBe('ipc down');
    }
    expect(useLicenseStore.getState().token).toBeNull();
  });

  it('clearLicense flips the state synchronously and fires bridge.clear in the background', async () => {
    const initial = {
      token: 'aaa.bbb',
      status: { kind: 'active' as const, verification: { ok: true as const, payload: {} as never, state: 'active' as const, supportWindowEndsAt: 1 } },
      deviceId: 'device-uuid',
      lastVerifiedAt: 9999,
    };
    const bridge = installBridge(initial);
    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');

    // Wait for the bootstrap to settle so the mirror reflects the bridge.
    await vi.waitFor(() => expect(useLicenseStore.getState().token).toBe('aaa.bbb'));

    useLicenseStore.getState().clearLicense();
    expect(useLicenseStore.getState().token).toBeNull();
    expect(useLicenseStore.getState().status.kind).toBe('free');
    expect(bridge.clear).toHaveBeenCalledTimes(1);
  });

  it('revalidate refreshes the mirror with the bridge response', async () => {
    const initial = {
      token: 'aaa.bbb',
      status: { kind: 'active' as const, verification: { ok: true as const, payload: {} as never, state: 'active' as const, supportWindowEndsAt: 1 } },
      deviceId: 'device-uuid',
      lastVerifiedAt: 9999,
    };
    const bridge = installBridge(initial);
    const refreshed = {
      ...initial,
      status: { kind: 'grace' as const, verification: { ok: true as const, payload: {} as never, state: 'grace' as const, supportWindowEndsAt: 2 } },
      lastVerifiedAt: 10_000,
    };
    bridge.revalidate.mockResolvedValueOnce({ ok: true, status: refreshed.status, snapshot: refreshed });

    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');
    await vi.waitFor(() => expect(useLicenseStore.getState().token).toBe('aaa.bbb'));

    const status = await useLicenseStore.getState().revalidate();
    expect(status.kind).toBe('grace');
    expect(useLicenseStore.getState().status.kind).toBe('grace');
    expect(useLicenseStore.getState().lastVerifiedAt).toBe(10_000);
  });

  it('revalidate converts bridge transport rejections into invalid status and resyncs the store from main so the previous valid license is not silently dropped', async () => {
    const initial = {
      token: 'aaa.bbb',
      status: { kind: 'active' as const, verification: { ok: true as const, payload: {} as never, state: 'active' as const, supportWindowEndsAt: 1 } },
      deviceId: 'device-uuid',
      lastVerifiedAt: 9999,
    };
    const bridge = installBridge(initial);
    bridge.revalidate.mockRejectedValueOnce(new Error('ipc down'));

    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');
    await vi.waitFor(() => expect(useLicenseStore.getState().token).toBe('aaa.bbb'));

    const status = await useLicenseStore.getState().revalidate();
    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') {
      expect(status.reason).toBe('revalidate-failed');
      expect(status.message).toBe('ipc down');
    }
    // The transport blew up but main still owns the active license — the
    // store must mirror that, not lie about being free. The notice in the
    // returned status is what surfaces the failure to the user.
    await vi.waitFor(() => {
      expect(useLicenseStore.getState().token).toBe('aaa.bbb');
      expect(useLicenseStore.getState().status.kind).toBe('active');
    });
  });

  it('setLicenseToken with a bridge tagged-failure resyncs from main so the previous license survives a partial apply', async () => {
    const persisted = {
      token: 'old.token',
      status: { kind: 'active' as const, verification: { ok: true as const, payload: {} as never, state: 'active' as const, supportWindowEndsAt: 1 } },
      deviceId: 'device-uuid',
      lastVerifiedAt: 5000,
    };
    const bridge = installBridge(persisted);
    bridge.applyToken.mockResolvedValueOnce({ ok: false, reason: 'apply-failed', message: 'disk-full' });

    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');
    await vi.waitFor(() => expect(useLicenseStore.getState().token).toBe('old.token'));

    const status = await useLicenseStore.getState().setLicenseToken('new.token');
    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') {
      expect(status.reason).toBe('apply-failed');
      expect(status.message).toBe('disk-full');
    }
    // Resync flipped the store back to whatever main actually persisted.
    await vi.waitFor(() => {
      expect(useLicenseStore.getState().token).toBe('old.token');
      expect(useLicenseStore.getState().status.kind).toBe('active');
    });
  });

  it('clearLicense resyncs from main when bridge.clear reports a failure so the renderer never lies about a license main still has on disk', async () => {
    const persisted = {
      token: 'aaa.bbb',
      status: { kind: 'active' as const, verification: { ok: true as const, payload: {} as never, state: 'active' as const, supportWindowEndsAt: 1 } },
      deviceId: 'device-uuid',
      lastVerifiedAt: 9999,
    };
    const bridge = installBridge(persisted);
    bridge.clear.mockResolvedValueOnce({ ok: false, reason: 'clear-failed', message: 'boom' });
    // Second getState call after the clear failure must observe the still-active main snapshot.
    bridge.getState.mockResolvedValueOnce(persisted).mockResolvedValueOnce(persisted);

    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');
    await vi.waitFor(() => expect(useLicenseStore.getState().token).toBe('aaa.bbb'));

    useLicenseStore.getState().clearLicense();
    // Optimistic flip happens synchronously...
    expect(useLicenseStore.getState().token).toBeNull();
    expect(useLicenseStore.getState().status.kind).toBe('free');

    // ...but the resync flips the renderer back to the main snapshot.
    await vi.waitFor(() => {
      expect(useLicenseStore.getState().token).toBe('aaa.bbb');
      expect(useLicenseStore.getState().status.kind).toBe('active');
    });
    expect(bridge.clear).toHaveBeenCalledTimes(1);
  });

  it('clearLicense resyncs from main when bridge.clear rejects before returning a tagged result', async () => {
    const persisted = {
      token: 'aaa.bbb',
      status: { kind: 'active' as const, verification: { ok: true as const, payload: {} as never, state: 'active' as const, supportWindowEndsAt: 1 } },
      deviceId: 'device-uuid',
      lastVerifiedAt: 9999,
    };
    const bridge = installBridge(persisted);
    bridge.clear.mockRejectedValueOnce(new Error('ipc down'));

    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');
    await vi.waitFor(() => expect(useLicenseStore.getState().token).toBe('aaa.bbb'));

    useLicenseStore.getState().clearLicense();
    expect(useLicenseStore.getState().token).toBeNull();
    expect(useLicenseStore.getState().status.kind).toBe('free');

    await vi.waitFor(() => {
      expect(useLicenseStore.getState().token).toBe('aaa.bbb');
      expect(useLicenseStore.getState().status.kind).toBe('active');
    });
    expect(bridge.clear).toHaveBeenCalledTimes(1);
  });

  it('a setLicenseToken racing the bootstrap getState wins — the bootstrap snapshot does not clobber the user mutation', async () => {
    const initial = {
      token: null,
      status: { kind: 'free' as const },
      deviceId: 'device-uuid',
      lastVerifiedAt: null,
    };
    // Hold the bootstrap getState() open until we explicitly resolve it so
    // the test deterministically forces the race the reviewer flagged.
    let resolveBootstrap: (snapshot: typeof initial) => void = () => undefined;
    const bridge: MockBridge = {
      getState: vi.fn(() => new Promise((resolve) => {
        resolveBootstrap = resolve;
      })),
      applyToken: vi.fn(),
      clear: vi.fn().mockResolvedValue({ ok: true, snapshot: initial }),
      revalidate: vi.fn(),
    };
    (window as unknown as { lingua: { license: MockBridge } }).lingua = { license: bridge };

    const next = {
      token: 'fresh.token',
      status: { kind: 'active' as const, verification: { ok: true as const, payload: {} as never, state: 'active' as const, supportWindowEndsAt: 1 } },
      deviceId: 'device-uuid',
      lastVerifiedAt: 12345,
    };
    bridge.applyToken.mockResolvedValueOnce({ ok: true, status: next.status, snapshot: next });

    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');
    // Apply BEFORE the bootstrap resolves.
    const status = await useLicenseStore.getState().setLicenseToken('fresh.token');
    expect(status.kind).toBe('active');
    expect(useLicenseStore.getState().token).toBe('fresh.token');

    // Now release the bootstrap with a stale (initial / pre-mutation) snapshot.
    resolveBootstrap(initial);

    // Wait one microtask tick — the bootstrap promise's `.then` would
    // normally run here. The barrier flag set inside setLicenseToken must
    // suppress the apply, so the user mutation survives.
    await Promise.resolve();
    expect(useLicenseStore.getState().token).toBe('fresh.token');
    expect(useLicenseStore.getState().status.kind).toBe('active');
  });

  it('does not write to localStorage in desktop mode', async () => {
    const bridge = installBridge({
      token: null,
      status: { kind: 'free' as const },
      deviceId: 'device-uuid',
      lastVerifiedAt: null,
    });
    const next = {
      token: 'aaa.bbb',
      status: { kind: 'active' as const, verification: { ok: true as const, payload: {} as never, state: 'active' as const, supportWindowEndsAt: 1 } },
      deviceId: 'device-uuid',
      lastVerifiedAt: 9999,
    };
    bridge.applyToken.mockResolvedValueOnce({ ok: true, status: next.status, snapshot: next });

    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');
    await useLicenseStore.getState().setLicenseToken('aaa.bbb');
    expect(localStorage.getItem('lingua-license')).toBeNull();
  });
});
