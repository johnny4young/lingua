/**
 * HTTP sends held while the system is offline. One entry per request, kept in
 * memory only and holding no request content: the request is read from the
 * collection and its variables resolved when it finally sends.
 */

import { create } from 'zustand';

export interface QueuedHttpSend {
  /** A write waits for Send now once back online instead of going out by itself. */
  ready: boolean;
}

interface HttpOfflineQueueState {
  queued: Readonly<Record<string, QueuedHttpSend>>;
  enqueue: (requestId: string) => void;
  markReady: (requestId: string) => void;
  remove: (requestId: string) => void;
}

export const useHttpOfflineQueue = create<HttpOfflineQueueState>((set) => ({
  queued: {},
  enqueue: (requestId) => set((state) => ({ queued: { ...state.queued, [requestId]: { ready: false } } })),
  markReady: (requestId) =>
    set((state) => (state.queued[requestId] ? { queued: { ...state.queued, [requestId]: { ready: true } } } : state)),
  remove: (requestId) =>
    set((state) => {
      if (!(requestId in state.queued)) return state;
      const { [requestId]: _removed, ...rest } = state.queued;
      return { queued: rest };
    }),
}));

/** Methods that only read go out by themselves when the connection returns. */
export const sendsByItselfOnline = (method: string): boolean => method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
