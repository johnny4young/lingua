/**
 * implementation — Run Capsule test matrix.
 *
 * Covers eight dimensions per `docs/CAPSULE_TEST_MATRIX.md`:
 *   1. Schema round-trip (every fixture).
 *   2. Builder shape (defaults, overrides, hash determinism).
 *   3. Sanitiser redaction proof + omittedFields honesty.
 *   4. Sanitiser size cap (MAX_STREAM_BYTES truncation).
 *   5. Parser version gating (migration replay, newer-app rejection).
 *   6. Parser shape validation (each load-bearing field).
 *   7. Summary helper format stability.
 *   8. contentHash collision-resistance smoke (10k unique inputs).
 *
 * Per-fixture assertions iterate `ALL_FIXTURES` so adding a new
 * fixture in `runCapsule.fixtures.ts` automatically widens coverage
 * — drop-in for future integrations.
 */

import { describe, expect, it } from 'vitest';
import {
  applyCapsuleMigrations,
  buildRunCapsule,
  CAPSULE_MIGRATIONS,
  computeContentHash,
  CURRENT_RUN_CAPSULE_VERSION,
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
        // implementation per spec).
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

  it('round-trips the optional named input set snapshot', async () => {
    const capsule = await buildRunCapsule({
      appVersion: '1.2.3',
      tab: {
        name: 'demo.js',
        language: 'javascript',
        runtimeMode: 'worker',
        workflowMode: 'run',
      },
      source: { content: 'console.log(1)' },
      input: {
        stdin: 'Ada\n42',
        setName: 'Happy path',
        args: ['--mode', 'fast'],
      },
      result: { status: 'success', durationMs: 4 },
      environment: { platform: 'web', runner: 'javascript' },
    });

    const parsed = parseRunCapsule(JSON.stringify(capsule));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.input).toEqual({
        stdin: 'Ada\n42',
        setName: 'Happy path',
        args: ['--mode', 'fast'],
      });
    }
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
    // Privacy + Trust Dashboard / internal contract). The honest
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
    const TOTAL = 10_000;
    // Hash in bounded batches rather than one `await` per input. Every
    // `computeContentHash` call is a `crypto.subtle.digest` round-trip through
    // the libuv threadpool, which the whole worker pool shares; 10 000
    // sequential round-trips are fast in isolation but stall behind other
    // files' threadpool work under a full-suite run, which is what made this
    // test flaky. Batching keeps the same 10 000 distinct inputs while
    // capping in-flight digests so the pool stays saturated instead of
    // ping-ponging.
    const BATCH = 500;
    const seen = new Set<string>();
    for (let start = 0; start < TOTAL; start += BATCH) {
      const size = Math.min(BATCH, TOTAL - start);
      const hashes = await Promise.all(
        Array.from({ length: size }, (_unused, offset) =>
          computeContentHash(`payload-${start + offset}`)
        )
      );
      for (const hash of hashes) {
        seen.add(hash);
      }
    }
    // A Set of 10 000 hashes from 10 000 distinct inputs can only reach
    // TOTAL when no two inputs shared a digest.
    expect(seen.size).toBe(TOTAL);
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
  it('accepts the version this build writes', () => {
    expect(CURRENT_RUN_CAPSULE_VERSION).toBe(1);
    const parsed = parseRunCapsule(
      JSON.stringify({ ...FIXTURE_MINIMAL_JS, version: CURRENT_RUN_CAPSULE_VERSION })
    );
    expect(parsed.ok).toBe(true);
  });

  it('tells a future capsule apart from a broken one', () => {
    // Same rejection before this split, but the user-facing instruction
    // differs: a v2 capsule means THIS app is behind, not that the file
    // is corrupt. Released builds cannot be taught that later, which is
    // why the taxonomy ships before a v2 exists.
    const fromFuture = JSON.stringify({
      ...FIXTURE_MINIMAL_JS,
      version: CURRENT_RUN_CAPSULE_VERSION + 1,
    });
    const parsed = parseRunCapsule(fromFuture);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('capsule-from-newer-app');
      expect(parsed.detail).toBe(`version=${CURRENT_RUN_CAPSULE_VERSION + 1}`);
    }
  });

  it.each([
    ['missing', undefined],
    ['a string', '1'],
    ['zero', 0],
    ['fractional', 1.5],
    ['negative', -1],
  ])('rejects a %s version as unsupported, never as from-the-future', (_label, version) => {
    const parsed = parseRunCapsule(JSON.stringify({ ...FIXTURE_MINIMAL_JS, version }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('unsupported-version');
    }
  });

  it('rejects an older capsule when no migration is registered for it', () => {
    // Nothing registered today, so a hypothetical v0 has no path forward.
    const parsed = parseRunCapsule(JSON.stringify({ ...FIXTURE_MINIMAL_JS, version: 0 }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('unsupported-version');
    }
  });

  // The parser's own loop is unreachable while CURRENT_RUN_CAPSULE_VERSION is
  // 1 (a lower version is rejected by the integer guard first), so the chain
  // is exercised through the function the parser delegates to. That is the
  // real code path, with a synthetic target version standing in for the v2
  // that does not exist yet.
  describe('applyCapsuleMigrations', () => {
    const base = { ...FIXTURE_MINIMAL_JS, version: 1 } as unknown as Record<string, unknown>;

    it('replays every step in ascending order', () => {
      const steps: number[] = [];
      const result = applyCapsuleMigrations(base, 1, 3, {
        1: raw => {
          steps.push(1);
          return { ...raw, version: 2, addedByV2: true };
        },
        2: raw => {
          steps.push(2);
          return { ...raw, version: 3 };
        },
      });
      expect(steps).toEqual([1, 2]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.version).toBe(3);
        expect(result.value.addedByV2).toBe(true);
        // The capsule's own fields survive the walk.
        expect(result.value.capsuleId).toBe(FIXTURE_MINIMAL_JS.capsuleId);
      }
    });

    it('is a no-op when the capsule is already current', () => {
      const result = applyCapsuleMigrations(base, 1, 1, {});
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(base);
    });

    it('reports a gap in the chain instead of skipping it', () => {
      const result = applyCapsuleMigrations(base, 1, 3, {
        1: raw => ({ ...raw, version: 2 }),
        // no 2 -> 3
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.detail).toMatch(/no migration registered for version 2/);
    });

    it('rejects a step that returns something that is not an object', () => {
      // Without this the downstream `key in candidate` checks throw a
      // TypeError instead of producing a parse rejection.
      for (const bad of [null, undefined, 'v2', 42, [1, 2]]) {
        const result = applyCapsuleMigrations(base, 1, 2, {
          1: () => bad as unknown as Record<string, unknown>,
        });
        expect(result.ok, `returning ${JSON.stringify(bad) ?? 'undefined'} must fail`).toBe(false);
        if (!result.ok) expect(result.detail).toMatch(/did not return an object/);
      }
    });

    it('rejects a step that forgets to bump the version', () => {
      // The silent failure: the capsule validates and gets cast to
      // RunCapsuleV1 while still carrying the old schema version.
      const result = applyCapsuleMigrations(base, 1, 2, {
        1: raw => ({ ...raw, addedByV2: true }),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.detail).toMatch(/left version=1/);
    });

    it('rejects a step that skips ahead past its target version', () => {
      const result = applyCapsuleMigrations(base, 1, 3, {
        1: raw => ({ ...raw, version: 3 }),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.detail).toMatch(/left version=3/);
    });

    it('turns a throwing step into a rejection, not a crash', () => {
      const result = applyCapsuleMigrations(base, 1, 2, {
        1: () => {
          throw new Error('boom');
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.detail).toMatch(/threw: boom/);
    });
  });

  it('keeps the migration registry consistent with the current version', () => {
    // A v2 cut that forgets to register the v1 -> v2 step would silently
    // orphan every capsule already in the wild. This is that alarm.
    for (let from = 1; from < CURRENT_RUN_CAPSULE_VERSION; from += 1) {
      expect(CAPSULE_MIGRATIONS[from], `missing migration for capsule version ${from}`).toBeTypeOf(
        'function'
      );
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

  it.each([
    { setName: 42 },
    { args: '--mode fast' },
    { args: ['--mode', 42] },
  ])('rejects malformed optional input-set fields: $setName$args', (input) => {
    const broken = JSON.stringify({
      ...FIXTURE_MINIMAL_JS,
      input: { ...FIXTURE_MINIMAL_JS.input, ...input },
    });
    const parsed = parseRunCapsule(broken);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('invalid-field-type');
      expect(parsed.detail).toBe('input fields');
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
