/**
 * RL-043 Slice (Monaco cells) — the code-cell editor surface.
 *
 * Mount-virtualization is the whole point: a notebook can hold up to 200
 * cells, and mounting a Monaco editor per cell would be ruinous. So only
 * the cell the user is actively editing hosts a live `<MonacoEditor>`
 * (`NotebookCellMonaco`); every other cell renders a cheap, static,
 * syntax-highlighted view (`NotebookCellStaticView`) produced by
 * `monaco.editor.colorizeElement` — no editor instance, no language
 * worker. Because only one cell can hold the caret at a time, at most ~1
 * Monaco editor is alive across the notebook.
 *
 * The parent `NotebookCodeCellRow` still owns the draft / debounce /
 * flush / run-keybind orchestration; this component only renders the
 * surface and forwards interactions:
 *   - static view click  → `onRequestEdit` (parent flips `editing` on)
 *   - Monaco blur        → `onBlur` (parent flips `editing` off + flushes)
 *   - Cmd/Ctrl+Enter     → `onRunInPlace`
 *   - Shift+Enter        → `onRunAdvance`
 *   - Alt+Enter          → `onRunInsertBelow`
 *   - Esc (no widget open) → `onEscape` (parent drops to command mode)
 *
 * Folds wired here:
 *   - B: RL-108 inline lint + quick-fixes inside the active JS/TS cell.
 *   - C: RL-112 status bar — the focused cell registers as the active
 *        editor so the bar's cursor / lint segments come alive.
 *   - D: RL-037 Vim mode parity on the active cell.
 *   - E: `notebook.cell_editor_mounted` telemetry on mount.
 */

import MonacoEditor, {
  type Monaco,
  type OnMount,
  useMonaco,
} from '@monaco-editor/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NotebookCellLanguage } from '../../../shared/notebook';
import {
  configureMonaco,
  applyTypeScriptDefaults,
  registerLanguageOnce,
} from '../../monaco';
import { getActiveEditor, setActiveEditor } from '../../runtime/editorAccess';
import { loadMonacoVim, type VimAdapter } from '../../runtime/monacoVim';
import { useInlineLint } from '../../hooks/useInlineLint';
import { trackNotebookCellEditorMounted } from '../../hooks/notebookTelemetry';
import { useSettingsStore } from '../../stores/settingsStore';
import { monacoLanguageFor } from '../../utils/languageMeta';
import { defineCustomThemes } from '../Editor/editorThemes';
import { getSatelliteEditorOptions } from '../Editor/editorOptions';
import { VimStatusBar } from '../Editor/VimStatusBar';
import { createLocalizedStatusBarClass } from '../Editor/vimStatusBarFactory';

// Ensure the worker environment + JS/TS contribution are registered before
// any editor mounts or `useMonaco()` colorizes (idempotent; shared with
// `<CodeEditor>` / `<SqlMonacoEditor>`).
configureMonaco();

type EditorInstance = Parameters<OnMount>[0];

/** Cell editor never grows past this (matches the old textarea cap); it
 * scrolls internally beyond it so a giant cell can't dominate the page. */
const MAX_CELL_EDITOR_HEIGHT = 600;
/** Floor so a one-line / empty cell editor still has a comfortable target. */
const MIN_CELL_EDITOR_HEIGHT = 56;

/**
 * The Esc-to-command-mode keybind must yield to Monaco's own widgets: when
 * the suggest / find / rename / parameter-hint / inline-suggestion popups
 * are open, Esc should close THEM first. Only when none are visible does Esc
 * drop the cell to command mode. Expressed as a Monaco `when` context clause.
 */
const ESCAPE_TO_COMMAND_WHEN =
  'editorTextFocus && !suggestWidgetVisible && !renameInputVisible && ' +
  '!findWidgetVisible && !parameterHintsVisible && !inlineSuggestionVisible';

export interface NotebookCellEditorProps {
  readonly cellId: string;
  readonly language: NotebookCellLanguage;
  /** Controlled draft source — the parent row owns it. */
  readonly value: string;
  /** When true the live Monaco editor mounts; otherwise the static view. */
  readonly editing: boolean;
  /** Run in flight / cell disabled — the editor mounts read-only. */
  readonly disabled: boolean;
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly onChange: (next: string) => void;
  /** Static view activated (click or keyboard) — parent enters edit mode. */
  readonly onRequestEdit: () => void;
  /** Monaco widget lost focus — parent exits edit mode + flushes. */
  readonly onBlur: () => void;
  readonly onRunInPlace: () => void;
  readonly onRunAdvance: () => void;
  readonly onRunInsertBelow: () => void;
  /** Esc with no Monaco widget open — parent drops to command mode. */
  readonly onEscape: () => void;
}

export function NotebookCellEditor(props: NotebookCellEditorProps) {
  if (props.editing) {
    return <NotebookCellMonaco {...props} />;
  }
  return (
    <NotebookCellStaticView
      cellId={props.cellId}
      language={props.language}
      value={props.value}
      ariaLabel={props.ariaLabel}
      placeholder={props.placeholder}
      onRequestEdit={props.onRequestEdit}
    />
  );
}

// ---------------------------------------------------------------------------
// Static (inactive) view — colorized, no editor instance
// ---------------------------------------------------------------------------

interface NotebookCellStaticViewProps {
  readonly cellId: string;
  readonly language: NotebookCellLanguage;
  readonly value: string;
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly onRequestEdit: () => void;
}

function NotebookCellStaticView({
  language,
  value,
  ariaLabel,
  placeholder,
  onRequestEdit,
}: NotebookCellStaticViewProps) {
  const monaco = useMonaco();
  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const hostRef = useRef<HTMLPreElement | null>(null);
  const monacoLangId = monacoLanguageFor(language);
  const isEmpty = value.length === 0;

  // Set the source as plain text first (safe; React never owns these
  // children), then let Monaco colorize the node in place. colorizeElement
  // does the innerHTML write internally, so no dangerouslySetInnerHTML and
  // no innerHTML in our code. The `<pre>` className is a constant literal so
  // React writes it once and never reverts the theme class Monaco appends.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.textContent = value;
    if (!monaco || isEmpty || typeof monaco.editor.colorizeElement !== 'function') {
      return;
    }
    let cancelled = false;
    defineCustomThemes(monaco);
    void registerLanguageOnce(monaco, monacoLangId)
      .then(() => {
        if (cancelled || !hostRef.current) return undefined;
        return monaco.editor.colorizeElement(hostRef.current, {
          mimeType: monacoLangId,
          theme: editorTheme,
          tabSize: 2,
        });
      })
      .catch(() => {
        // Colorize is best-effort decoration; on any failure the node keeps
        // the plain-text content set above.
      });
    return () => {
      cancelled = true;
    };
  }, [value, monaco, monacoLangId, editorTheme, isEmpty]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onRequestEdit();
    },
    [onRequestEdit]
  );

  return (
    <div
      data-testid="notebook-code-cell-static"
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onMouseDown={onRequestEdit}
      onKeyDown={handleKeyDown}
      className="min-h-[44px] cursor-text rounded border border-border/60 bg-background p-2 outline-none hover:border-border-strong focus-visible:border-primary/70 focus-visible:ring-1 focus-visible:ring-primary/40"
      style={{ fontFamily, fontSize }}
    >
      {isEmpty ? (
        <span className="font-mono text-body-sm text-muted">{placeholder}</span>
      ) : null}
      <pre
        ref={hostRef}
        aria-hidden={isEmpty ? 'true' : undefined}
        className="m-0 overflow-x-auto whitespace-pre-wrap break-words font-mono text-body-sm text-foreground"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active view — live Monaco editor (folds B / C / D / E)
// ---------------------------------------------------------------------------

function NotebookCellMonaco({
  cellId,
  language,
  value,
  disabled,
  ariaLabel,
  onChange,
  onBlur,
  onRunInPlace,
  onRunAdvance,
  onRunInsertBelow,
  onEscape,
}: NotebookCellEditorProps) {
  const { t } = useTranslation();
  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const vimMode = useSettingsStore((s) => s.vimMode);
  const monacoLangId = monacoLanguageFor(language);

  const editorRef = useRef<EditorInstance | null>(null);
  const vimStatusBarRef = useRef<HTMLDivElement | null>(null);
  const vimAdapterRef = useRef<VimAdapter | null>(null);
  const [editorInstance, setEditorInstance] = useState<EditorInstance | null>(
    null
  );
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);
  const [height, setHeight] = useState<number>(MIN_CELL_EDITOR_HEIGHT);

  // Latest-callback refs so the once-registered Monaco commands always call
  // the current handlers without re-mounting the editor (the SqlMonacoEditor
  // pattern). `t` is stashed too so the localized Vim status bar reflects a
  // locale switch without tearing down the Vim adapter.
  const onBlurRef = useRef(onBlur);
  const onRunInPlaceRef = useRef(onRunInPlace);
  const onRunAdvanceRef = useRef(onRunAdvance);
  const onRunInsertBelowRef = useRef(onRunInsertBelow);
  const onEscapeRef = useRef(onEscape);
  const translateRef = useRef(t);
  useEffect(() => {
    onBlurRef.current = onBlur;
    onRunInPlaceRef.current = onRunInPlace;
    onRunAdvanceRef.current = onRunAdvance;
    onRunInsertBelowRef.current = onRunInsertBelow;
    onEscapeRef.current = onEscape;
    translateRef.current = t;
  }, [onBlur, onRunInPlace, onRunAdvance, onRunInsertBelow, onEscape, t]);

  // Fold B — inline lint + quick-fixes on the active JS/TS cell. The
  // tab object mirrors `<CodeEditor>`'s `useActiveTab` shape; a Python cell
  // falls through useInlineLint's LINTABLE guard untouched. Memoized so a
  // non-content re-render (e.g. an auto-height change) doesn't churn the
  // hook's effects with a fresh object identity.
  const lintTab = useMemo(
    () => ({ id: cellId, language: monacoLangId, content: value }),
    [cellId, monacoLangId, value]
  );
  useInlineLint(editorInstance, monacoInstance, lintTab);

  const handleBeforeMount = useCallback(
    (monaco: Monaco) => {
      defineCustomThemes(monaco);
      applyTypeScriptDefaults(monaco);
      void registerLanguageOnce(monaco, monacoLangId);
    },
    [monacoLangId]
  );

  const handleMount = useCallback<OnMount>(
    (editor, monaco) => {
      editorRef.current = editor;
      setEditorInstance(editor);
      setMonacoInstance(monaco);
      // Fold C — a notebook tab has no main code editor, so registering the
      // focused cell as the active editor is unambiguous: the persistent
      // status bar's cursor + lint segments now track this cell. Cleared on
      // dispose so the bar never holds a torn-down editor.
      setActiveEditor(editor, monaco);
      // Fold E — adoption + perf signal. NO source on the wire.
      trackNotebookCellEditorMounted(language);
      // Entering edit mode focuses the editor (click + command-mode Enter
      // + run-and-advance all route here).
      editor.focus();

      // Jupyter-parity run keybinds. addCommand returns a binding id (not a
      // disposable); the commands tear down with the editor itself.
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        onRunInPlaceRef.current();
      });
      editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
        onRunAdvanceRef.current();
      });
      editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.Enter, () => {
        onRunInsertBelowRef.current();
      });
      // Fold G — Esc drops to command mode, but only when no Monaco widget
      // is open (so Esc still closes suggest / find first).
      editor.addCommand(
        monaco.KeyCode.Escape,
        () => {
          onEscapeRef.current();
        },
        ESCAPE_TO_COMMAND_WHEN
      );

      // Auto-height: grow the host to the content height, capped, so the
      // cell list scrolls the page (not a nested editor) until the cap.
      const applyHeight = () => {
        const next = Math.min(
          Math.max(editor.getContentHeight(), MIN_CELL_EDITOR_HEIGHT),
          MAX_CELL_EDITOR_HEIGHT
        );
        setHeight(next);
      };
      editor.onDidContentSizeChange(applyHeight);
      applyHeight();

      // Exit edit mode when the whole editor widget (incl. its popups) loses
      // focus — the parent flushes the draft + flips back to the static view.
      editor.onDidBlurEditorWidget(() => {
        onBlurRef.current();
      });

      editor.onDidDispose(() => {
        // Only relinquish the active-editor slot if we still own it. When the
        // user switches cells, the NEXT cell's onMount calls
        // setActiveEditor(next) BEFORE this (now-blurred) editor disposes, so
        // an unconditional clear would clobber the new active editor and blank
        // the RL-112 status-bar cursor/lint segments.
        if (getActiveEditor() === editor) setActiveEditor(null);
        editorRef.current = null;
      });
    },
    [language]
  );

  // Fold D — Vim parity on the active cell, mirroring `<CodeEditor>`'s
  // adapter lifecycle (lazy chunk, localized status bar, dispose on
  // unmount / toggle-off). Keyed on the editor instance so it wires once
  // the editor has mounted.
  useEffect(() => {
    if (!vimMode || !editorInstance) return undefined;
    const statusNode = vimStatusBarRef.current;
    if (!statusNode) return undefined;
    let cancelled = false;
    void loadMonacoVim().then((mod) => {
      if (cancelled || !mod) return;
      const LocalizedStatusBar = createLocalizedStatusBarClass(
        mod.StatusBar,
        (key, options) => translateRef.current(key, options)
      );
      vimAdapterRef.current = mod.initVimMode(
        editorInstance,
        statusNode,
        LocalizedStatusBar
      );
    });
    return () => {
      cancelled = true;
      vimAdapterRef.current?.dispose();
      vimAdapterRef.current = null;
      statusNode.replaceChildren();
    };
  }, [vimMode, editorInstance]);

  return (
    <div className="grid gap-1" data-testid="notebook-code-cell-editor">
      <div
        className="overflow-hidden rounded border border-border-strong bg-background"
        style={{ height }}
      >
        <MonacoEditor
          height={height}
          language={monacoLangId}
          value={value}
          theme={editorTheme}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          onChange={(next) => {
            if (next !== undefined) onChange(next);
          }}
          options={{
            ...getSatelliteEditorOptions({ fontSize, fontFamily, ariaLabel }),
            readOnly: disabled,
            // Let wheel events bubble to the cell list when the editor is
            // not internally scrolled, so the notebook still scrolls past a
            // focused cell.
            scrollbar: { alwaysConsumeMouseWheel: false },
          }}
        />
      </div>
      <VimStatusBar ref={vimStatusBarRef} vimEnabled={vimMode} />
    </div>
  );
}
