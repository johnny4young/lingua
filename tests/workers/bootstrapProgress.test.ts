import { describe, expect, it } from 'vitest';
import {
  drainResponseBody,
  responseWithBootstrapProgress,
  type BootstrapDownloadProgress,
} from '../../src/renderer/workers/bootstrapProgress';

function chunkedResponse(
  chunks: readonly number[][],
  contentLength?: number
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });
  const headers = new Headers({ 'content-type': 'application/wasm' });
  if (contentLength !== undefined) {
    headers.set('content-length', String(contentLength));
  }
  return new Response(stream, { headers });
}

describe('responseWithBootstrapProgress', () => {
  it('emits the exact final byte count without Content-Length', async () => {
    const samples: BootstrapDownloadProgress[] = [];
    const times = [0, 100, 100];
    const response = responseWithBootstrapProgress(
      chunkedResponse([[1, 2], [3, 4, 5]]),
      sample => samples.push(sample),
      { now: () => times.shift() ?? 100, throttleMs: 250 }
    );

    expect(response.headers.get('content-type')).toBe('application/wasm');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(samples).toEqual([
      { loadedBytes: 2, totalBytes: null },
      { loadedBytes: 5, totalBytes: null },
    ]);
  });

  it('does not duplicate a final sample already emitted at Content-Length', async () => {
    const samples: BootstrapDownloadProgress[] = [];
    const response = responseWithBootstrapProgress(
      chunkedResponse([[1, 2, 3]], 3),
      sample => samples.push(sample),
      { now: () => 0 }
    );

    await drainResponseBody(response);
    expect(samples).toEqual([{ loadedBytes: 3, totalBytes: 3 }]);
  });

  it('treats compressed Content-Length as indeterminate decoded progress', async () => {
    const samples: BootstrapDownloadProgress[] = [];
    const raw = chunkedResponse([[1, 2, 3]], 1);
    raw.headers.set('content-encoding', 'br');
    const response = responseWithBootstrapProgress(raw, sample => {
      samples.push(sample);
    });

    await drainResponseBody(response);
    expect(samples.at(-1)).toEqual({ loadedBytes: 3, totalBytes: null });
  });
});
