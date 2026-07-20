import type { OnMount } from '@monaco-editor/react';
import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { useCommandListener } from './useCommandListener';

type MonacoEditorInstance = Parameters<OnMount>[0];
type DecorationsCollection = ReturnType<MonacoEditorInstance['createDecorationsCollection']>;

/**
 * implementation — applies a Monaco line-flash decoration when an
 * `<OutputLineBadge>` chip is hovered. The chip emits an
 * `editor.highlightLine` command; this hook listens for it and applies
 * the `lingua-highlight-flash` decoration to the
 * line on the editor instance passed in via `editorRef`.
 *
 * The flash class lives in `src/renderer/index.css` and runs a 1500ms
 * CSS animation. After the animation completes (durationMs from the
 * command payload, defaulting to 1500ms) we clear the decoration so the
 * editor model returns to its baseline state.
 *
 * Output-to-source linking is a baseline affordance: valid commands flash
 * the target and reveal it when it is outside the current viewport.
 *
 * Symmetric inverse direction (implementation note — `editor.sourceLineHovered`)
 * is wired inline in `ConsolePanel.tsx` (the listener lives next to
 * the panel-local `pulseLine` useState) so the console pulse does not
 * depend on an editor instance and so it survives when CodeEditor is
 * unmounted (Settings overlay, focus mode). This hook owns only the
 * editor-side direction; the panel-side listener is symmetric in
 * shape but lives where its consumer lives.
 */
const DEFAULT_DURATION_MS = 1500;

export function useEditorHighlightSync(editorRef: RefObject<MonacoEditorInstance | null>): void {
  // implementation — the master + sub-gates are gone; output→source linking
  // and smooth offscreen reveal are baseline.
  // Reviewer pass — single mutable ref so rapid hover bursts (e.g. a
  // user dragging across 5 console rows) clear the previous flash
  // before painting the new one, instead of stacking N decoration
  // collections whose fade-out animations smear visually. Also avoids
  // leaking the collection if the editor is disposed before the
  // teardown setTimeout fires.
  const activeCollectionRef = useRef<DecorationsCollection | null>(null);
  const activeClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearActive = useCallback(() => {
    if (activeClearTimerRef.current) {
      clearTimeout(activeClearTimerRef.current);
      activeClearTimerRef.current = null;
    }
    if (activeCollectionRef.current) {
      activeCollectionRef.current.clear();
      activeCollectionRef.current = null;
    }
  }, []);

  useCommandListener('editor.highlightLine', detail => {
    const { line } = detail;
    if (!Number.isFinite(line) || line <= 0) return;
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    if (line > model.getLineCount()) return;

    const durationMs =
      typeof detail?.durationMs === 'number' && detail.durationMs > 0
        ? Math.min(detail.durationMs, 10_000)
        : DEFAULT_DURATION_MS;

    const range = {
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: model.getLineMaxColumn(line),
    };

    // Drop any previous flash before painting the new one so rapid
    // hover bursts collapse to a single visible decoration.
    clearActive();
    const collection = editor.createDecorationsCollection([
      {
        range,
        options: {
          isWholeLine: true,
          className: 'lingua-highlight-flash',
        },
      },
    ]);
    activeCollectionRef.current = collection;

    // If the line is outside the visible viewport, center it.
    const visibleRanges = editor.getVisibleRanges();
    const isOnscreen = visibleRanges.some(
      r => line >= r.startLineNumber && line <= r.endLineNumber
    );
    if (!isOnscreen) {
      // ScrollType.Smooth === 0; we lazily import the enum from
      // the editor module via the captured editorRef rather than
      // a static `import * as monaco` here so this file stays
      // tree-shakable for the worker bundles that don't need it.
      editor.revealLineInCenter(line, 0);
    }

    // Tear down the decoration after the animation completes so a
    // subsequent hover on the same line re-triggers the animation.
    // If the editor unmounts before the timer fires, the deferred
    // `collection.clear()` is a no-op on the disposed editor.
    activeClearTimerRef.current = setTimeout(() => {
      if (activeCollectionRef.current === collection) {
        collection.clear();
        activeCollectionRef.current = null;
      }
      activeClearTimerRef.current = null;
    }, durationMs + 50);
  });

  useEffect(
    () => () => {
      // Hook teardown (hot reload or editor unmount) — drop any active
      // flash so the next mount starts clean.
      clearActive();
    },
    [clearActive]
  );
}
