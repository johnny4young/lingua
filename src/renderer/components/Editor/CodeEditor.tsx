import MonacoEditor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  isHiddenUndefinedLineResult,
  useInlineResults,
  useInlineResultWidgets,
} from '../../hooks/useInlineResults';
import { useBreakpointGutter } from '../../hooks/useBreakpointGutter';
import { useEditorHighlightSync } from '../../hooks/useEditorHighlightSync';
import { useLanguageIntelligenceDiagnostics } from '../../hooks/useLanguageIntelligenceDiagnostics';
import { useGoLspDocumentSync } from '../../hooks/useGoLspLifecycle';
import { useRustLspDocumentSync } from '../../hooks/useRustLspLifecycle';
import { setActiveEditor } from '../../runtime/editorAccess';
import { notifyDependencyDetectionPaste } from '../../hooks/useDependencyDetection';
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
  // RL-044 Sub-slice G.1 — gate the Fold G inverse direction (cursor →
  // console pulse) on the master toggle. Stashed in a ref so the
  // listener registered inside `handleEditorMount` (a useCallback with
  // `[]` deps) reads the live value instead of the initial closure.
  const outputSourceMappingEnabled = useSettingsStore(
    (state) => state.outputSourceMappingEnabled
  );
  const outputSourceMappingEnabledRef = useRef(outputSourceMappingEnabled);
  useEffect(() => {
    outputSourceMappingEnabledRef.current = outputSourceMappingEnabled;
    // When the master flips OFF mid-debounce, drop any pending
    // broadcast so a stale dispatch does not slip out after the user
    // opted out.
    if (!outputSourceMappingEnabled && cursorBroadcastTimerRef.current) {
      clearTimeout(cursorBroadcastTimerRef.current);
      cursorBroadcastTimerRef.current = null;
    }
  }, [outputSourceMappingEnabled]);
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
  const hideUndefined = useSettingsStore((state) => state.hideUndefined);
  const diagnostics = useResultStore((state) => state.diagnostics);
  const executionSource = useResultStore((state) => state.executionSource);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const vimAdapterRef = useRef<VimAdapter | null>(null);
  const vimStatusBarRef = useRef<HTMLDivElement | null>(null);
  const lastRevealedDiagnosticKeyRef = useRef<string | null>(null);
  const cursorBroadcastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // RL-027 Slice 1.5 — track the mounted editor + monaco namespace in
  // state so effects can react to mount (refs alone don't re-render).
  // The original refs stay in place for the existing inline-results
  // hook that already reads them inside diagnostics-driven effects.
  const [editorInstance, setEditorInstance] = useState<Parameters<OnMount>[0] | null>(null);
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);
  const { clearDecorations, applyDiagnostics, clearMarkers } = useInlineResults();
  const visibleLineResults = useMemo(
    () =>
      hideUndefined
        ? lineResults.filter((result) => !isHiddenUndefinedLineResult(result))
        : lineResults,
    [hideUndefined, lineResults],
  );

  // RL-093 Slice 3 — richer inline-result presentation as Monaco
  // overlay widgets. This replaces the old trailing-comment
  // decorations so the editor shows one result surface, not duplicate
  // values after the code and again at the right edge.
  useInlineResultWidgets(
    editorInstance,
    monacoInstance,
    visibleLineResults,
    activeTabId,
  );
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
  // RL-044 Sub-slice G — listen for `lingua-highlight-line` events
  // dispatched by `<OutputLineBadge>` on hover, apply the
  // `lingua-highlight-flash` decoration to the hinted line, and
  // (when the Settings smooth-scroll sub-gate is ON) reveal
  // offscreen lines via `editor.revealLineInCenter`.
  useEditorHighlightSync(editorRef);

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
    // RL-025 Slice A fold D — let the dependency detection runner
    // see paste events so it can drop to the 60ms paste debounce
    // instead of the 300ms keystroke debounce on the very next
    // tick.
    editor.onDidPaste(() => {
      notifyDependencyDetectionPaste();
    });
    // RL-044 Sub-slice G Fold G — symmetric inverse direction:
    // cursor settled on line N → broadcast a
    // `lingua-source-line-hovered` CustomEvent so any
    // `<ConsolePanel>` row whose `origin.line === N` can pulse for
    // the next 1500ms. Debounced 200ms so a normal cursor-move
    // burst (arrow keys, click + drag) does not stream events.
    //
    // RL-044 Sub-slice G.1 — gated on the master toggle via the ref
    // so the listener honors the live setting (the outer useEffect
    // also clears any pending broadcast when the flag flips OFF
    // mid-debounce; this guard short-circuits new cursor moves so
    // we never schedule a doomed timer).
    editor.onDidChangeCursorPosition((event) => {
      if (!outputSourceMappingEnabledRef.current) return;
      const line = event.position.lineNumber;
      if (!Number.isFinite(line) || line <= 0) return;
      if (cursorBroadcastTimerRef.current) {
        clearTimeout(cursorBroadcastTimerRef.current);
      }
      cursorBroadcastTimerRef.current = setTimeout(() => {
        // Re-check at fire time — a flag flip during the 200ms
        // debounce shouldn't leak a stale event past the toggle.
        if (outputSourceMappingEnabledRef.current) {
          window.dispatchEvent(
            new CustomEvent('lingua-source-line-hovered', {
              detail: { line, durationMs: 1500 },
            })
          );
        }
        cursorBroadcastTimerRef.current = null;
      }, 200);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (cursorBroadcastTimerRef.current) {
        clearTimeout(cursorBroadcastTimerRef.current);
        cursorBroadcastTimerRef.current = null;
      }
      setActiveEditor(null);
    };
  }, []);

  useEffect(() => {
    clearDecorations(editorRef.current);
  }, [clearDecorations, visibleLineResults]);

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
