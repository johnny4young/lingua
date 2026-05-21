/**
 * RL-094 Slice 1 — Run Capsule test matrix.
 *
 * Covers eight dimensions per `docs/CAPSULE_TEST_MATRIX.md`:
 *   1. Schema round-trip (every fixture).
 *   2. Builder shape (defaults, overrides, hash determinism).
 *   3. Sanitiser redaction proof + omittedFields honesty.
 *   4. Sanitiser size cap (MAX_STREAM_BYTES truncation).
 *   5. Parser version gating (rejects version: 2).
 *   6. Parser shape validation (each load-bearing field).
 *   7. Summary helper format stability.
 *   8. contentHash collision-resistance smoke (10k unique inputs).
 *
 * Per-fixture assertions iterate `ALL_FIXTURES` so adding a new
 * fixture in `runCapsule.fixtures.ts` automatically widens coverage
 * — drop-in for downstream tickets (RL-036, RL-097, RL-098, RL-099,
 * RL-100, RL-039 Slice B).
 */

import { describe, expect, it } from 'vitest';
import {
  buildRunCapsule,
  computeContentHash,
  MAX_CAPSULE_BYTES,
  MAX_STREAM_BYTES,
  parseRunCapsule,
  sanitizeRunCapsule,
  summarizeRunCapsule,
  type RunCapsuleV1,
} from '../../src/shared/runCapsule';
import {
  ALL_FIXTURES,
  FIXTURE_DESKTOP_DEP_SUMMARY,
  FIXTURE_LARGE_STDOUT,
  FIXTURE_LICENSE_LEAK_PROBE,
  FIXTURE_MINIMAL_JS,
} from './runCapsule.fixtures';

// ---------------------------------------------------------------------------
// Dimension 1: schema round-trip per fixture
// ---------------------------------------------------------------------------

describe('parseRunCapsule + JSON round-trip (per fixture)', () => {
  for (const { name, fixture } of ALL_FIXTURES) {
    it(`round-trips fixture ${name}`, () => {
      const sanitised = sanitizeRunCapsule(fixture);
      const json = JSON.stringify(sanitised);
      const parsed = parseRunCapsule(json);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        // Re-stringify both sides to compare structurally (avoids
        // map-ordering false positives — JSON object key order is
        // implementation-defined per spec).
        expect(JSON.stringify(parsed.value)).toEqual(JSON.stringify(sanitised));
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Dimension 2: builder shape
// ---------------------------------------------------------------------------

describe('buildRunCapsule', () => {
  it('keeps fixture contentHash values in sync with fixture source content', async () => {
    for (const { fixture } of ALL_FIXTURES) {
      const hash = await computeContentHash(fixture.source.content);
      expect(fixture.source.contentHash).toBe(hash);
    }
  });

  it('returns a RunCapsuleV1 with all required fields populated', async () => {
    const capsule = await buildRunCapsule({
      appVersion: '1.2.3',
      tab: {
        name: 'demo.js',
        language: 'javascript',
        runtimeMode: 'worker',
        workflowMode: 'run',
      },
      source: { content: 'console.log(1)' },
      result: { status: 'success', durationMs: 4 },
      environment: { platform: 'web', runner: 'javascript' },
      capsuleId: 'fixed-id',
      createdAtMs: Date.UTC(2026, 4, 21, 13, 0, 0),
    });
    expect(capsule.version).toBe(1);
    expect(capsule.capsuleId).toBe('fixed-id');
    expect(capsule.createdAt).toBe('2026-05-21T13:00:00.000Z');
    expect(capsule.appVersion).toBe('1.2.3');
    expect(capsule.source.contentHash).toHaveLength(64); // SHA-256 hex
    expect(capsule.privacy.redactionVersion).toBeTruthy();
    expect(capsule.privacy.omittedFields).toEqual([]);
  });

  it('produces deterministic contentHash for the same input', async () => {
    const a = await buildRunCapsule({
      appVersion: 'v',
      tab: { name: 'a', language: 'javascript', runtimeMode: 'worker', workflowMode: 'run' },
      source: { content: 'same input' },
      result: { status: 'success', durationMs: 0 },
      environment: { platform: 'web', runner: 'javascript' },
    });
    const b = await buildRunCapsule({
      appVersion: 'v',
      tab: { name: 'b', language: 'javascript', runtimeMode: 'worker', workflowMode: 'run' },
      source: { content: 'same input' },
      result: { status: 'success', durationMs: 0 },
      environment: { platform: 'web', runner: 'javascript' },
    });
    expect(a.source.contentHash).toBe(b.source.contentHash);
  });

  it('produces distinct contentHash for distinct inputs', async () => {
    const a = await buildRunCapsule({
      appVersion: 'v',
      tab: { name: 'a', language: 'javascript', runtimeMode: 'worker', workflowMode: 'run' },
      source: { content: 'aaa' },
      result: { status: 'success', durationMs: 0 },
      environment: { platform: 'web', runner: 'javascript' },
    });
    const b = await buildRunCapsule({
      appVersion: 'v',
      tab: { name: 'a', language: 'javascript', runtimeMode: 'worker', workflowMode: 'run' },
      source: { content: 'bbb' },
      result: { status: 'success', durationMs: 0 },
      environment: { platform: 'web', runner: 'javascript' },
    });
    expect(a.source.contentHash).not.toBe(b.source.contentHash);
  });
});

// ---------------------------------------------------------------------------
// Dimension 3 + 8: redaction proof (license-token + 10k hashes)
// ---------------------------------------------------------------------------

describe('sanitizeRunCapsule — redaction proof', () => {
  it('preserves source.content (capsule is explicitly a replay artifact)', () => {
    const sanitised = sanitizeRunCapsule(FIXTURE_LICENSE_LEAK_PROBE);
    expect(sanitised.source.content).toBe(
      FIXTURE_LICENSE_LEAK_PROBE.source.content
    );
    // The capsule design accepts source content verbatim (per
    // Privacy + Trust Dashboard / RL-096 contract). The honest
    // user-facing flow is: surface the source through the export
    // preview UI before publishing. The redactor's job is to keep
    // *out-of-band* metadata (tokens in env, paths in errorMessages)
    // safe, not the source itself.
  });

  it('redacts non-primitive dependencySummary entries and records the field', () => {
    const sanitised = sanitizeRunCapsule(FIXTURE_DESKTOP_DEP_SUMMARY);
    expect(sanitised.environment.dependencySummary).toMatchObject({
      node: '22.4.0',
      npm: '10.8.1',
    });
    expect(
      (sanitised.environment.dependencySummary as Record<string, unknown>).modules
    ).toBeUndefined();
    expect(sanitised.privacy.omittedFields).toContain(
      'environment.dependencySummary'
    );
  });
});

describe('computeContentHash — collision smoke (Dimension 8)', () => {
  it('produces 10 000 unique hashes across 10 000 distinct inputs', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const hash = await computeContentHash(`payload-${i}`);
      expect(seen.has(hash)).toBe(false);
      seen.add(hash);
    }
    expect(seen.size).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// Dimension 4: size cap truncation
// ---------------------------------------------------------------------------

describe('sanitizeRunCapsule — stream truncation', () => {
  it('truncates oversized stdout to MAX_STREAM_BYTES and flags the field', () => {
    const sanitised = sanitizeRunCapsule(FIXTURE_LARGE_STDOUT);
    expect(sanitised.result.stdout?.length).toBe(MAX_STREAM_BYTES);
    expect(sanitised.privacy.omittedFields).toContain('result.stdout');
  });

  it('truncates multibyte stdout by UTF-8 bytes without splitting a surrogate pair', () => {
    const multibyteCapsule: RunCapsuleV1 = {
      ...FIXTURE_MINIMAL_JS,
      result: {
        ...FIXTURE_MINIMAL_JS.result,
        stdout: '😀'.repeat(Math.ceil(MAX_STREAM_BYTES / 4) + 10),
      },
    };
    const sanitised = sanitizeRunCapsule(multibyteCapsule);
    const stdout = sanitised.result.stdout ?? '';
    expect(new TextEncoder().encode(stdout).byteLength).toBeLessThanOrEqual(
      MAX_STREAM_BYTES
    );
    const lastCodeUnit = stdout.charCodeAt(stdout.length - 1);
    expect(lastCodeUnit < 0xd800 || lastCodeUnit > 0xdbff).toBe(true);
    expect(sanitised.privacy.omittedFields).toContain('result.stdout');
  });

  it('leaves a small stdout untouched', () => {
    const sanitised = sanitizeRunCapsule(FIXTURE_MINIMAL_JS);
    expect(sanitised.result.stdout).toBe(FIXTURE_MINIMAL_JS.result.stdout);
    expect(sanitised.privacy.omittedFields).not.toContain('result.stdout');
  });

  it('is idempotent: sanitising a sanitised capsule never bloats omittedFields', () => {
    const once = sanitizeRunCapsule(FIXTURE_LARGE_STDOUT);
    const twice = sanitizeRunCapsule(once);
    expect(twice.privacy.omittedFields.sort()).toEqual(
      once.privacy.omittedFields.sort()
    );
  });
});

// ---------------------------------------------------------------------------
// Dimension 5: parser version gating
// ---------------------------------------------------------------------------

describe('parseRunCapsule — version gating', () => {
  it('rejects version: 2 with unsupported-version', () => {
    const forged = JSON.stringify({ ...FIXTURE_MINIMAL_JS, version: 2 });
    const parsed = parseRunCapsule(forged);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('unsupported-version');
    }
  });

  it('rejects oversized JSON (above MAX_CAPSULE_BYTES)', () => {
    const oversized = '"' + 'x'.repeat(MAX_CAPSULE_BYTES + 1) + '"';
    const parsed = parseRunCapsule(oversized);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('oversized');
    }
  });

  it('rejects JSON that is oversized by UTF-8 bytes, not character count', () => {
    const oversized = JSON.stringify(
      '😀'.repeat(Math.ceil(MAX_CAPSULE_BYTES / 4) + 1)
    );
    expect(oversized.length).toBeLessThan(MAX_CAPSULE_BYTES);
    const parsed = parseRunCapsule(oversized);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('oversized');
    }
  });

  it('rejects empty input', () => {
    const parsed = parseRunCapsule('');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('invalid-json');
    }
  });

  it('rejects malformed JSON', () => {
    const parsed = parseRunCapsule('{not-json');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('invalid-json');
    }
  });
});

// ---------------------------------------------------------------------------
// Dimension 6: parser shape validation
// ---------------------------------------------------------------------------

describe('parseRunCapsule — shape validation', () => {
  function omitField(
    capsule: RunCapsuleV1,
    field: keyof RunCapsuleV1
  ): string {
    const copy = { ...capsule };
    delete (copy as Record<string, unknown>)[field];
    return JSON.stringify(copy);
  }

  it('rejects a missing capsuleId', () => {
    const parsed = parseRunCapsule(omitField(FIXTURE_MINIMAL_JS, 'capsuleId'));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('missing-required-field');
      expect(parsed.detail).toBe('capsuleId');
    }
  });

  it('rejects a malformed tab field', () => {
    const broken = JSON.stringify({
      ...FIXTURE_MINIMAL_JS,
      tab: { name: 123, language: 'js', runtimeMode: 'worker', workflowMode: 'run' },
    });
    const parsed = parseRunCapsule(broken);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('invalid-field-type');
    }
  });

  it.each(['tab', 'source', 'input', 'result', 'environment', 'privacy'] as const)(
    'rejects a non-object %s field without throwing',
    (field) => {
      const broken = JSON.stringify({ ...FIXTURE_MINIMAL_JS, [field]: null });
      expect(() => parseRunCapsule(broken)).not.toThrow();
      const parsed = parseRunCapsule(broken);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.reason).toBe('invalid-field-type');
      }
    }
  );

  it('rejects an unknown result.status', () => {
    const broken = JSON.stringify({
      ...FIXTURE_MINIMAL_JS,
      result: { ...FIXTURE_MINIMAL_JS.result, status: 'magically-fine' },
    });
    const parsed = parseRunCapsule(broken);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('invalid-field-type');
    }
  });

  it('rejects an unknown environment.platform', () => {
    const broken = JSON.stringify({
      ...FIXTURE_MINIMAL_JS,
      environment: { platform: 'mobile', runner: 'javascript' },
    });
    const parsed = parseRunCapsule(broken);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('invalid-field-type');
    }
  });
});

// ---------------------------------------------------------------------------
// Dimension 7: summary helper format stability
// ---------------------------------------------------------------------------

describe('summarizeRunCapsule', () => {
  it('produces a stable one-line summary', () => {
    expect(summarizeRunCapsule(FIXTURE_MINIMAL_JS)).toBe(
      'javascript · success · 3ms · 2026-05-21T13:00:00.000Z'
    );
  });

  it('renders timeout / stopped status verbatim', () => {
    const fixtures = ALL_FIXTURES.filter(({ fixture }) =>
      ['timeout', 'stopped'].includes(fixture.result.status)
    );
    for (const { fixture } of fixtures) {
      const summary = summarizeRunCapsule(fixture);
      expect(summary).toContain(fixture.result.status);
    }
  });

  it('clamps negative durationMs to 0', () => {
    const oddCapsule: RunCapsuleV1 = {
      ...FIXTURE_MINIMAL_JS,
      result: { ...FIXTURE_MINIMAL_JS.result, durationMs: -42 },
    };
    expect(summarizeRunCapsule(oddCapsule)).toContain(' · 0ms · ');
  });
});
