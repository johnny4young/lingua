import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  trackShareCreated,
  trackShareOpened,
} from '../../src/renderer/utils/shareLink';
import {
  _resetTrustEventCounterForTesting,
  useTrustEventStore,
} from '../../src/renderer/stores/trustEventStore';

/**
 * RL-096 Slice 2 fold D — share-link create/open record metadata-only trust
 * events, and ONLY on a real success (a usable link produced / a clean
 * decode). The share URL encodes the payload and must never reach the log.
 */
describe('shareLink trust capture (RL-096 Slice 2)', () => {
  beforeEach(() => {
    _resetTrustEventCounterForTesting();
    useTrustEventStore.getState().clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records a created event on success, metadata only — no URL or fragment', () => {
    trackShareCreated({ trigger: 'button', status: 'success', sizeBucket: '<1kb' });
    const events = useTrustEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      feature: 'share-link',
      action: 'created',
      sensitivity: 'medium',
    });
    expect(events[0]!.summary).not.toMatch(/https?:|#/);
  });

  it('does NOT record when no usable link was produced', () => {
    trackShareCreated({ trigger: 'button', status: 'too-large', sizeBucket: '<4kb' });
    trackShareCreated({ trigger: 'palette', status: 'cancelled', sizeBucket: '<1kb' });
    trackShareCreated({
      trigger: 'shortcut',
      status: 'unknown-language',
      sizeBucket: '<2kb',
    });
    expect(useTrustEventStore.getState().events).toHaveLength(0);
  });

  it('does not throw when trust capture storage fails after a successful create', () => {
    vi.spyOn(useTrustEventStore.getState(), 'record').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() =>
      trackShareCreated({ trigger: 'button', status: 'success', sizeBucket: '<1kb' })
    ).not.toThrow();
  });

  it('records an opened event on a clean decode', () => {
    trackShareOpened({ status: 'success', sizeBucket: '<2kb' });
    const events = useTrustEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ feature: 'share-link', action: 'opened' });
    expect(events[0]!.summary).not.toMatch(/https?:|#/);
  });

  it('does NOT record an opened event on a failed decode', () => {
    trackShareOpened({ status: 'decode-fail', sizeBucket: '<1kb' });
    trackShareOpened({ status: 'oversized', sizeBucket: '<4kb' });
    expect(useTrustEventStore.getState().events).toHaveLength(0);
  });
});
