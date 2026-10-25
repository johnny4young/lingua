import { useCallback, useEffect, useRef } from 'react';
import { interpolateRequest } from '../../../shared/httpEnvironment';
import type { HttpRequestV1 } from '../../../shared/httpWorkspaceSchema';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { sendsByItselfOnline, useHttpOfflineQueue } from '../../stores/httpOfflineQueueStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceToolStore } from '../../stores/workspaceToolStore';
import { isLocalNetworkHostname } from '../../utils/loopbackHost';
import type { HttpSendQueue } from './HttpSendButton';
import { scopedEnvironmentFor } from './httpScopes';

/** Whether an HTTP request needs the internet: false for local and private hosts, which answer offline too. */
function needsInternet(request: HttpRequestV1): boolean {
  if ((request.transport ?? 'http') !== 'http') return false;
  try {
    const env = scopedEnvironmentFor(request, useWorkspaceToolStore.getState().getActiveEnvironment() ?? null);
    return !isLocalNetworkHostname(new URL(interpolateRequest(request, env).url).hostname);
  } catch {
    return false;
  }
}

/**
 * Sends from the editor, or holds them while the system is offline. When the
 * connection returns, held reads go out one at a time and held writes wait
 * for Send now. Pipelines call `send` directly and never queue.
 */
export function useHttpOfflineSend(send: (request: HttpRequestV1) => Promise<unknown>) {
  const online = useOnlineStatus();
  const queued = useHttpOfflineQueue((state) => state.queued);
  const willQueue = useCallback((request: HttpRequestV1) => !online && needsInternet(request), [online]);

  const sendFromEditor = useCallback(
    (request: HttpRequestV1) => {
      const queue = useHttpOfflineQueue.getState();
      if (queue.queued[request.id]?.ready === false && !online) return;
      if (!willQueue(request)) {
        queue.remove(request.id);
        void send(request);
        return;
      }
      queue.enqueue(request.id);
      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        messageKey: sendsByItselfOnline(request.method) ? 'httpWorkspace.offline.queuedRead' : 'httpWorkspace.offline.queuedWrite',
      });
    },
    [send, willQueue, online]
  );

  // Watches held entries, not the offline edge: the connection may have returned while the panel was closed.
  const held = useHttpOfflineQueue((state) => Object.values(state.queued).some((entry) => !entry.ready));
  const flushing = useRef(false);
  useEffect(() => {
    if (!online || !held || flushing.current) return;
    flushing.current = true;
    void (async () => {
      let waiting = 0;
      try {
        while (navigator.onLine) {
          // A reconnect can add held entries while an earlier send is pending.
          // Select from the live queue after every await, including new ids.
          const queue = useHttpOfflineQueue.getState();
          const requestId = Object.keys(queue.queued).find((id) => queue.queued[id]?.ready === false);
          if (requestId === undefined) break;
          const request = useWorkspaceToolStore.getState().requests.find((candidate) => candidate.id === requestId);
          if (!request) {
            queue.remove(requestId);
          } else if (sendsByItselfOnline(request.method)) {
            queue.remove(requestId);
            // One at a time: a new send aborts the one in flight.
            await send(request);
          } else {
            queue.markReady(requestId);
            waiting += 1;
          }
        }
      } finally {
        flushing.current = false;
      }
      if (waiting > 0) {
        useUIStore.getState().pushStatusNotice({ tone: 'info', messageKey: 'httpWorkspace.offline.waiting', values: { count: waiting } });
      }
    })();
  }, [online, held, send]);

  const queueFor = useCallback(
    (request: HttpRequestV1): HttpSendQueue => {
      const entry = queued[request.id];
      return {
        willQueue: willQueue(request),
        state: entry ? (entry.ready ? 'ready' : 'queued') : null,
        onRemove: () => useHttpOfflineQueue.getState().remove(request.id),
      };
    },
    [queued, willQueue]
  );

  return { sendFromEditor, queueFor };
}
