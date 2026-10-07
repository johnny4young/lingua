import { describe, expect, it } from 'vitest';
import { executeHttpProxyRequest, type LookupImpl } from '../../src/main/httpProxy';
import { createBlankHttpRequest, type HttpRequestV1 } from '../../src/shared/httpWorkspace';

const publicLookup: LookupImpl = async () => [{ address: '93.184.216.34', family: 4 }];

function request(overrides: Partial<HttpRequestV1> = {}): HttpRequestV1 {
  return {
    ...createBlankHttpRequest({ id: 'stream', now: '2026-05-26T00:00:00.000Z' }),
    url: 'https://api.example.com/stream',
    method: 'GET',
    ...overrides,
  };
}

function chunkedFetch(chunks: readonly Uint8Array[]): typeof fetch {
  return (async () => {
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]!);
        else controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
}

function splitEvery(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    chunks.push(bytes.subarray(offset, offset + size));
  }
  return chunks;
}

function wholeBodyEventCount(body: string): number {
  return body.split(/\r?\n\r?\n/u).filter(event => event.trim().length > 0).length;
}

describe('executeHttpProxyRequest streaming body reads', () => {
  it('reads a 4 MiB plain body in small chunks without per-chunk rescans', async () => {
    const line = 'data: 0123456789abcdef\n\n';
    const body = new TextEncoder().encode(line.repeat(Math.floor((4 * 1024 * 1024 - 1) / line.length)));
    const startedAt = performance.now();
    const response = await executeHttpProxyRequest(request(), {
      fetchImpl: chunkedFetch(splitEvery(body, 4096)),
      lookupImpl: publicLookup,
    });
    expect(performance.now() - startedAt).toBeLessThan(1000);
    expect(response.kind).toBe('success');
    expect(response.sizeBytes).toBe(body.byteLength);
  });

  it('counts SSE events across boundaries and characters split between chunks', async () => {
    const source = ['data: a\r\n\r\n', 'data: €uro\n\n', '\n\n', 'data: b\r\n', 'id: 2\r\n\r\n', 'data: tail'].join('');
    const progress: Array<{ body: string; messageCount: number }> = [];
    const response = await executeHttpProxyRequest(request({ transport: 'sse' }), {
      fetchImpl: chunkedFetch(splitEvery(new TextEncoder().encode(source), 1)),
      lookupImpl: publicLookup,
      onProgress: update => progress.push({ body: update.body, messageCount: update.messageCount }),
    });

    expect(response.body).toBe(source);
    for (const update of progress) {
      expect(update.messageCount).toBe(wholeBodyEventCount(update.body));
    }
    expect(progress.at(-1)?.messageCount).toBe(4);
  });

  it('stops an SSE stream at the message cap with the retained events only', async () => {
    const source = 'data: x\n\n'.repeat(1005);
    const response = await executeHttpProxyRequest(request({ transport: 'sse' }), {
      fetchImpl: chunkedFetch(splitEvery(new TextEncoder().encode(source), 7)),
      lookupImpl: publicLookup,
    });
    expect(response.tooLarge).toBe(true);
    expect(response.body).toBe('data: x\n\n'.repeat(1000));
  });
});
