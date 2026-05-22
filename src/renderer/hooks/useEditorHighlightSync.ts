import type { OnMount } from '@monaco-editor/react';
import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

import { useSettingsStore } from '../stores/settingsStore';

type MonacoEditorInstance = Parameters<OnMount>[0];
type DecorationsCollection = ReturnType<
  MonacoEditorInstance['createDecorationsCollection']
>;

/**
 * RL-044 Sub-slice G — applies a Monaco line-flash decoration when an
 * `<OutputLineBadge>` chip is hovered. The chip dispatches a
 * `lingua-highlight-line` CustomEvent on `window`; this hook listens
 * for it and applies the `lingua-highlight-flash` decoration to the
 * line on the editor instance passed in via `editorRef`.
 *
 * The flash class lives in `src/renderer/index.css` and runs a 1500ms
 * CSS animation. After the animation completes (durationMs from the
 * event detail, defaulting to 1500ms) we clear the decoration so the
 * editor model returns to its baseline state.
 *
 * Respects two Settings flags:
 *   - `outputHighlightOnHoverEnabled` — when OFF the hook ignores the
 *     event entirely (the badge gates hover dispatch on the same flag
 *     so this is defense in depth).
 *   - `outputSmoothScrollOffscreenEnabled` — when ON and the line is
 *     outside the editor viewport, the hook calls `revealLineInCenter`
 *     with smooth-scroll. When OFF the flash still fires but the
 *     viewport stays put (useful for users sensitive to motion).
 *
 * Symmetric inverse direction (Fold G — `lingua-source-line-hovered`)
 * is wired inline in `ConsolePanel.tsx` (the listener lives next to
 * the panel-local `pulseLine` useState) so the console pulse does not
 * depend on an editor instance and so it survives when CodeEditor is
 * unmounted (Settings overlay, focus mode). This hook owns only the
 * editor-side direction; the panel-side listener is symmetric in
 * shape but lives where its consumer lives.
 */
export interface LinguaHighlightLineDetail {
  line?: unknown;
  column?: unknown;
  durationMs?: unknown;
}

const DEFAULT_DURATION_MS = 1500;

export function useEditorHighlightSync(
  editorRef: RefObject<MonacoEditorInstance | null>
): void {
  // We subscribe directly so the hook re-runs when the user flips
  // either gate. Reading via getState() inside the listener would
  // also work but loses the React-driven listener teardown when the
  // master flag flips OFF mid-session.
  const masterEnabled = useSettingsStore((state) => state.outputSourceMappingEnabled);
  const hoverEnabled = useSettingsStore(
    (state) => state.outputHighlightOnHoverEnabled
  );
  const smoothScrollEnabled = useSettingsStore(
    (state) => state.outputSmoothScrollOffscreenEnabled
  );
  // Reviewer pass — single mutable ref so rapid hover bursts (e.g. a
  // user dragging across 5 console rows) clear the previous flash
  // before painting the new one, instead of stacking N decoration
  // collections whose fade-out animations smear visually. Also avoids
  // leaking the collection if the editor is disposed before the
  // teardown setTimeout fires.
  const activeCollectionRef = useRef<DecorationsCollection | null>(null);
  const activeClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    if (!masterEnabled || !hoverEnabled) return;

    const clearActive = () => {
      if (activeClearTimerRef.current) {
        clearTimeout(activeClearTimerRef.current);
        activeClearTimerRef.current = null;
      }
      if (activeCollectionRef.current) {
        activeCollectionRef.current.clear();
        activeCollectionRef.current = null;
      }
    };

    const handler = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as LinguaHighlightLineDetail | null | undefined;
      const line = typeof detail?.line === 'number' ? detail.line : 0;
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

      // If the line is outside the visible viewport and the user has
      // opted into smooth-scroll, center it. Otherwise leave the
      // viewport static so a long-running session does not turn into
      // a scroll show.
      if (smoothScrollEnabled) {
        const visibleRanges = editor.getVisibleRanges();
        const isOnscreen = visibleRanges.some(
          (r) => line >= r.startLineNumber && line <= r.endLineNumber
        );
        if (!isOnscreen) {
          // ScrollType.Smooth === 0; we lazily import the enum from
          // the editor module via the captured editorRef rather than
          // a static `import * as monaco` here so this file stays
          // tree-shakable for the worker bundles that don't need it.
          editor.revealLineInCenter(line, 0);
        }
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
    };

    window.addEventListener('lingua-highlight-line', handler);
    return () => {
      window.removeEventListener('lingua-highlight-line', handler);
      // Hook teardown (settings flip, hot-reload) — drop any active
      // flash so the next mount starts clean.
      clearActive();
    };
  }, [editorRef, masterEnabled, hoverEnabled, smoothScrollEnabled]);
}
