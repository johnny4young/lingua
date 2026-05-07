import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyError,
  classifyResponseStatus,
  log,
  redact,
  routeNameFromPath,
  wrapRequestObservability,
} from '../src/lib/observability';

describe('redact (update-server)', () => {
  it('redacts sensitive top-level fields', () => {
    expect(redact({ githubToken: 'ghp_xxx', repo: 'owner/repo' })).toEqual({
      githubToken: '[redacted]',
      repo: 'owner/repo',
    });
  });

  it('matches sensitive keys case-insensitively', () => {
    expect(redact({ Authorization: 'Bearer ghp_xxx' })).toEqual({
      Authorization: '[redacted]',
    });
  });

  it('walks nested objects + arrays up to depth 4', () => {
    expect(
      redact({
        request: { headers: { authorization: 'Bearer xxx' } },
        assets: [{ apiKey: 'k1' }, { apiKey: 'k2' }],
      })
    ).toEqual({
      request: { headers: { authorization: '[redacted]' } },
      assets: [{ apiKey: '[redacted]' }, { apiKey: '[redacted]' }],
    });
  });

  it('truncates beyond depth cap so cyclic objects do not blow the stack', () => {
    interface DeepRecord {
      level: number;
      nested?: DeepRecord;
    }
    const deep: DeepRecord = { level: 0 };
    let cursor: DeepRecord = deep;
    for (let depth = 1; depth < 8; depth += 1) {
      const next: DeepRecord = { level: depth };
      cursor.nested = next;
      cursor = next;
    }
    const redacted = redact(deep) as { nested?: unknown };
    let walker: unknown = redacted;
    for (let depth = 0; depth < 4; depth += 1) {
      walker = (walker as { nested?: unknown }).nested;
    }
    expect(walker).toBe('[truncated-object]');
  });
});

describe('classifyError (update-server)', () => {
  it('tags fetch failures as upstream', () => {
    expect(classifyError(new TypeError('fetch failed'))).toBe('upstream');
  });

  it('tags github 5xx-style messages as upstream', () => {
    expect(classifyError(new Error('github 502 bad gateway'))).toBe('upstream');
    expect(classifyError(new Error('github timeout'))).toBe('upstream');
  });

  it('tags missing/invalid messages as client', () => {
    expect(classifyError(new Error('missing version'))).toBe('client');
    expect(classifyError(new Error('invalid platform'))).toBe('client');
  });

  it('defaults unknown errors to server', () => {
    expect(classifyError(new Error('something exploded'))).toBe('server');
  });
});

describe('classifyResponseStatus (update-server)', () => {
  it('does not tag successful responses', () => {
    expect(classifyResponseStatus(200, 'update.feed')).toBeUndefined();
    expect(classifyResponseStatus(304, 'update.feed')).toBeUndefined();
  });

  it('tags handled 4xx responses as client errors', () => {
    expect(classifyResponseStatus(404, 'update.asset_proxy')).toBe('client');
    expect(classifyResponseStatus(405, 'update.web_version')).toBe('client');
  });

  it('tags returned GitHub proxy failures as upstream errors', () => {
    expect(classifyResponseStatus(502, 'update.feed')).toBe('upstream');
    expect(classifyResponseStatus(502, 'update.asset_proxy')).toBe('upstream');
    expect(classifyResponseStatus(502, 'update.web_version')).toBe('upstream');
  });

  it('defaults handled non-upstream 5xx responses to server errors', () => {
    expect(classifyResponseStatus(500, 'unknown')).toBe('server');
  });
});

describe('routeNameFromPath (update-server)', () => {
  it('collapses path parameters to stable labels', () => {
    expect(routeNameFromPath('/')).toBe('health.live');
    expect(routeNameFromPath('/health')).toBe('health.live');
    expect(routeNameFromPath('/health/ready')).toBe('health.ready');
    expect(routeNameFromPath('/web/version')).toBe('update.web_version');
    expect(routeNameFromPath('/update/darwin/0.2.0')).toBe('update.feed');
    expect(routeNameFromPath('/update/win32/0.1.5')).toBe('update.feed');
    expect(routeNameFromPath('/download/12345')).toBe('update.asset_proxy');
    expect(routeNameFromPath('/download/12345/Lingua-0.2.5-full.nupkg')).toBe('update.asset_proxy');
    expect(routeNameFromPath('/something-else')).toBe('unknown');
  });
});

describe('log (update-server)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('emits a structured JSON line with redacted payload', () => {
    log('test.event', { githubToken: 'ghp_xxx', repo: 'owner/repo' });
    const line = JSON.parse((infoSpy.mock.calls[0]?.[0] as string) ?? '{}');
    expect(line.event).toBe('test.event');
    expect(line.githubToken).toBe('[redacted]');
    expect(line.repo).toBe('owner/repo');
    expect(typeof line.timestamp).toBe('string');
  });
});

describe('wrapRequestObservability (update-server)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('emits request.received and request.completed on the happy path', async () => {
    const request = new Request('https://updates.linguacode.dev/web/version');
    const response = await wrapRequestObservability(
      request,
      async () => new Response('{"version":"0.1.0"}', { status: 200 })
    );
    expect(response.status).toBe(200);
    expect(infoSpy.mock.calls).toHaveLength(2);
    const received = JSON.parse((infoSpy.mock.calls[0]?.[0] as string) ?? '{}');
    expect(received.event).toBe('request.received');
    expect(received.route).toBe('update.web_version');
    const completed = JSON.parse((infoSpy.mock.calls[1]?.[0] as string) ?? '{}');
    expect(completed.event).toBe('request.completed');
    expect(completed.status).toBe(200);
    expect(completed.route).toBe('update.web_version');
    expect(typeof completed.durationMs).toBe('number');
  });

  it('emits request.completed with errorClass and re-throws on failure', async () => {
    const request = new Request('https://updates.linguacode.dev/update/darwin/0.1.0');
    const failure = new TypeError('fetch failed');

    await expect(
      wrapRequestObservability(request, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);

    const completed = JSON.parse((infoSpy.mock.calls[1]?.[0] as string) ?? '{}');
    expect(completed.errorClass).toBe('upstream');
    expect(completed.status).toBe(500);
    expect(completed.errorMessage).toBe('fetch failed');
  });

  it('emits upstream errorClass when the handler returns a GitHub failure response', async () => {
    const request = new Request('https://updates.linguacode.dev/update/darwin/0.1.0');
    const response = await wrapRequestObservability(
      request,
      async () => new Response('Bad gateway', { status: 502 })
    );

    expect(response.status).toBe(502);
    const completed = JSON.parse((infoSpy.mock.calls[1]?.[0] as string) ?? '{}');
    expect(completed.event).toBe('request.completed');
    expect(completed.route).toBe('update.feed');
    expect(completed.status).toBe(502);
    expect(completed.errorClass).toBe('upstream');
    expect(completed.errorMessage).toBeUndefined();
  });
});
