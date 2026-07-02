import { useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import type {
  LspLanguageStatus,
  LspLanguageStore,
} from '../stores/lspLanguageStoreFactory';
import { useUIStore } from '../stores/uiStore';
import type { LspLanguageIntelligenceAdapter } from '../languageIntelligence/types';
import { LINGUA_LANGUAGE_INTELLIGENCE_MARKER_OWNER } from './useLanguageIntelligenceDiagnostics';

/**
 * RL-026 Slice 4 — generic lifecycle hook for a desktop LSP language.
 *
 * Slice 3 introduced this shape inline for Rust; Slice 4 lifts it
 * into a config-driven helper so the Rust + Go (and any future LSP)
 * paths stay byte-identical. The hook is composed of four effects so
 * each concern stays auditable in isolation:
 *
 *   1. Boot trigger — when the first matching-language tab opens
 *      (and the bridge is present), call `bridge.start()`. Re-entrant:
 *      a second tab in the same language just calls `start()` again,
 *      which is a fast path in main when the launcher is already
 *      alive.
 *   2. Status sync — bridge → store. The same store is read by the
 *      Settings row and the boot trigger so the UI and the boot path
 *      see the same truth.
 *   3. Toast on first `'available'` — fire a one-shot `StatusNotice`
 *      announcing the server is up. Subsequent transitions (after a
 *      manual restart) stay silent so the banner does not pop on
 *      every recovery.
 *   4. Diagnostics wire — when `'available'`, subscribe the adapter's
 *      `subscribeDiagnostics` to Monaco's `setModelMarkers`. The
 *      marker owner matches the Python sync path so they share the
 *      `lingua-language-intelligence` namespace; cleanup clears stale
 *      markers on every matching-language model when the LSP drops
 *      back below `'available'`.
 */

type MonacoApi = typeof import('monaco-editor/esm/vs/editor/editor.api.js');

/**
 * Lazily-imported Monaco accessor (same pattern as `useDocumentSymbols`).
 * This hook mounts in AppChrome on every build, but only the diagnostics
 * effect — which runs exclusively after a desktop LSP reaches
 * `'available'` — touches Monaco. A static top-level import here was the
 * edge that pulled the entire ~3.8 MB monaco chunk into the INITIAL web
 * bundle; keep the import inside the effect so cold loads stay lean.
 */
async function resolveMonaco(): Promise<MonacoApi> {
  return import('monaco-editor/esm/vs/editor/editor.api.js');
}

function severityFor(
  monacoNs: MonacoApi,
  severity: 'error' | 'warning' | 'info'
): number {
  switch (severity) {
    case 'error':
      return monacoNs.MarkerSeverity.Error;
    case 'warning':
      return monacoNs.MarkerSeverity.Warning;
    case 'info':
    default:
      return monacoNs.MarkerSeverity.Info;
  }
}

type BridgeStatus =
  | { kind: 'unknown' }
  | { kind: 'starting' }
  | { kind: 'running'; version: string }
  | { kind: 'missing'; reason: string }
  | { kind: 'startup-failed'; error: string }
  | { kind: 'degraded'; error: string }
  | { kind: 'stopped' };

interface LspBridge {
  start: () => Promise<BridgeStatus>;
  status: () => Promise<BridgeStatus>;
  onStatusChanged: (callback: (status: BridgeStatus) => void) => () => void;
}

export interface LspLifecycleConfig {
  /** Lingua language id — `'rust'` for `.rs`, `'go'` for `.go`. */
  language: string;
  /** Diagnostic source label written to Monaco markers. */
  diagnosticSource: string;
  /** i18n key for the ready-toast copy. Interpolates `{{ version }}`. */
  toastMessageKey: string;
  /** Live capability store factory output. */
  store: LspLanguageStore;
  /** True when the desktop bridge for this language exists. */
  isAvailable: () => boolean;
  /** Adapter accessor (used by the diagnostics-wire effect). */
  getAdapter: () => LspLanguageIntelligenceAdapter | null;
  /** Bridge accessor (used by boot trigger + status sync). */
  getBridge: () => LspBridge;
}

export function useLspLifecycle(config: LspLifecycleConfig): void {
  const { language, diagnosticSource, toastMessageKey, store, isAvailable, getAdapter, getBridge } =
    config;
  const setStatus = store((state) => state.setStatus);
  const markBootRequested = store((state) => state.markBootRequested);
  const markReadyToastShown = store((state) => state.markReadyToastShown);
  const readyToastShown = store((state) => state.readyToastShown);
  const bootRequested = store((state) => state.bootRequested);
  const status = store((state) => state.status);
  const pushStatusNotice = useUIStore((state) => state.pushStatusNotice);
  // Fold to a primitive INSIDE the selector: subscribing to `state.tabs`
  // would re-render this hook's host (AppChrome — the whole shell) on
  // every keystroke, because updateContent rebuilds the tabs array.
  const hasMatchingTab = useEditorStore((state) =>
    state.tabs.some((tab) => tab.language === language)
  );

  // Effect 1 — boot trigger
  useEffect(() => {
    if (!isAvailable()) {
      setStatus({ kind: 'unavailable', reason: 'web-build' });
      return;
    }
    if (!hasMatchingTab) return;
    if (bootRequested) return;
    markBootRequested();
    void getBridge().start();
  }, [bootRequested, hasMatchingTab, markBootRequested, setStatus, isAvailable, getBridge]);

  // Effect 2 — status sync
  useEffect(() => {
    if (!isAvailable()) return;
    const bridge = getBridge();
    const unsubscribe = bridge.onStatusChanged((next) => {
      setStatus(mapBridgeStatus(next));
    });
    void bridge
      .status()
      .then((current) => setStatus(mapBridgeStatus(current)))
      .catch(() => {
        // Ignore — `unknown` is a valid initial state.
      });
    return unsubscribe;
  }, [setStatus, isAvailable, getBridge]);

  // Effect 3 — toast on first 'available'
  useEffect(() => {
    if (status.kind !== 'available') return;
    if (readyToastShown) return;
    markReadyToastShown();
    pushStatusNotice({
      tone: 'success',
      messageKey: toastMessageKey,
      values: { version: status.version },
    });
  }, [status, readyToastShown, markReadyToastShown, pushStatusNotice, toastMessageKey]);

  // Effect 4 — diagnostics wire
  useEffect(() => {
    if (status.kind !== 'available') return;
    const adapter = getAdapter();
    if (!adapter) return;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    let monacoApi: MonacoApi | null = null;
    void resolveMonaco().then((monacoNs) => {
      if (disposed) return;
      monacoApi = monacoNs;
      unsubscribe = adapter.subscribeDiagnostics((uri, diagnostics) => {
        const model = monacoNs.editor.getModels().find((m) => m.uri.toString() === uri);
        if (!model) return;
        monacoNs.editor.setModelMarkers(
          model,
          LINGUA_LANGUAGE_INTELLIGENCE_MARKER_OWNER,
          diagnostics.map((diagnostic) => ({
            startLineNumber: diagnostic.line,
            startColumn: diagnostic.column,
            endLineNumber: diagnostic.endLine ?? diagnostic.line,
            endColumn: diagnostic.endColumn ?? diagnostic.column + 1,
            message: diagnostic.message,
            severity: severityFor(monacoNs, diagnostic.severity),
            source: diagnosticSource,
          }))
        );
      });
    });
    return () => {
      disposed = true;
      unsubscribe?.();
      if (!monacoApi) return;
      for (const model of monacoApi.editor.getModels()) {
        if (model.getLanguageId() === language) {
          monacoApi.editor.setModelMarkers(
            model,
            LINGUA_LANGUAGE_INTELLIGENCE_MARKER_OWNER,
            []
          );
        }
      }
    };
  }, [status, getAdapter, language, diagnosticSource]);
}

interface LspDocumentSyncAdapter {
  openDocument: (uri: string, content: string) => void;
  closeDocument: (uri: string) => void;
}

export interface LspDocumentSyncConfig {
  language: string;
  store: LspLanguageStore;
  getAdapter: () => LspDocumentSyncAdapter | null;
}

interface EditorWithModel {
  getModel: () => { uri: { toString: () => string }; getLanguageId?: () => string } | null;
}

interface ActiveLspTab {
  id: string;
  language: string;
  content: string;
}

export const LSP_DOCUMENT_SYNC_DEBOUNCE_MS = 150;

export function useLspDocumentSync(
  editor: EditorWithModel | null,
  activeTab: ActiveLspTab | null | undefined,
  config: LspDocumentSyncConfig
): void {
  const { language, store, getAdapter } = config;
  const status = store((state) => state.status);
  const openUriRef = useRef<string | null>(null);

  // Effect 1: track which uri is currently open and close it on tab change.
  useEffect(() => {
    const adapter = getAdapter();
    const model =
      status.kind === 'available' && activeTab?.language === language
        ? editor?.getModel()
        : null;
    const nextUri = model?.uri.toString() ?? null;
    const previousUri = openUriRef.current;

    if (previousUri && previousUri !== nextUri) {
      adapter?.closeDocument(previousUri);
      openUriRef.current = null;
    }

    if (nextUri) {
      openUriRef.current = nextUri;
    }

    return () => {
      if (nextUri && openUriRef.current === nextUri) {
        adapter?.closeDocument(nextUri);
        openUriRef.current = null;
      }
    };
  }, [editor, activeTab?.id, activeTab?.language, status.kind, language, getAdapter]);

  // Effect 2: open / didChange with a small debounce so rapid typing
  // doesn't flood the LSP.
  useEffect(() => {
    if (status.kind !== 'available') return;
    if (activeTab?.language !== language) return;
    const model = editor?.getModel();
    if (!model) return;
    const adapter = getAdapter();
    if (!adapter) return;

    const uri = model.uri.toString();
    const timeout = window.setTimeout(() => {
      adapter.openDocument(uri, activeTab.content);
    }, LSP_DOCUMENT_SYNC_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [editor, activeTab?.id, activeTab?.language, activeTab?.content, status, language, getAdapter]);
}

function mapBridgeStatus(bridge: BridgeStatus): LspLanguageStatus {
  switch (bridge.kind) {
    case 'running':
      return { kind: 'available', version: bridge.version };
    case 'missing':
      return bridge.reason === 'web-build'
        ? { kind: 'unavailable', reason: 'web-build' }
        : { kind: 'unavailable', reason: 'missing', detail: bridge.reason };
    case 'startup-failed':
      return { kind: 'unavailable', reason: 'startup-failed', detail: bridge.error };
    case 'degraded':
      return { kind: 'degraded', detail: bridge.error };
    case 'stopped':
    case 'unknown':
    case 'starting':
    default:
      return { kind: 'unknown' };
  }
}
