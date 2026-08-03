/** Typed lifecycle-owned bridge for guarded desktop HTTP live transports. */

import { parseHttpRequest } from '../../shared/httpWorkspacePersistence';
import type {
  HttpDesktopRequestOptions,
  HttpStreamProgress,
} from '../../shared/httpWorkspaceSchema';
import { executeHttpProxyRequest } from '../httpProxy';
import { executeWebSocketProxyRequest } from '../httpWebSocket';
import { typedHandle } from './typedHandle';

const activeRuns = new Map<string, AbortController>();

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
      const stopOnDestroyed = (): void => controller.abort('renderer-destroyed');
      sender.once('destroyed', stopOnDestroyed);
      const onProgress = (
        progress: Omit<HttpStreamProgress, 'runId' | 'requestId' | 'transport'>
      ): void => {
        if (sender.isDestroyed()) return;
        sender.send('http:stream-progress', {
          ...progress,
          runId,
          requestId: request.id,
          transport: request.transport === 'websocket' ? 'websocket' : 'sse',
        } satisfies HttpStreamProgress);
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
        if (activeRuns.get(key) === controller) activeRuns.delete(key);
        sender.removeListener('destroyed', stopOnDestroyed);
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
