/**
 * RL-100 Slice 1 — `useImportPreview` hook.
 *
 * Orchestrates the global Import overlay flow:
 *
 *   1. The user pastes text or drops a file.
 *   2. The hook runs the registry's `detectImporter` → resolves the
 *      adapter id.
 *   3. The adapter's `preview(source)` is invoked synchronously.
 *      The result lives in the hook's state machine
 *      `{ idle | previewed | rejected }`.
 *   4. The user clicks `Confirm` → the hook calls `adapter.import`
 *      then writes the result into the right Zustand store. For
 *      `curl-http` this is `useWorkspaceToolStore.createRequest`.
 *   5. Fold G — on a successful commit, the hook also flips the
 *      bottom-panel to the `'http'` tab via `useUIStore` so the
 *      imported request is visible immediately.
 *
 * Stays a pure hook (no IPC); shared importer adapters all run in
 * the renderer.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  createBlankHttpRequest,
  type HttpRequestV1,
  utf8ByteLength,
} from '../../shared/httpWorkspace';
import {
  detectImporter,
  getImporter,
} from '../../shared/importers/registry';
import type {
  CurlImporterPreview,
  CurlImporterResult,
} from '../../shared/importers/curlImporter';
import type {
  ImporterId,
  ImporterLossyWarning,
  ImporterRejectReason,
} from '../../shared/importers/types';
import { bucketCapsuleSize } from '../../shared/runCapsule';
import { useUIStore } from '../stores/uiStore';
import { useWorkspaceToolStore } from '../stores/workspaceToolStore';
import { trackImportApplied } from './importTelemetry';

export type ImportPreviewPhase = 'idle' | 'previewed' | 'rejected';

export interface ImportPreviewState {
  phase: ImportPreviewPhase;
  /** Resolved importer id when phase !== 'idle'. */
  importerId?: ImporterId;
  /** Parsed preview shape when phase === 'previewed'. Slice 1: cURL-specific. */
  preview?: CurlImporterPreview;
  /** Closed-enum reject reason when phase === 'rejected'. */
  reason?: ImporterRejectReason;
  /** Optional dev-facing reject detail (not user-facing copy). */
  rejectDetail?: string;
  /** Size of the source input at the time of preview (bytes). */
  sourceBytes: number;
}

export interface UseImportPreviewResult {
  state: ImportPreviewState;
  /** Run the preview pass against pasted text. */
  previewSource: (source: string) => void;
  /** Commit the previewed import; on success closes the overlay. */
  confirm: () => HttpRequestV1 | null;
  /** Reset the hook back to idle. */
  reset: () => void;
  /** Track a user-cancelled flow without committing. */
  trackCancelled: () => void;
  /** Warning codes (closed enum) — empty array when phase !== 'previewed'. */
  warnings: ReadonlyArray<ImporterLossyWarning>;
}

const INITIAL_STATE: ImportPreviewState = {
  phase: 'idle',
  sourceBytes: 0,
};

export function useImportPreview(): UseImportPreviewResult {
  const [state, setState] = useState<ImportPreviewState>(INITIAL_STATE);

  const previewSource = useCallback((source: string) => {
    const sourceBytes = utf8ByteLength(typeof source === 'string' ? source : '');
    if (typeof source !== 'string' || source.trim().length === 0) {
      setState({
        phase: 'rejected',
        reason: 'empty-input',
        sourceBytes,
      });
      return;
    }
    const importerId = detectImporter(source);
    if (importerId === null) {
      setState({
        phase: 'rejected',
        reason: 'unrecognized-format',
        sourceBytes,
      });
      return;
    }
    const adapter = getImporter(importerId);
    if (!adapter) {
      // Shouldn't happen — detectImporter returns from the same
      // registry that getImporter reads. Defensive branch.
      setState({
        phase: 'rejected',
        reason: 'unrecognized-format',
        rejectDetail: `registry missing adapter for "${importerId}"`,
        sourceBytes,
      });
      return;
    }
    const outcome = adapter.preview(source);
    if (!outcome.ok) {
      setState({
        phase: 'rejected',
        importerId,
        reason: outcome.reason,
        ...(outcome.detail !== undefined ? { rejectDetail: outcome.detail } : {}),
        sourceBytes,
      });
      return;
    }
    // Slice 1 only knows the cURL shape — narrow defensively.
    if (importerId !== 'curl-http') {
      setState({
        phase: 'rejected',
        importerId,
        reason: 'unsupported-feature',
        rejectDetail: `importer "${importerId}" not wired Slice 1`,
        sourceBytes,
      });
      return;
    }
    setState({
      phase: 'previewed',
      importerId,
      preview: outcome.preview as CurlImporterPreview,
      sourceBytes,
    });
  }, []);

  const confirm = useCallback((): HttpRequestV1 | null => {
    if (state.phase !== 'previewed' || !state.importerId || !state.preview) {
      return null;
    }
    const adapter = getImporter(state.importerId);
    if (!adapter) return null;
    // Slice 1 — only cURL → HTTP. The future-proof shape will switch
    // on `importerId` and route to the matching store (e.g.
    // `'ipynb-notebook'` → notebook store, `'postman-collection'` →
    // multiple HTTP requests).
    const result = adapter.import(state.preview) as CurlImporterResult;
    const newRequest = createBlankHttpRequest({
      id: crypto.randomUUID(),
      name: deriveRequestName(result),
    });
    const merged: HttpRequestV1 = {
      ...newRequest,
      method: result.method,
      url: result.url,
      headers: result.headers.map((h) => ({ ...h })),
      ...(result.body ? { body: { ...result.body } } : {}),
    };
    useWorkspaceToolStore.getState().createRequest(merged);
    // Fold G — surface the new request immediately.
    useUIStore.getState().openBottomPanel('http');
    trackImportApplied({
      importerId: 'curl-http',
      status: 'ok',
      sizeBucket: bucketCapsuleSize(state.sourceBytes),
    });
    setState(INITIAL_STATE);
    return merged;
  }, [state]);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const trackCancelled = useCallback(() => {
    // Only fire the telemetry pip when there was at least a preview
    // attempt — a click on the empty overlay's Cancel button is
    // noise.
    if (state.phase === 'idle') return;
    const status: 'rejected' | 'cancelled' =
      state.phase === 'rejected' ? 'rejected' : 'cancelled';
    trackImportApplied({
      importerId: state.importerId ?? 'curl-http',
      status,
      sizeBucket: bucketCapsuleSize(state.sourceBytes),
    });
    setState(INITIAL_STATE);
  }, [state]);

  const warnings = useMemo<ReadonlyArray<ImporterLossyWarning>>(
    () =>
      state.phase === 'previewed' && state.preview
        ? state.preview.warnings
        : [],
    [state]
  );

  return { state, previewSource, confirm, reset, trackCancelled, warnings };
}

/**
 * Derive a default name for the imported request from the URL's
 * hostname + first path segment, falling back to the method when
 * the URL is malformed.
 */
function deriveRequestName(result: CurlImporterResult): string {
  try {
    const parsed = new URL(result.url);
    const firstSegment = parsed.pathname.split('/').find((seg) => seg.length > 0);
    return firstSegment
      ? `${parsed.hostname}/${firstSegment}`
      : parsed.hostname;
  } catch {
    return `${result.method} import`;
  }
}
