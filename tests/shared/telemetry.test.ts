/**
 * RL-065 privacy guarantees locked as tests:
 *   - redactor drops any property not on the per-event allowlist
 *   - redactor defensively strips keys/values that look like user data
 *   - timestamps are rounded to the minute
 *   - bucketers never emit raw values
 */

import { describe, expect, it } from 'vitest';
import {
  TELEMETRY_EVENTS,
  bucketDurationMs,
  bucketOs,
  createSessionId,
  redactForTelemetry,
  type TelemetryEvent,
} from '../../src/shared/telemetry';

function buildEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    event: 'overlay.opened',
    appVersion: '0.1.0',
    osBucket: 'darwin/23',
    licenseStatus: 'free',
    sessionId: 'abc',
    properties: {},
    timestamp: Date.parse('2026-04-17T10:23:41.999Z'),
    ...overrides,
  };
}

describe('TELEMETRY_EVENTS', () => {
  it('matches the allowed event names and does not grow without review', () => {
    expect([...TELEMETRY_EVENTS].sort()).toEqual([
      'app.launched',
      // RL-027 Slice 1.5 — debugger session lifecycle. Closed-enum payload
      // per DEBUGGER_ADR §4; the redactor drops anything off the contract.
      'debugger.attached',
      'debugger.detached',
      'debugger.paused',
      'feature.blocked',
      'overlay.opened',
      'runner.executed',
      // RL-019 Slice 1 — per-tab JS/TS runtime mode change.
      // Closed-enum payload `{ mode, language }`; see RUNTIME_MODES_ADR.
      'runtime.mode_changed',
      'update.checked',
      // RL-069 Slice 3 — Developer Utilities productivity layer.
      'utility.clipboard.applied',
      'utility.favorite.pinned',
      'utility.history.cleared',
    ]);
  });
});

describe('redactForTelemetry', () => {
  it('keeps only allow-listed properties and reports what was dropped', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'runner.executed',
        properties: {
          language: 'python',
          status: 'ok',
          durationBucketMs: 250,
          source: 'print("secret")',
          filePath: '/Users/me/Documents/secret.py',
        },
      })
    );

    expect(event.properties).toEqual({
      language: 'python',
      status: 'ok',
      durationBucketMs: 250,
    });
    expect(droppedKeys).toContain('source');
    expect(droppedKeys).toContain('filePath');
  });

  it('strips non-primitive values even if the key happens to be allow-listed', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'overlay.opened',
        properties: {
          overlayId: { nested: 'oops' } as unknown as string,
        },
      })
    );

    expect(event.properties).toEqual({});
    expect(droppedKeys).toContain('overlayId');
  });

  it('strips suspicious free-form values even when the property key is allow-listed', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'runner.executed',
        properties: {
          language: 'console.log(secret)',
          status: 'ok',
          durationBucketMs: 250,
        },
      })
    );

    expect(event.properties).toEqual({
      status: 'ok',
      durationBucketMs: 250,
    });
    expect(droppedKeys).toContain('language');
  });

  it('strips invalid enum and bucket values from allow-listed keys', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'update.checked',
        properties: {
          status: 'https://updates.linguacode.dev/releases/private',
        },
      })
    );

    expect(event.properties).toEqual({});
    expect(droppedKeys).toContain('status');
  });

  it('rounds timestamps to the minute to reduce fingerprintability', () => {
    const { event } = redactForTelemetry(buildEvent());
    expect(event.timestamp).toBe(Date.parse('2026-04-17T10:23:00.000Z'));
  });

  it('never accepts code-bearing keys even if someone adds them to the allow list by accident', () => {
    // Simulate a careless expansion: a property named `sourceCode` snuck
    // onto an event. The key-substring check in the redactor (DENY_SUBSTRINGS)
    // must still strip it so we don't rely on allow-list discipline alone.
    const event = {
      ...buildEvent({
        event: 'runner.executed',
        properties: { sourceCode: 'console.log(1)' } as unknown as Record<
          string,
          string | number | boolean
        >,
      }),
    };
    const { event: redacted, droppedKeys } = redactForTelemetry(event);
    expect(redacted.properties).toEqual({});
    expect(droppedKeys).toContain('sourceCode');
  });
});

describe('bucketOs + bucketDurationMs', () => {
  it('buckets OS versions into platform/major', () => {
    expect(bucketOs('darwin', '23.4.0')).toBe('darwin/23');
    expect(bucketOs('linux', '6.7-arch')).toBe('linux/6');
    expect(bucketOs('win32', '10.0.22631')).toBe('win32/10');
    expect(bucketOs('darwin', 'weird')).toBe('darwin/unknown');
    expect(bucketOs('', '1')).toBe('unknown');
  });

  it('buckets durations into coarse ranges so raw run times never leak', () => {
    expect(bucketDurationMs(1)).toBe(50);
    expect(bucketDurationMs(120)).toBe(250);
    expect(bucketDurationMs(900)).toBe(1000);
    expect(bucketDurationMs(4_500)).toBe(5000);
    expect(bucketDurationMs(29_000)).toBe(30_000);
    expect(bucketDurationMs(120_000)).toBe(60_000);
    expect(bucketDurationMs(Number.NaN)).toBe(0);
  });
});

describe('createSessionId', () => {
  it('produces a 32-hex-char launch-scoped id', () => {
    const id = createSessionId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces unique ids across multiple calls so we never collide across launches', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      ids.add(createSessionId());
    }
    expect(ids.size).toBe(200);
  });
});
