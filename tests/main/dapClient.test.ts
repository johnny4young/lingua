import net, { type Server, type Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DapClient } from '../../src/main/debugger/dapClient';

function frame(message: unknown): Buffer {
  const payload = JSON.stringify(message);
  return Buffer.from(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
}

async function listen(handler: (socket: Socket) => void): Promise<{ server: Server; port: number }> {
  const server = net.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return { server, port: address.port };
}

const resources: Array<{ server: Server; client?: DapClient }> = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    resource.client?.close();
    await new Promise<void>(resolve => resource.server.close(() => resolve()));
  }
});

describe('DapClient', () => {
  it('does not open a socket for an already cancelled connection', async () => {
    const controller = new AbortController();
    controller.abort();
    const socket = new net.Socket();
    const connect = vi.spyOn(net, 'createConnection').mockReturnValue(socket);
    const pending = DapClient.connect('127.0.0.1', 12345, 5000, controller.signal);
    const outcome = pending.catch(error => error);
    try {
      expect(connect).not.toHaveBeenCalled();
      expect(await outcome).toMatchObject({ name: 'AbortError' });
    } finally {
      if (socket.listenerCount('error')) socket.emit('error', new Error('fixture cleanup'));
      socket.destroy();
      await outcome;
      connect.mockRestore();
    }
  });

  it('cancels a pending connection and detaches its startup listeners', async () => {
    const controller = new AbortController();
    const socket = new net.Socket();
    const connect = vi.spyOn(net, 'createConnection').mockReturnValue(socket);
    let settled = false;
    const outcome = DapClient.connect('127.0.0.1', 12345, 5000, controller.signal)
      .then(value => { settled = true; return value; }, error => { settled = true; return error; });
    try {
      controller.abort();
      await vi.waitFor(() => expect(settled).toBe(true));
      expect(await outcome).toMatchObject({ name: 'AbortError' });
      expect(socket.destroyed).toBe(true);
      expect(socket.listenerCount('connect')).toBe(0);
      expect(socket.listenerCount('error')).toBe(0);
    } finally {
      if (socket.listenerCount('error')) socket.emit('error', new Error('fixture cleanup'));
      socket.destroy();
      await outcome;
      connect.mockRestore();
    }
  });

  it('closes a failed transport and ignores any buffered events after failure', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const close = vi.fn(() => { input.destroy(); });
    const client = DapClient.fromStreams(input, output, { close });
    const listener = vi.fn();
    client.onEvent(listener);
    const pending = client.request('initialize').catch(error => error);
    try {
      output.emit('error', new Error('adapter transport failed'));
      const failure = await pending;
      expect(failure).toBeInstanceOf(Error);
      if (!(failure instanceof Error)) throw new Error('Expected transport failure');
      expect(failure.message).toContain('adapter transport failed');
      expect(close).toHaveBeenCalledTimes(1);
      expect(input.destroyed).toBe(true);
      output.write(frame({ seq: 1, type: 'event', event: 'output', body: { output: 'late' } }));
      expect(listener).not.toHaveBeenCalled();
      client.close();
      expect(close).toHaveBeenCalledTimes(1);
    } finally { client.close(); input.destroy(); output.destroy(); }
  });

  it('does not deliver protocol events after explicit close', () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const client = DapClient.fromStreams(input, output);
    const listener = vi.fn();
    client.onEvent(listener);
    try {
      client.close();
      output.write(frame({ seq: 1, type: 'event', event: 'stopped', body: { threadId: 1 } }));
      expect(listener).not.toHaveBeenCalled();
    } finally { input.destroy(); output.destroy(); }
  });

  it('parses split frames, correlates responses, and buffers early events', async () => {
    const { server, port } = await listen(socket => {
      let request = Buffer.alloc(0);
      socket.on('data', chunk => {
        request = Buffer.concat([request, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);
        const headerEnd = request.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const body = JSON.parse(request.subarray(headerEnd + 4).toString('utf8')) as {
          seq: number;
        };
        const early = frame({ seq: 1, type: 'event', event: 'initialized', body: {} });
        const response = frame({
          seq: 2,
          type: 'response',
          request_seq: body.seq,
          command: 'initialize',
          success: true,
          body: { supportsConfigurationDoneRequest: true },
        });
        socket.write(early.subarray(0, 11));
        socket.write(Buffer.concat([early.subarray(11), response]));
      });
    });
    const client = await DapClient.connect('127.0.0.1', port);
    resources.push({ server, client });

    await expect(client.request<{ supportsConfigurationDoneRequest: boolean }>('initialize')).resolves.toEqual({
      supportsConfigurationDoneRequest: true,
    });
    await expect(client.waitForEvent('initialized')).resolves.toMatchObject({
      type: 'event',
      event: 'initialized',
    });
  });

  it('rejects failed responses with Delve diagnostics', async () => {
    const { server, port } = await listen(socket => {
      socket.once('data', chunk => {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        const headerEnd = bytes.indexOf('\r\n\r\n');
        const body = JSON.parse(bytes.subarray(headerEnd + 4).toString('utf8')) as { seq: number };
        socket.write(
          frame({
            seq: 2,
            type: 'response',
            request_seq: body.seq,
            command: 'launch',
            success: false,
            message: 'could not launch process',
          })
        );
      });
    });
    const client = await DapClient.connect('127.0.0.1', port);
    resources.push({ server, client });

    await expect(client.request('launch')).rejects.toThrow(/could not launch process/i);
  });

  it('supports adapters that communicate over separate stdio streams', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const client = DapClient.fromStreams(input, output, { label: 'LLDB DAP' });
    let request = Buffer.alloc(0);
    input.on('data', chunk => {
      request = Buffer.concat([request, chunk]);
      const headerEnd = request.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const body = JSON.parse(request.subarray(headerEnd + 4).toString('utf8')) as {
        seq: number;
      };
      output.write(
        frame({
          seq: 2,
          type: 'response',
          request_seq: body.seq,
          command: 'initialize',
          success: true,
          body: { supportsConfigurationDoneRequest: true },
        })
      );
    });

    await expect(client.request('initialize')).resolves.toEqual({
      supportsConfigurationDoneRequest: true,
    });
    client.close();
    output.destroy();
  });

  it('closes fail-closed on an oversized frame declaration', async () => {
    const { server, port } = await listen(socket => {
      socket.write('Content-Length: 1000001\r\n\r\n');
    });
    const client = await DapClient.connect('127.0.0.1', port);
    resources.push({ server, client });

    await expect(client.waitForEvent('never', undefined, 1_000)).rejects.toThrow(/oversized/i);
    await expect(client.request('initialize')).rejects.toThrow(/closed/i);
  });

  it('closes fail-closed when a JSON frame is not an object', async () => {
    const { server, port } = await listen(socket => {
      socket.write(frame(null));
    });
    const client = await DapClient.connect('127.0.0.1', port);
    resources.push({ server, client });

    await expect(client.waitForEvent('never', undefined, 1_000)).rejects.toThrow(/invalid json/i);
    await expect(client.request('initialize')).rejects.toThrow(/closed/i);
  });
});
