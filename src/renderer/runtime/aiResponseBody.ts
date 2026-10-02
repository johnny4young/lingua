/** Bounded AI body consumption. No endpoint, credential, or persistence ownership. */
import { utf8ByteLength } from '../../shared/utf8';

export const AI_RESPONSE_LIMITS = {
  responseBytes: 2 * 1024 * 1024,
  // SSE spends ~200 envelope bytes per token; frame and content caps bound retained memory.
  streamBytes: 16 * 1024 * 1024,
  frameBytes: 256 * 1024,
  contentBytes: 256 * 1024,
} as const;

export class AiResponseError extends Error {
  constructor(readonly kind: 'limit' | 'cancelled' | 'timeout') {
    super(
      kind === 'limit'
        ? 'The AI response exceeded its resource budget.'
        : kind === 'timeout'
          ? 'The AI request timed out.'
          : 'The AI request was cancelled.'
    );
  }
}

/** JSON is buffered only inside its cap; SSE retains one bounded line and answer. */
export async function readAiResponseBody(
  response: Response,
  signal: AbortSignal,
  onProgress: () => void,
  onChunk?: (text: string) => void
): Promise<string> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  const wireBytes = onChunk ? AI_RESPONSE_LIMITS.streamBytes : AI_RESPONSE_LIMITS.responseBytes;
  let buffer = '';
  let bufferBytes = 0;
  let text = '';
  let textBytes = 0;
  let ended = false;
  let callbackError: unknown;
  let callbackFailed = false;
  let lastEmitted = '';
  let updateTimer: ReturnType<typeof setTimeout> | undefined;
  const checkActive = () => {
    if (callbackFailed) throw callbackError;
    if (signal.aborted)
      throw new AiResponseError(signal.reason === 'timeout' ? 'timeout' : 'cancelled');
  };
  const cancelReader = () => {
    void reader.cancel().catch(() => {});
  };
  const emit = () => {
    updateTimer = undefined;
    if (!signal.aborted && text !== lastEmitted) {
      lastEmitted = text;
      try {
        onChunk?.(text);
      } catch (error) {
        callbackFailed = true;
        callbackError = error;
        cancelReader();
      }
    }
  };
  const changed = () => {
    if (!lastEmitted) emit();
    else updateTimer ??= setTimeout(emit, 50);
  };
  const line = (value: string) => {
    if (!value.startsWith('data:')) return;
    const data = value.slice(5).trim();
    if (data === '[DONE]') {
      ended = true;
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('choices' in payload) ||
      !Array.isArray(payload.choices)
    )
      return;
    const first = payload.choices[0] as { delta?: { content?: unknown } } | undefined;
    const delta = first?.delta?.content;
    if (typeof delta !== 'string' || !delta) return;
    // JSON providers can split a surrogate pair across deltas. Counting each
    // delta independently would charge six UTF-8 bytes for a four-byte scalar.
    const combinesSurrogates = /[\uD800-\uDBFF]$/.test(text) && /^[\uDC00-\uDFFF]/.test(delta);
    textBytes += utf8ByteLength(delta) - (combinesSurrogates ? 2 : 0);
    if (textBytes > AI_RESPONSE_LIMITS.contentBytes) throw new AiResponseError('limit');
    text += delta;
    changed();
  };
  const accept = (chunk: string) => {
    if (!onChunk) {
      buffer += chunk;
      return;
    }
    // Never concatenate a giant chunk into the pending-frame buffer.
    let start = 0;
    do {
      const newline = chunk.indexOf('\n', start);
      const fragment = chunk.slice(start, newline < 0 ? undefined : newline);
      bufferBytes += utf8ByteLength(fragment);
      if (bufferBytes > AI_RESPONSE_LIMITS.frameBytes) throw new AiResponseError('limit');
      buffer += fragment;
      if (newline < 0) break;
      line(buffer.replace(/\r$/, ''));
      buffer = '';
      bufferBytes = 0;
      if (ended) break;
      start = newline + 1;
    } while (start < chunk.length);
  };
  signal.addEventListener('abort', cancelReader, { once: true });
  try {
    checkActive();
    while (!ended) {
      const result = await reader.read();
      checkActive();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > wireBytes) throw new AiResponseError('limit');
      onProgress();
      accept(decoder.decode(result.value, { stream: true }));
      checkActive();
    }
    if (!ended) {
      accept(decoder.decode());
      if (onChunk && buffer) line(buffer.replace(/\r$/, ''));
    }
    checkActive();
    if (updateTimer !== undefined) clearTimeout(updateTimer);
    emit();
    checkActive();
    return onChunk ? text : buffer;
  } finally {
    if (updateTimer !== undefined) clearTimeout(updateTimer);
    signal.removeEventListener('abort', cancelReader);
    cancelReader();
    reader.releaseLock();
  }
}
