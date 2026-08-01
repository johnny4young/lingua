/** SSRF-guarded desktop WebSocket client with bounded live output. */

import { lookup as dnsLookup } from 'node:dns/promises';
import WebSocket, { type RawData } from 'ws';
import { composeRequestHeaders } from '../shared/httpWorkspaceHeaders';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_REQUEST_BODY_BYTES,
  MAX_REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BODY_BYTES,
  MAX_STREAM_MESSAGES,
  utf8ByteLength,
  type HttpRequestV1,
  type HttpResponseV1,
} from '../shared/httpWorkspaceSchema';
import {
  resolveGuardedNetworkTarget,
  type HttpProxyOptions,
  type LookupImpl,
} from './httpProxy';
import { createPinnedLookup } from './pinnedLookup';

const WEBSOCKET_PROTOCOLS = new Set(['ws:', 'wss:']);

export interface WebSocketProxyOptions
  extends Pick<
    HttpProxyOptions,
    'allowPrivateHosts' | 'signal' | 'lookupImpl' | 'maxResponseBodyBytes'
  > {
  onProgress?: (progress: {
    body: string;
    sizeBytes: number;
    messageCount: number;
    opened: boolean;
  }) => void;
  webSocketFactory?: typeof WebSocket;
}

function failure(
  request: HttpRequestV1,
  kind: 'network-error' | 'timeout' | 'too-large',
  message: string,
  startedAt: number,
  body = '',
  sizeBytes = 0,
  messageCount = 0
): HttpResponseV1 {
  return {
    version: 1,
    transport: 'websocket',
    kind,
    status: 0,
    statusText: '',
    url: request.url,
    finalUrl: request.url,
    headers: [],
    body,
    contentType: 'application/websocket',
    sizeBytes,
    durationMs: Math.max(0, Date.now() - startedAt),
    tooLarge: kind === 'too-large',
    redactedHeaders: [],
    recordedAt: new Date(startedAt).toISOString(),
    errorMessage: message,
    messageCount,
  };
}

function toHeaderRecord(request: HttpRequestV1): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of composeRequestHeaders(request)) {
    if (!entry.name.trim()) continue;
    if (/\r|\n/u.test(entry.name) || /\r|\n/u.test(entry.value)) continue;
    headers[entry.name] = entry.value;
  }
  return headers;
}

function rawDataBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Connect, optionally send one opening message, and settle when closed. */
export async function executeWebSocketProxyRequest(
  request: HttpRequestV1,
  options: WebSocketProxyOptions = {}
): Promise<HttpResponseV1> {
  const startedAt = Date.now();
  const allowPrivateHosts = options.allowPrivateHosts ?? false;
  const cap = options.maxResponseBodyBytes ?? MAX_RESPONSE_BODY_BYTES;
  const timeoutMs = Math.min(
    request.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    MAX_REQUEST_TIMEOUT_MS
  );
  const lookupImpl: LookupImpl =
    options.lookupImpl ?? ((hostname) => dnsLookup(hostname, { all: true }));

  let target;
  try {
    target = await resolveGuardedNetworkTarget(
      request.url,
      WEBSOCKET_PROTOCOLS,
      allowPrivateHosts,
      lookupImpl
    );
  } catch (error) {
    return failure(
      request,
      'network-error',
      error instanceof Error ? error.message : String(error),
      startedAt
    );
  }

  const openingMessage = request.body?.content ?? '';
  if (utf8ByteLength(openingMessage) > MAX_REQUEST_BODY_BYTES) {
    return failure(
      request,
      'network-error',
      'Opening message exceeds 1 MiB cap',
      startedAt
    );
  }

  return new Promise<HttpResponseV1>((resolve) => {
    const WebSocketImpl = options.webSocketFactory ?? WebSocket;
    let settled = false;
    let opened = false;
    let totalBytes = 0;
    let messageCount = 0;
    const session: {
      socket?: WebSocket;
      timer?: ReturnType<typeof setTimeout>;
    } = {};
    const messages: string[] = [];
    const finish = (response: HttpResponseV1): void => {
      if (settled) return;
      settled = true;
      if (session.timer) clearTimeout(session.timer);
      options.signal?.removeEventListener('abort', abort);
      resolve(response);
    };
    const snapshotBody = (): string => messages.join('\n');
    const emit = (): void => {
      options.onProgress?.({
        body: snapshotBody(),
        sizeBytes: totalBytes,
        messageCount,
        opened,
      });
    };
    const abort = (): void => {
      try {
        session.socket?.close(1000, 'cancelled');
      } catch {
        session.socket?.terminate();
      }
      finish(failure(request, 'network-error', 'Request cancelled', startedAt));
    };
    try {
      session.socket = new WebSocketImpl(target.url, {
        headers: toHeaderRecord(request),
        followRedirects: false,
        handshakeTimeout: timeoutMs,
        lookup: createPinnedLookup(target.addresses),
        maxPayload: cap,
        perMessageDeflate: false,
      });
    } catch (error) {
      finish(
        failure(
          request,
          'network-error',
          error instanceof Error ? error.message : String(error),
          startedAt
        )
      );
      return;
    }
    const socket = session.socket;
    session.timer = setTimeout(() => {
      socket.terminate();
      finish(
        failure(
          request,
          'timeout',
          'Request timed out',
          startedAt,
          snapshotBody(),
          totalBytes,
          messageCount
        )
      );
    }, timeoutMs);

    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener('abort', abort, { once: true });

    socket.once('open', () => {
      opened = true;
      emit();
      if (openingMessage.length > 0) socket.send(openingMessage);
    });
    socket.on('message', (data, isBinary) => {
      const bytes = rawDataBytes(data);
      totalBytes += bytes.byteLength;
      messageCount += 1;
      if (totalBytes > cap || messageCount > MAX_STREAM_MESSAGES) {
        socket.close(1009, 'Lingua stream limit reached');
        finish(
          failure(
            request,
            'too-large',
            messageCount > MAX_STREAM_MESSAGES
              ? `Stream exceeds ${MAX_STREAM_MESSAGES} message cap`
              : 'Stream exceeds 4 MiB cap',
            startedAt,
            snapshotBody(),
            totalBytes,
            messageCount
          )
        );
        return;
      }
      messages.push(
        isBinary
          ? `[binary message: ${bytes.byteLength} bytes]`
          : new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      );
      emit();
    });
    socket.once('error', (error) => {
      finish(failure(request, 'network-error', error.message, startedAt));
    });
    socket.once('unexpected-response', (_request, response) => {
      finish(
        failure(
          request,
          'network-error',
          `WebSocket upgrade rejected with HTTP ${response.statusCode}`,
          startedAt
        )
      );
      response.destroy();
    });
    socket.once('close', (code, reason) => {
      if (!opened) {
        finish(
          failure(request, 'network-error', 'WebSocket closed before opening', startedAt)
        );
        return;
      }
      finish({
        version: 1,
        transport: 'websocket',
        kind: 'success',
        status: 101,
        statusText: 'Switching Protocols',
        url: request.url,
        finalUrl: request.url,
        headers: [],
        body: snapshotBody(),
        contentType: 'application/websocket',
        sizeBytes: totalBytes,
        durationMs: Math.max(0, Date.now() - startedAt),
        tooLarge: false,
        redactedHeaders: [],
        recordedAt: new Date(startedAt).toISOString(),
        messageCount,
        closeCode: code,
        closeReason: reason.toString('utf8'),
      });
    });
  });
}
