import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { executeWebSocketProxyRequest } from '../../src/main/httpWebSocket';
import { createBlankHttpRequest } from '../../src/shared/httpWorkspaceSchema';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
});

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  return address.port;
}

function request(url: string) {
  return {
    ...createBlankHttpRequest({ id: 'request-1' }),
    transport: 'websocket' as const,
    url,
    body: { kind: 'text' as const, content: 'hello' },
  };
}

describe('desktop WebSocket proxy', () => {
  it('blocks loopback unless the user explicitly opts in', async () => {
    const response = await executeWebSocketProxyRequest(
      request('ws://127.0.0.1:45001/socket')
    );
    expect(response.kind).toBe('network-error');
    expect(response.errorMessage).toMatch(/private address/i);
  });

  it('maps a synchronous client-constructor failure to network-error', async () => {
    const ThrowingWebSocket = function ThrowingWebSocket() {
      throw new Error('constructor failed');
    } as unknown as typeof WebSocket;
    const response = await executeWebSocketProxyRequest(
      request('wss://example.com/socket'),
      {
        lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
        webSocketFactory: ThrowingWebSocket,
      }
    );
    expect(response.kind).toBe('network-error');
    expect(response.errorMessage).toBe('constructor failed');
  });

  it('pins an opted-in target, streams bounded messages, and records close metadata', async () => {
    const server = createServer();
    const webSocketServer = new WebSocketServer({ server });
    webSocketServer.on('connection', (socket) => {
      socket.on('message', (value) => {
        socket.send(`echo:${value.toString()}`);
        socket.close(1000, 'complete');
      });
    });
    const port = await listen(server);
    const progress: string[] = [];
    const response = await executeWebSocketProxyRequest(
      request(`ws://127.0.0.1:${port}/socket`),
      {
        allowPrivateHosts: true,
        onProgress: (next) => progress.push(next.body),
      }
    );
    webSocketServer.close();

    expect(response).toMatchObject({
      kind: 'success',
      status: 101,
      transport: 'websocket',
      body: 'echo:hello',
      messageCount: 1,
      closeCode: 1000,
      closeReason: 'complete',
    });
    expect(progress).toContain('echo:hello');
  });

  it('rejects handshake redirects instead of following them', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(302, { location: 'ws://127.0.0.1:9/private' });
      response.end();
    });
    const port = await listen(server);
    const response = await executeWebSocketProxyRequest(
      request(`ws://127.0.0.1:${port}/redirect`),
      { allowPrivateHosts: true }
    );
    expect(response.kind).toBe('network-error');
    expect(response.errorMessage).toMatch(/HTTP 302/);
  });
});
