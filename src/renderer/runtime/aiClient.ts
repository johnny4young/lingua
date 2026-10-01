/**
 * AI provider client (OpenAI-compatible chat).
 *
 * Sends a chat request (built by `shared/ai/explainError.ts`) to the user's
 * BYO endpoint and returns a typed result. Per `docs/LOCAL_AI_ADR.md`:
 *   - BYO-API-key, provider-agnostic OpenAI-compatible `/chat/completions`.
 *   - Ships on web + desktop via `fetch`; on web it is CORS-bound (documented).
 *     Desktop can later route through the SSRF-guarded main proxy.
 *   - Only ever called from an explicit user action (the caller enforces the
 *     consent-preview gate); this module performs the transport only.
 *
 * Never throws — always settles to a typed `AiChatResult`. The API key is
 * never echoed into any error message.
 */

import type { ChatMessage } from '../../shared/ai/explainError';
import { readAiResponseBody, AiResponseError, AI_RESPONSE_LIMITS } from './aiResponseBody';

/** Default request timeout. */
const DEFAULT_AI_TIMEOUT_MS = 60_000;
/** Hard cap so a caller override can't disable the deadline. */
const MAX_AI_TIMEOUT_MS = 5 * 60_000;

export interface AiProviderConfig {
  /** Full chat-completions URL, e.g. https://api.openai.com/v1/chat/completions. */
  readonly endpoint: string;
  /** BYO API key. Stored locally only; never logged or echoed. */
  readonly apiKey: string;
  /** Optional default model id. */
  readonly model?: string;
}

type AiErrorKind =
  'config' | 'network' | 'timeout' | 'auth' | 'http' | 'parse' | 'limit' | 'cancelled';

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
  /** Absolute wall-clock budget, independently of streaming activity. */
  readonly absoluteTimeoutMs?: number;
  /**
   * Streaming: when provided the request asks for SSE (`stream: true`) and
   * this callback receives the ACCUMULATED text after every delta, so a UI
   * can render progressively. The resolved result still carries the full
   * content. Servers that ignore `stream` fall back to the single-JSON
   * parse transparently. With streaming, the timeout is a STALL deadline —
   * it re-arms on every chunk — subject to a separate five-minute absolute ceiling. Updates are coalesced
   * to at most one per 50 ms, plus the first and final accepted text.
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
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
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
  const timeoutMs = boundedTimeout(options.timeoutMs, DEFAULT_AI_TIMEOUT_MS);
  const absoluteTimeoutMs = boundedTimeout(options.absoluteTimeoutMs, MAX_AI_TIMEOUT_MS);
  let timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  const absoluteTimer = setTimeout(() => controller.abort('timeout'), absoluteTimeoutMs);
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
    if (controller.signal.aborted) throw new AiResponseError('cancelled');
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
        detail = await readAiResponseBody(response, controller.signal, rearmTimer);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        // Oversized/unreadable errors keep the HTTP status, not a partial body.
      }
      // Defense in depth: a misconfigured proxy/server can echo the request
      // `Authorization` header back in its error body, which would reintroduce
      // the key into the UI string. Scrub any literal occurrence of the key
      // before it is appended so the "key never leaks" guarantee holds even on
      // the endpoint-error path. split/join avoids regex-escaping the key.
      if (detail) {
        detail = detail.split(normalizedConfig.apiKey).join('[redacted]').slice(0, 500);
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
    if (options.onChunk && contentType.includes('text/event-stream') && response.body) {
      const text = await readAiResponseBody(
        response,
        controller.signal,
        rearmTimer,
        options.onChunk
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
      payload = JSON.parse(await readAiResponseBody(response, controller.signal, rearmTimer));
    } catch (error) {
      if (error instanceof AiResponseError || controller.signal.aborted) throw error;
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
    if (new TextEncoder().encode(content).byteLength > AI_RESPONSE_LIMITS.contentBytes)
      throw new AiResponseError('limit');
    return { ok: true, content, model };
  } catch (err) {
    if (controller.signal.aborted && controller.signal.reason === 'timeout') {
      return { ok: false, kind: 'timeout', message: 'The AI request timed out.' };
    }
    if (controller.signal.aborted)
      return { ok: false, kind: 'cancelled', message: 'The AI request was cancelled.' };
    if (err instanceof AiResponseError) return { ok: false, kind: err.kind, message: err.message };
    const message = (err instanceof Error ? err.message : String(err ?? 'network error'))
      .split(normalizedConfig.apiKey)
      .join('[redacted]');
    return { ok: false, kind: 'network', message };
  } finally {
    clearTimeout(timer);
    clearTimeout(absoluteTimer);
    controller.abort('finished');
    if (options.signal) options.signal.removeEventListener('abort', onAbort);
  }
}

function boundedTimeout(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value) || 1, MAX_AI_TIMEOUT_MS)
    : fallback;
}
