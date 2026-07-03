/**
 * T19 / RL-031 Slice 2 — AI provider client (OpenAI-compatible chat).
 *
 * Sends a chat request (built by `shared/ai/explainError.ts`) to the user's
 * BYO endpoint and returns a typed result. Per `docs/LOCAL_AI_ADR.md`:
 *   - BYO-API-key, provider-agnostic OpenAI-compatible `/chat/completions`.
 *   - Ships on web + desktop via `fetch`; on web it is CORS-bound (documented).
 *     Desktop can later route through the T7 SSRF-guarded main proxy.
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
  /** Test seam: override global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/** Validate the endpoint is a well-formed http(s) URL. */
function validateConfig(config: AiProviderConfig): string | null {
  if (!config.apiKey || config.apiKey.trim().length === 0) {
    return 'No API key configured.';
  }
  let url: URL;
  try {
    url = new URL(config.endpoint);
  } catch {
    return 'AI endpoint is not a valid URL.';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'AI endpoint must be an http(s) URL.';
  }
  return null;
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
  const configError = validateConfig(config);
  if (configError) return { ok: false, kind: 'config', message: configError };

  const model = request.model ?? config.model;
  if (!model) {
    return { ok: false, kind: 'config', message: 'No model configured.' };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timeoutMs = Math.min(
    options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
    MAX_AI_TIMEOUT_MS
  );
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  const onAbort = (): void => controller.abort(options.signal?.reason ?? 'cancelled');
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        stream: false,
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
