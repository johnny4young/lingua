/**
 * HTTP sends held while the system is offline. One entry per request, kept in
 * memory only and holding no request content: the request is read from the
 * collection and its variables resolved when it finally sends.
 */

import { create } from 'zustand';

interface QueuedHttpSend {
  /** A write waits for Send now once back online instead of going out by itself. */
  ready: boolean;
  /** Queued from Run chain, so its sources go out first when it sends. */
  forceChain?: boolean;
}

interface HttpOfflineQueueState {
  queued: Readonly<Record<string, QueuedHttpSend>>;
  enqueue: (requestId: string, forceChain?: boolean) => void;
  markReady: (requestId: string) => void;
  remove: (requestId: string) => void;
}

export const useHttpOfflineQueue = create<HttpOfflineQueueState>((set) => ({
  queued: {},
  enqueue: (requestId, forceChain) =>
    set((state) => ({ queued: { ...state.queued, [requestId]: { ready: false, ...(forceChain ? { forceChain } : {}) } } })),
  markReady: (requestId) => {
    set((state) => {
      const entry = state.queued[requestId];
      return entry ? { queued: { ...state.queued, [requestId]: { ...entry, ready: true } } } : state;
    });
  },
  remove: (requestId) =>
    set((state) => {
      if (!(requestId in state.queued)) return state;
      const { [requestId]: _removed, ...rest } = state.queued;
      return { queued: rest };
    }),
}));

/** Methods that only read go out by themselves when the connection returns. */
export const sendsByItselfOnline = (method: string): boolean => method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
