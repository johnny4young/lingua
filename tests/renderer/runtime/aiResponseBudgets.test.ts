import { afterEach, describe, expect, it, vi } from 'vitest';
import { runChatCompletion } from '../../../src/renderer/runtime/aiClient';
import { AI_RESPONSE_LIMITS as limits } from '../../../src/renderer/runtime/aiResponseBody';

const config = {
  endpoint: 'https://api.example.com/v1/chat/completions',
  apiKey: 'test-private',
  model: 'fixture',
};
const request = { messages: [{ role: 'user' as const, content: 'Explain fixture' }] };
const encoder = new TextEncoder();
const event = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
function response(chunks: string[], sse = false, close = true) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      if (close) controller.close();
    },
    cancel,
  });
  return {
    cancel,
    value: new Response(body, {
      headers: { 'content-type': sse ? 'text/event-stream' : 'application/json' },
    }),
  };
}
const completion = (content: string) => JSON.stringify({ choices: [{ message: { content } }] });
const fetchResponse = (value: Response) => vi.fn(async () => value) as unknown as typeof fetch;
afterEach(() => vi.useRealTimers());

describe('AI response budgets', () => {
  it.each([limits.contentBytes, limits.contentBytes + 1])(
    'bounds JSON answer %i bytes',
    async size => {
      const body = response([completion('a'.repeat(size))]);
      const result = await runChatCompletion(request, config, {
        fetchImpl: fetchResponse(body.value),
      });
      expect(result.ok).toBe(size === limits.contentBytes);
      if (!result.ok) expect(result.kind).toBe('limit');
    }
  );
  it.each([limits.responseBytes, limits.responseBytes + 1])(
    'bounds wire JSON %i bytes',
    async size => {
      const json = completion('ok');
      const body = response([json + ' '.repeat(size - json.length)]);
      const result = await runChatCompletion(request, config, {
        fetchImpl: fetchResponse(body.value),
      });
      expect(result.ok).toBe(size === limits.responseBytes);
      if (!result.ok) expect(result.kind).toBe('limit');
    }
  );
  it.each([limits.frameBytes, limits.frameBytes + 1])(
    'bounds unterminated SSE line %i bytes',
    async size => {
      const body = response([':'.repeat(size)], true);
      const result = await runChatCompletion(request, config, {
        fetchImpl: fetchResponse(body.value),
        onChunk: () => {},
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe(size === limits.frameBytes ? 'parse' : 'limit');
    }
  );
  it.each([limits.contentBytes, limits.contentBytes + 1])(
    'bounds accumulated SSE %i bytes',
    async size => {
      const bodies = [
        event('a'.repeat(size / 2)),
        event('b'.repeat(Math.ceil(size / 2))),
        'data: [DONE]\n\n',
      ];
      const result = await runChatCompletion(request, config, {
        fetchImpl: fetchResponse(response(bodies, true).value),
        onChunk: () => {},
      });
      expect(result.ok).toBe(size === limits.contentBytes);
      if (!result.ok) expect(result.kind).toBe('limit');
    }
  );
  it('bounds all wire chunks, including keepalives', async () => {
    const line = ': ' + 'x'.repeat(65532) + '\n';
    const result = await runChatCompletion(request, config, {
      fetchImpl: fetchResponse(response(Array(33).fill(line), true).value),
      onChunk: () => {},
    });
    expect(result).toMatchObject({ ok: false, kind: 'limit' });
  });
  it('decodes Unicode split at every byte and flushes EOF without newline', async () => {
    const bytes = encoder.encode(event('漢😀').trimEnd());
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const chunks: string[] = [];
    const result = await runChatCompletion(request, config, {
      fetchImpl: fetchResponse(
        new Response(body, { headers: { 'content-type': 'text/event-stream' } })
      ),
      onChunk: text => chunks.push(text),
    });
    expect(result).toMatchObject({ ok: true, content: '漢😀' });
    expect(chunks).toEqual(['漢😀']);
  });
  it('counts output as UTF-8 rather than UTF-16', async () => {
    const result = await runChatCompletion(request, config, {
      fetchImpl: fetchResponse(
        response([completion('😀'.repeat(limits.contentBytes / 4 + 1))]).value
      ),
    });
    expect(result).toMatchObject({ ok: false, kind: 'limit' });
  });
  it('stops at DONE without requiring EOF or publishing trailing data', async () => {
    const body = response(
      [event('accepted'), 'data: [DONE]\n\n', event('not accepted')],
      true,
      false
    );
    const result = await runChatCompletion(request, config, {
      fetchImpl: fetchResponse(body.value),
      onChunk: () => {},
    });
    expect(result).toMatchObject({ ok: true, content: 'accepted' });
    expect(body.cancel).toHaveBeenCalledOnce();
  });
  it('coalesces many deltas and flushes the final text', async () => {
    const chunks: string[] = [];
    const result = await runChatCompletion(request, config, {
      fetchImpl: fetchResponse(response(Array(1000).fill(event('x')), true).value),
      onChunk: text => chunks.push(text),
    });
    expect(result).toMatchObject({ ok: true, content: 'x'.repeat(1000) });
    expect(chunks).toEqual(['x', 'x'.repeat(1000)]);
  });
  it('cancels a stalled reader when the inactivity deadline expires', async () => {
    vi.useFakeTimers();
    const body = response([], true, false);
    const pending = runChatCompletion(request, config, {
      fetchImpl: fetchResponse(body.value),
      onChunk: () => {},
      timeoutMs: 20,
    });
    await vi.advanceTimersByTimeAsync(21);
    expect(await pending).toMatchObject({ ok: false, kind: 'timeout' });
    expect(body.cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('continuous keepalives cannot extend the absolute deadline', async () => {
    vi.useFakeTimers();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
      },
      cancel,
    });
    const pending = runChatCompletion(request, config, {
      fetchImpl: fetchResponse(
        new Response(body, { headers: { 'content-type': 'text/event-stream' } })
      ),
      onChunk: () => {},
      timeoutMs: 20,
      absoluteTimeoutMs: 50,
    });
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(10);
      stream.enqueue(encoder.encode(': keepalive\n'));
      await vi.advanceTimersByTimeAsync(0);
    }
    await vi.advanceTimersByTimeAsync(11);
    expect(await pending).toMatchObject({ ok: false, kind: 'timeout' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('a trickling JSON body cannot re-arm the non-streaming deadline', async () => {
    vi.useFakeTimers();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
      },
      cancel,
    });
    const pending = runChatCompletion(request, config, {
      fetchImpl: fetchResponse(
        new Response(body, { headers: { 'content-type': 'application/json' } })
      ),
      timeoutMs: 20,
    });
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(15);
    stream.enqueue(encoder.encode(' '));
    await vi.advanceTimersByTimeAsync(6);
    expect(settled).toBe(true);
    expect(await pending).toMatchObject({ ok: false, kind: 'timeout' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('external abort closes an outstanding read and discards pending updates', async () => {
    const controller = new AbortController();
    const body = response([event('partial')], true, false);
    const pending = runChatCompletion(request, config, {
      fetchImpl: fetchResponse(body.value),
      onChunk: () => controller.abort('dialog-closed'),
      signal: controller.signal,
    });
    expect(await pending).toMatchObject({ ok: false, kind: 'cancelled' });
    expect(body.cancel).toHaveBeenCalledOnce();
  });
  it('never starts fetch for an already cancelled request', async () => {
    const fetchImpl = vi.fn();
    const controller = new AbortController();
    controller.abort();
    expect(
      await runChatCompletion(request, config, { fetchImpl, signal: controller.signal })
    ).toMatchObject({ ok: false, kind: 'cancelled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('keeps oversized HTTP errors bounded and does not expose partial error data', async () => {
    const result = await runChatCompletion(request, config, {
      fetchImpl: fetchResponse(
        new Response('test-private'.repeat(limits.responseBytes), { status: 502 })
      ),
    });
    expect(result).toMatchObject({ ok: false, kind: 'http', status: 502 });
    if (!result.ok) expect(result.message).not.toContain(config.apiKey);
  });
  it('scrubs thrown transport errors as well as reflected HTTP errors', async () => {
    const result = await runChatCompletion(request, config, {
      fetchImpl: async () => {
        throw new Error(config.apiKey);
      },
    });
    expect(result).toMatchObject({ ok: false, kind: 'network', message: '[redacted]' });
  });
  it('counts split surrogate pairs as accumulated UTF-8 text', async () => {
    const prefix = 'x'.repeat(limits.contentBytes - 4);
    const result = await runChatCompletion(request, config, {
      fetchImpl: fetchResponse(
        response(
          [
            event(prefix.slice(0, 131072)),
            event(prefix.slice(131072)),
            event('\uD83D'),
            event('\uDE00'),
          ],
          true
        ).value
      ),
      onChunk: () => {},
    });
    expect(result).toMatchObject({ ok: true, content: prefix + '😀' });
  });
  it('a callback throwing undefined cannot turn cancellation into success', async () => {
    const result = await runChatCompletion(request, config, {
      fetchImpl: fetchResponse(response([event('ok')], true).value),
      onChunk: () => {
        throw undefined;
      },
    });
    expect(result).toMatchObject({ ok: false, kind: 'network' });
  });
  it('maps consumer callback errors to a typed failure without leaking credentials', async () => {
    const result = await runChatCompletion(request, config, {
      fetchImpl: fetchResponse(response([event('ok')], true).value),
      onChunk: () => {
        throw new Error(config.apiKey);
      },
    });
    expect(result).toMatchObject({ ok: false, kind: 'network', message: '[redacted]' });
  });
});
