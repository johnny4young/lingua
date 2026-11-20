import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankHttpRequest } from '../../src/shared/httpWorkspace';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const proxy = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));
vi.mock('../../src/main/httpProxy', () => ({ executeHttpProxyRequest: proxy.execute }));
vi.mock('../../src/main/httpWebSocket', () => ({ executeWebSocketProxyRequest: vi.fn() }));

class FakeSender extends EventEmitter {
  readonly id = 9;
  readonly send = vi.fn();
  isDestroyed() {
    return false;
  }
}

const options = { allowPrivateHosts: false, userSensitiveHeaders: [] };
const sseRequest = {
  ...createBlankHttpRequest({ id: 'req', now: '2026-05-26T00:00:00.000Z' }),
  url: 'https://api.example.com/stream',
  transport: 'sse',
};

beforeEach(async () => {
  vi.resetModules();
  handlers.clear();
  proxy.execute.mockReset();
  const { registerHttpHandlers } = await import('../../src/main/ipc/http');
  registerHttpHandlers();
});

describe('HTTP IPC owner lifecycle', () => {
  it('aborts a live stream when its renderer reloads', async () => {
    const sender = new FakeSender();
    let signal: AbortSignal | undefined;
    proxy.execute.mockImplementation((_request, proxyOptions: { signal: AbortSignal }) => {
      signal = proxyOptions.signal;
      return new Promise(resolve => {
        proxyOptions.signal.addEventListener('abort', () => resolve({ kind: 'network-error' }));
      });
    });
    const pending = handlers.get('http:execute')?.({ sender }, 'run-1', sseRequest, options);
    await vi.waitFor(() => expect(signal).toBeDefined());

    sender.emit('did-navigate');
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(sender.listenerCount('did-navigate')).toBe(0);
    expect(sender.listenerCount('destroyed')).toBe(0);
  });

  it('coalesces stream progress and always delivers the latest body', async () => {
    const sender = new FakeSender();
    proxy.execute.mockImplementation(async (_request, proxyOptions: {
      onProgress: (progress: { body: string; sizeBytes: number; messageCount: number; opened: boolean }) => void;
    }) => {
      for (let index = 1; index <= 1000; index += 1) {
        proxyOptions.onProgress({ body: `body-${index}`, sizeBytes: index, messageCount: index, opened: true });
      }
      return { kind: 'success' };
    });
    await handlers.get('http:execute')?.({ sender }, 'run-2', sseRequest, options);

    expect(sender.send.mock.calls.length).toBeLessThanOrEqual(2);
    expect(sender.send.mock.calls.at(-1)?.[1]).toMatchObject({ body: 'body-1000', runId: 'run-2' });
  });

  it('passes a bounded stream message cap to the proxy and refuses one past the ceiling', async () => {
    const sender = new FakeSender();
    proxy.execute.mockResolvedValue({ kind: 'success' });
    const execute = handlers.get('http:execute');
    await execute?.({ sender }, 'run-3', sseRequest, { ...options, maxStreamMessages: 20_000 });
    expect(proxy.execute.mock.calls[0]?.[1]).toMatchObject({ maxStreamMessages: 20_000 });

    for (const maxStreamMessages of [0, 1.5, 20_001, '50']) {
      await expect(
        Promise.resolve().then(() => execute?.({ sender }, 'run-4', sseRequest, { ...options, maxStreamMessages }))
      ).rejects.toThrow('Invalid stream message cap');
    }
    expect(proxy.execute).toHaveBeenCalledTimes(1);
  });

  it('sends each appended span once when a run asks for delta progress', async () => {
    const sender = new FakeSender();
    proxy.execute.mockImplementation(async (_request, proxyOptions: {
      onProgress: (progress: { body: string; sizeBytes: number; messageCount: number; opened: boolean }) => void;
    }) => {
      let body = '';
      for (let index = 1; index <= 1000; index += 1) {
        body += `${index},`;
        proxyOptions.onProgress({ body, sizeBytes: body.length, messageCount: index, opened: true });
      }
      proxyOptions.onProgress({ body: body.slice(0, 10), sizeBytes: 10, messageCount: 1, opened: true });
      return { kind: 'success' };
    });
    await handlers.get('http:execute')?.({ sender }, 'run-5', sseRequest, { ...options, progress: 'delta' });

    const bodies = sender.send.mock.calls.map(([, progress]) => (progress as { body: string }).body);
    expect(bodies.length).toBeLessThanOrEqual(2);
    expect(bodies.join('')).toBe(Array.from({ length: 1000 }, (_, index) => `${index + 1},`).join(''));
  });

  it('passes a bounded response body cap and refuses unknown progress modes', async () => {
    const sender = new FakeSender();
    proxy.execute.mockResolvedValue({ kind: 'success' });
    const execute = handlers.get('http:execute');
    await execute?.({ sender }, 'run-6', sseRequest, { ...options, maxResponseBodyBytes: 2_097_152 });
    expect(proxy.execute.mock.calls[0]?.[1]).toMatchObject({ maxResponseBodyBytes: 2_097_152 });

    for (const maxResponseBodyBytes of [0, 1.5, 4 * 1_048_576 + 1, '1024']) {
      await expect(
        Promise.resolve().then(() => execute?.({ sender }, 'run-7', sseRequest, { ...options, maxResponseBodyBytes }))
      ).rejects.toThrow('Invalid response body cap');
    }
    await expect(
      Promise.resolve().then(() => execute?.({ sender }, 'run-8', sseRequest, { ...options, progress: 'full' }))
    ).rejects.toThrow('Invalid progress mode');
    expect(proxy.execute).toHaveBeenCalledTimes(1);
  });
});
