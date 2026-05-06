import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyError,
  classifyResponseStatus,
  log,
  redact,
  withRequestObservability,
} from '../src/lib/observability';

describe('redact', () => {
  it('replaces sensitive top-level keys with the literal redacted marker', () => {
    expect(redact({ token: 'abc', userId: 'u1' })).toEqual({
      token: '[redacted]',
      userId: 'u1',
    });
  });

  it('matches sensitive keys case-insensitively', () => {
    expect(redact({ Authorization: 'Bearer abc', apiKEY: 'k1' })).toEqual({
      Authorization: '[redacted]',
      apiKEY: '[redacted]',
    });
  });

  it('walks nested objects up to depth 4 and redacts inside', () => {
    expect(
      redact({
        user: { token: 'abc', email: 'u@local' },
        keys: [{ jwk: 'k1' }, { jwk: 'k2', other: 'ok' }],
      }),
    ).toEqual({
      user: { token: '[redacted]', email: 'u@local' },
      keys: [
        { jwk: '[redacted]' },
        { jwk: '[redacted]', other: 'ok' },
      ],
    });
  });

  it('truncates beyond the depth cap so cyclic objects do not blow the stack', () => {
    interface DeepRecord {
      level: number;
      nested?: DeepRecord;
    }
    const deep: DeepRecord = { level: 0 };
    let cursor: DeepRecord = deep;
    for (let depth = 1; depth < 10; depth += 1) {
      const next: DeepRecord = { level: depth };
      cursor.nested = next;
      cursor = next;
    }
    const redacted = redact(deep) as { level: number; nested?: unknown };
    let walker: unknown = redacted;
    for (let depth = 0; depth < 4; depth += 1) {
      expect(typeof walker).toBe('object');
      walker = (walker as { nested?: unknown }).nested;
    }
    expect(walker).toBe('[truncated-object]');
  });

  it('passes primitives through unchanged', () => {
    expect(redact('plain')).toBe('plain');
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it('redacts inside arrays of objects', () => {
    expect(redact([{ token: 'a' }, { token: 'b' }, { other: 'c' }])).toEqual([
      { token: '[redacted]' },
      { token: '[redacted]' },
      { other: 'c' },
    ]);
  });

  it('redacts polar webhook signature headers', () => {
    expect(
      redact({
        eventType: 'subscription.created',
        polarSignature: 'sha256=...',
        customerId: 'c_123',
      }),
    ).toEqual({
      eventType: 'subscription.created',
      polarSignature: '[redacted]',
      customerId: 'c_123',
    });
  });

  it('redacts email body fields while preserving subject + recipient', () => {
    expect(
      redact({
        to: 'buyer@example.com',
        subject: 'Your Lingua license',
        htmlBody: '<p>Token: abc</p>',
        textBody: 'Token: abc',
      }),
    ).toEqual({
      to: 'buyer@example.com',
      subject: 'Your Lingua license',
      htmlBody: '[redacted]',
      textBody: '[redacted]',
    });
  });
});

describe('classifyError', () => {
  it('tags Hono HTTPException as client', () => {
    const err = new Error('Bad request');
    err.name = 'HTTPException';
    expect(classifyError(err)).toBe('client');
  });

  it('tags Zod validation errors as client', () => {
    const err = new Error('parse failed');
    err.name = 'ZodError';
    expect(classifyError(err)).toBe('client');
  });

  it('treats explicit invalid/missing/unauthorized messages as client', () => {
    expect(classifyError(new Error('missing token'))).toBe('client');
    expect(classifyError(new Error('invalid signature'))).toBe('client');
    expect(classifyError(new Error('unauthorized request'))).toBe('client');
  });

  it('tags D1 / KV errors as storage', () => {
    expect(classifyError(new Error('D1_TYPE_ERROR: bad bind'))).toBe('storage');
    expect(classifyError(new Error('KV_GET_MISSING'))).toBe('storage');
    const d1Error = new Error('write failed');
    d1Error.name = 'D1Error';
    expect(classifyError(d1Error)).toBe('storage');
  });

  it('tags fetch + network failures as upstream', () => {
    const err = new TypeError('fetch failed');
    expect(classifyError(err)).toBe('upstream');
  });

  it('tags polar/resend/github 5xx-style messages as upstream', () => {
    expect(classifyError(new Error('polar returned 503 unreachable'))).toBe('upstream');
    expect(classifyError(new Error('resend timeout'))).toBe('upstream');
    expect(classifyError(new Error('github 502 bad gateway'))).toBe('upstream');
  });

  it('defaults unknown errors to server', () => {
    expect(classifyError(new Error('something exploded'))).toBe('server');
    expect(classifyError(null)).toBe('server');
    expect(classifyError({ kind: 'odd' })).toBe('server');
  });
});

describe('classifyResponseStatus', () => {
  it('does not tag successful responses', () => {
    expect(classifyResponseStatus(200)).toBeUndefined();
    expect(classifyResponseStatus(302)).toBeUndefined();
  });

  it('tags handled 4xx responses as client errors', () => {
    expect(classifyResponseStatus(400)).toBe('client');
    expect(classifyResponseStatus(401)).toBe('client');
    expect(classifyResponseStatus(429)).toBe('client');
  });

  it('tags handled 5xx responses as server errors', () => {
    expect(classifyResponseStatus(500)).toBe('server');
    expect(classifyResponseStatus(501)).toBe('server');
  });
});

describe('log', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('emits a single JSON line per call with event + timestamp + redacted payload', () => {
    log('test.event', { token: 'abc', customerId: 'c_1' });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const line = infoSpy.mock.calls[0]?.[0];
    expect(typeof line).toBe('string');
    const parsed = JSON.parse(line as string) as Record<string, unknown>;
    expect(parsed.event).toBe('test.event');
    expect(typeof parsed.timestamp).toBe('string');
    expect(parsed.token).toBe('[redacted]');
    expect(parsed.customerId).toBe('c_1');
  });

  it('produces an ISO-8601 timestamp', () => {
    log('test.event');
    const line = JSON.parse((infoSpy.mock.calls[0]?.[0] as string) ?? '{}');
    expect(line.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('withRequestObservability', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  function buildContext(method: string, path: string): import('hono').Context {
    return {
      req: { method, path },
    } as unknown as import('hono').Context;
  }

  it('emits request.received then request.completed on the happy path', async () => {
    const c = buildContext('GET', '/licenses/status');
    const handler = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    const response = await withRequestObservability(c, 'licenses.status', handler);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(infoSpy.mock.calls).toHaveLength(2);
    const received = JSON.parse((infoSpy.mock.calls[0]?.[0] as string) ?? '{}');
    expect(received.event).toBe('request.received');
    expect(received.route).toBe('licenses.status');
    const completed = JSON.parse((infoSpy.mock.calls[1]?.[0] as string) ?? '{}');
    expect(completed.event).toBe('request.completed');
    expect(completed.status).toBe(200);
    expect(typeof completed.durationMs).toBe('number');
    expect(completed.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('emits request.completed with errorClass and re-throws on failure', async () => {
    const c = buildContext('POST', '/licenses/activate');
    const failure = new Error('D1_TYPE_ERROR: bad bind');
    const handler = vi.fn().mockRejectedValue(failure);

    await expect(
      withRequestObservability(c, 'licenses.activate', handler),
    ).rejects.toBe(failure);

    expect(infoSpy.mock.calls).toHaveLength(2);
    const completed = JSON.parse((infoSpy.mock.calls[1]?.[0] as string) ?? '{}');
    expect(completed.event).toBe('request.completed');
    expect(completed.status).toBe(500);
    expect(completed.errorClass).toBe('storage');
    expect(completed.errorMessage).toBe('D1_TYPE_ERROR: bad bind');
  });

  it('emits errorClass when the handler returns a handled error response', async () => {
    const c = buildContext('GET', '/licenses/status');
    const handler = vi.fn().mockResolvedValue(new Response('bad token', { status: 400 }));

    const response = await withRequestObservability(c, 'licenses.status', handler);

    expect(response.status).toBe(400);
    const completed = JSON.parse((infoSpy.mock.calls[1]?.[0] as string) ?? '{}');
    expect(completed.event).toBe('request.completed');
    expect(completed.status).toBe(400);
    expect(completed.errorClass).toBe('client');
    expect(completed.errorMessage).toBeUndefined();
  });

  it('records the route name handed in (not the raw path) so dashboards stay legible', async () => {
    const c = buildContext('GET', '/licenses/status?token=abc');
    const handler = vi.fn().mockResolvedValue(new Response('ok'));

    await withRequestObservability(c, 'licenses.status', handler);

    const received = JSON.parse((infoSpy.mock.calls[0]?.[0] as string) ?? '{}');
    expect(received.route).toBe('licenses.status');
    expect(received.path).toBe('/licenses/status?token=abc');
  });
});
