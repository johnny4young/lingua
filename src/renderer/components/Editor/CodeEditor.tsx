import MonacoEditor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { useResultStore } from '../../stores/resultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { monacoLanguageFor } from '../../utils/languageMeta';
import { rustLspModelPathForTab } from '../../utils/filePath';
import { fontStackSupportsLigatures } from '../Settings/settingsOptions';
import {
  configureMonaco,
  applyTypeScriptDefaults,
  registerLanguageCompletionProviders,
} from '../../monaco';
import { getDiagnosticKey } from '../../utils/editorExecutionDecorations';
import { useInlineResults } from '../../hooks/useInlineResults';
import { useBreakpointGutter } from '../../hooks/useBreakpointGutter';
import { useLanguageIntelligenceDiagnostics } from '../../hooks/useLanguageIntelligenceDiagnostics';
import { useGoLspDocumentSync } from '../../hooks/useGoLspLifecycle';
import { useRustLspDocumentSync } from '../../hooks/useRustLspLifecycle';
import { setActiveEditor } from '../../runtime/editorAccess';
import { EditorEmptyState } from './EditorEmptyState';
import { getEditorOptions } from './editorOptions';
import { defineCustomThemes } from './editorThemes';
import { VimStatusBar } from './VimStatusBar';
import { createLocalizedStatusBarClass } from './vimStatusBarFactory';

configureMonaco();

// ---------------------------------------------------------------------------
// monaco-vim lazy loader (RL-037)
// ---------------------------------------------------------------------------
//
// The chunk is fetched at most once per session — even rapid toggle on /
// off cycles share the same in-flight promise. Failures fall through to
// `null` so the gate in `CodeEditor` simply skips the init call instead
// of bricking the editor; the user can re-flip the toggle to retry.

type MonacoVimModule = typeof import('monaco-vim');
type VimAdapter = ReturnType<MonacoVimModule['initVimMode']>;

let monacoVimPromise: Promise<MonacoVimModule | null> | null = null;

function loadMonacoVim(): Promise<MonacoVimModule | null> {
  if (monacoVimPromise) return monacoVimPromise;
  monacoVimPromise = import('monaco-vim').catch((error: unknown) => {
    console.warn('Failed to load monaco-vim chunk', error);
    monacoVimPromise = null;
    return null;
  });
  return monacoVimPromise;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CodeEditor() {
  const { tabs, activeTabId, updateContent } = useEditorStore();
  const pendingReveal = useEditorStore((state) => state.pendingReveal);
  const clearPendingReveal = useEditorStore((state) => state.clearPendingReveal);
  const {
    editorTheme,
    fontSize,
    fontFamily,
    fontLigatures,
    showLineNumbers,
    wordWrap,
    minimap,
  } = useSettingsStore();
  const vimMode = useSettingsStore((state) => state.vimMode);
  const { t } = useTranslation();
  // Stash `t` in a ref so the Vim init effect doesn't re-run (and tear
  // down + rebuild the Vim layer, dropping the user's mode + buffer
  // cursor) every time react-i18next emits a fresh translator
  // identity. The localized status-bar subclass still resolves the
  // current locale because it reads through the ref every setMode call.
  const translateRef = useRef(t);
  useEffect(() => {
    translateRef.current = t;
  }, [t]);
  const lineResults = useResultStore((state) => state.lineResults);
  const diagnostics = useResultStore((state) => state.diagnostics);
  const executionSource = useResultStore((state) => state.executionSource);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const vimAdapterRef = useRef<VimAdapter | null>(null);
  const vimStatusBarRef = useRef<HTMLDivElement | null>(null);
  const lastRevealedDiagnosticKeyRef = useRef<string | null>(null);
  // RL-027 Slice 1.5 — track the mounted editor + monaco namespace in
  // state so effects can react to mount (refs alone don't re-render).
  // The original refs stay in place for the existing inline-results
  // hook that already reads them inside diagnostics-driven effects.
  const [editorInstance, setEditorInstance] = useState<Parameters<OnMount>[0] | null>(null);
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);
  const { applyDecorations, clearDecorations, applyDiagnostics, clearMarkers } =
    useInlineResults();
  const effectiveFontLigatures = fontLigatures && fontStackSupportsLigatures(fontFamily);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  useLanguageIntelligenceDiagnostics(editorInstance, monacoInstance, activeTab);
  useRustLspDocumentSync(editorInstance, activeTab);
  useGoLspDocumentSync(editorInstance, activeTab);
  // RL-027 Slice 1.5 — glyph-margin breakpoint dots + click → toggle.
  // The hook self-gates on `debuggerEnabled` AND `language ∈ {js, ts}`
  // so non-debug tabs stay byte-identical in the DOM.
  useBreakpointGutter(editorInstance, monacoInstance, {
    activeTabId: activeTab?.id ?? null,
    language: activeTab?.language,
    toggleAriaLabel: (line) => t('debugger.gutter.toggle', { line }),
  });

  const handleBeforeMount = useCallback((monaco: Monaco) => {
    defineCustomThemes(monaco);
    applyTypeScriptDefaults(monaco);
    registerLanguageCompletionProviders(monaco);
  }, []);

  // Sync scroll with ResultPanel
  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setEditorInstance(editor);
    setMonacoInstance(monaco);
    // RL-027 Slice 1.5 fold C — register the editor with the
    // module-level ref the keyboard-shortcut bus consults to read
    // the cursor line. Cleared in the matching unmount effect below.
    setActiveEditor(editor);

    editor.onDidScrollChange((e) => {
      window.dispatchEvent(
        new CustomEvent('lingua:editor-scroll', {
          detail: { scrollTop: e.scrollTop },
        })
      );
    });
  }, []);

  useEffect(() => {
    return () => {
      setActiveEditor(null);
    };
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

  // RL-037 — wire the Vim layer when the toggle flips on, dispose when
  // it flips off (or when the editor unmounts / active tab changes).
  // The localized status-bar subclass routes through `translateRef.current`
  // so locale switches reflect immediately on the next mode-change event
  // without re-initializing the Vim adapter and dropping the user's
  // buffer position.
  useEffect(() => {
    if (!vimMode) return;
    let cancelled = false;
    const editor = editorRef.current;
    const statusNode = vimStatusBarRef.current;
    if (!editor || !statusNode) return;

    void loadMonacoVim().then((mod) => {
      if (cancelled || !mod) return;
      const LocalizedStatusBar = createLocalizedStatusBarClass(mod.StatusBar, (key, options) =>
        translateRef.current(key, options)
      );
      vimAdapterRef.current = mod.initVimMode(editor, statusNode, LocalizedStatusBar);
    });

    return () => {
      cancelled = true;
      vimAdapterRef.current?.dispose();
      vimAdapterRef.current = null;
      // Clear any DOM the upstream class wrote into the host node so
      // toggling off leaves a clean slate. `replaceChildren()` with no
      // arguments is the standards-track equivalent of `innerHTML = ''`
      // without the linter false-positive about XSS.
      statusNode.replaceChildren();
    };
  }, [vimMode, activeTab?.id]);

  if (!activeTab) {
    return <EditorEmptyState />;
  }

  const editorPath =
    activeTab.language === 'rust' ? rustLspModelPathForTab(activeTab) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <MonacoEditor
          height="100%"
          language={monacoLanguageFor(activeTab.language)}
          path={editorPath}
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
            fontLigatures: effectiveFontLigatures,
            showLineNumbers,
            wordWrap,
            minimap,
          })}
        />
      </div>
      <VimStatusBar ref={vimStatusBarRef} vimEnabled={vimMode} />
    </div>
  );
}
