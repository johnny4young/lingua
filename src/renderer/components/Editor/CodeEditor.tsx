import MonacoEditor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useResultStore } from '../../stores/resultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { monacoLanguageFor } from '../../utils/languageMeta';
import { configureMonaco } from '../../monaco';
import { getExecutionErrorKey } from '../../utils/editorExecutionDecorations';
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
  const { editorTheme, fontSize, fontFamily, showLineNumbers, wordWrap, minimap } =
    useSettingsStore();
  const lineResults = useResultStore((state) => state.lineResults);
  const error = useResultStore((state) => state.error);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const lastRevealedErrorKeyRef = useRef<string | null>(null);
  const { applyDecorations, clearDecorations, applyErrorMarker, clearMarkers } =
    useInlineResults();

  const activeTab = tabs.find((t) => t.id === activeTabId);

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
    applyErrorMarker(editorRef.current, error, monacoRef.current);
    const editor = editorRef.current;
    const nextErrorKey = getExecutionErrorKey(error);

    if (!editor || !nextErrorKey || nextErrorKey === lastRevealedErrorKeyRef.current) {
      if (!nextErrorKey) {
        lastRevealedErrorKeyRef.current = null;
      }
      return;
    }

    editor.revealLineInCenter(error.line!);
    editor.setPosition({
      lineNumber: error.line!,
      column: error.column ?? 1,
    });
    lastRevealedErrorKeyRef.current = nextErrorKey;
  }, [applyErrorMarker, error]);

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
      beforeMount={defineCustomThemes}
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
