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
});
