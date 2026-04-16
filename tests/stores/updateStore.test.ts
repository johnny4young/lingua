import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateStore } from '@/stores/updateStore';

describe('updateStore', () => {
  beforeEach(() => {
    useUpdateStore.setState({
      status: 'unavailable',
      supported: false,
      enabled: false,
      message: 'Automatic updates are not available.',
      releaseName: undefined,
      releaseNotes: undefined,
      updateURL: undefined,
      lastCheckedAt: undefined,
      initialized: false,
    });

    const idleState: UpdateState = {
      status: 'idle',
      supported: true,
      enabled: true,
      message: 'Automatic updates are enabled for this packaged build.',
    };

    window.lingua = {
      ...window.lingua,
      updates: {
        getState: vi.fn(async () => idleState),
        check: vi.fn(async () => ({
          ...idleState,
          status: 'checking',
          message: 'Checking for updates...',
        })),
        restartToApply: vi.fn(async () => true),
        onStateChanged: vi.fn((callback: (state: UpdateState) => void) => {
          callback({
            ...idleState,
            status: 'downloaded',
            message: 'An update has been downloaded and is ready to install.',
            releaseName: 'v0.2.0',
          });
          return () => {};
        }),
      },
    } as LinguaAPI;
  });

  it('initializes from the preload update API and subscribes to changes', async () => {
    await useUpdateStore.getState().initialize();

    const state = useUpdateStore.getState();
    expect(state.initialized).toBe(true);
    expect(state.status).toBe('downloaded');
    expect(state.releaseName).toBe('v0.2.0');
  });

  it('checks for updates through the preload bridge', async () => {
    await useUpdateStore.getState().checkForUpdates();
    expect(useUpdateStore.getState().status).toBe('checking');
  });

  it('surfaces a checking state immediately before the bridge resolves', async () => {
    let resolveCheck: ((state: UpdateState) => void) | null = null;

    window.lingua = {
      ...window.lingua,
      updates: {
        ...window.lingua.updates,
        check: vi.fn(
          () =>
            new Promise<UpdateState>((resolve) => {
              resolveCheck = resolve;
            })
        ),
      },
    } as LinguaAPI;

    const pendingCheck = useUpdateStore.getState().checkForUpdates();

    expect(useUpdateStore.getState().status).toBe('checking');
    expect(useUpdateStore.getState().lastCheckedAt).toBeTruthy();

    resolveCheck?.({
      status: 'not-available',
      supported: true,
      enabled: true,
      message: 'You are up to date.',
      lastCheckedAt: '2026-04-15T21:15:00.000Z',
    });

    await pendingCheck;

    expect(useUpdateStore.getState().status).toBe('not-available');
  });

  it('restarts through the preload bridge', async () => {
    const restarted = await useUpdateStore.getState().restartToApply();
    expect(restarted).toBe(true);
  });
});
