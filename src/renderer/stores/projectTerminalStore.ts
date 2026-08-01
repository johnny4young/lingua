/** Transient renderer orchestration for one project-scoped terminal session. */

import { create } from 'zustand';
import type { RootId } from '../../shared/fs/brandedIds';
import type {
  ProjectTerminalExitEvent,
  ProjectTerminalStartFailureReason,
} from '../../shared/projectTerminal';
import { useNativeExecutionGateStore } from './nativeExecutionGateStore';
import { useSettingsStore } from './settingsStore';

const MAX_BUFFER_CHARS = 2 * 1024 * 1024;
const MAX_BUFFER_CHUNKS = 4_096;

export interface ProjectTerminalBinding {
  readonly rootId: RootId;
  readonly projectName: string;
}

interface ProjectTerminalChunk {
  readonly sequence: number;
  readonly data: string;
}

type ProjectTerminalStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'exited'
  | 'error'
  | 'unavailable';

interface ProjectTerminalState {
  readonly rootId: RootId | null;
  readonly projectName: string | null;
  readonly status: ProjectTerminalStatus;
  readonly sessionId: string | null;
  readonly shellName: string | null;
  readonly chunks: readonly ProjectTerminalChunk[];
  readonly bufferChars: number;
  readonly nextSequence: number;
  readonly exit: ProjectTerminalExitEvent | null;
  readonly error: ProjectTerminalStartFailureReason | null;
  start: (
    binding: ProjectTerminalBinding,
    columns: number,
    rows: number
  ) => Promise<void>;
  write: (data: string) => void;
  resize: (columns: number, rows: number) => void;
  stop: () => Promise<void>;
  clearBuffer: () => void;
  reset: (binding?: ProjectTerminalBinding) => void;
}

let listenersAttached = false;

/** Test seam for replacing the preload bridge between isolated store cases. */
export function _resetProjectTerminalListenersForTests(): void {
  listenersAttached = false;
}

function appendBoundedChunk(
  chunks: readonly ProjectTerminalChunk[],
  bufferChars: number,
  sequence: number,
  data: string
): { chunks: ProjectTerminalChunk[]; bufferChars: number } {
  const clippedData =
    data.length > MAX_BUFFER_CHARS ? data.slice(-MAX_BUFFER_CHARS) : data;
  const next = [...chunks, { sequence, data: clippedData }];
  let nextChars = bufferChars + clippedData.length;
  while (
    next.length > 1 &&
    (next.length > MAX_BUFFER_CHUNKS || nextChars > MAX_BUFFER_CHARS)
  ) {
    const removed = next.shift();
    nextChars -= removed?.data.length ?? 0;
  }
  return { chunks: next, bufferChars: Math.max(0, nextChars) };
}

function ensureTerminalListeners(): void {
  const bridge = window.lingua?.projectTerminal;
  if (!bridge || listenersAttached) return;
  listenersAttached = true;
  bridge.onData(event => {
    useProjectTerminalStore.setState(state => {
      const isPendingFirstChunk =
        state.status === 'starting' && state.sessionId === null;
      if (
        (!isPendingFirstChunk && state.sessionId !== event.sessionId) ||
        (state.status !== 'starting' && state.status !== 'running')
      ) {
        return state;
      }
      const appended = appendBoundedChunk(
        state.chunks,
        state.bufferChars,
        state.nextSequence,
        event.data
      );
      return {
        ...(isPendingFirstChunk ? { sessionId: event.sessionId } : {}),
        chunks: appended.chunks,
        bufferChars: appended.bufferChars,
        nextSequence: state.nextSequence + 1,
      };
    });
  });
  bridge.onExit(event => {
    useProjectTerminalStore.setState(state =>
      state.sessionId === event.sessionId ||
      (state.status === 'starting' && state.sessionId === null)
        ? {
            status: 'exited',
            sessionId: null,
            exit: event,
          }
        : state
    );
  });
}

export const useProjectTerminalStore = create<ProjectTerminalState>((set, get) => ({
  rootId: null,
  projectName: null,
  status: window.lingua?.projectTerminal ? 'idle' : 'unavailable',
  sessionId: null,
  shellName: null,
  chunks: [],
  bufferChars: 0,
  nextSequence: 1,
  exit: null,
  error: null,

  start: async (binding, columns, rows) => {
    const bridge = window.lingua?.projectTerminal;
    if (!bridge) {
      set({ status: 'unavailable', rootId: binding.rootId, projectName: binding.projectName });
      return;
    }
    const state = get();
    if (state.status === 'starting' || state.status === 'running') return;
    if (!useSettingsStore.getState().nativeExecutionAcknowledged) {
      useNativeExecutionGateStore.getState().request('project-terminal', () => {
        void get().start(binding, columns, rows);
      });
      return;
    }

    ensureTerminalListeners();
    set({
      rootId: binding.rootId,
      projectName: binding.projectName,
      status: 'starting',
      sessionId: null,
      shellName: null,
      chunks: [],
      bufferChars: 0,
      nextSequence: 1,
      exit: null,
      error: null,
    });
    try {
      const result = await bridge.start(binding.rootId, columns, rows);
      if (get().rootId !== binding.rootId || get().status !== 'starting') {
        if (result.ok) await bridge.stop(result.sessionId).catch(() => ({ stopped: false }));
        return;
      }
      if (!result.ok) {
        set({ status: 'error', error: result.reason });
        return;
      }
      set({
        status: 'running',
        sessionId: result.sessionId,
        shellName: result.shellName,
      });
    } catch {
      if (get().rootId === binding.rootId) {
        set({ status: 'error', error: 'spawn-failed' });
      }
    }
  },

  write: data => {
    const bridge = window.lingua?.projectTerminal;
    const sessionId = get().sessionId;
    if (!bridge || !sessionId || get().status !== 'running') return;
    void bridge.write(sessionId, data);
  },

  resize: (columns, rows) => {
    const bridge = window.lingua?.projectTerminal;
    const sessionId = get().sessionId;
    if (!bridge || !sessionId || get().status !== 'running') return;
    void bridge.resize(sessionId, columns, rows);
  },

  stop: async () => {
    const bridge = window.lingua?.projectTerminal;
    const sessionId = get().sessionId;
    if (!bridge || !sessionId) return;
    await bridge.stop(sessionId).catch(() => ({ stopped: false }));
    if (get().sessionId === sessionId) {
      set({
        status: 'exited',
        sessionId: null,
        exit: {
          sessionId,
          exitCode: null,
          signal: null,
          reason: 'stopped',
        },
      });
    }
  },

  clearBuffer: () => set({ chunks: [], bufferChars: 0 }),

  reset: binding => {
    const previousSessionId = get().sessionId;
    if (previousSessionId) void get().stop();
    set({
      rootId: binding?.rootId ?? null,
      projectName: binding?.projectName ?? null,
      status: window.lingua?.projectTerminal ? 'idle' : 'unavailable',
      sessionId: null,
      shellName: null,
      chunks: [],
      bufferChars: 0,
      nextSequence: 1,
      exit: null,
      error: null,
    });
  },
}));
