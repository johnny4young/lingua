import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { executeHttpProxyRequest } from '../../src/main/httpProxy';
import {
  MAX_STREAM_MESSAGES,
  createBlankHttpRequest,
} from '../../src/shared/httpWorkspaceSchema';

let server: Server | null = null;

afterEach(async () => {
  if (!server) return;
  const closing = server;
  server = null;
  await new Promise<void>((resolve) => closing.close(() => resolve()));
});

describe('desktop SSE proxy', () => {
  it('uses the guarded production dispatcher and emits bounded live progress', async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('event: ready\ndata: one\n\n');
      response.end('data: two\n\n');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing port');
    const progress: string[] = [];
    const response = await executeHttpProxyRequest(
      {
        ...createBlankHttpRequest({ id: 'sse-1' }),
        transport: 'sse',
        url: `http://127.0.0.1:${address.port}/events`,
      },
      {
        allowPrivateHosts: true,
        onProgress: (next) => progress.push(next.body),
      }
    );

    expect(response).toMatchObject({
      kind: 'success',
      status: 200,
      transport: 'sse',
      messageCount: 2,
    });
    expect(response.body).toContain('data: one');
    expect(response.body).toContain('data: two');
    expect(progress.at(-1)).toBe(response.body);
  });

  it('stops an SSE response at the message cap', async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        Array.from(
          { length: MAX_STREAM_MESSAGES + 1 },
          (_, index) => `data: ${index}\n\n`
        ).join('')
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing port');
    const progress: number[] = [];
    const response = await executeHttpProxyRequest(
      {
        ...createBlankHttpRequest({ id: 'sse-cap' }),
        transport: 'sse',
        url: `http://127.0.0.1:${address.port}/events`,
      },
      {
        allowPrivateHosts: true,
        onProgress: (next) => progress.push(next.messageCount),
      }
    );

    expect(response.kind).toBe('too-large');
    expect(response.messageCount).toBe(MAX_STREAM_MESSAGES);
    expect(response.body).toContain(`data: ${MAX_STREAM_MESSAGES - 1}`);
    expect(response.body).not.toContain(`data: ${MAX_STREAM_MESSAGES}\n`);
    expect(progress.at(-1)).toBe(MAX_STREAM_MESSAGES);
  });

  it('streams a POST past the default cap when the caller raises it, with the status in progress', async () => {
    let received = '';
    server = createServer((request, response) => {
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        received += chunk;
      });
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(
          Array.from({ length: MAX_STREAM_MESSAGES + 500 }, (_, index) => `data: ${index}\n\n`).join('')
        );
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing port');
    const progress: { status?: number; contentType?: string }[] = [];
    const response = await executeHttpProxyRequest(
      {
        ...createBlankHttpRequest({ id: 'sse-post' }),
        transport: 'sse',
        method: 'POST',
        url: `http://127.0.0.1:${address.port}/v1/chat/completions`,
        body: { kind: 'json', content: '{"stream":true}' },
      },
      {
        allowPrivateHosts: true,
        maxStreamMessages: MAX_STREAM_MESSAGES + 1_000,
        onProgress: (next) => progress.push({ status: next.status, contentType: next.contentType }),
      }
    );

    expect(received).toBe('{"stream":true}');
    expect(response).toMatchObject({ kind: 'success', messageCount: MAX_STREAM_MESSAGES + 500 });
    expect(progress[0]).toEqual({ status: 200, contentType: 'text/event-stream' });
  });

  it('times the phases of the hop that answered and counts the redirects before it', async () => {
    server = createServer((request, response) => {
      if (request.url === '/old') {
        response.writeHead(302, { location: '/new' });
        response.end();
        return;
      }
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('[1,');
        setTimeout(() => response.end('2]'), 40);
      }, 60);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing port');
    const response = await executeHttpProxyRequest(
      { ...createBlankHttpRequest({ id: 'timed' }), url: `http://127.0.0.1:${address.port}/old` },
      { allowPrivateHosts: true }
    );

    expect(response).toMatchObject({ kind: 'success', body: '[1,2]' });
    const timing = response.timing!;
    expect(timing.redirects).toBe(1);
    expect(timing.tlsMs).toBe(0);
    expect(timing.waitingMs).toBeGreaterThanOrEqual(50);
    expect(timing.downloadMs).toBeGreaterThanOrEqual(30);
    const phases = timing.dnsMs + timing.connectMs + timing.tlsMs + timing.waitingMs + timing.downloadMs + timing.redirectMs;
    expect(phases).toBeLessThanOrEqual(response.durationMs + 2);
  });

  it('leaves timing off a streamed response', async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: one\n\n');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing port');
    const response = await executeHttpProxyRequest(
      { ...createBlankHttpRequest({ id: 'sse-timed' }), transport: 'sse', url: `http://127.0.0.1:${address.port}/events` },
      { allowPrivateHosts: true }
    );
    expect(response.timing).toBeUndefined();
  });

  it('counts no redirect time when the first hop answers', async () => {
    server = createServer((_request, response) => response.end('ok'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing port');
    const response = await executeHttpProxyRequest(
      { ...createBlankHttpRequest({ id: 'direct' }), url: `http://127.0.0.1:${address.port}/` },
      { allowPrivateHosts: true }
    );
    expect(response.timing).toMatchObject({ redirects: 0, redirectMs: 0 });
  });

  it('dials the address the guard resolved through the timed connector', async () => {
    server = createServer((_request, response) => response.end('pinned'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing port');
    const lookups: string[] = [];
    // A .invalid name never resolves through system DNS, so only the pinned lookup can reach the server.
    const response = await executeHttpProxyRequest(
      { ...createBlankHttpRequest({ id: 'pinned' }), url: `http://pinned-only.invalid:${address.port}/` },
      {
        allowPrivateHosts: true,
        lookupImpl: async (hostname) => {
          lookups.push(hostname);
          return [{ address: '127.0.0.1', family: 4 }];
        },
      }
    );
    expect(response).toMatchObject({ kind: 'success', status: 200, body: 'pinned' });
    expect(lookups).toEqual(['pinned-only.invalid']);
    expect(response.timing).toBeDefined();
  });
});
