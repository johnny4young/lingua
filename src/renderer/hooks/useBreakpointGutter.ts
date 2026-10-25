import { useEffect, useRef } from 'react';
import type * as monacoTypes from 'monaco-editor';
import { useDebuggerStore } from '../stores/debuggerStore';
import type { Language } from '../types/language';
import { localsChanges } from '../utils/debuggerLocals';
import { languageSupportsBreakpointModes, languageSupportsDebugger } from '../utils/languageMeta';

/**
 * Monaco glyph-margin integration for breakpoints.
 *
 * Renders one mark per breakpoint in the active tab, shaped by its mode, and
 * turns clicks on the gutter into `toggleBreakpoint(tabId, line)` calls;
 * alt-click cycles pause, conditional and logpoint in JS/TS. Disabled
 * breakpoints (set via the Debugger panel's Disable all action) render
 * as a hollow ring so users still see them but they no longer pause
 * execution.
 *
 * Per the Debugger ADR (`docs/DEBUGGER_ADR.md` §1), the gutter mounts for
 * JavaScript/TypeScript in both shells and Python on desktop. Other tabs see
 * no gutter affordance; the per-runtime capability gate stays authoritative.
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
  /** Tab language — gates the gutter to shipping debugger adapters. */
  language: Language | undefined;
  /** Localized hover text for a mark; `modes` is false where only plain breakpoints exist. */
  toggleAriaLabel: (line: number, modes: boolean) => string;
}

const INLINE_VALUES = 3;
const INLINE_VALUE_LENGTH = 40;

function inlineValues(previous: Record<string, string>, current: Record<string, string>): string | null {
  const names = [...localsChanges(previous, current).keys()];
  if (names.length === 0) return null;
  const shown = names.slice(0, INLINE_VALUES).map((name) => {
    const value = current[name]!;
    return `${name} → ${value.length > INLINE_VALUE_LENGTH ? `${value.slice(0, INLINE_VALUE_LENGTH - 1)}…` : value}`;
  });
  return `${shown.join('  ·  ')}${names.length > INLINE_VALUES ? '  …' : ''}`;
}

export function useBreakpointGutter(
  editor: monacoTypes.editor.IStandaloneCodeEditor | null,
  monaco: typeof monacoTypes | null,
  options: BreakpointGutterOptions
): void {
  const breakpoints = useDebuggerStore((state) => state.breakpoints);
  const pausedFrame = useDebuggerStore((state) => state.pausedFrame);
  const previousPause = useDebuggerStore((state) => state.previousPause);
  const decorationsRef = useRef<monacoTypes.editor.IEditorDecorationsCollection | null>(null);

  const { activeTabId, language, toggleAriaLabel } = options;
  const supportsDebugger = languageSupportsDebugger(language);
  const supportsModes = languageSupportsBreakpointModes(language);

  // Decoration pass — runs on every breakpoint mutation. Clears the
  // previous set first; Monaco's collection handles incremental diffs
  // internally so we don't pay a full re-render on each toggle.
  useEffect(() => {
    if (!editor || !monaco) return;
    if (!supportsDebugger || !activeTabId) {
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
        glyphMarginClassName: [
          'lingua-bp-glyph',
          `lingua-bp-glyph--${supportsModes ? bp.mode : 'pause'}`,
          bp.enabled ? '' : 'lingua-bp-glyph--disabled',
        ]
          .filter(Boolean)
          .join(' '),
        glyphMarginHoverMessage: { value: toggleAriaLabel(bp.line, supportsModes) },
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
      const inline = previousPause?.tabId === activeTabId ? inlineValues(previousPause.locals, pausedFrame!.locals) : null;
      const model = editor.getModel();
      if (inline && model && previousPause!.line <= model.getLineCount()) {
        // What the last step changed, shown on the line it paused at, like a scratchpad value.
        const column = model.getLineMaxColumn(previousPause!.line);
        decorations.push({
          range: new monaco.Range(previousPause!.line, column, previousPause!.line, column),
          options: { after: { content: inline, inlineClassName: 'lingua-debugger-inline-value' }, showIfCollapsed: true },
        });
      }
    }

    if (!decorationsRef.current) {
      decorationsRef.current = editor.createDecorationsCollection(decorations);
    } else {
      decorationsRef.current.set(decorations);
    }
  }, [
    editor,
    monaco,
    supportsDebugger,
    supportsModes,
    activeTabId,
    breakpoints,
    pausedFrame,
    previousPause,
    toggleAriaLabel,
  ]);

  // Mouse-click pass — only one listener at a time. Re-binds when the
  // editor instance changes or when the active tab changes (the tabId
  // is captured in the handler closure so a stale listener targeting
  // the wrong tab is the failure mode we avoid).
  useEffect(() => {
    if (!editor || !monaco) return;
    if (!supportsDebugger || !activeTabId) return;

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
      const store = useDebuggerStore.getState();
      // Alt-click picks the mode where the runtime has modes; elsewhere it is a plain toggle.
      if (event.event.altKey && supportsModes) store.cycleBreakpointMode(activeTabId, lineNumber);
      else store.toggleBreakpoint(activeTabId, lineNumber);
    });

    return () => {
      handler.dispose();
    };
  }, [editor, monaco, supportsDebugger, supportsModes, activeTabId]);

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
