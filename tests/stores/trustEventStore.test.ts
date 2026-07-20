import { beforeEach, describe, expect, it } from 'vitest';
import {
  TRUST_EVENT_STORAGE_KEY,
  TRUST_EVENT_CAP_FOR_TEST,
  _resetTrustEventCounterForTesting,
  _sanitizeTrustEventsForTesting,
  useTrustEventStore,
} from '@/stores/trustEventStore';

describe('trustEventStore', () => {
  beforeEach(() => {
    window.localStorage.removeItem(TRUST_EVENT_STORAGE_KEY);
    _resetTrustEventCounterForTesting();
    useTrustEventStore.getState().clear();
  });

  it('enforces a 200-entry FIFO cap when more than 200 events arrive', () => {
    for (let i = 0; i < TRUST_EVENT_CAP_FOR_TEST + 1; i += 1) {
      useTrustEventStore.getState().record({
        feature: 'telemetry',
        action: 'enqueue',
        sensitivity: 'low',
        summary: `event-${i}`,
      });
    }
    const events = useTrustEventStore.getState().events;
    expect(events.length).toBe(TRUST_EVENT_CAP_FOR_TEST);
    // Oldest entry got shifted out, so the first surviving summary
    // is `event-1` (the original `event-0` is gone).
    expect(events[0]?.summary).toBe('event-1');
    expect(events[events.length - 1]?.summary).toBe(
      `event-${TRUST_EVENT_CAP_FOR_TEST}`
    );
  });

  it('strips extra props callers may smuggle in (shape integrity)', () => {
    // implementation — the store's `record` signature is typed but a
    // JS caller could pass extra keys. The shape contract for the
    // dashboard's privacy guarantee is that NOTHING beyond
    // {feature, action, sensitivity, summary} ever lands in the
    // event. This test pins that.
    useTrustEventStore.getState().record({
      feature: 'capsule-export',
      action: 'copy',
      sensitivity: 'medium',
      summary: 'export ok',
      // @ts-expect-error — extra prop must be ignored.
      payload: { token: 'sk-leak-me' },
      // @ts-expect-error — code must never land in the trust log.
      code: 'console.log(1)',
    } as never);
    const entry = useTrustEventStore.getState().events[0];
    expect(entry).toBeDefined();
    expect(Object.keys(entry ?? {})).toEqual(
      expect.arrayContaining([
        'id',
        'at',
        'feature',
        'action',
        'sensitivity',
        'summary',
      ])
    );
    expect(Object.keys(entry ?? {})).not.toEqual(
      expect.arrayContaining(['payload', 'code'])
    );
  });

  it('truncates summary strings past the cap with an ellipsis', () => {
    const huge = 'x'.repeat(500);
    useTrustEventStore.getState().record({
      feature: 'license',
      action: 'verify',
      sensitivity: 'high',
      summary: huge,
    });
    const entry = useTrustEventStore.getState().events[0];
    expect(entry?.summary.length).toBeLessThanOrEqual(201);
    expect(entry?.summary.endsWith('…')).toBe(true);
  });

  it('rejects unknown features silently (no entry recorded)', () => {
    useTrustEventStore.getState().record({
      // @ts-expect-error — closed enum violation.
      feature: 'analytics',
      action: 'ping',
      sensitivity: 'low',
      summary: 'should not land',
    } as never);
    expect(useTrustEventStore.getState().events).toEqual([]);
  });

  it('rejects empty action strings silently', () => {
    useTrustEventStore.getState().record({
      feature: 'telemetry',
      action: '',
      sensitivity: 'low',
      summary: 'missing action',
    });
    expect(useTrustEventStore.getState().events).toEqual([]);
  });

  it('clear() empties the log', () => {
    useTrustEventStore.getState().record({
      feature: 'telemetry',
      action: 'enqueue',
      sensitivity: 'low',
      summary: 'one',
    });
    expect(useTrustEventStore.getState().events.length).toBe(1);
    useTrustEventStore.getState().clear();
    expect(useTrustEventStore.getState().events).toEqual([]);
  });

  it('persists events under the audited localStorage key', () => {
    useTrustEventStore.getState().record({
      feature: 'telemetry',
      action: 'enqueue',
      sensitivity: 'low',
      summary: 'persist me',
    });
    const raw = window.localStorage.getItem(TRUST_EVENT_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(raw).toContain('persist me');
  });

  it('sanitizes persisted rows before rehydrate can expose them', () => {
    const events = _sanitizeTrustEventsForTesting([
      {
        id: 41,
        at: 123,
        feature: 'license',
        action: 'verify',
        sensitivity: 'high',
        summary: 'x'.repeat(500),
        payload: { token: 'sk-never-expose' },
      },
      {
        id: 42,
        at: 124,
        feature: 'unknown',
        action: 'verify',
        sensitivity: 'high',
        summary: 'drop me',
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      id: 41,
      at: 123,
      feature: 'license',
      action: 'verify',
      sensitivity: 'high',
      summary: `${'x'.repeat(200)}…`,
    });
    expect(Object.keys(events[0] ?? {})).not.toContain('payload');
  });

  it('continues ids after rehydrated events to avoid duplicate keys', () => {
    useTrustEventStore.setState({
      events: [
        {
          id: 41,
          at: 123,
          feature: 'telemetry',
          action: 'enqueue',
          sensitivity: 'low',
          summary: 'existing',
        },
      ],
    });
    useTrustEventStore.getState().record({
      feature: 'updates',
      action: 'check',
      sensitivity: 'low',
      summary: 'new',
    });
    expect(useTrustEventStore.getState().events.map((event) => event.id)).toEqual([
      41,
      42,
    ]);
  });
});
