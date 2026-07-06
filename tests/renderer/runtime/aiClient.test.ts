/**
 * T19 / RL-031 Slice 2 — AI provider client. Covers the OpenAI-compatible
 * success mapping, config/auth/http/timeout/parse failure envelope, and the
 * guarantee that the API key never leaks into an error message.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  runChatCompletion,
  type AiProviderConfig,
} from '../../../src/renderer/runtime/aiClient';

const config: AiProviderConfig = {
  endpoint: 'https://api.example.com/v1/chat/completions',
  apiKey: 'sk-secret-key-value',
  model: 'gpt-4o-mini',
};

const request = {
  messages: [
    { role: 'system' as const, content: 'sys' },
    { role: 'user' as const, content: 'explain this' },
  ],
};

function jsonResponse(body: unknown, init: Partial<Response> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { 'content-type': 'application/json' },
  });
}

describe('runChatCompletion', () => {
  it('maps an OpenAI-compatible completion to a success result', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: 'Here is the fix.' } }] })
    ) as unknown as typeof fetch;
    const res = await runChatCompletion(request, config, { fetchImpl });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toBe('Here is the fix.');
      expect(res.model).toBe('gpt-4o-mini');
    }
  });

  it('sends the key in the Authorization header and the model+messages in the body', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer sk-secret-key-value');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.messages).toHaveLength(2);
      expect(body.stream).toBe(false);
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }) as unknown as typeof fetch;
    const res = await runChatCompletion(request, config, { fetchImpl });
    expect(res.ok).toBe(true);
  });

  it('trims endpoint, key, and model before sending', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.example.com/v1/chat/completions');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer sk-secret-key-value');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('gpt-4o-mini');
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }) as unknown as typeof fetch;
    const res = await runChatCompletion(
      request,
      {
        endpoint: '  https://api.example.com/v1/chat/completions  ',
        apiKey: '  sk-secret-key-value  ',
        model: '  gpt-4o-mini  ',
      },
      { fetchImpl }
    );
    expect(res.ok).toBe(true);
  });

  it('rejects a missing key as a config error (no network call)', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const res = await runChatCompletion(request, { ...config, apiKey: '' }, { fetchImpl });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('config');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a non-http endpoint as a config error', async () => {
    const res = await runChatCompletion(request, {
      ...config,
      endpoint: 'file:///etc/passwd',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('config');
  });

  it('rejects a non-loopback plain-http endpoint before sending the key', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const res = await runChatCompletion(
      request,
      {
        ...config,
        endpoint: 'http://api.example.com/v1/chat/completions',
      },
      { fetchImpl }
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('config');
      expect(res.message).toContain('Plain HTTP');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows loopback plain-http endpoints for local AI servers', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
      return jsonResponse({ choices: [{ message: { content: 'local ok' } }] });
    }) as unknown as typeof fetch;
    const res = await runChatCompletion(
      request,
      {
        ...config,
        endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      },
      { fetchImpl }
    );
    expect(res.ok).toBe(true);
  });

  it('classifies 401 as auth and never echoes the key', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('unauthorized sk-secret-key-value', { status: 401 })
    ) as unknown as typeof fetch;
    const res = await runChatCompletion(request, config, { fetchImpl });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('auth');
      expect(res.status).toBe(401);
      expect(res.message).not.toContain('sk-secret-key-value');
    }
  });

  it('classifies a 500 as http', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('boom', { status: 500 })
    ) as unknown as typeof fetch;
    const res = await runChatCompletion(request, config, { fetchImpl });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('http');
      expect(res.status).toBe(500);
    }
  });

  it('redacts the key from an http error body that echoes it back (proxy reflection)', async () => {
    // Defense in depth: a misconfigured proxy can reflect the request
    // Authorization header into its error body. The key must never reach the
    // UI message even on the endpoint-error path.
    const fetchImpl = vi.fn(async () =>
      new Response(
        'Bad gateway: rejected header Authorization: Bearer sk-secret-key-value',
        { status: 502 }
      )
    ) as unknown as typeof fetch;
    const res = await runChatCompletion(request, config, { fetchImpl });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('http');
      expect(res.message).not.toContain('sk-secret-key-value');
      expect(res.message).toContain('[redacted]');
    }
  });

  it('surfaces a network failure', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const res = await runChatCompletion(request, config, { fetchImpl });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('network');
  });

  it('surfaces a timeout when the request aborts on the deadline', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        );
      })) as unknown as typeof fetch;
    const res = await runChatCompletion(request, config, {
      fetchImpl,
      timeoutMs: 10,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('timeout');
  });

  it('reports a completion-less response as a parse error', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [] })
    ) as unknown as typeof fetch;
    const res = await runChatCompletion(request, config, { fetchImpl });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('parse');
  });

  function sseResponse(events: readonly string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(encoder.encode(event));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  it('streams SSE deltas through onChunk and resolves the full content', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      // Streaming callers must ask the server to stream.
      expect(JSON.parse(String(init?.body)).stream).toBe(true);
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        ': keep-alive comment line\n',
        'data: [DONE]\n\n',
      ]);
    }) as unknown as typeof fetch;
    const chunks: string[] = [];
    const res = await runChatCompletion(request, config, {
      fetchImpl,
      onChunk: (text) => chunks.push(text),
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.content).toBe('Hello');
    // Progressive accumulation, not deltas: each call carries text-so-far.
    expect(chunks).toEqual(['Hel', 'Hello']);
  });

  it('processes a final SSE data line without a trailing newline', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse(['data: {"choices":[{"delta":{"content":"done"}}]}'])
    ) as unknown as typeof fetch;
    const chunks: string[] = [];
    const res = await runChatCompletion(request, config, {
      fetchImpl,
      onChunk: (text) => chunks.push(text),
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.content).toBe('done');
    expect(chunks).toEqual(['done']);
  });

  it('falls back to plain JSON when the server ignores stream:true', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: 'unstreamed' } }] })
    ) as unknown as typeof fetch;
    const chunks: string[] = [];
    const res = await runChatCompletion(request, config, {
      fetchImpl,
      onChunk: (text) => chunks.push(text),
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.content).toBe('unstreamed');
    // No SSE body → no progressive callbacks; the final result carries it all.
    expect(chunks).toEqual([]);
  });

  it('reports an SSE stream that ends with no text as a parse error', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse(['data: [DONE]\n\n'])
    ) as unknown as typeof fetch;
    const res = await runChatCompletion(request, config, {
      fetchImpl,
      onChunk: () => {},
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('parse');
  });

  it('skips malformed SSE data lines instead of failing the stream', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        'data: {not json}\n\n',
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: [DONE]\n\n',
      ])
    ) as unknown as typeof fetch;
    const res = await runChatCompletion(request, config, {
      fetchImpl,
      onChunk: () => {},
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.content).toBe('ok');
  });
});
