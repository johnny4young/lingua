import { useCallback, useEffect, type MutableRefObject } from 'react';
import { createBlankCaptureRule } from '../../../shared/httpWorkspaceCaptures';
import type { HttpCaptureRule } from '../../../shared/httpWorkspaceSchema';
import { useUIStore } from '../../stores/uiStore';
import { normalizeCapturePath, suggestCaptureName, type JsonSegment } from './httpJsonTreeModel';

export type HttpCaptureTarget = (path: string, segments: readonly JsonSegment[]) => void;

/**
 * Points `targetRef` at the handler that turns a value picked in the response
 * tree into a body capture rule on the editor's draft, once per path.
 */
export function useHttpTreeCapture(
  targetRef: MutableRefObject<HttpCaptureTarget | null> | undefined,
  captures: readonly HttpCaptureRule[],
  applyCaptures: (next: HttpCaptureRule[]) => void,
  onCapture: () => void
): void {
  const capture = useCallback<HttpCaptureTarget>(
    (path, segments) => {
      onCapture();
      const wanted = normalizeCapturePath(path);
      if (captures.some((rule) => rule.source === 'body-json' && normalizeCapturePath(rule.path) === wanted)) return;
      const name = suggestCaptureName(segments, new Set(captures.map((rule) => rule.targetVariable)));
      applyCaptures([...captures, { ...createBlankCaptureRule(), path, targetVariable: name }]);
      useUIStore.getState().pushStatusNotice({ tone: 'success', messageKey: 'httpWorkspace.editor.capture.added', values: { path, name } });
    },
    [captures, applyCaptures, onCapture]
  );
  useEffect(() => {
    if (!targetRef) return;
    targetRef.current = capture;
    return () => {
      targetRef.current = null;
    };
  }, [targetRef, capture]);
}
