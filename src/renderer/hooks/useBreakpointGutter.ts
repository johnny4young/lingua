import { useEffect, useRef } from 'react';
import type * as monacoTypes from 'monaco-editor';
import { useDebuggerStore } from '../stores/debuggerStore';
import type { Language } from '../types';
import { languageSupportsDebugger } from '../utils/languageMeta';

/**
 * RL-027 Slice 1.5 — Monaco glyph-margin integration for breakpoints.
 *
 * Renders one dot per breakpoint in the active tab and turns clicks on
 * the gutter into `toggleBreakpoint(tabId, line)` calls. Disabled
 * breakpoints (set via the Debugger panel's Disable all action) render
 * as a hollow ring so users still see them but they no longer pause
 * execution.
 *
 * Per the Debugger ADR (`docs/DEBUGGER_ADR.md` §1) the JS/TS adapter is
 * the first runtime to ship; this gutter only mounts dots for those
 * languages. Other tabs see no gutter affordance — the ADR's per-runtime
 * capability gate keeps the surface honest until later slices land.
 *
 * Two callsites would otherwise hammer Monaco unnecessarily:
 *   - tab switches change `activeTabId` mid-flight.
 *   - rapid clicks toggle one breakpoint per call.
 * `createDecorationsCollection` gives us a stable handle the cleanup
 * effect can clear cheaply on either transition.
 */

export interface BreakpointGutterOptions {
  /** Active tab id — null when no tab is open. */
  activeTabId: string | null;
  /** Tab language — gates the gutter to JS / TS per ADR §1. */
  language: Language | undefined;
  /** Localized aria label for the breakpoint toggle row. */
  toggleAriaLabel: (line: number) => string;
}

export function useBreakpointGutter(
  editor: monacoTypes.editor.IStandaloneCodeEditor | null,
  monaco: typeof monacoTypes | null,
  options: BreakpointGutterOptions
): void {
  // Slice 2 — debugger is baseline; the Settings master toggle is gone.
  const debuggerEnabled = true;
  const breakpoints = useDebuggerStore((state) => state.breakpoints);
  const pausedFrame = useDebuggerStore((state) => state.pausedFrame);
  const decorationsRef = useRef<monacoTypes.editor.IEditorDecorationsCollection | null>(null);

  const { activeTabId, language, toggleAriaLabel } = options;
  const supportsDebugger = languageSupportsDebugger(language);

  // Decoration pass — runs on every breakpoint mutation. Clears the
  // previous set first; Monaco's collection handles incremental diffs
  // internally so we don't pay a full re-render on each toggle.
  useEffect(() => {
    if (!editor || !monaco) return;
    if (!debuggerEnabled || !supportsDebugger || !activeTabId) {
      decorationsRef.current?.clear();
      decorationsRef.current = null;
      return;
    }

    const tabBreakpoints = Object.values(breakpoints).filter((bp) => bp.tabId === activeTabId);
    const pausedLine =
      pausedFrame?.tabId === activeTabId && Number.isInteger(pausedFrame.line)
        ? pausedFrame.line
        : null;
    if (tabBreakpoints.length === 0 && pausedLine === null) {
      decorationsRef.current?.clear();
      decorationsRef.current = null;
      return;
    }

    const decorations: monacoTypes.editor.IModelDeltaDecoration[] = tabBreakpoints.map((bp) => ({
      range: new monaco.Range(bp.line, 1, bp.line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: bp.enabled ? 'lingua-bp-glyph' : 'lingua-bp-glyph lingua-bp-glyph--disabled',
        glyphMarginHoverMessage: { value: toggleAriaLabel(bp.line) },
      },
    }));

    if (pausedLine !== null && pausedLine > 0) {
      decorations.push({
        range: new monaco.Range(pausedLine, 1, pausedLine, 1),
        options: {
          isWholeLine: true,
          className: 'lingua-debugger-paused-line',
          linesDecorationsClassName: 'lingua-debugger-paused-line-marker',
        },
      });
      editor.revealLineInCenterIfOutsideViewport(pausedLine);
      editor.setPosition({ lineNumber: pausedLine, column: 1 });
    }

    if (!decorationsRef.current) {
      decorationsRef.current = editor.createDecorationsCollection(decorations);
    } else {
      decorationsRef.current.set(decorations);
    }
  }, [
    editor,
    monaco,
    debuggerEnabled,
    supportsDebugger,
    activeTabId,
    breakpoints,
    pausedFrame,
    toggleAriaLabel,
  ]);

  // Mouse-click pass — only one listener at a time. Re-binds when the
  // editor instance changes or when the active tab changes (the tabId
  // is captured in the handler closure so a stale listener targeting
  // the wrong tab is the failure mode we avoid).
  useEffect(() => {
    if (!editor || !monaco) return;
    if (!debuggerEnabled || !supportsDebugger || !activeTabId) return;

    const handler = editor.onMouseDown((event) => {
      // GLYPH_MARGIN === 2 on monaco.editor.MouseTargetType but importing
      // the enum value is awkward through @monaco-editor/react. The
      // numeric comparison is stable across Monaco majors that ship with
      // the same MouseTargetType enum.
      const isGlyphMargin =
        event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;
      if (!isGlyphMargin) return;
      const lineNumber = event.target.position?.lineNumber;
      if (typeof lineNumber !== 'number' || lineNumber <= 0) return;
      useDebuggerStore.getState().toggleBreakpoint(activeTabId, lineNumber);
    });

    return () => {
      handler.dispose();
    };
  }, [editor, monaco, debuggerEnabled, supportsDebugger, activeTabId]);

  // Always-on cleanup — when the gutter unmounts we clear decorations
  // so a leftover dot doesn't sit on a now-unused tab. The mouse-click
  // effect owns its own `IDisposable` teardown via its returned cleanup
  // function, so we deliberately don't re-dispose `disposableRef` here.
  useEffect(
    () => () => {
      decorationsRef.current?.clear();
      decorationsRef.current = null;
    },
    []
  );
}
