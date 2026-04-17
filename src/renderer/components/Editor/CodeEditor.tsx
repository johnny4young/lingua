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

  // Apply pending reveals queued by other surfaces (Project Search today,
  // future Go to Symbol). The effect depends on `pendingReveal`, `activeTab`,
  // and `activeTab.content` so a reveal fires both when the file becomes
  // active and when its content finishes loading from disk — otherwise
  // revealLineInCenter on a newly-created tab can run before Monaco has the
  // content populated and land on a clipped viewport.
  useEffect(() => {
    if (!pendingReveal) return;
    const editor = editorRef.current;
    if (!editor) return;
    if (!activeTab?.filePath || activeTab.filePath !== pendingReveal.filePath) return;

    editor.revealLineInCenter(pendingReveal.line);
    editor.setPosition({
      lineNumber: pendingReveal.line,
      column: pendingReveal.column ?? 1,
    });
    editor.focus();
    clearPendingReveal();
  }, [pendingReveal, activeTab?.filePath, activeTab?.content, clearPendingReveal]);

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
