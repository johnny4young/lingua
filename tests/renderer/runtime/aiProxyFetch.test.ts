/**
 * Desktop proxy transport for remote AI endpoints: SSE progress from main
 * becomes a streaming Response, and failures map to the AI client's kinds.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProxyAiFetch } from '../../../src/renderer/runtime/aiProxyFetch';
import { runChatCompletion, type AiProviderConfig } from '../../../src/renderer/runtime/aiClient';
import type {
  HttpDesktopAPI,
  HttpDesktopRequestOptions,
  HttpRequestV1,
  HttpResponseV1,
  HttpStreamProgress,
} from '../../../src/shared/httpWorkspaceSchema';

const config: AiProviderConfig = {
  endpoint: 'https://api.example.com/v1/chat/completions',
  apiKey: 'sk-secret-key-value',
  model: 'gpt-4o-mini',
};
const request = { messages: [{ role: 'user' as const, content: 'explain this' }] };

const delta = (text: string): string => `data: {"choices":[{"delta":{"content":"${text}"}}]}\n\n`;

function fakeBridge() {
  const listeners = new Set<(progress: HttpStreamProgress) => void>();
  const calls: { runId: string; request: HttpRequestV1; options: HttpDesktopRequestOptions }[] = [];
  let settle: (response: HttpResponseV1) => void = () => {};
  const bridge: HttpDesktopAPI = {
    execute: vi.fn((runId: string, wire: HttpRequestV1, options: HttpDesktopRequestOptions) => {
      calls.push({ runId, request: wire, options });
      return new Promise<HttpResponseV1>((resolve) => {
        settle = resolve;
      });
    }),
    cancel: vi.fn(async () => ({ cancelled: true })),
    onProgress: (handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  };
  const runId = (): string => calls[0]!.runId;
  return {
    bridge,
    calls,
    listeners,
    emit(body: string, contentType = 'text/event-stream', status = 200) {
      for (const listener of listeners) {
        listener({ runId: runId(), requestId: runId(), transport: 'sse', body, sizeBytes: body.length, messageCount: 1, opened: true, status, contentType });
      }
    },
    settle(overrides: Partial<HttpResponseV1>) {
      settle({
        version: 1,
        transport: 'sse',
        kind: 'success',
        status: 200,
        statusText: 'OK',
        url: config.endpoint,
        finalUrl: config.endpoint,
        headers: [],
        body: '',
        contentType: 'text/event-stream',
        sizeBytes: 0,
        durationMs: 1,
        tooLarge: false,
        redactedHeaders: [],
        recordedAt: '2026-10-25T00:00:00.000Z',
        ...overrides,
      });
    },
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'lingua');
  vi.unstubAllGlobals();
});

describe('createProxyAiFetch', () => {
  it('streams deltas as main reports progress, before the run settles', async () => {
    const fake = fakeBridge();
    const chunks: string[] = [];
    const pending = runChatCompletion(request, config, {
      fetchImpl: createProxyAiFetch(fake.bridge),
      onChunk: (text) => chunks.push(text),
    });
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    const { request: wire, options } = fake.calls[0]!;
    expect(wire).toMatchObject({ method: 'POST', transport: 'sse', url: config.endpoint, body: { kind: 'json' } });
    expect(wire.headers).toContainEqual({ name: 'authorization', value: 'Bearer sk-secret-key-value', enabled: true });
    expect(options).toEqual({ allowPrivateHosts: false, userSensitiveHeaders: [], maxStreamMessages: 20_000 });

    fake.emit(delta('Hel'));
    await vi.waitFor(() => expect(chunks.at(-1)).toBe('Hel'));
    fake.settle({ body: `${delta('Hel')}${delta('lo')}data: [DONE]\n\n` });

    await expect(pending).resolves.toEqual({ ok: true, content: 'Hello', model: 'gpt-4o-mini' });
    expect(fake.listeners.size).toBe(0);
  });

  it('answers a non-streaming request from the settled response', async () => {
    const fake = fakeBridge();
    const pending = runChatCompletion(request, config, { fetchImpl: createProxyAiFetch(fake.bridge) });
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    expect(fake.calls[0]!.request.transport).toBe('http');
    expect(fake.calls[0]!.options).not.toHaveProperty('maxStreamMessages');
    fake.settle({ transport: 'http', contentType: 'application/json', body: '{"choices":[{"message":{"content":"Fix it."}}]}' });
    await expect(pending).resolves.toMatchObject({ ok: true, content: 'Fix it.' });
  });

  it('waits for the final status when the progress body is not an event stream', async () => {
    const fake = fakeBridge();
    const pending = runChatCompletion(request, config, { fetchImpl: createProxyAiFetch(fake.bridge), onChunk: () => {} });
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    fake.emit('{"error":"bad key"}', 'application/json', 401);
    fake.settle({ kind: 'client-error', status: 401, statusText: 'Unauthorized', contentType: 'application/json', body: '{"error":"bad key"}' });
    await expect(pending).resolves.toMatchObject({ ok: false, kind: 'auth', status: 401 });
  });

  it('maps a proxy network failure without echoing the key', async () => {
    const fake = fakeBridge();
    const pending = runChatCompletion(request, config, { fetchImpl: createProxyAiFetch(fake.bridge) });
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    fake.settle({ kind: 'network-error', status: 0, body: '', errorMessage: 'refused for sk-secret-key-value' });
    const result = await pending;
    expect(result).toMatchObject({ ok: false, kind: 'network' });
    expect(JSON.stringify(result)).not.toContain('sk-secret-key-value');
  });

  it('reports a stream main cut at its cap as over budget', async () => {
    const fake = fakeBridge();
    const pending = runChatCompletion(request, config, { fetchImpl: createProxyAiFetch(fake.bridge), onChunk: () => {} });
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    fake.emit(delta('partial'));
    fake.settle({ kind: 'too-large', tooLarge: true, body: delta('partial') });
    await expect(pending).resolves.toMatchObject({ ok: false, kind: 'limit' });
  });

  it('cancels the main run when the caller aborts mid-stream', async () => {
    const fake = fakeBridge();
    const controller = new AbortController();
    const pending = runChatCompletion(request, config, {
      fetchImpl: createProxyAiFetch(fake.bridge),
      onChunk: () => {},
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    fake.emit(delta('Hel'));
    controller.abort();
    await expect(pending).resolves.toMatchObject({ ok: false, kind: 'cancelled' });
    expect(fake.bridge.cancel).toHaveBeenCalledWith(fake.calls[0]!.runId);
    expect(fake.listeners.size).toBe(0);
  });
});

describe('runChatCompletion transport choice', () => {
  it('sends a remote endpoint through the desktop proxy and reaches a local server directly', async () => {
    const fake = fakeBridge();
    Object.defineProperty(window, 'lingua', { value: { http: fake.bridge }, configurable: true });
    const directFetch = vi.fn(async () =>
      new Response('{"choices":[{"message":{"content":"local"}}]}', { headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', directFetch);

    const remote = runChatCompletion(request, config);
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    fake.settle({ transport: 'http', contentType: 'application/json', body: '{"choices":[{"message":{"content":"remote"}}]}' });
    await expect(remote).resolves.toMatchObject({ ok: true, content: 'remote' });
    expect(directFetch).not.toHaveBeenCalled();

    const local = await runChatCompletion(request, { endpoint: 'http://localhost:11434/v1/chat/completions', apiKey: '', model: 'qwen' });
    expect(local).toMatchObject({ ok: true, content: 'local' });
    expect(directFetch).toHaveBeenCalledTimes(1);
    expect(fake.calls).toHaveLength(1);
  });
});
