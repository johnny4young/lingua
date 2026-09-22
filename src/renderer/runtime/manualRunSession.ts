import i18next from 'i18next';
import { announce } from '../stores/announcerStore';
import { useConsoleStore } from '../stores/consoleStore';
import { useEditorStore } from '../stores/editorStore';
import { useResultStore } from '../stores/resultStore';
import type { FileTab } from '../types/editor';

/** In-memory ownership only: never serialized into tabs, history or capsules. */
export interface ManualRunSession {
  readonly tabId: string | null;
  isCurrent: () => boolean;
  onCancel: (stop: () => void) => () => void;
  cancel: () => void;
  finish: () => void;
}

/** Claim before any lazy import so Stop also owns the preparation window. */
export function beginManualRun(tab?: FileTab, debug = false): ManualRunSession | null {
  const state = useResultStore.getState();
  if (state.isManualRunning || state.manualRunSession) return null;
  const cancellations = new Set<() => void>();
  let unsubscribe: (() => void) | undefined;
  let revoked = false;
  const release = (stopped = false) => {
    unsubscribe?.();
    unsubscribe = undefined;
    useResultStore.setState({
      manualRunSession: null,
      isManualRunning: false,
      isManualInitializing: false,
      manualLoadingMessage: null,
      manualRunMode: null,
      ...(stopped ? { runDeadlineAt: null, runTermination: { kind: 'stopped' as const } } : {}),
    });
  };
  const session: ManualRunSession = {
    tabId: tab?.id ?? null,
    isCurrent: () => !revoked && useResultStore.getState().manualRunSession === session,
    onCancel: stop => {
      if (session.isCurrent()) cancellations.add(stop);
      return () => {
        cancellations.delete(stop);
      };
    },
    cancel: () => {
      if (!session.isCurrent()) return;
      // Revoke publication before stopping the worker: stop itself may resolve
      // its pending promise synchronously. Never dynamically import a global
      // stop function that could instead target the next run.
      revoked = true;
      if (tab) useEditorStore.getState().setTabExecutionState(tab.id, 'idle');
      const message = i18next.t('runner.stopped.message');
      useConsoleStore.getState().addEntry({ type: 'warn', content: message });
      announce(i18next.t('console.run.announce.stopped'));
      for (const stop of cancellations) {
        try {
          stop();
        } catch {
          /* Publication remains revoked if teardown fails. */
        }
      }
      cancellations.clear();
      release(true);
    },
    finish: () => {
      if (!session.isCurrent()) return;
      cancellations.clear();
      release();
    },
  };
  useResultStore.setState({
    manualRunSession: session,
    isManualRunning: true,
    manualRunMode: debug ? 'debug' : 'run',
  });
  // Direct smoke callers can execute a synthetic tab outside the editor. Only
  // subscribe when this run actually belongs to an open editor tab.
  if (tab && useEditorStore.getState().tabs.some(candidate => candidate.id === tab.id)) {
    unsubscribe = useEditorStore.subscribe(state => {
      if (!state.tabs.some(candidate => candidate.id === tab.id)) session.cancel();
    });
  }
  return session;
}
