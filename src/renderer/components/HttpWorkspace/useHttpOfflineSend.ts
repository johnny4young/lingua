import { useCallback, useEffect, useRef } from 'react';
import { interpolateRequest } from '../../../shared/httpEnvironment';
import type { HttpRequestV1 } from '../../../shared/httpWorkspaceSchema';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { sendsByItselfOnline, useHttpOfflineQueue } from '../../stores/httpOfflineQueueStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceToolStore } from '../../stores/workspaceToolStore';
import { isLocalNetworkHostname } from '../../utils/loopbackHost';
import type { HttpSendQueue } from './HttpSendButton';

/** Whether an HTTP request needs the internet: false for local and private hosts, which answer offline too. */
function needsInternet(request: HttpRequestV1): boolean {
  if ((request.transport ?? 'http') !== 'http') return false;
  try {
    const env = useWorkspaceToolStore.getState().getActiveEnvironment() ?? null;
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
    [send, willQueue]
  );

  const wasOnline = useRef(online);
  useEffect(() => {
    const back = online && !wasOnline.current;
    wasOnline.current = online;
    if (!back) return;
    void (async () => {
      const queue = useHttpOfflineQueue.getState();
      let waiting = 0;
      for (const requestId of Object.keys(queue.queued)) {
        const request = useWorkspaceToolStore.getState().requests.find((entry) => entry.id === requestId);
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
      if (waiting > 0) {
        useUIStore.getState().pushStatusNotice({ tone: 'info', messageKey: 'httpWorkspace.offline.waiting', values: { count: waiting } });
      }
    })();
  }, [online, send]);

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
