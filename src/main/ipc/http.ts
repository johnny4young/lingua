/** Typed lifecycle-owned bridge for guarded desktop HTTP live transports. */

import { parseHttpRequest } from '../../shared/httpWorkspacePersistence';
import {
  MAX_RESPONSE_BODY_BYTES,
  MAX_STREAM_MESSAGES_CEILING,
  type HttpDesktopRequestOptions,
  type HttpStreamProgress,
} from '../../shared/httpWorkspaceSchema';
import { typedHandle } from './typedHandle';
import { onOwnerReset } from '../runners/ownerReset';

const activeRuns = new Map<string, AbortController>();
const PROGRESS_INTERVAL_MS = 100;

function runKey(senderId: number, runId: string): string {
  return `${senderId}:${runId}`;
}

function parseRunId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) {
    throw new Error('Invalid HTTP run id');
  }
  return value;
}

function parseOptions(value: unknown): HttpDesktopRequestOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid HTTP options');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.allowPrivateHosts !== 'boolean') {
    throw new Error('Invalid private-host option');
  }
  if (!Array.isArray(record.userSensitiveHeaders)) {
    throw new Error('Invalid sensitive-header option');
  }
  const headers = record.userSensitiveHeaders.filter(
    (entry): entry is string => typeof entry === 'string'
  );
  if (headers.length !== record.userSensitiveHeaders.length) {
    throw new Error('Invalid sensitive-header entry');
  }
  const maxStreamMessages = record.maxStreamMessages;
  if (
    maxStreamMessages !== undefined &&
    (!Number.isInteger(maxStreamMessages) ||
      (maxStreamMessages as number) < 1 ||
      (maxStreamMessages as number) > MAX_STREAM_MESSAGES_CEILING)
  ) {
    throw new Error('Invalid stream message cap');
  }
  const maxResponseBodyBytes = record.maxResponseBodyBytes;
  if (
    maxResponseBodyBytes !== undefined &&
    (!Number.isInteger(maxResponseBodyBytes) ||
      (maxResponseBodyBytes as number) < 1 ||
      (maxResponseBodyBytes as number) > MAX_RESPONSE_BODY_BYTES)
  ) {
    throw new Error('Invalid response body cap');
  }
  if (record.progress !== undefined && record.progress !== 'delta') {
    throw new Error('Invalid progress mode');
  }
  return {
    allowPrivateHosts: record.allowPrivateHosts,
    userSensitiveHeaders: headers,
    ...(maxStreamMessages !== undefined ? { maxStreamMessages: maxStreamMessages as number } : {}),
    ...(maxResponseBodyBytes !== undefined
      ? { maxResponseBodyBytes: maxResponseBodyBytes as number }
      : {}),
    ...(record.progress === 'delta' ? { progress: 'delta' as const } : {}),
  };
}

export function registerHttpHandlers(): void {
  typedHandle(
    'http:execute',
    async (event, rawRunId: unknown, rawRequest: unknown, rawOptions: unknown) => {
      const runId = parseRunId(rawRunId);
      const request = parseHttpRequest(rawRequest);
      if (!request) throw new Error('Invalid HTTP request');
      const options = parseOptions(rawOptions);
      const key = runKey(event.sender.id, runId);
      activeRuns.get(key)?.abort('superseded');
      const controller = new AbortController();
      activeRuns.set(key, controller);
      const sender = event.sender;
      const stopObservingOwner = onOwnerReset(sender, () => controller.abort('renderer-destroyed'));
      // Coalescing bounds the IPC volume of a fast stream while the final
      // response stays authoritative. Delta runs send each appended span once.
      const deltas = options.progress === 'delta';
      let queuedLength = 0;
      let pending: HttpStreamProgress | null = null;
      let throttle: NodeJS.Timeout | null = null;
      const flushProgress = (): void => {
        const next = pending;
        pending = null;
        if (!next || sender.isDestroyed()) return;
        try {
          sender.send('http:stream-progress', next);
        } catch {
          // A frame can disappear before WebContents emits destroyed.
        }
      };
      const onProgress = (
        progress: Omit<HttpStreamProgress, 'runId' | 'requestId' | 'transport'>
      ): void => {
        let body = progress.body;
        if (deltas) {
          // A body cut back to its message cap ends the run; the shorter text adds nothing.
          const added = progress.body.length > queuedLength ? progress.body.slice(queuedLength) : '';
          queuedLength = Math.max(queuedLength, progress.body.length);
          body = (pending?.body ?? '') + added;
        }
        pending = {
          ...progress,
          body,
          runId,
          requestId: request.id,
          transport: request.transport === 'websocket' ? 'websocket' : 'sse',
        } satisfies HttpStreamProgress;
        if (throttle !== null) return;
        flushProgress();
        throttle = setInterval(() => {
          if (pending) {
            flushProgress();
            return;
          }
          if (throttle !== null) clearInterval(throttle);
          throttle = null;
        }, PROGRESS_INTERVAL_MS);
      };
      try {
        // undici and ws load with the first request, not with every launch.
        if (request.transport === 'websocket') {
          const { executeWebSocketProxyRequest } = await import('../httpWebSocket');
          return await executeWebSocketProxyRequest(request, {
            allowPrivateHosts: options.allowPrivateHosts,
            signal: controller.signal,
            onProgress,
          });
        }
        const { executeHttpProxyRequest } = await import('../httpProxy');
        return await executeHttpProxyRequest(request, {
          allowPrivateHosts: options.allowPrivateHosts,
          userSensitiveHeaders: options.userSensitiveHeaders,
          signal: controller.signal,
          ...(options.maxStreamMessages !== undefined
            ? { maxStreamMessages: options.maxStreamMessages }
            : {}),
          ...(options.maxResponseBodyBytes !== undefined
            ? { maxResponseBodyBytes: options.maxResponseBodyBytes }
            : {}),
          ...(request.transport === 'sse' ? { onProgress } : {}),
        });
      } finally {
        if (throttle !== null) clearInterval(throttle);
        flushProgress();
        if (activeRuns.get(key) === controller) activeRuns.delete(key);
        stopObservingOwner();
      }
    }
  );

  typedHandle('http:cancel', (event, rawRunId: unknown) => {
    const runId = parseRunId(rawRunId);
    const key = runKey(event.sender.id, runId);
    const controller = activeRuns.get(key);
    if (!controller) return { cancelled: false };
    controller.abort('cancelled');
    activeRuns.delete(key);
    return { cancelled: true };
  });
}

export function disposeHttpRuns(): void {
  for (const controller of activeRuns.values()) controller.abort('app-quit');
  activeRuns.clear();
}
