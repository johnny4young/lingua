/**
 * Desktop transport for remote AI endpoints: a `fetch` that sends the chat
 * request through main's SSRF-guarded proxy, so no remote host needs CSP
 * room in the renderer. SSE bodies stream as main reports progress.
 */

import {
  MAX_REQUEST_TIMEOUT_MS,
  MAX_STREAM_MESSAGES_CEILING,
  type HttpDesktopAPI,
  type HttpRequestV1,
  type HttpResponseV1,
} from '../../shared/httpWorkspaceSchema';
import { AiResponseError } from './aiResponseBody';

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

export function createProxyAiFetch(bridge: HttpDesktopAPI): typeof fetch {
  return (input, init = {}) => {
    const runId = crypto.randomUUID();
    const body = typeof init.body === 'string' ? init.body : '';
    const headers = new Headers(init.headers);
    const stream = isEventStream(headers.get('accept') ?? undefined);
    const now = new Date().toISOString();
    const request: HttpRequestV1 = {
      version: 1,
      id: runId,
      name: 'AI chat',
      transport: stream ? 'sse' : 'http',
      method: 'POST',
      url: String(input),
      headers: [...headers].map(([name, value]) => ({ name, value, enabled: true })),
      body: { kind: 'json', content: body },
      // The caller owns the stall and absolute deadlines and cancels through the signal.
      timeoutMs: MAX_REQUEST_TIMEOUT_MS,
      createdAt: now,
      updatedAt: now,
    };
    const signal = init.signal ?? undefined;
    if (signal?.aborted) return Promise.reject(abortError(signal));

    return new Promise<Response>((resolve, reject) => {
      const encoder = new TextEncoder();
      let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
      let opened = false;
      let finished = false;
      let sent = 0;
      const push = (text: string): void => {
        if (text.length <= sent) return;
        streamController?.enqueue(encoder.encode(text.slice(sent)));
        sent = text.length;
      };
      const fail = (error: unknown): void => {
        if (finished) return;
        finished = true;
        if (opened) streamController?.error(error);
        else reject(error);
        cleanup();
      };
      const onAbort = (): void => {
        void bridge.cancel(runId);
        fail(abortError(signal));
      };
      const unsubscribe = bridge.onProgress((progress) => {
        if (finished || progress.runId !== runId) return;
        if (!opened) {
          if (!isEventStream(progress.contentType) || !isBodyStatus(progress.status)) return;
          opened = true;
          resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start: (controller) => {
                  streamController = controller;
                },
                cancel: () => {
                  finished = true;
                  void bridge.cancel(runId);
                  cleanup();
                },
              }),
              { status: progress.status, headers: { 'content-type': progress.contentType ?? '' } }
            )
          );
        }
        push(progress.body);
      });
      const cleanup = (): void => {
        unsubscribe();
        signal?.removeEventListener('abort', onAbort);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      bridge
        .execute(runId, request, {
          allowPrivateHosts: false,
          userSensitiveHeaders: [],
          ...(stream ? { maxStreamMessages: MAX_STREAM_MESSAGES_CEILING } : {}),
        })
        .then((response) => {
          if (finished) return;
          const error = responseError(response);
          if (error) {
            fail(error);
            return;
          }
          finished = true;
          if (opened) {
            push(response.body);
            streamController?.close();
          } else {
            resolve(toResponse(response));
          }
          cleanup();
        }, fail);
    });
  };
}

function isEventStream(contentType: string | undefined): boolean {
  return contentType?.toLowerCase().includes('text/event-stream') ?? false;
}

function isBodyStatus(status: number | undefined): status is number {
  return status !== undefined && status >= 200 && status <= 599 && !NULL_BODY_STATUSES.has(status);
}

function responseError(response: HttpResponseV1): Error | null {
  if (response.tooLarge) return new AiResponseError('limit');
  if (response.status === 0) return new TypeError(response.errorMessage ?? 'Network request failed');
  return null;
}

function toResponse(response: HttpResponseV1): Response {
  const status = response.status;
  return new Response(NULL_BODY_STATUSES.has(status) ? null : response.body, {
    status,
    statusText: response.statusText,
    headers: { 'content-type': response.contentType },
  });
}

function abortError(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('Aborted', 'AbortError');
}
