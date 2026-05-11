import { useEffect, useRef } from 'react';
import * as monacoNs from 'monaco-editor/esm/vs/editor/editor.api.js';
import {
  getRustLspAdapter,
  isRustLspAvailable,
} from '../languageIntelligence/rustAdapterSingleton';
import { useEditorStore } from '../stores/editorStore';
import { useRustLanguageStore, type RustLanguageStatus } from '../stores/rustLanguageStore';
import { useUIStore } from '../stores/uiStore';
import { LINGUA_LANGUAGE_INTELLIGENCE_MARKER_OWNER } from './useLanguageIntelligenceDiagnostics';

export const RUST_LSP_DOCUMENT_SYNC_DEBOUNCE_MS = 150;

interface ActiveRustTab {
  id: string;
  language: string;
  content: string;
}

interface EditorWithModel {
  getModel: () => { uri: { toString: () => string }; getLanguageId?: () => string } | null;
}

/**
 * RL-026 Slice 3 — orchestrate rust-analyzer's runtime lifecycle.
 *
 * Mounted once at the App level. The hook is split into four
 * `useEffect` blocks so each concern stays auditable in isolation:
 *
 *   1. Boot trigger — when the first Rust tab opens (and the bridge is
 *      present), call `lingua.lsp.rust.start()`. Re-entrant: a second
 *      `.rs` open just calls `start()` again, which is a fast path in
 *      main when the launcher is already alive.
 *   2. Status sync — bridge → `useRustLanguageStore`. The same store
 *      is read by the Settings row and the boot trigger so the UI and
 *      the boot path see the same truth.
 *   3. Toast on first `'running'` — fire a one-shot `StatusNotice`
 *      announcing rust-analyzer is up. Subsequent `'running'`
 *      transitions (e.g. after a manual restart) stay silent so the
 *      banner does not pop on every recovery.
 *   4. Diagnostics wire — when `'running'`, subscribe the adapter's
 *      `subscribeDiagnostics` to Monaco's `setModelMarkers`. The
 *      marker owner matches the Python sync path so they share the
 *      `lingua-language-intelligence` namespace.
 */
function severityFor(severity: 'error' | 'warning' | 'info'): number {
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

export function useRustLspLifecycle(): void {
  const setStatus = useRustLanguageStore((state) => state.setStatus);
  const markBootRequested = useRustLanguageStore((state) => state.markBootRequested);
  const markReadyToastShown = useRustLanguageStore((state) => state.markReadyToastShown);
  const readyToastShown = useRustLanguageStore((state) => state.readyToastShown);
  const bootRequested = useRustLanguageStore((state) => state.bootRequested);
  const pushStatusNotice = useUIStore((state) => state.pushStatusNotice);
  const tabs = useEditorStore((state) => state.tabs);

  const hasRustTab = tabs.some((tab) => tab.language === 'rust');

  // Effect 1 — boot trigger
  useEffect(() => {
    if (!isRustLspAvailable()) {
      setStatus({ kind: 'unavailable', reason: 'web-build' });
      return;
    }
    if (!hasRustTab) return;
    if (bootRequested) return;
    markBootRequested();
    void window.lingua.lsp.rust.start();
  }, [bootRequested, hasRustTab, markBootRequested, setStatus]);

  // Effect 2 — status sync
  useEffect(() => {
    if (!isRustLspAvailable()) return;
    const unsubscribe = window.lingua.lsp.rust.onStatusChanged((next) => {
      setStatus(mapBridgeStatus(next));
    });
    // Pull the initial value once on mount so the store reflects an
    // already-running server when a renderer hot-reloads.
    void window.lingua.lsp.rust
      .status()
      .then((current) => setStatus(mapBridgeStatus(current)))
      .catch(() => {
        // Ignore — `unknown` is a valid initial state.
      });
    return unsubscribe;
  }, [setStatus]);

  // Effect 3 — toast on first 'running'
  const status = useRustLanguageStore((state) => state.status);
  useEffect(() => {
    if (status.kind !== 'available') return;
    if (readyToastShown) return;
    markReadyToastShown();
    pushStatusNotice({
      tone: 'success',
      messageKey: 'languageIntelligence.rust.toast.ready',
      values: { version: status.version },
    });
  }, [status, readyToastShown, markReadyToastShown, pushStatusNotice]);

  // Effect 4 — diagnostics wire
  useEffect(() => {
    if (status.kind !== 'available') return;
    const adapter = getRustLspAdapter();
    if (!adapter) return;
    const unsubscribe = adapter.subscribeDiagnostics((uri, diagnostics) => {
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
          severity: severityFor(diagnostic.severity),
          source: 'rust-analyzer',
        }))
      );
    });
    return () => {
      unsubscribe();
      // When the LSP transitions out of 'available' (degraded, missing
      // after stop, etc.) the diagnostics it last published become
      // stale. Sync-adapter languages have their own cleanup in
      // `useLanguageIntelligenceDiagnostics`, but Rust is push-only —
      // clear the markers explicitly on every Rust model so stale red
      // squiggles do not persist indefinitely.
      for (const model of monacoNs.editor.getModels()) {
        if (model.getLanguageId() === 'rust') {
          monacoNs.editor.setModelMarkers(
            model,
            LINGUA_LANGUAGE_INTELLIGENCE_MARKER_OWNER,
            []
          );
        }
      }
    };
  }, [status]);
}

export function useRustLspDocumentSync(
  editor: EditorWithModel | null,
  activeTab: ActiveRustTab | null | undefined
): void {
  const status = useRustLanguageStore((state) => state.status);
  const openUriRef = useRef<string | null>(null);

  useEffect(() => {
    const adapter = getRustLspAdapter();
    const model =
      status.kind === 'available' && activeTab?.language === 'rust'
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
  }, [editor, activeTab?.id, activeTab?.language, status.kind]);

  useEffect(() => {
    if (status.kind !== 'available') return;
    if (activeTab?.language !== 'rust') return;
    const model = editor?.getModel();
    if (!model) return;
    const adapter = getRustLspAdapter();
    if (!adapter) return;

    const uri = model.uri.toString();
    const timeout = window.setTimeout(() => {
      adapter.openDocument(uri, activeTab.content);
    }, RUST_LSP_DOCUMENT_SYNC_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [editor, activeTab?.id, activeTab?.language, activeTab?.content, status]);
}

function mapBridgeStatus(bridge: RustAnalyzerStatus): RustLanguageStatus {
  switch (bridge.kind) {
    case 'running':
      return { kind: 'available', version: bridge.version };
    case 'missing':
      return { kind: 'unavailable', reason: 'missing', detail: bridge.reason };
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
