import MonacoEditor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useResultStore } from '../../stores/resultStore';
import {
  PRESENTER_EDITOR_FONT_LIFT,
  usePresenterModeStore,
} from '../../stores/presenterModeStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { monacoLanguageFor } from '../../utils/languageMeta';
import { rustLspModelPathForTab } from '../../utils/filePath';
import { fontStackSupportsLigatures } from '../Settings/settingsOptions';
import {
  configureMonaco,
  applyTypeScriptDefaults,
  registerLanguageOnce,
  prefetchLanguage,
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
import { useInlineLint } from '../../hooks/useInlineLint';
import { useSmartPaste } from '../../hooks/useSmartPaste';
import { useGoLspDocumentSync } from '../../hooks/useGoLspLifecycle';
import { useRustLspDocumentSync } from '../../hooks/useRustLspLifecycle';
import { setActiveEditor } from '../../runtime/editorAccess';
import { loadMonacoVim, type VimAdapter } from '../../runtime/monacoVim';
import { notifyDependencyDetectionPaste } from '../../hooks/useDependencyDetection';
import { useEntitlement } from '../../hooks/useEntitlement';
import { openExplainCodeForEditor } from '../../stores/aiExplainCodeStore';
import { EditorEmptyState } from './EditorEmptyState';
import { getEditorOptions } from './editorOptions';
import { defineCustomThemes } from './editorThemes';
import { VimStatusBar } from './VimStatusBar';
import { createLocalizedStatusBarClass } from './vimStatusBarFactory';
import { emitCommand } from '../../stores/commandBus';

configureMonaco();

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CodeEditor() {
  const activeTabId = useEditorStore(state => state.activeTabId);
  const updateContent = useEditorStore(state => state.updateContent);
  const pendingReveal = useEditorStore(state => state.pendingReveal);
  const clearPendingReveal = useEditorStore(state => state.clearPendingReveal);
  const { editorTheme, fontSize, fontFamily, wordWrap, minimap } = useSettingsStore();
  const vimMode = useSettingsStore(state => state.vimMode);
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
  const lineResults = useResultStore(state => state.lineResults);
  const lineTimings = useResultStore(state => state.lineTimings);
  const presenterActive = usePresenterModeStore(state => state.active);
  const diagnostics = useResultStore(state => state.diagnostics);
  const executionSource = useResultStore(state => state.executionSource);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const vimAdapterRef = useRef<VimAdapter | null>(null);
  const vimStatusBarRef = useRef<HTMLDivElement | null>(null);
  const lastRevealedDiagnosticKeyRef = useRef<string | null>(null);
  const cursorBroadcastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // implementation — track the mounted editor + monaco namespace in
  // state so effects can react to mount (refs alone don't re-render).
  // The original refs stay in place for the existing inline-results
  // hook that already reads them inside diagnostics-driven effects.
  const [editorInstance, setEditorInstance] = useState<Parameters<OnMount>[0] | null>(null);
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);
  const { clearDecorations, applyDiagnostics, clearMarkers } = useInlineResults();
  const visibleLineResults = useMemo(
    () => lineResults.filter(result => !isHiddenUndefinedLineResult(result)),
    [lineResults]
  );

  // implementation — richer inline-result presentation as Monaco
  // overlay widgets. This replaces the old trailing-comment
  // decorations so the editor shows one result surface, not duplicate
  // values after the code and again at the right edge.
  useInlineResultWidgets(
    editorInstance,
    monacoInstance,
    visibleLineResults,
    activeTabId,
    lineTimings
  );
  const effectiveFontLigatures = fontStackSupportsLigatures(fontFamily);

  const activeTab = useActiveTab();

  // internal — "Explain with AI" over a selection (or the whole buffer) is
  // the first main-editor AI affordance. Registered as a Monaco context-menu
  // action, gated by LOCAL_AI (invisible on Free); it opens a consent-first
  // dialog rendered by AiExplainCodeHost (also reachable from the command
  // palette). The action closure reads live tab context through a ref so it
  // never needs re-registering on every keystroke.
  const aiEntitled = useEntitlement('LOCAL_AI');
  const explainCtxRef = useRef<{ language: string; name: string } | null>(null);
  useEffect(() => {
    explainCtxRef.current = activeTab
      ? { language: activeTab.language, name: activeTab.name }
      : null;
  }, [activeTab]);
  useLanguageIntelligenceDiagnostics(editorInstance, monacoInstance, activeTab);
  // internal — inline lint: per-language toggle over Monaco's native JS/TS
  // diagnostics + custom 'lingua-lint' markers + quick-fix provider.
  useInlineLint(editorInstance, monacoInstance, activeTab);
  // internal — smart paste detection: share-link / capsule / cURL / stack-trace /
  // large-JSON paste intents surfaced as a non-blocking import toast.
  useSmartPaste(editorInstance, monacoInstance);
  useRustLspDocumentSync(editorInstance, activeTab);
  useGoLspDocumentSync(editorInstance, activeTab);

  // Rust tabs are the only ones mounted with an explicit `path` (so the
  // LSP can address the document by URI), which switches
  // @monaco-editor/react into keep-models-per-path mode — and nothing
  // disposed those models when their tab closed, leaking text +
  // tokenization state per closed Rust tab for the session lifetime.
  // The selector implementation note expected model URIs into one string so this
  // effect only re-runs when the Rust tab set (id / name / filePath)
  // actually changes, never per keystroke.
  const expectedRustModelPaths = useEditorStore(state =>
    state.tabs
      .filter(tab => tab.language === 'rust')
      .map(tab => rustLspModelPathForTab(tab))
      .join('\n')
  );
  useEffect(() => {
    if (!monacoInstance) return;
    const expected = new Set(
      expectedRustModelPaths
        .split('\n')
        .filter(Boolean)
        .map(path => monacoInstance.Uri.parse(path).toString())
    );
    const mounted = editorRef.current?.getModel() ?? null;
    for (const model of monacoInstance.editor.getModels()) {
      if (model === mounted) continue;
      if (model.getLanguageId() !== 'rust') continue;
      // Only sweep models we minted (per-tab `path`): exact-URI match
      // against the live Rust tab set. Anything else (diff panels,
      // detached buffers from other surfaces) is left alone.
      if (expected.has(model.uri.toString())) continue;
      model.dispose();
    }
  }, [monacoInstance, expectedRustModelPaths]);
  // implementation — glyph-margin breakpoint dots + click → toggle.
  // The hook self-gates on `debuggerEnabled` AND `language ∈ {js, ts}`
  // so non-debug tabs stay byte-identical in the DOM.
  useBreakpointGutter(editorInstance, monacoInstance, {
    activeTabId: activeTab?.id ?? null,
    language: activeTab?.language,
    toggleAriaLabel: line => t('debugger.gutter.toggle', { line }),
  });
  // implementation detail — listen for editor.highlightLine commands
  // emitted by `<OutputLineBadge>` on hover, apply the
  // `lingua-highlight-flash` decoration to the hinted line, and
  // reveal offscreen lines via `editor.revealLineInCenter`.
  useEditorHighlightSync(editorRef);

  // internal — lazy per-language Monaco registration. Pre-fetch the active
  // language once on first mount (idle) so first paint colors fast, then
  // register on every language change once the editor's monaco instance exists.
  const activeLanguage = activeTab?.language;
  const didPrefetchLanguageRef = useRef(false);
  useEffect(() => {
    if (didPrefetchLanguageRef.current || !activeLanguage) return;
    didPrefetchLanguageRef.current = true;
    prefetchLanguage(monacoLanguageFor(activeLanguage));
  }, [activeLanguage]);
  useEffect(() => {
    if (!monacoInstance || !activeLanguage) return;
    void registerLanguageOnce(monacoInstance, monacoLanguageFor(activeLanguage));
  }, [monacoInstance, activeLanguage]);

  const handleBeforeMount = useCallback((monaco: Monaco) => {
    defineCustomThemes(monaco);
    applyTypeScriptDefaults(monaco);
    // internal — pre-register the scratchpad happy-path languages so a blank
    // JS/TS tab colors within one frame; every other language is registered
    // lazily by the active-language effect above.
    void registerLanguageOnce(monaco, 'javascript');
    void registerLanguageOnce(monaco, 'typescript');
  }, []);

  // Sync scroll with ResultPanel
  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setEditorInstance(editor);
    setMonacoInstance(monaco);
    // implementation note — register the editor with the
    // module-level ref the keyboard-shortcut bus consults to read
    // the cursor line. Cleared in the matching unmount effect below.
    // internal — also hand over the `monaco` namespace so the persistent
    // status bar can read marker severities + `getModelMarkers`.
    setActiveEditor(editor, monaco);

    editor.onDidScrollChange(e => {
      emitCommand('editor.scroll', { scrollTop: e.scrollTop });
    });
    // implementation Slice A implementation note — let the dependency detection runner
    // see paste events so it can drop to the 60ms paste debounce
    // instead of the 300ms keystroke debounce on the very next
    // tick.
    editor.onDidPaste(() => {
      notifyDependencyDetectionPaste();
    });
    // implementation Sub-slice G implementation note — symmetric inverse direction:
    // cursor settled on line N → emit editor.sourceLineHovered so any
    // `<ConsolePanel>` row whose `origin.line === N` can pulse for
    // the next 1500ms. Debounced 200ms so a normal cursor-move
    // burst (arrow keys, click + drag) does not stream events.
    //
    // implementation — keep one pending command so cursor bursts
    // collapse to the final settled line.
    editor.onDidChangeCursorPosition(event => {
      const line = event.position.lineNumber;
      if (!Number.isFinite(line) || line <= 0) return;
      if (cursorBroadcastTimerRef.current) {
        clearTimeout(cursorBroadcastTimerRef.current);
      }
      cursorBroadcastTimerRef.current = setTimeout(() => {
        emitCommand('editor.sourceLineHovered', { line, durationMs: 1500 });
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

  // internal — register/dispose the "Explain with AI" context-menu action.
  // Only mounted when entitled, so it stays invisible on Free (matching
  // the ExplainErrorButton/AskSqlButton convention).
  useEffect(() => {
    const editor = editorInstance;
    if (!editor || !aiEntitled) return;
    const action = editor.addAction({
      id: 'lingua.ai.explainSelection',
      label: t('ai.explainCode.action'),
      contextMenuGroupId: '9_ai',
      contextMenuOrder: 1,
      run: (ed) => {
        const ctx = explainCtxRef.current;
        if (!ctx) return;
        openExplainCodeForEditor(ed, ctx.language, ctx.name);
      },
    });
    return () => action.dispose();
  }, [editorInstance, aiEntitled, t]);

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
      : pendingReveal.filePath !== undefined && activeTab.filePath === pendingReveal.filePath;
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

  // internal — wire the Vim layer when the toggle flips on, dispose when
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

    void loadMonacoVim().then(mod => {
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

  const editorPath = activeTab.language === 'rust' ? rustLspModelPathForTab(activeTab) : undefined;

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
          onChange={value => {
            if (value !== undefined) {
              updateContent(activeTab.id, value);
            }
          }}
          options={getEditorOptions({
            // internal — presenter mode lifts the editor font without
            // touching the persisted preference.
            fontSize: presenterActive ? fontSize + PRESENTER_EDITOR_FONT_LIFT : fontSize,
            fontFamily,
            fontLigatures: effectiveFontLigatures,
            wordWrap,
            minimap,
          })}
        />
      </div>
      <VimStatusBar ref={vimStatusBarRef} vimEnabled={vimMode} />
    </div>
  );
}
