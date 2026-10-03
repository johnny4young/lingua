/** Typed lifecycle-owned bridge for guarded desktop HTTP live transports. */

import { parseHttpRequest } from '../../shared/httpWorkspacePersistence';
import type {
  HttpDesktopRequestOptions,
  HttpStreamProgress,
} from '../../shared/httpWorkspaceSchema';
import { executeHttpProxyRequest } from '../httpProxy';
import { executeWebSocketProxyRequest } from '../httpWebSocket';
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
  return {
    allowPrivateHosts: record.allowPrivateHosts,
    userSensitiveHeaders: headers,
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
      // Each update carries the whole body so far; coalescing bounds the IPC
      // volume of a fast stream while the final response stays authoritative.
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
        pending = {
          ...progress,
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
        if (request.transport === 'websocket') {
          return await executeWebSocketProxyRequest(request, {
            allowPrivateHosts: options.allowPrivateHosts,
            signal: controller.signal,
            onProgress,
          });
        }
        return await executeHttpProxyRequest(request, {
          allowPrivateHosts: options.allowPrivateHosts,
          userSensitiveHeaders: options.userSensitiveHeaders,
          signal: controller.signal,
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
