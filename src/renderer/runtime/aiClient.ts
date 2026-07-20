/**
 * implementation — AI provider client (OpenAI-compatible chat).
 *
 * Sends a chat request (built by `shared/ai/explainError.ts`) to the user's
 * BYO endpoint and returns a typed result. Per `docs/LOCAL_AI_ADR.md`:
 *   - BYO-API-key, provider-agnostic OpenAI-compatible `/chat/completions`.
 *   - Ships on web + desktop via `fetch`; on web it is CORS-bound (documented).
 *     Desktop can later route through the implementation SSRF-guarded main proxy.
 *   - Only ever called from an explicit user action (the caller enforces the
 *     consent-preview gate); this module performs the transport only.
 *
 * Never throws — always settles to a typed `AiChatResult`. The API key is
 * never echoed into any error message.
 */

import type { ChatMessage } from '../../shared/ai/explainError';

/** Default request timeout. */
export const DEFAULT_AI_TIMEOUT_MS = 60_000;
/** Hard cap so a caller override can't disable the deadline. */
export const MAX_AI_TIMEOUT_MS = 5 * 60_000;

export interface AiProviderConfig {
  /** Full chat-completions URL, e.g. https://api.openai.com/v1/chat/completions. */
  readonly endpoint: string;
  /** BYO API key. Stored locally only; never logged or echoed. */
  readonly apiKey: string;
  /** Optional default model id. */
  readonly model?: string;
}

export type AiErrorKind =
  | 'config'
  | 'network'
  | 'timeout'
  | 'auth'
  | 'http'
  | 'parse';

export type AiChatResult =
  | { readonly ok: true; readonly content: string; readonly model?: string }
  | {
      readonly ok: false;
      readonly kind: AiErrorKind;
      readonly message: string;
      readonly status?: number;
    };

export interface AiChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly model?: string;
}

export interface RunChatCompletionOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /**
   * Streaming: when provided the request asks for SSE (`stream: true`) and
   * this callback receives the ACCUMULATED text after every delta, so a UI
   * can render progressively. The resolved result still carries the full
   * content. Servers that ignore `stream` fall back to the single-JSON
   * parse transparently. With streaming, the timeout is a STALL deadline —
   * it re-arms on every chunk — so a long answer that keeps flowing is
   * never cut off mid-sentence.
   */
  readonly onChunk?: (textSoFar: string) => void;
  /** Test seam: override global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

type NormalizedAiProviderConfig =
  | {
      readonly ok: true;
      readonly endpoint: string;
      readonly apiKey: string;
      readonly model?: string;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  );
}

/** Validate and normalize the endpoint/key/model before a network request. */
function normalizeConfig(config: AiProviderConfig): NormalizedAiProviderConfig {
  const endpoint = config.endpoint.trim();
  const apiKey = config.apiKey.trim();
  const model = config.model?.trim();

  if (apiKey.length === 0) return { ok: false, message: 'No API key configured.' };

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, message: 'AI endpoint is not a valid URL.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, message: 'AI endpoint must be an http(s) URL.' };
  }
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    return {
      ok: false,
      message:
        'Plain HTTP AI endpoints are limited to localhost/loopback. Use HTTPS for remote providers.',
    };
  }
  return model ? { ok: true, endpoint, apiKey, model } : { ok: true, endpoint, apiKey };
}

function extractContent(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } };
  const content = first?.message?.content;
  return typeof content === 'string' ? content : null;
}

/** Extract the delta text from one OpenAI-compatible SSE chunk payload. */
function extractDelta(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { delta?: { content?: unknown } };
  const content = first?.delta?.content;
  return typeof content === 'string' ? content : null;
}

/**
 * Consume an OpenAI-compatible `text/event-stream` body, invoking `onChunk`
 * with the accumulated text after each delta and re-arming the stall
 * deadline via `onProgress`. Malformed data lines are skipped (keep-alives,
 * vendor extras) — the stream fails only if it ends with no text at all.
 */
async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (textSoFar: string) => void,
  onProgress: () => void
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  const processLine = (line: string): void => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (data === '[DONE]') return;
    try {
      const delta = extractDelta(JSON.parse(data));
      if (delta) {
        text += delta;
        onChunk(text);
      }
    } catch {
      // Permissive by design: skip non-JSON keep-alive / vendor lines.
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onProgress();
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      processLine(line);
    }
  }
  buffer += decoder.decode();
  if (buffer.length > 0) processLine(buffer.replace(/\r$/, ''));
  return text;
}

/**
 * POST an OpenAI-compatible chat completion. Always resolves to a typed
 * result; never throws. The key travels only in the `Authorization` header
 * and is never included in any returned message.
 */
export async function runChatCompletion(
  request: AiChatRequest,
  config: AiProviderConfig,
  options: RunChatCompletionOptions = {}
): Promise<AiChatResult> {
  const normalizedConfig = normalizeConfig(config);
  if (!normalizedConfig.ok) {
    return { ok: false, kind: 'config', message: normalizedConfig.message };
  }

  const model = request.model?.trim() || normalizedConfig.model;
  if (!model) {
    return { ok: false, kind: 'config', message: 'No model configured.' };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timeoutMs = Math.min(
    options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
    MAX_AI_TIMEOUT_MS
  );
  // Streaming re-arms this on every chunk (stall deadline); the non-streaming
  // path arms it once, preserving the original absolute-deadline behavior.
  let timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  const rearmTimer = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  };
  const onAbort = (): void => controller.abort(options.signal?.reason ?? 'cancelled');
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const response = await fetchImpl(normalizedConfig.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${normalizedConfig.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        stream: options.onChunk !== undefined,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const kind: AiErrorKind =
        response.status === 401 || response.status === 403 ? 'auth' : 'http';
      // Surface a short server message when available, but never the key.
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 500);
      } catch {
        /* body already consumed / unreadable */
      }
      // Defense in depth: a misconfigured proxy/server can echo the request
      // `Authorization` header back in its error body, which would reintroduce
      // the key into the UI string. Scrub any literal occurrence of the key
      // before it is appended so the "key never leaks" guarantee holds even on
      // the endpoint-error path. split/join avoids regex-escaping the key.
      if (detail) {
        detail = detail.split(normalizedConfig.apiKey).join('[redacted]');
      }
      return {
        ok: false,
        kind,
        status: response.status,
        message:
          kind === 'auth'
            ? 'The AI endpoint rejected the API key.'
            : `AI endpoint returned ${response.status}${detail ? `: ${detail}` : ''}`,
      };
    }

    // SSE path: only when the caller asked to stream AND the server honored
    // it. A server that ignores `stream: true` answers plain JSON and falls
    // through to the single-parse below.
    const contentType = response.headers.get('content-type') ?? '';
    if (
      options.onChunk &&
      contentType.includes('text/event-stream') &&
      response.body
    ) {
      const text = await readSseStream(
        response.body,
        options.onChunk,
        rearmTimer
      );
      if (text.length === 0) {
        return {
          ok: false,
          kind: 'parse',
          message: 'AI response did not contain a completion.',
        };
      }
      return { ok: true, content: text, model };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, kind: 'parse', message: 'AI response was not valid JSON.' };
    }
    const content = extractContent(payload);
    if (content === null) {
      return {
        ok: false,
        kind: 'parse',
        message: 'AI response did not contain a completion.',
      };
    }
    return { ok: true, content, model };
  } catch (err) {
    if (controller.signal.aborted && controller.signal.reason === 'timeout') {
      return { ok: false, kind: 'timeout', message: 'The AI request timed out.' };
    }
    const message =
      err instanceof Error ? err.message : String(err ?? 'network error');
    return { ok: false, kind: 'network', message };
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener('abort', onAbort);
  }
}
