/**
 * RL-065 Slice 5 — `/telemetry` ingest endpoint tests.
 *
 * Covers:
 *   - Method negotiation: POST, OPTIONS preflight, 405 for everything else.
 *   - Payload size cap (8 KB) on both the Content-Length and body paths.
 *   - JSON parse + structural validation (missing/unknown event, bad
 *     property bag).
 *   - Allowlist enforcement: unknown property keys silently dropped
 *     so a sneaky `sourceCode` field never reaches the log line.
 *   - Fold A — `DENY_SUBSTRINGS` substring deny pass mirrored from
 *     `src/shared/telemetry.ts`.
 *   - Fold B — per-IP rate limit (5 req/s ceiling, CF Cache API).
 *   - Fold C — parity test: `TELEMETRY_EVENT_NAMES` and
 *     `EVENT_PROPERTY_ALLOWLIST` here must equal the renderer copies
 *     in `src/shared/telemetry.ts`. Drift between the two is exactly
 *     the failure mode this test guards.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import worker, { type Env } from '../src/index';
import {
  DENY_SUBSTRINGS,
  EVENT_PROPERTY_ALLOWLIST,
  ONBOARDING_DISMISS_MODES as WORKER_ONBOARDING_DISMISS_MODES,
  ONBOARDING_LANGUAGE_IDS as WORKER_ONBOARDING_LANGUAGE_IDS,
  ONBOARDING_TOAST_STAGES as WORKER_ONBOARDING_TOAST_STAGES,
  OUTPUT_ORIGIN_SURFACES as WORKER_OUTPUT_ORIGIN_SURFACES,
  GIT_LAYER_REPO_STATES as WORKER_GIT_LAYER_REPO_STATES,
  REVEAL_IN_SC_TARGETS as WORKER_REVEAL_IN_SC_TARGETS,
  EXTERNAL_RELOAD_MODES as WORKER_EXTERNAL_RELOAD_MODES,
  HTTP_METHODS_SET as WORKER_HTTP_METHODS_SET,
  HTTP_STATUS_BUCKETS_SET as WORKER_HTTP_STATUS_BUCKETS_SET,
  DEPENDENCY_COUNT_BUCKETS as WORKER_DEPENDENCY_COUNT_BUCKETS,
  TEMPLATE_PROJECT_IDS as WORKER_TEMPLATE_PROJECT_IDS,
  PRIVACY_DASHBOARD_SURFACES as WORKER_PRIVACY_DASHBOARD_SURFACES,
  TELEMETRY_EVENT_NAMES,
  checkRateLimit,
  ipBucket,
  keyLooksSensitive,
} from '../src/telemetry';
import {
  ONBOARDING_DISMISS_MODES as RENDERER_ONBOARDING_DISMISS_MODES,
  ONBOARDING_TOAST_STAGES as RENDERER_ONBOARDING_TOAST_STAGES,
  OUTPUT_ORIGIN_SURFACES as RENDERER_OUTPUT_ORIGIN_SURFACES,
  GIT_LAYER_REPO_STATES as RENDERER_GIT_LAYER_REPO_STATES,
  REVEAL_IN_SC_TARGETS as RENDERER_REVEAL_IN_SC_TARGETS,
  EXTERNAL_RELOAD_MODES as RENDERER_EXTERNAL_RELOAD_MODES,
  HTTP_METHODS_SET as RENDERER_HTTP_METHODS_SET,
  HTTP_STATUS_BUCKETS_SET as RENDERER_HTTP_STATUS_BUCKETS_SET,
  DEPENDENCY_COUNT_BUCKETS_SET as RENDERER_DEPENDENCY_COUNT_BUCKETS_SET,
  TEMPLATE_PROJECT_IDS as RENDERER_TEMPLATE_PROJECT_IDS,
  PRIVACY_DASHBOARD_SURFACES as RENDERER_PRIVACY_DASHBOARD_SURFACES,
  TELEMETRY_EVENTS as RENDERER_TELEMETRY_EVENTS,
} from '../../src/shared/telemetry';
// RL-096 Slice 1 reviewer pass — cross-import the renderer's
// canonical DENY_SUBSTRINGS so the parity test cannot silently
// drift when the renderer extends the deny pass (as it did in this
// slice for apiKey / secret / credential / authorization /
// privateKey / accessKey / licenseKey patterns). The worker DENY
// list MUST be a byte-for-byte superset of the renderer list — the
// worker's job is defense in depth against renderer regressions, so
// it can't redact LESS than the renderer does.
import { DENY_SUBSTRINGS as RENDERER_DENY_SUBSTRINGS } from '../../src/shared/redaction';
import { LANGUAGE_PACKS } from '../../src/shared/languagePacks';

type FetchMock = Mock<typeof fetch>;

function createMockCacheStorage(): { mockCache: Cache; store: Map<string, Response> } {
  const store = new Map<string, Response>();
  const mockCache: Cache = {
    match: vi.fn(async (request: RequestInfo | URL) => {
      const key = typeof request === 'string' ? request : (request as Request).url;
      const cached = store.get(key);
      return cached ? cached.clone() : undefined;
    }),
    put: vi.fn(async (request: RequestInfo | URL, response: Response) => {
      const key = typeof request === 'string' ? request : (request as Request).url;
      store.set(key, response.clone());
    }),
    add: vi.fn(),
    addAll: vi.fn(),
    delete: vi.fn(),
    keys: vi.fn(),
    matchAll: vi.fn(),
  } as unknown as Cache;
  return { mockCache, store };
}

function createEnv(): Env {
  return { GITHUB_TOKEN: 'gh_test_token' };
}

function postTelemetry(body: unknown, init: RequestInit = {}, ip = '203.0.113.1') {
  return worker.fetch(
    new Request('https://updates.linguacode.dev/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...init,
    }),
    createEnv()
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  const { mockCache } = createMockCacheStorage();
  vi.stubGlobal('caches', { default: mockCache });
  // Telemetry handler never reaches out to GitHub; pin fetch to a
  // throwing stub so an accidental call surfaces as a hard failure.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('telemetry handler must not call fetch');
    }) as FetchMock
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /telemetry — method negotiation', () => {
  it('returns 204 on OPTIONS preflight with CORS headers', async () => {
    const response = await worker.fetch(
      new Request('https://updates.linguacode.dev/telemetry', { method: 'OPTIONS' }),
      createEnv()
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
  });

  it('returns 405 with Allow: POST, OPTIONS for GET', async () => {
    const response = await worker.fetch(
      new Request('https://updates.linguacode.dev/telemetry'),
      createEnv()
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST, OPTIONS');
  });
});

describe('POST /telemetry — payload validation', () => {
  it('returns 400 when the body is not valid JSON', async () => {
    const response = await postTelemetry('not-json');
    expect(response.status).toBe(400);
  });

  it('returns 400 when the body is missing the `event` field', async () => {
    const response = await postTelemetry({ properties: { language: 'js' } });
    expect(response.status).toBe(400);
  });

  it('returns 400 when `event` is not in the allowlist', async () => {
    const response = await postTelemetry({ event: 'app.spied_on' });
    expect(response.status).toBe(400);
  });

  it('returns 400 when `properties` is a non-object', async () => {
    const response = await postTelemetry({
      event: 'app.launched',
      properties: 'not-an-object',
    });
    expect(response.status).toBe(400);
  });

  it('accepts an allowed event with no properties (returns 204)', async () => {
    const response = await postTelemetry({ event: 'app.launched' });
    expect(response.status).toBe(204);
  });

  it('accepts an allowed event with valid properties (returns 204)', async () => {
    const response = await postTelemetry({
      event: 'runner.executed',
      properties: { language: 'js', status: 'ok', durationBucketMs: 250 },
    });
    expect(response.status).toBe(204);
  });
});

describe('POST /telemetry — silent property drop (no signal leakage)', () => {
  it('drops unknown property keys without surfacing a 400', async () => {
    // The privacy contract: never signal "we saw your sneaky key" by
    // reflecting a rejection. Drop + 204 is what the renderer
    // redactor already does locally.
    const response = await postTelemetry({
      event: 'runner.executed',
      properties: { language: 'js', status: 'ok', sourceCode: 'leak me' },
    });
    expect(response.status).toBe(204);
  });

  it('drops non-primitive property values silently', async () => {
    const response = await postTelemetry({
      event: 'runner.executed',
      properties: { language: 'js', status: { nested: 'object' } },
    });
    expect(response.status).toBe(204);
  });

  it('drops suspicious free-form values even when the property key is allow-listed', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const response = await postTelemetry({
      event: 'runner.executed',
      properties: {
        language: 'console.log(secret)',
        status: 'ok',
        durationBucketMs: 250,
      },
    });

    expect(response.status).toBe(204);
    const eventLine = consoleSpy.mock.calls
      .map(call => String(call[0] ?? ''))
      .find(line => line.includes('"telemetry.event"'));
    expect(eventLine).toBeDefined();
    const parsed = JSON.parse(eventLine!);
    expect(parsed.properties).toEqual({
      status: 'ok',
      durationBucketMs: 250,
    });
    expect(eventLine).not.toContain('console.log(secret)');
  });

  it('drops invalid enum values from allow-listed keys', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const response = await postTelemetry({
      event: 'update.checked',
      properties: { status: 'full stacktrace with path /Users/me/app' },
    });

    expect(response.status).toBe(204);
    const eventLine = consoleSpy.mock.calls
      .map(call => String(call[0] ?? ''))
      .find(line => line.includes('"telemetry.event"'));
    expect(eventLine).toBeDefined();
    const parsed = JSON.parse(eventLine!);
    expect(parsed.properties).toEqual({});
  });
});

describe('POST /telemetry — fold A: deny-substring guard', () => {
  it('keyLooksSensitive returns true for every DENY_SUBSTRING entry', () => {
    for (const deny of DENY_SUBSTRINGS) {
      // Bare substring as the whole key (e.g., `token`).
      expect(keyLooksSensitive(deny), `bare ${deny}`).toBe(true);
      // Substring embedded inside a longer key (e.g., `myToken`).
      expect(keyLooksSensitive(`my${deny}`), `prefixed ${deny}`).toBe(true);
      expect(keyLooksSensitive(`${deny}Field`), `suffixed ${deny}`).toBe(true);
    }
  });

  it('keyLooksSensitive is case-insensitive', () => {
    // A property key like `SourceCode` (mixed case) must hit the
    // substring check the same as `sourcecode`. Without this guard
    // a future allowlist regression that ever permitted a
    // capitalised sensitive key would slip through.
    expect(keyLooksSensitive('SourceCode')).toBe(true);
    expect(keyLooksSensitive('EMAIL_ADDRESS')).toBe(true);
    expect(keyLooksSensitive('UserPath')).toBe(true);
  });

  it('keyLooksSensitive returns false for benign keys', () => {
    expect(keyLooksSensitive('platform')).toBe(false);
    expect(keyLooksSensitive('language')).toBe(false);
    expect(keyLooksSensitive('status')).toBe(false);
    expect(keyLooksSensitive('durationBucketMs')).toBe(false);
  });

  it('end-to-end: a sneaky deny key in a POST is silently dropped from the log line', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await postTelemetry({
      event: 'runner.executed',
      properties: { language: 'js', status: 'ok', sourceCode: 'leak me' },
    });
    const eventLine = consoleSpy.mock.calls
      .map(call => String(call[0] ?? ''))
      .find(line => line.includes('"telemetry.event"'));
    expect(eventLine).toBeDefined();
    expect(eventLine!.toLowerCase()).not.toContain('sourcecode');
    expect(eventLine!.toLowerCase()).not.toContain('leak me');
  });
});

describe('POST /telemetry — payload size cap (8 KB)', () => {
  it('returns 413 when Content-Length declares an over-size body', async () => {
    const response = await worker.fetch(
      new Request('https://updates.linguacode.dev/telemetry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'content-length': String(9000),
          'cf-connecting-ip': '203.0.113.1',
        },
        // Send the smallest body — the cap fires on the declared
        // length before the body is read.
        body: '{}',
      }),
      createEnv()
    );
    expect(response.status).toBe(413);
  });

  it('returns 413 when the read body exceeds the cap', async () => {
    // 12 KB JSON payload — well above the 8 KB cap. Build by
    // padding `properties.platform` with a long string so the JSON
    // is still parseable.
    const padding = 'x'.repeat(12 * 1024);
    const response = await postTelemetry({
      event: 'app.launched',
      properties: { platform: padding },
    });
    expect(response.status).toBe(413);
  });

  it('returns 413 when a multi-byte body exceeds the byte cap', async () => {
    const response = await postTelemetry({
      event: 'app.launched',
      properties: { platform: '😀'.repeat(3000) },
    });
    expect(response.status).toBe(413);
  });
});

describe('POST /telemetry — fold B: per-IP rate limit', () => {
  it('allows up to RATE_LIMIT_PER_SECOND requests in the same second', async () => {
    const ip = '198.51.100.1';
    const now = Math.floor(Date.now() / 1000);
    const results = await Promise.all([
      checkRateLimit({ ip, now, perSecond: 5 }),
      checkRateLimit({ ip, now, perSecond: 5 }),
      checkRateLimit({ ip, now, perSecond: 5 }),
      checkRateLimit({ ip, now, perSecond: 5 }),
      checkRateLimit({ ip, now, perSecond: 5 }),
    ]);
    // Sequential / serialised: every call returns allowed.
    expect(results.every(allowed => allowed)).toBe(true);
  });

  it('blocks the 6th request in the same second', async () => {
    const ip = '198.51.100.2';
    const now = Math.floor(Date.now() / 1000);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await checkRateLimit({ ip, now, perSecond: 5 });
    }
    const sixth = await checkRateLimit({ ip, now, perSecond: 5 });
    expect(sixth).toBe(false);
  });

  it('returns 429 on the endpoint when the IP is over the ceiling', async () => {
    const ip = '198.51.100.3';
    // Burn the budget with a small ceiling, then assert the 6th
    // POST hits 429 instead of 204.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await postTelemetry({ event: 'app.launched' }, {}, ip);
    }
    const response = await postTelemetry({ event: 'app.launched' }, {}, ip);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('1');
  });

  it('isolates rate-limit buckets per IP', async () => {
    const now = Math.floor(Date.now() / 1000);
    // IP A burns its budget.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await checkRateLimit({ ip: 'A', now, perSecond: 5 });
    }
    // IP B starts fresh.
    const otherAllowed = await checkRateLimit({ ip: 'B', now, perSecond: 5 });
    expect(otherAllowed).toBe(true);
  });
});

describe('telemetry observability log line', () => {
  it('writes a `telemetry.event` log line with the validated payload', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await postTelemetry({
      event: 'runner.executed',
      properties: { language: 'js', status: 'ok', durationBucketMs: 250 },
    });
    const eventLine = consoleSpy.mock.calls
      .map(call => String(call[0] ?? ''))
      .find(line => line.includes('"telemetry.event"'));
    expect(eventLine, 'telemetry.event log line was never written').toBeDefined();
    const parsed = JSON.parse(eventLine!);
    expect(parsed.event).toBe('telemetry.event');
    expect(parsed.eventName).toBe('runner.executed');
    expect(parsed.properties).toEqual({
      language: 'js',
      status: 'ok',
      durationBucketMs: 250,
    });
    // Privacy guard — never log any deny-substring key, even if a
    // future allowlist regression let one through. (Asserts the
    // log line directly rather than relying on the validator alone.)
    for (const deny of DENY_SUBSTRINGS) {
      expect(eventLine!.toLowerCase()).not.toContain(`"${deny}`);
    }
  });
});

describe('fold C — allowlist parity vs src/shared/telemetry.ts', () => {
  it('TELEMETRY_EVENT_NAMES matches the renderer authority verbatim', () => {
    // Same order, same length, same entries. Drift here is exactly
    // the failure mode the parity test guards.
    expect([...TELEMETRY_EVENT_NAMES]).toEqual([...RENDERER_TELEMETRY_EVENTS]);
  });

  it('every renderer event has a property allowlist on the worker side', () => {
    for (const event of RENDERER_TELEMETRY_EVENTS) {
      expect(EVENT_PROPERTY_ALLOWLIST, `missing allowlist for ${event}`).toHaveProperty(event);
    }
  });

  it('worker EVENT_PROPERTY_ALLOWLIST has no extra event keys', () => {
    const rendererSet = new Set<string>(RENDERER_TELEMETRY_EVENTS);
    for (const event of Object.keys(EVENT_PROPERTY_ALLOWLIST)) {
      expect(rendererSet.has(event), `${event} on worker but not renderer`).toBe(true);
    }
  });

  it('CAPSULE_EXPORT_TRIGGERS stays in sync with the renderer enum (RL-094 Slice 1 fold A)', async () => {
    // Closed-enum parity for the `capsule.exported.trigger` field.
    // Drift here would silently widen the surface the export
    // telemetry accepts on one side without the other.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe = /CAPSULE_EXPORT_TRIGGERS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
    expect(workerValues).toEqual([
      'palette-export',
      'result-panel-export',
      'settings-export',
    ]);
  });

  it('CAPSULE_SIZE_BUCKETS stays in sync with the renderer enum (RL-094 Slice 1 fold A)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe = /CAPSULE_SIZE_BUCKETS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
    expect(workerValues).toEqual([
      '<100kb',
      '<10kb',
      '<1mb',
      '<4mb',
      '>=4mb',
    ]);
  });

  it('CAPSULE_IMPORT_SOURCES stays in sync with the renderer enum (RL-094 Slice 2 fold D)', async () => {
    // Closed-enum parity for the `capsule.imported.sourceSurface`
    // field. Drift on either side would silently widen which import
    // surfaces telemetry accepts.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe = /CAPSULE_IMPORT_SOURCES\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
    expect(workerValues).toEqual(['drag-drop', 'file-picker', 'paste']);
  });

  it('CAPSULE_IMPORT_STATUSES stays in sync with the renderer enum (RL-094 Slice 2 fold D)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe = /CAPSULE_IMPORT_STATUSES\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
    expect(workerValues).toEqual([
      'cancelled',
      'decoded',
      'open-confirmed',
      'rejected',
    ]);
  });

  it('capsule.imported accepts closed-enum sourceSurface+status+sizeBucket, drops unknown (RL-094 Slice 2 fold D)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'capsule.imported',
      properties: {
        surface: 'paste',
        status: 'decoded',
        sizeBucket: '<10kb',
      },
    });
    expect(okResponse.status).toBe(204);
    const unknownSurface = await postTelemetry({
      event: 'capsule.imported',
      properties: {
        surface: 'webhook',
        status: 'decoded',
        sizeBucket: '<10kb',
      },
    });
    expect(unknownSurface.status).toBe(204);
    const unknownStatus = await postTelemetry({
      event: 'capsule.imported',
      properties: {
        surface: 'paste',
        status: 'success',
        sizeBucket: '<10kb',
      },
    });
    expect(unknownStatus.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"capsule.imported"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(3);
    const okLine = eventLines.find(
      (line) =>
        line.includes('"surface":"paste"') &&
        line.includes('"status":"decoded"') &&
        line.includes('"sizeBucket":"<10kb"')
    );
    expect(okLine).toBeDefined();
    const unknownSurfaceLine = eventLines.find((line) =>
      line.includes('"webhook"')
    );
    expect(unknownSurfaceLine).toBeUndefined();
    const unknownStatusLine = eventLines.find(
      (line) => line.includes('"status":"success"')
    );
    expect(unknownStatusLine).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it('capsule.exported accepts closed-enum trigger+sizeBucket, drops unknown (RL-094 Slice 1 fold A)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'capsule.exported',
      properties: { trigger: 'settings-export', sizeBucket: '<10kb' },
    });
    expect(okResponse.status).toBe(204);
    const unknownTrigger = await postTelemetry({
      event: 'capsule.exported',
      properties: { trigger: 'remote-upload', sizeBucket: '<10kb' },
    });
    expect(unknownTrigger.status).toBe(204);
    const unknownBucket = await postTelemetry({
      event: 'capsule.exported',
      properties: { trigger: 'settings-export', sizeBucket: 'gigantic' },
    });
    expect(unknownBucket.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"capsule.exported"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(3);
    const okLine = eventLines.find(
      (line) =>
        line.includes('"trigger":"settings-export"') &&
        line.includes('"sizeBucket":"<10kb"')
    );
    expect(okLine).toBeDefined();
    const unknownTriggerLine = eventLines.find((line) =>
      line.includes('"remote-upload"')
    );
    expect(unknownTriggerLine).toBeUndefined();
    const unknownBucketLine = eventLines.find((line) =>
      line.includes('"gigantic"')
    );
    expect(unknownBucketLine).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it('onboarding closed enums stay in sync with the renderer source of truth (RL-101 Slice 1)', () => {
    expect([...WORKER_ONBOARDING_TOAST_STAGES].sort()).toEqual(
      [...RENDERER_ONBOARDING_TOAST_STAGES].sort()
    );
    expect([...WORKER_ONBOARDING_DISMISS_MODES].sort()).toEqual(
      [...RENDERER_ONBOARDING_DISMISS_MODES].sort()
    );
    expect([...WORKER_ONBOARDING_LANGUAGE_IDS].sort()).toEqual(
      LANGUAGE_PACKS.map((pack) => pack.id).sort()
    );
  });

  it('onboarding telemetry accepts closed payloads and drops unknown values (RL-101 Slice 1)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const firstRunOk = await postTelemetry({
      event: 'onboarding.first_run_completed',
      properties: { language: 'javascript' },
    });
    expect(firstRunOk.status).toBe(204);
    const firstRunUnknown = await postTelemetry({
      event: 'onboarding.first_run_completed',
      properties: { language: 'brainfuck' },
    });
    expect(firstRunUnknown.status).toBe(204);
    const dismissedOk = await postTelemetry({
      event: 'onboarding.toast_dismissed',
      properties: { stage: 'first_run', dismissMode: 'cta' },
    });
    expect(dismissedOk.status).toBe(204);
    const dismissedUnknown = await postTelemetry({
      event: 'onboarding.toast_dismissed',
      properties: { stage: 'welcome', dismissMode: 'keyboard' },
    });
    expect(dismissedUnknown.status).toBe(204);
    const clobberedOk = await postTelemetry({
      event: 'onboarding.toast_clobbered',
      properties: { outstandingStage: 'first_snippet' },
    });
    expect(clobberedOk.status).toBe(204);
    const clobberedUnknown = await postTelemetry(
      {
        event: 'onboarding.toast_clobbered',
        properties: { outstandingStage: 'welcome' },
      },
      {},
      '203.0.113.2'
    );
    expect(clobberedUnknown.status).toBe(204);
    const firstSnippet = await postTelemetry(
      {
        event: 'onboarding.first_snippet_saved',
        properties: { stage: 'first_snippet' },
      },
      {},
      '203.0.113.3'
    );
    expect(firstSnippet.status).toBe(204);

    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"onboarding.'));
    expect(eventLines.length).toBeGreaterThanOrEqual(5);
    expect(
      eventLines.some((line) => line.includes('"language":"javascript"'))
    ).toBe(true);
    expect(eventLines.some((line) => line.includes('"brainfuck"'))).toBe(false);
    expect(
      eventLines.some(
        (line) =>
          line.includes('"stage":"first_run"') &&
          line.includes('"dismissMode":"cta"')
      )
    ).toBe(true);
    expect(
      eventLines.some((line) =>
        line.includes('"outstandingStage":"first_snippet"')
      )
    ).toBe(true);
    expect(eventLines.some((line) => line.includes('"welcome"'))).toBe(false);
    expect(eventLines.some((line) => line.includes('"keyboard"'))).toBe(false);
    consoleSpy.mockRestore();
  });

  it('privacy dashboard surfaces stay in sync with the renderer source of truth (RL-096 Slice 1)', () => {
    expect([...WORKER_PRIVACY_DASHBOARD_SURFACES].sort()).toEqual(
      [...RENDERER_PRIVACY_DASHBOARD_SURFACES].sort()
    );
  });

  it('output origin surfaces stay in sync with the renderer source of truth (RL-044 Sub-slice G)', () => {
    expect([...WORKER_OUTPUT_ORIGIN_SURFACES].sort()).toEqual(
      [...RENDERER_OUTPUT_ORIGIN_SURFACES].sort()
    );
  });

  it('git layer repo states stay in sync with the renderer source of truth (RL-102 Slice 1 fold D)', () => {
    // Closed-enum parity for the `git.layer_attached.repoState` field.
    // A future Slice 2 addition (e.g. `'detached-head'`, `'submodule'`)
    // must land in both copies at the same time or this guard fails
    // CI before the diff reaches main.
    expect([...WORKER_GIT_LAYER_REPO_STATES].sort()).toEqual(
      [...RENDERER_GIT_LAYER_REPO_STATES].sort()
    );
  });

  it('git reveal-in-source-control targets stay in sync (RL-102 Slice 2)', () => {
    // Closed-enum parity for `git.reveal_in_source_control_clicked.target`.
    // Single value today; any future Slice 3+ extension (e.g.
    // `'commit-hash'`, `'branch-history'`) must land in both copies
    // at the same time.
    expect([...WORKER_REVEAL_IN_SC_TARGETS].sort()).toEqual(
      [...RENDERER_REVEAL_IN_SC_TARGETS].sort()
    );
    expect([...WORKER_REVEAL_IN_SC_TARGETS]).toEqual(['repo-root']);
  });

  it('git external-modification reload modes stay in sync (RL-102 Slice 2 fold E)', () => {
    // Closed-enum parity for `git.external_modification_reload.mode`.
    // `'auto-applied'` is reserved; renderer never emits it today.
    expect([...WORKER_EXTERNAL_RELOAD_MODES].sort()).toEqual(
      [...RENDERER_EXTERNAL_RELOAD_MODES].sort()
    );
    expect([...WORKER_EXTERNAL_RELOAD_MODES].sort()).toEqual([
      'auto-applied',
      'user-accepted',
      'user-rejected',
    ]);
  });

  it('HTTP methods stay in sync (RL-097 Slice 1 fold F)', () => {
    // Closed-enum parity for `http.request_executed.method`. The
    // canonical source of truth is `HTTP_METHODS` in
    // `src/shared/httpWorkspace.ts`; both telemetry copies mirror it.
    // Adding a new method (e.g. CONNECT, TRACE) requires touching
    // BOTH copies — this guard fails CI when only one side drifts.
    expect([...WORKER_HTTP_METHODS_SET].sort()).toEqual(
      [...RENDERER_HTTP_METHODS_SET].sort()
    );
    expect([...WORKER_HTTP_METHODS_SET].sort()).toEqual([
      'DELETE',
      'GET',
      'HEAD',
      'OPTIONS',
      'PATCH',
      'POST',
      'PUT',
    ]);
  });

  it('HTTP status buckets stay in sync (RL-097 Slice 1 fold F)', () => {
    // Closed-enum parity for `http.request_executed.statusBucket`.
    // The renderer + worker copies BOTH carry the typed runtime
    // failures (`'network-error'`, `'timeout'`, `'cors-error'`)
    // alongside the standard `2xx / 3xx / 4xx / 5xx` buckets.
    expect([...WORKER_HTTP_STATUS_BUCKETS_SET].sort()).toEqual(
      [...RENDERER_HTTP_STATUS_BUCKETS_SET].sort()
    );
    expect([...WORKER_HTTP_STATUS_BUCKETS_SET].sort()).toEqual([
      '2xx',
      '3xx',
      '4xx',
      '5xx',
      'cors-error',
      'network-error',
      'timeout',
    ]);
  });

  it('HTTP redactedHeadersBucket uses the same DEPENDENCY_COUNT_BUCKETS as the renderer (RL-097 Slice 1 fold F)', () => {
    // Reviewer pass — the worker validates `redactedHeadersBucket`
    // against `DEPENDENCY_COUNT_BUCKETS` while the renderer uses
    // `DEPENDENCY_COUNT_BUCKETS_SET`. Both copies live in their
    // respective telemetry.ts files; without this guard, a future
    // bucket change on one side would silently bypass the gate on
    // the other.
    expect([...WORKER_DEPENDENCY_COUNT_BUCKETS].sort()).toEqual(
      [...RENDERER_DEPENDENCY_COUNT_BUCKETS_SET].sort()
    );
    expect([...WORKER_DEPENDENCY_COUNT_BUCKETS].sort()).toEqual([
      '0',
      '1',
      '2-5',
      '6-10',
      '>10',
    ]);
  });

  it('template project ids stay in sync with the renderer source of truth (RL-103 Slice 1 fold B)', () => {
    // Closed-enum parity for the `template_project_applied.templateId`
    // field. The renderer-side catalog
    // (`src/renderer/data/projectTemplates/index.ts`) is the design
    // source of truth; the shared mirror and the update-server mirror
    // both duplicate the literal list. Drift here means the closed
    // enum on one side accepts a value the other rejects — exactly
    // the surface the parity guard exists to prevent.
    expect([...WORKER_TEMPLATE_PROJECT_IDS].sort()).toEqual(
      [...RENDERER_TEMPLATE_PROJECT_IDS].sort()
    );
    expect([...WORKER_TEMPLATE_PROJECT_IDS].sort()).toEqual([
      'express-api-hello',
      'fastapi-hello',
      'node-cli-argparse',
      'python-data-explorer',
      'react-component-sandbox',
    ]);
  });

  it('DENY_SUBSTRINGS stays a byte-for-byte mirror of the renderer source of truth (RL-096 Slice 1 reviewer pass)', () => {
    // The worker is defense-in-depth: if the renderer redactor
    // regresses and a sneaky key reaches the wire, the worker's
    // DENY pass strips it. That guarantee fails the moment the
    // worker list is a SUBSET of the renderer list — drift
    // observed in this slice's initial pass when the renderer
    // added apikey/secret/credential/authorization/privatekey/
    // accesskey/licensekey patterns without updating the mirror.
    // Cross-import asserts byte-for-byte equality so the slot
    // CANNOT silently regress again.
    expect([...DENY_SUBSTRINGS].sort()).toEqual(
      [...RENDERER_DENY_SUBSTRINGS].sort()
    );
  });

  it('privacy dashboard telemetry accepts closed payloads and drops unknown values (RL-096 Slice 1)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const settingsOk = await postTelemetry(
      {
        event: 'privacy.dashboard_opened',
        properties: { surface: 'settings' },
      },
      {},
      '203.0.113.4'
    );
    expect(settingsOk.status).toBe(204);
    const paletteOk = await postTelemetry(
      {
        event: 'privacy.dashboard_opened',
        properties: { surface: 'palette' },
      },
      {},
      '203.0.113.5'
    );
    expect(paletteOk.status).toBe(204);
    const unknown = await postTelemetry(
      {
        event: 'privacy.dashboard_opened',
        properties: { surface: 'background_poll' },
      },
      {},
      '203.0.113.6'
    );
    expect(unknown.status).toBe(204);

    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"privacy.dashboard_opened"'));
    expect(
      eventLines.some((line) => line.includes('"surface":"settings"'))
    ).toBe(true);
    expect(
      eventLines.some((line) => line.includes('"surface":"palette"'))
    ).toBe(true);
    expect(eventLines.some((line) => line.includes('background_poll'))).toBe(
      false
    );
    consoleSpy.mockRestore();
  });

  it('output origin telemetry accepts badge surface and drops unknown values (RL-044 Sub-slice G)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry(
      {
        event: 'runtime.output_origin_clicked',
        properties: { language: 'javascript', surface: 'badge' },
      },
      {},
      '203.0.113.7'
    );
    expect(okResponse.status).toBe(204);

    const unknownResponse = await postTelemetry(
      {
        event: 'runtime.output_origin_clicked',
        properties: { language: 'javascript', surface: 'hover' },
      },
      {},
      '203.0.113.8'
    );
    expect(unknownResponse.status).toBe(204);

    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"runtime.output_origin_clicked"'));
    expect(
      eventLines.some(
        (line) =>
          line.includes('"language":"javascript"') &&
          line.includes('"surface":"badge"')
      )
    ).toBe(true);
    expect(eventLines.some((line) => line.includes('"hover"'))).toBe(false);
    consoleSpy.mockRestore();
  });

  it('RICH_MEDIA_REJECTED_KINDS stays in sync with the renderer enum (RL-044 Slice 2a)', async () => {
    // Closed-enum parity for the rich-media rejection / adoption surface.
    // Both `runtime.rich_media_payload_rejected` and the new
    // `runtime.python_rich_media_used` (RL-044 Slice 2b-β-β-α fold E)
    // validate `kind` against this set. Drift here would silently let
    // a worker-emitted unknown kind through one validator and not the
    // other.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe = /RICH_MEDIA_REJECTED_KINDS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
    expect(workerValues).toEqual(['chart', 'html', 'image']);
  });

  it('RICH_MEDIA_REJECTED_REASONS stays in sync with the renderer enum (RL-044 Slice 2a)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe = /RICH_MEDIA_REJECTED_REASONS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
    expect(workerValues).toEqual([
      'invalid-src',
      'size-limit',
      'validation-failed',
    ]);
  });

  it('AUTO_RUN_GATE_REASONS stays in sync with the renderer enum (RL-020 Slice 1)', async () => {
    // Mirror of the RUNTIME_MODE parity check: closed-enum lists for
    // `runtime.auto_run_gated` live in two places (renderer + worker)
    // and must stay aligned. A heuristic expansion that adds a new
    // reason has to amend both Sets in the same commit.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe = /const\s+AUTO_RUN_GATE_REASONS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
    // Slice 1 lock — only `'incomplete'` ships. If this assertion
    // ever loosens, the comment in `useAutoRun.ts` must be updated
    // and the renderer surface widened too.
    expect(workerValues).toEqual(['incomplete']);
  });

  it('runtime.auto_run_gated accepts incomplete, drops unknown reasons (worker validator)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Accept the closed enum.
    const okResponse = await postTelemetry({
      event: 'runtime.auto_run_gated',
      properties: { language: 'javascript', reason: 'incomplete' },
    });
    expect(okResponse.status).toBe(204);
    // Drop a future-shaped reason without surfacing a 400.
    const futureResponse = await postTelemetry({
      event: 'runtime.auto_run_gated',
      properties: { language: 'typescript', reason: 'future-shape' },
    });
    expect(futureResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"runtime.auto_run_gated"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    const future = eventLines
      .map((line) => JSON.parse(line))
      .find((parsed) => parsed.properties.language === 'typescript');
    expect(future).toBeDefined();
    expect(future.properties).not.toHaveProperty('reason');
  });

  it('WORKFLOW_MODE_VALUES stays in sync with the renderer enum (RL-020 Slice 2)', async () => {
    // Parity guard for the closed `WorkflowMode` enum used by
    // `runtime.workflow_mode_changed`. Adding a new mode (e.g. a
    // future `notebook` workflow) has to amend BOTH the worker
    // mirror in `update-server/src/telemetry.ts` and the renderer
    // copy in `src/shared/telemetry.ts` in the same commit.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe = /const\s+WORKFLOW_MODE_VALUES\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
    // Slice 2 lock — three workflow modes ship. If this loosens,
    // the renderer surface (segmented control + Settings rows)
    // must widen too.
    expect(workerValues).toEqual(['debug', 'run', 'scratchpad']);
  });

  it('WORKFLOW_MODE_CHANGE_TRIGGERS stays in sync with the renderer enum (RL-020 Slice 2)', async () => {
    // Parity guard for the `trigger` closed enum. Adding a new
    // trigger (e.g. `'command_palette'`, `'settings_default'`)
    // requires updating both mirrors AND the comment in the
    // allowlist in the same commit.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe = /const\s+WORKFLOW_MODE_CHANGE_TRIGGERS\s*=\s*new\s+Set\(\s*\[([\s\S]+?)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
    expect(workerValues).toEqual(['language_change', 'toolbar']);
  });

  it('HISTORY_REPLAY_SURFACES stays in sync with the renderer enum (RL-020 Slice 4)', async () => {
    // Parity guard for the closed `surface` enum used by
    // `runtime.history_replay`. Adding a new replay surface (e.g.
    // `'sidebar'`) requires updating BOTH the worker mirror and the
    // renderer copy in the same commit.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe = /const\s+HISTORY_REPLAY_SURFACES\s*=\s*new\s+Set\(\s*\[([\s\S]+?)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
    expect(workerValues).toEqual(['palette', 'popover', 'tab_pill']);
  });

  it('runtime.history_replay accepts the closed enum, drops unknown surface (RL-020 Slice 4)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.history_replay',
      properties: { language: 'javascript', status: 'ok', surface: 'tab_pill' },
    });
    expect(okResponse.status).toBe(204);
    const futureResponse = await postTelemetry({
      event: 'runtime.history_replay',
      properties: { language: 'python', status: 'ok', surface: 'sidebar' },
    });
    expect(futureResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"runtime.history_replay"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    const future = eventLines
      .map((line) => JSON.parse(line))
      .find((parsed) => parsed.properties.language === 'python');
    expect(future).toBeDefined();
    expect(future.properties).not.toHaveProperty('surface');
  });

  it('AUTO_LOG_COUNT_BUCKETS stays in sync with the renderer enum (RL-020 Slice 5)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe = /const\s+AUTO_LOG_COUNT_BUCKETS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
    expect(workerValues).toEqual(['1', '2-5', '20-plus', '6-20']);
  });

  it('CONSOLE_RICH_KIND_BUCKETS stays in sync with the renderer (RL-044 Slice 1B)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe =
      /export const CONSOLE_RICH_KIND_BUCKETS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
    // Lock the kind enum so any future widening must amend both Sets
    // explicitly. text / rawText are catch-all buckets — the renderer
    // renders them through the text path. `html` lands in Slice 2a.
    expect(workerValues).toEqual([
      'array',
      'chart',
      'date',
      'error',
      'html',
      'image',
      'mapSet',
      'object',
      'promise',
      'rawText',
      'table',
      'text',
    ]);
  });

  it('runtime.console_rich_rendered accepts closed-enum kind, drops unknown (RL-044 Slice 1B)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.console_rich_rendered',
      properties: { kind: 'table' },
    });
    expect(okResponse.status).toBe(204);
    const unknownResponse = await postTelemetry({
      event: 'runtime.console_rich_rendered',
      properties: { kind: 'pivot-table' },
    });
    expect(unknownResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter(
        (line) =>
          line.includes('"telemetry.event"') &&
          line.includes('"runtime.console_rich_rendered"')
      );
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    const okLine = eventLines.find((line) => line.includes('"kind":"table"'));
    expect(okLine).toBeDefined();
    // The unknown value should be dropped, so the second event line
    // never carries `"pivot-table"` in any field.
    const unknownLine = eventLines.find((line) =>
      line.includes('pivot-table')
    );
    expect(unknownLine).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it('runtime.console_table_called accepts safe-token language (RL-044 Slice 1B fold F)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.console_table_called',
      properties: { language: 'typescript' },
    });
    expect(okResponse.status).toBe(204);
    const eventLine = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .find(
        (line) =>
          line.includes('"telemetry.event"') &&
          line.includes('"runtime.console_table_called"')
      );
    expect(eventLine).toBeDefined();
    const parsed = JSON.parse(eventLine!);
    expect(parsed.properties).toEqual({ language: 'typescript' });
    consoleSpy.mockRestore();
  });

  it('runtime.cursor_pulse_emitted accepts safe-token language, drops unsafe (RL-044 Sub-slice G.1)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.cursor_pulse_emitted',
      properties: { language: 'javascript' },
    });
    expect(okResponse.status).toBe(204);
    const unsafeResponse = await postTelemetry({
      event: 'runtime.cursor_pulse_emitted',
      properties: { language: '/etc/passwd' },
    });
    expect(unsafeResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"runtime.cursor_pulse_emitted"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    const okLine = eventLines.find((line) =>
      line.includes('"language":"javascript"')
    );
    expect(okLine).toBeDefined();
    const unsafeLine = eventLines.find((line) => line.includes('/etc/passwd'));
    expect(unsafeLine).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it('RUBY_DISPATCHED_MODE_VALUES + RUBY_SPAWN_BUCKETS stay in sync with the renderer (RL-042 Slice 6)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const modeRe =
      /export const RUBY_DISPATCHED_MODE_VALUES\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const spawnRe =
      /export const RUBY_SPAWN_BUCKETS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const prefRe =
      /export const RUBY_RUNTIME_PREFERENCE_VALUES\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    for (const [label, re] of [
      ['mode', modeRe],
      ['spawn', spawnRe],
      ['preference', prefRe],
    ] as const) {
      const workerMatch = workerSource.match(re);
      const sharedMatch = sharedSource.match(re);
      expect(workerMatch, `worker ${label}`).not.toBeNull();
      expect(sharedMatch, `shared ${label}`).not.toBeNull();
      const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
        .map((match) => match[1]!)
        .sort();
      const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
        .map((match) => match[1]!)
        .sort();
      expect(workerValues, `${label} parity`).toEqual(sharedValues);
    }
  });

  it('runtime.ruby_runner_dispatched accepts closed-enum mode + bucket, drops unknown (RL-042 Slice 6)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.ruby_runner_dispatched',
      properties: { mode: 'system', bucketedSpawnMs: '<300ms' },
    });
    expect(okResponse.status).toBe(204);
    const unknownResponse = await postTelemetry({
      event: 'runtime.ruby_runner_dispatched',
      properties: { mode: 'jruby', bucketedSpawnMs: '15m' },
    });
    expect(unknownResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter(
        (line) =>
          line.includes('"telemetry.event"') &&
          line.includes('"runtime.ruby_runner_dispatched"')
      );
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    const okLine = eventLines.find((line) =>
      line.includes('"mode":"system"')
    );
    expect(okLine).toBeDefined();
    const unknownLine = eventLines.find((line) => line.includes('"jruby"'));
    expect(unknownLine).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it('runtime.python_console_payload_emitted accepts closed-enum kind, drops unknown (RL-044 Slice 1C fold B)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.python_console_payload_emitted',
      properties: { kind: 'object' },
    });
    expect(okResponse.status).toBe(204);
    const unknownResponse = await postTelemetry({
      event: 'runtime.python_console_payload_emitted',
      properties: { kind: 'dataframe' },
    });
    expect(unknownResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter(
        (line) =>
          line.includes('"telemetry.event"') &&
          line.includes('"runtime.python_console_payload_emitted"')
      );
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    const okLine = eventLines.find((line) => line.includes('"kind":"object"'));
    expect(okLine).toBeDefined();
    const unknownLine = eventLines.find((line) => line.includes('dataframe'));
    expect(unknownLine).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it('runtime.console_rich_rendered accepts the html bucket (RL-044 Slice 2a)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.console_rich_rendered',
      properties: { kind: 'html' },
    });
    expect(okResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"runtime.console_rich_rendered"'));
    const okLine = eventLines.find((line) => line.includes('"kind":"html"'));
    expect(okLine).toBeDefined();
    consoleSpy.mockRestore();
  });

  it('runtime.error_stack_frame_clicked accepts closed-enum language, drops unsafe (RL-044 Slice 2a)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.error_stack_frame_clicked',
      properties: { language: 'javascript' },
    });
    expect(okResponse.status).toBe(204);
    const unsafeResponse = await postTelemetry({
      event: 'runtime.error_stack_frame_clicked',
      properties: { language: '/etc/passwd' },
    });
    expect(unsafeResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"runtime.error_stack_frame_clicked"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    const okLine = eventLines.find((line) =>
      line.includes('"language":"javascript"')
    );
    expect(okLine).toBeDefined();
    const unsafeLine = eventLines.find((line) =>
      line.includes('/etc/passwd')
    );
    expect(unsafeLine).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it('runtime.rich_media_payload_rejected accepts closed-enum kind+reason, drops unknown (RL-044 Slice 2a)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.rich_media_payload_rejected',
      properties: { kind: 'image', reason: 'invalid-src' },
    });
    expect(okResponse.status).toBe(204);
    const unknownKind = await postTelemetry({
      event: 'runtime.rich_media_payload_rejected',
      properties: { kind: 'video', reason: 'invalid-src' },
    });
    expect(unknownKind.status).toBe(204);
    const unknownReason = await postTelemetry({
      event: 'runtime.rich_media_payload_rejected',
      properties: { kind: 'html', reason: 'too-spicy' },
    });
    expect(unknownReason.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"runtime.rich_media_payload_rejected"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(3);
    const okLine = eventLines.find(
      (line) =>
        line.includes('"kind":"image"') && line.includes('"reason":"invalid-src"')
    );
    expect(okLine).toBeDefined();
    const videoLine = eventLines.find((line) => line.includes('"video"'));
    expect(videoLine).toBeUndefined();
    const spicyLine = eventLines.find((line) => line.includes('too-spicy'));
    expect(spicyLine).toBeUndefined();

    // RL-044 Slice 2b-α — chart added to RICH_MEDIA_REJECTED_KINDS.
    const chartResponse = await postTelemetry({
      event: 'runtime.rich_media_payload_rejected',
      properties: { kind: 'chart', reason: 'validation-failed' },
    });
    expect(chartResponse.status).toBe(204);
    const chartLine = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .find(
        (line) =>
          line.includes('"runtime.rich_media_payload_rejected"') &&
          line.includes('"kind":"chart"')
      );
    expect(chartLine).toBeDefined();
    consoleSpy.mockRestore();
  });

  it('runtime.python_rich_media_used accepts closed-enum kind, drops unknown (RL-044 Slice 2b-β-β-α fold E)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const kind of ['chart', 'image', 'html'] as const) {
      const okResponse = await postTelemetry({
        event: 'runtime.python_rich_media_used',
        properties: { kind },
      });
      expect(okResponse.status).toBe(204);
    }
    const unknownResponse = await postTelemetry({
      event: 'runtime.python_rich_media_used',
      properties: { kind: 'video' },
    });
    expect(unknownResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"runtime.python_rich_media_used"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(4);
    const okLine = eventLines.find((line) => line.includes('"kind":"chart"'));
    expect(okLine).toBeDefined();
    const videoLine = eventLines.find((line) => line.includes('"video"'));
    expect(videoLine).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it('runtime.auto_log_enabled accepts boolean enabled, drops non-boolean (RL-020 Slice 5)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.auto_log_enabled',
      properties: { language: 'javascript', enabled: true },
    });
    expect(okResponse.status).toBe(204);
    const futureResponse = await postTelemetry({
      event: 'runtime.auto_log_enabled',
      properties: { language: 'typescript', enabled: 'yes' },
    });
    expect(futureResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"runtime.auto_log_enabled"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    const future = eventLines
      .map((line) => JSON.parse(line))
      .find((parsed) => parsed.properties.language === 'typescript');
    expect(future).toBeDefined();
    expect(future.properties).not.toHaveProperty('enabled');
  });

  it('runtime.auto_log_emitted accepts the closed bucket enum, drops unknown values (RL-020 Slice 5)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.auto_log_emitted',
      properties: { language: 'javascript', countBucket: '2-5' },
    });
    expect(okResponse.status).toBe(204);
    const futureResponse = await postTelemetry({
      event: 'runtime.auto_log_emitted',
      properties: { language: 'typescript', countBucket: 'too-many' },
    });
    expect(futureResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"runtime.auto_log_emitted"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    const future = eventLines
      .map((line) => JSON.parse(line))
      .find((parsed) => parsed.properties.language === 'typescript');
    expect(future).toBeDefined();
    expect(future.properties).not.toHaveProperty('countBucket');
  });

  it('runtime.stdin_used accepts the closed payload, drops unknown keys (RL-020 Slice 6)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.stdin_used',
      properties: { language: 'python' },
    });
    expect(okResponse.status).toBe(204);
    // Future / drift payload: an extra `linesRead` integer would be
    // a privacy regression. Validator drops it silently with 204.
    const futureResponse = await postTelemetry({
      event: 'runtime.stdin_used',
      properties: { language: 'javascript', linesRead: 7 },
    });
    expect(futureResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"runtime.stdin_used"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    const future = eventLines
      .map((line) => JSON.parse(line))
      .find((parsed) => parsed.properties.language === 'javascript');
    expect(future).toBeDefined();
    expect(future.properties).not.toHaveProperty('linesRead');
  });

  it('runtime.magic_comment_emitted accepts boolean flags, drops non-boolean (RL-020 Slice 3)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.magic_comment_emitted',
      properties: { language: 'javascript', hasArrow: true, hasWatch: true },
    });
    expect(okResponse.status).toBe(204);
    const futureResponse = await postTelemetry({
      event: 'runtime.magic_comment_emitted',
      properties: { language: 'python', hasArrow: 'yes', hasWatch: 1 },
    });
    expect(futureResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"runtime.magic_comment_emitted"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    const future = eventLines
      .map((line) => JSON.parse(line))
      .find((parsed) => parsed.properties.language === 'python');
    expect(future).toBeDefined();
    expect(future.properties).not.toHaveProperty('hasArrow');
    expect(future.properties).not.toHaveProperty('hasWatch');
  });

  it('runtime.workflow_mode_changed accepts the closed enum, drops unknown trigger values', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.workflow_mode_changed',
      properties: {
        language: 'javascript',
        from: 'scratchpad',
        to: 'debug',
        trigger: 'toolbar',
      },
    });
    expect(okResponse.status).toBe(204);
    // Drop a future-shaped source without surfacing a 400.
    const futureResponse = await postTelemetry({
      event: 'runtime.workflow_mode_changed',
      properties: {
        language: 'typescript',
        from: 'scratchpad',
        to: 'run',
        trigger: 'spyware',
      },
    });
    expect(futureResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"runtime.workflow_mode_changed"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    const future = eventLines
      .map((line) => JSON.parse(line))
      .find((parsed) => parsed.properties.language === 'typescript');
    expect(future).toBeDefined();
    expect(future.properties).not.toHaveProperty('trigger');
  });

  it('RUNNER_STATUS_VALUES stays in sync with the renderer enum (RL-020 Slice 7)', async () => {
    // Slice 7 widened the renderer status enum from {ok, error} to
    // {ok, error, timeout, stopped}. The worker mirror must keep
    // pace so the dashboard distinguishes operator-stop from
    // organic timeout from real errors.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe =
      /const\s+RUNNER_STATUS_VALUES\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
    expect(workerValues).toEqual(['error', 'ok', 'stopped', 'timeout']);
  });

  it('RUNTIME_TIMEOUT_PRESET_VALUES stays in sync with the renderer (RL-020 Slice 7)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe =
      /const\s+RUNTIME_TIMEOUT_PRESET_VALUES\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
    expect(workerValues).toEqual(['extended', 'long', 'normal', 'quick']);
  });

  it('runtime.timeout_preset_changed accepts the closed payload (worker validator)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.timeout_preset_changed',
      properties: { language: 'python', preset: 'long' },
    });
    expect(okResponse.status).toBe(204);
    // Tampered preset is silently dropped (no 400).
    const droppedResponse = await postTelemetry({
      event: 'runtime.timeout_preset_changed',
      properties: { language: 'python', preset: 'pizza' },
    });
    expect(droppedResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"runtime.timeout_preset_changed"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    const dropped = eventLines
      .map((line) => JSON.parse(line))
      .find((parsed) => parsed.properties.preset === undefined);
    expect(dropped).toBeDefined();
  });

  it('RUNTIME_MODE_VALUES stays in sync with the renderer enum (RL-019 Slice 1)', async () => {
    // Both the worker (`update-server/src/telemetry.ts`) and the
    // renderer (`src/shared/telemetry.ts`) maintain a private Set of
    // the closed `RuntimeMode` values for the `runtime.mode_changed`
    // event. The Set is duplicated by design (no import cycle); this
    // parity test guards against drift so a Slice 2 addition of
    // `'node'` lights up both sides together.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    // update-server vitest runs from `update-server/` cwd; the
    // shared telemetry module sits two levels up at the repo root.
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe = /const\s+RUNTIME_MODE_VALUES\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
  });

  it('FS_DIRECTORY_PICKER_UA_BUCKETS stays in sync between worker and renderer (RL-024 Slice 1)', async () => {
    // Mirror discipline for the new browser bucket enum behind
    // `runtime.fs_directory_picker_unsupported`. Adding `'chromium-old'`
    // (for example) without updating the renderer would let the worker
    // silently accept events the renderer never produces.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(process.cwd(), '..', 'src/shared/telemetry.ts');
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    const literalRe =
      /export const FS_DIRECTORY_PICKER_UA_BUCKETS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const workerMatch = workerSource.match(literalRe);
    const sharedMatch = sharedSource.match(literalRe);
    expect(workerMatch).not.toBeNull();
    expect(sharedMatch).not.toBeNull();
    const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    expect(workerValues).toEqual(sharedValues);
  });

  it('runtime.fs_directory_picker_unsupported accepts closed-enum bucket, drops unknown (RL-024 Slice 1)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'runtime.fs_directory_picker_unsupported',
      properties: { userAgentBucket: 'safari' },
    });
    expect(okResponse.status).toBe(204);
    const unknownResponse = await postTelemetry({
      event: 'runtime.fs_directory_picker_unsupported',
      properties: { userAgentBucket: 'netscape' },
    });
    expect(unknownResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) =>
        line.includes('"runtime.fs_directory_picker_unsupported"')
      );
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    const okLine = eventLines.find((line) =>
      line.includes('"userAgentBucket":"safari"')
    );
    expect(okLine).toBeDefined();
    const unknownLine = eventLines.find((line) =>
      line.includes('"netscape"')
    );
    expect(unknownLine).toBeUndefined();
    consoleSpy.mockRestore();
  });
});

describe('RL-025 Slice B — dependency install lifecycle events', () => {
  it('DEPENDENCY_INSTALL_OUTCOMES + DEPENDENCY_INSTALL_FAILURE_REASONS stay in sync with the renderer', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workerPath = path.resolve(process.cwd(), 'src/telemetry.ts');
    const sharedPath = path.resolve(
      process.cwd(),
      '..',
      'src/shared/dependencies/types.ts'
    );
    const workerSource = await fs.readFile(workerPath, 'utf-8');
    const sharedSource = await fs.readFile(sharedPath, 'utf-8');
    // Worker copies live as `new Set([...])`; shared source uses a
    // `const ... = [...] as const` tuple. Both regexes extract the
    // single-quoted entries between brackets.
    const outcomesWorkerRe =
      /DEPENDENCY_INSTALL_OUTCOMES\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const outcomesSharedRe =
      /DEPENDENCY_INSTALL_OUTCOMES\s*=\s*\[([^\]]+)\]\s*as\s+const/u;
    const reasonsWorkerRe =
      /DEPENDENCY_INSTALL_FAILURE_REASONS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u;
    const reasonsSharedRe =
      /DEPENDENCY_INSTALL_FAILURE_REASONS\s*=\s*\[([^\]]+)\]\s*as\s+const/u;
    for (const [label, workerRe, sharedRe] of [
      ['outcomes', outcomesWorkerRe, outcomesSharedRe],
      ['reasons', reasonsWorkerRe, reasonsSharedRe],
    ] as const) {
      const workerMatch = workerSource.match(workerRe);
      const sharedMatch = sharedSource.match(sharedRe);
      expect(workerMatch, `worker ${label}`).not.toBeNull();
      expect(sharedMatch, `shared ${label}`).not.toBeNull();
      const workerValues = [...(workerMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
        .map((match) => match[1]!)
        .sort();
      const sharedValues = [...(sharedMatch![1] ?? '').matchAll(/'([^']+)'/gu)]
        .map((match) => match[1]!)
        .sort();
      expect(workerValues, `${label} parity`).toEqual(sharedValues);
    }
  });

  it('dependency.install_started accepts closed-enum countBucket, drops unknown', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'dependency.install_started',
      properties: { language: 'javascript', countBucket: '2-5' },
    });
    expect(okResponse.status).toBe(204);
    const unknownResponse = await postTelemetry({
      event: 'dependency.install_started',
      properties: { language: 'javascript', countBucket: 'lots' },
    });
    expect(unknownResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"dependency.install_started"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    expect(
      eventLines.find((line) => line.includes('"countBucket":"2-5"'))
    ).toBeDefined();
    expect(eventLines.find((line) => line.includes('"lots"'))).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it('dependency.install_completed accepts closed-enum outcome, drops unknown', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'dependency.install_completed',
      properties: { language: 'typescript', outcome: 'partial' },
    });
    expect(okResponse.status).toBe(204);
    const unknownResponse = await postTelemetry({
      event: 'dependency.install_completed',
      properties: { language: 'typescript', outcome: 'whoknows' },
    });
    expect(unknownResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"dependency.install_completed"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    expect(
      eventLines.find((line) => line.includes('"outcome":"partial"'))
    ).toBeDefined();
    expect(
      eventLines.find((line) => line.includes('"whoknows"'))
    ).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it('dependency.install_failed_reason accepts closed-enum reason, drops unknown', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'dependency.install_failed_reason',
      properties: { language: 'javascript', reason: 'exit-nonzero' },
    });
    expect(okResponse.status).toBe(204);
    const unknownResponse = await postTelemetry({
      event: 'dependency.install_failed_reason',
      properties: { language: 'javascript', reason: 'gremlins' },
    });
    expect(unknownResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"dependency.install_failed_reason"'));
    expect(eventLines.length).toBeGreaterThanOrEqual(2);
    expect(
      eventLines.find((line) => line.includes('"reason":"exit-nonzero"'))
    ).toBeDefined();
    expect(
      eventLines.find((line) => line.includes('"gremlins"'))
    ).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it('dependency.install_failed_reason accepts the unsupported-wheel reason (RL-025 Slice C)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const okResponse = await postTelemetry({
      event: 'dependency.install_failed_reason',
      properties: { language: 'python', reason: 'unsupported-wheel' },
    });
    expect(okResponse.status).toBe(204);
    const eventLines = consoleSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((line) => line.includes('"dependency.install_failed_reason"'));
    const line = eventLines.find((entry) =>
      entry.includes('"reason":"unsupported-wheel"')
    );
    expect(line).toBeDefined();
    // Reviewer fix — parse the structured log line and assert both
    // `language` and `reason` round-trip through the redactor, not
    // just that the substring `"reason":"unsupported-wheel"` is
    // present. A future regression that silently strips the
    // `language` property would slip past a substring check.
    expect(JSON.parse(line!)).toMatchObject({
      event: 'telemetry.event',
      eventName: 'dependency.install_failed_reason',
      properties: {
        language: 'python',
        reason: 'unsupported-wheel',
      },
    });
    consoleSpy.mockRestore();
  });
});

describe('ipBucket — privacy guard', () => {
  it('truncates the last IPv4 octet', () => {
    expect(ipBucket('203.0.113.42')).toBe('203.0.113.*');
  });

  it('truncates IPv6 to the first three hextets', () => {
    expect(ipBucket('2001:db8:abcd:0012:0:0:0:1')).toBe('2001:db8:abcd::*');
  });

  it('returns `unknown` for malformed input', () => {
    expect(ipBucket('garbage')).toBe('unknown');
    expect(ipBucket('')).toBe('unknown');
    expect(ipBucket('unknown')).toBe('unknown');
  });
});
