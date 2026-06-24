/**
 * RL-065 Slice 5 fold D — `update.checked` telemetry callsite.
 *
 * The store subscribes at module-load and emits `update.checked`
 * once per transition out of the `checking` state. Closed-enum
 * status:
 *   `available`  — autoupdater found an update (status:
 *                  'available' or 'downloaded').
 *   `no-update`  — autoupdater confirmed the build is current
 *                  (status: 'not-available').
 *   `failure`    — autoupdater raised an error (status: 'error').
 *
 * Other transitions (no change, into-checking, unrelated terminal
 * → terminal) MUST NOT emit telemetry — the dashboard counts
 * funnel volume and double-counting would pollute the signal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const trackEventMock = vi.fn();

vi.mock('@/utils/telemetry', () => ({
  trackEvent: trackEventMock,
  // The store does not import these but the module shape needs
  // them so any future import survives the mock.
  emitTelemetryEvent: vi.fn(),
  isTelemetryEnabled: vi.fn(() => false),
  resolveTelemetryBase: vi.fn(() => ({
    appVersion: '0.0.0-test',
    osBucket: 'test/0',
    licenseStatus: 'free',
    sessionId: 'test-session',
  })),
}));

describe('updateStore — update.checked telemetry (fold D)', () => {
  beforeEach(async () => {
    trackEventMock.mockClear();
    // Reset the store to the default unavailable state at the start
    // of every test so a `checking` → `not-available` transition is
    // observable; without this the prior test's terminal state
    // would prevent the next set() from looking like a transition.
    const { useUpdateStore } = await import('@/stores/updateStore');
    useUpdateStore.setState(
      {
        status: 'unavailable',
        supported: false,
        enabled: false,
        message: 'reset',
        initialized: false,
        lastCheckedAt: undefined,
        releaseName: undefined,
        releaseNotes: undefined,
        updateURL: undefined,
      },
      true
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits status=no-update when checking → not-available', async () => {
    const { useUpdateStore } = await import('@/stores/updateStore');
    useUpdateStore.setState({ status: 'checking', message: 'checking' });
    expect(trackEventMock).not.toHaveBeenCalled();
    useUpdateStore.setState({ status: 'not-available', message: 'current' });
    expect(trackEventMock).toHaveBeenCalledWith('update.checked', { status: 'no-update' });
  });

  it('emits status=available when checking → available', async () => {
    const { useUpdateStore } = await import('@/stores/updateStore');
    useUpdateStore.setState({ status: 'checking', message: 'checking' });
    useUpdateStore.setState({ status: 'available', message: 'downloading' });
    expect(trackEventMock).toHaveBeenCalledWith('update.checked', { status: 'available' });
  });

  it('emits status=available when checking → downloaded (skipped intermediate available)', async () => {
    const { useUpdateStore } = await import('@/stores/updateStore');
    useUpdateStore.setState({ status: 'checking', message: 'checking' });
    useUpdateStore.setState({ status: 'downloaded', message: 'ready' });
    expect(trackEventMock).toHaveBeenCalledWith('update.checked', { status: 'available' });
  });

  it('emits status=failure when checking → error', async () => {
    const { useUpdateStore } = await import('@/stores/updateStore');
    useUpdateStore.setState({ status: 'checking', message: 'checking' });
    useUpdateStore.setState({ status: 'error', message: 'network down' });
    expect(trackEventMock).toHaveBeenCalledWith('update.checked', { status: 'failure' });
  });

  it('does NOT fire when transition does not start from checking', async () => {
    const { useUpdateStore } = await import('@/stores/updateStore');
    useUpdateStore.setState({ status: 'unavailable', message: 'a' });
    useUpdateStore.setState({ status: 'not-available', message: 'b' });
    // Both transitions miss the `prev.status === 'checking'` gate.
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it('does NOT fire when the next state is itself checking (re-arming)', async () => {
    const { useUpdateStore } = await import('@/stores/updateStore');
    useUpdateStore.setState({ status: 'checking', message: 'a' });
    useUpdateStore.setState({ status: 'checking', message: 'b' });
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it('fires once per check, not once per state update inside a check', async () => {
    const { useUpdateStore } = await import('@/stores/updateStore');
    useUpdateStore.setState({ status: 'checking', message: 'a' });
    useUpdateStore.setState({ status: 'available', message: 'b' });
    // A second update-state broadcast lands while the autoupdater
    // is still processing the same check (e.g., update-downloaded
    // follows update-available). That second transition is NOT a
    // new check — it's a continuation. The gate filters it out
    // because prev.status is no longer `checking`.
    useUpdateStore.setState({ status: 'downloaded', message: 'c' });
    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith('update.checked', { status: 'available' });
  });

  it('records a metadata-only updates trust event on a real check (RL-096 Slice 2 fold A)', async () => {
    const { useUpdateStore } = await import('@/stores/updateStore');
    const { useTrustEventStore } = await import('@/stores/trustEventStore');
    useTrustEventStore.getState().clear();
    useUpdateStore.setState({ status: 'checking', message: 'checking' });
    useUpdateStore.setState({ status: 'not-available', message: 'current' });
    const events = useTrustEventStore
      .getState()
      .events.filter((e) => e.feature === 'updates');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      feature: 'updates',
      action: 'checked',
      sensitivity: 'low',
    });
    // Metadata only — the closed-enum outcome, never a version string.
    expect(events[0]!.summary).toContain('no-update');
  });

  it('records no updates trust event when the transition is not a real check', async () => {
    const { useUpdateStore } = await import('@/stores/updateStore');
    const { useTrustEventStore } = await import('@/stores/trustEventStore');
    useTrustEventStore.getState().clear();
    // Never enters `checking`, so the subscribe gate filters it out.
    useUpdateStore.setState({ status: 'unavailable', message: 'a' });
    useUpdateStore.setState({ status: 'not-available', message: 'b' });
    expect(
      useTrustEventStore.getState().events.filter((e) => e.feature === 'updates')
    ).toHaveLength(0);
  });
});
