import MonacoEditor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useResultStore } from '../../stores/resultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { monacoLanguageFor } from '../../utils/languageMeta';
import {
  configureMonaco,
  applyTypeScriptDefaults,
  registerLanguageCompletionProviders,
} from '../../monaco';
import { getDiagnosticKey } from '../../utils/editorExecutionDecorations';
import { useInlineResults } from '../../hooks/useInlineResults';
import { EditorEmptyState } from './EditorEmptyState';
import { getEditorOptions } from './editorOptions';
import { defineCustomThemes } from './editorThemes';

configureMonaco();

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CodeEditor() {
  const { tabs, activeTabId, updateContent } = useEditorStore();
  const pendingReveal = useEditorStore((state) => state.pendingReveal);
  const clearPendingReveal = useEditorStore((state) => state.clearPendingReveal);
  const { editorTheme, fontSize, fontFamily, showLineNumbers, wordWrap, minimap } =
    useSettingsStore();
  const lineResults = useResultStore((state) => state.lineResults);
  const diagnostics = useResultStore((state) => state.diagnostics);
  const executionSource = useResultStore((state) => state.executionSource);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const lastRevealedDiagnosticKeyRef = useRef<string | null>(null);
  const { applyDecorations, clearDecorations, applyDiagnostics, clearMarkers } =
    useInlineResults();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleBeforeMount = useCallback((monaco: Monaco) => {
    defineCustomThemes(monaco);
    applyTypeScriptDefaults(monaco);
    registerLanguageCompletionProviders(monaco);
  }, []);

  // Sync scroll with ResultPanel
  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editor.onDidScrollChange((e) => {
      window.dispatchEvent(
        new CustomEvent('lingua:editor-scroll', {
          detail: { scrollTop: e.scrollTop },
        })
      );
    });
  }, []);

  useEffect(() => {
    applyDecorations(editorRef.current, lineResults, monacoRef.current as Monaco);
  }, [applyDecorations, lineResults]);

  useEffect(() => {
    applyDiagnostics(editorRef.current, diagnostics, monacoRef.current);
    const editor = editorRef.current;
    const nextDiagnosticKey = getDiagnosticKey(diagnostics);
    const primaryDiagnostic = diagnostics[0];

    if (!nextDiagnosticKey) {
      lastRevealedDiagnosticKeyRef.current = null;
      return;
    }

    if (
      !editor ||
      executionSource !== 'manual' ||
      nextDiagnosticKey === lastRevealedDiagnosticKeyRef.current
    ) {
      return;
    }

    if (!primaryDiagnostic) {
      lastRevealedDiagnosticKeyRef.current = nextDiagnosticKey;
      return;
    }

    editor.revealLineInCenter(primaryDiagnostic.line);
    editor.setPosition({
      lineNumber: primaryDiagnostic.line,
      column: primaryDiagnostic.column ?? 1,
    });
    lastRevealedDiagnosticKeyRef.current = nextDiagnosticKey;
  }, [applyDiagnostics, diagnostics, executionSource]);

  // Apply pending reveals queued by other surfaces (Project Search, Go to
  // Symbol). The request is addressed by either tabId (same-tab surfaces like
  // Go to Symbol that target the active unsaved tab) or filePath (open-file
  // flows). When both are supplied, tabId wins since it's the tighter id.
  //
  // The effect depends on `activeTab?.id` and `activeTab?.content` so a
  // reveal fires both when the target tab becomes active and when its content
  // finishes loading from disk — otherwise revealLineInCenter on a freshly
  // opened tab can run before Monaco has the content populated and land on a
  // clipped viewport.
  useEffect(() => {
    if (!pendingReveal) return;
    const editor = editorRef.current;
    if (!editor || !activeTab) return;

    const matchesActiveTab = pendingReveal.tabId
      ? pendingReveal.tabId === activeTab.id
      : pendingReveal.filePath !== undefined &&
        activeTab.filePath === pendingReveal.filePath;
    if (!matchesActiveTab) return;

    editor.revealLineInCenter(pendingReveal.line);
    editor.setPosition({
      lineNumber: pendingReveal.line,
      column: pendingReveal.column ?? 1,
    });
    editor.focus();
    clearPendingReveal();
    // `activeTab` is the ref we branch on; eslint's exhaustive-deps rule
    // correctly flags it. The `!pendingReveal` short-circuit on line 108
    // makes re-runs cheap when no reveal is queued.
  }, [pendingReveal, activeTab, clearPendingReveal]);

  useEffect(() => {
    return () => {
      clearDecorations(editorRef.current);
      clearMarkers(editorRef.current, monacoRef.current);
    };
  }, [clearDecorations, clearMarkers]);

  if (!activeTab) {
    return <EditorEmptyState />;
  }

  return (
    <MonacoEditor
      height="100%"
      language={monacoLanguageFor(activeTab.language)}
      value={activeTab.content}
      theme={editorTheme}
      beforeMount={handleBeforeMount}
      onMount={handleEditorMount}
      onChange={(value) => {
        if (value !== undefined) {
          updateContent(activeTab.id, value);
        }
      }}
      options={getEditorOptions({
        fontSize,
        fontFamily,
        showLineNumbers,
        wordWrap,
        minimap,
      })}
    />
  );
}
