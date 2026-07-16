/**
 * Shared streaming wrapper for large WASM bootstrap responses.
 *
 * The wrapper preserves the response headers/body semantics so callers can
 * still use `WebAssembly.compileStreaming`, while emitting throttled byte
 * counts as the consumer pulls chunks. A final sample is guaranteed after
 * EOF when at least one byte was read, including responses without a
 * Content-Length header.
 */

export interface BootstrapDownloadProgress {
  loadedBytes: number;
  totalBytes: number | null;
}

interface BootstrapProgressOptions {
  now?: () => number;
  throttleMs?: number;
}

function contentLength(response: Response): number | null {
  // Fetch exposes decoded body chunks while Content-Length can describe the
  // compressed transfer. Treat encoded responses as indeterminate instead of
  // showing impossible counters such as 34 MB / 8 MB.
  const contentEncoding = response.headers.get('content-encoding');
  if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
    return null;
  }
  const parsed = Number(response.headers.get('content-length'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function responseWithBootstrapProgress(
  response: Response,
  onProgress: (progress: BootstrapDownloadProgress) => void,
  options: BootstrapProgressOptions = {}
): Response {
  if (!response.body) return response;

  const reader = response.body.getReader();
  const totalBytes = contentLength(response);
  const now = options.now ?? Date.now;
  const throttleMs = options.throttleMs ?? 250;
  let loadedBytes = 0;
  let lastPostAt = Number.NEGATIVE_INFINITY;
  let lastPostedBytes = -1;

  const postProgress = (force: boolean) => {
    if (loadedBytes <= 0 || loadedBytes === lastPostedBytes) return;
    const currentTime = now();
    if (!force && currentTime - lastPostAt < throttleMs) return;
    lastPostAt = currentTime;
    lastPostedBytes = loadedBytes;
    onProgress({ loadedBytes, totalBytes });
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          postProgress(true);
          controller.close();
          return;
        }
        if (value) {
          loadedBytes += value.byteLength;
          postProgress(totalBytes !== null && loadedBytes >= totalBytes);
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Consume a response without retaining its bytes (used for cache pre-warm). */
export async function drainResponseBody(response: Response): Promise<void> {
  if (!response.body) {
    await response.arrayBuffer();
    return;
  }
  const reader = response.body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
}
