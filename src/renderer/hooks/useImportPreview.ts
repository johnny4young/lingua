/**
 * RL-100 Slice 1 + Slice 2 — `useImportPreview` hook.
 *
 * Orchestrates the global Import overlay flow:
 *
 *   1. The user pastes text or drops a file.
 *   2. The hook runs the registry's `detectImporter` → resolves the
 *      adapter id.
 *   3. The adapter's `preview(source)` is invoked synchronously.
 *      The result lives in the hook's state machine
 *      `{ idle | previewed | rejected }` as a discriminated union
 *      keyed on `importerId`.
 *   4. The user clicks `Confirm` → the hook calls `adapter.import`
 *      then writes the result into the appropriate store.
 *      - `'curl-http'` → `useWorkspaceToolStore.createRequest` +
 *        opens or focuses the stable HTTP workspace editor tab.
 *      - `'ipynb-notebook'` (Slice 2) → `editorStore.addNotebookTab`
 *        with the dominant notebook language + walks parsed cells via
 *        `addCell`; fold F keeps the FloatingActionPill language chip
 *        and new code cells oriented to that language.
 *   5. Fold E (Slice 2) — when the ipynb import succeeded WITH
 *      warnings, the hook also fires
 *      `import.notebook_warnings_surfaced { warningKindCount,
 *      dominantKind }` so we can measure how often Jupyter imports
 *      drop rich outputs vs other warning categories.
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
  IpynbImporterPreview,
  IpynbImporterResult,
} from '../../shared/importers/ipynbImporter';
import type {
  CollectionImporterPreview,
  CollectionImporterResult,
} from '../../shared/importers/postmanImporter';
import type {
  ImporterId,
  ImporterLossyWarning,
  ImporterRejectReason,
} from '../../shared/importers/types';
import {
  isNotebookCodeCell,
  type NotebookCellLanguage,
  type NotebookV1,
} from '../../shared/notebook';
import { bucketCapsuleSize } from '../../shared/runCapsule';
import { useEditorStore } from '../stores/editorStore';
import { useNotebookStore } from '../stores/notebookStore';
import { useWorkspaceToolStore } from '../stores/workspaceToolStore';
import { openHttpWorkspaceTab } from '../runtime/openWorkspaceTab';
import {
  bucketImportVariableCount,
  bucketWarningKindCount,
  countDistinctNotebookWarningKinds,
  deriveDominantNotebookWarning,
  trackImportApplied,
  trackNotebookWarningsSurfaced,
  trackPostmanVariablesResolved,
} from './importTelemetry';

export type ImportPreviewPhase = 'idle' | 'previewed' | 'rejected';

/**
 * Discriminated union of preview shapes. Adding a new importer means
 * extending this union with the adapter's TPreview type; the UI's
 * `<ImportPreviewBody>` branches on `kind`.
 *
 * Note: `CurlImporterPreview` is the legacy Slice 1 shape; we widen
 * it here with a `kind: 'curl-http'` discriminator at the hook
 * boundary so the union stays uniform.
 */
export type AnyImporterPreview =
  | (CurlImporterPreview & { readonly kind: 'curl-http' })
  | IpynbImporterPreview
  | CollectionImporterPreview;

export interface ImportPreviewState {
  phase: ImportPreviewPhase;
  /** Resolved importer id when phase !== 'idle'. */
  importerId?: ImporterId;
  /** Parsed preview shape when phase === 'previewed'. */
  preview?: AnyImporterPreview;
  /** Closed-enum reject reason when phase === 'rejected'. */
  reason?: ImporterRejectReason;
  /** Optional dev-facing reject detail (carries ipynb-specific code for the UI hint). */
  rejectDetail?: string;
  /** Size of the source input at the time of preview (bytes). */
  sourceBytes: number;
}

export interface ConfirmResult {
  readonly kind:
    | 'curl-http'
    | 'ipynb-notebook'
    | 'postman-collection'
    | 'bruno-collection';
  /** Slice 1 — newly-created request. Null for ipynb / collections. */
  readonly request?: HttpRequestV1;
  /** Slice 2 — newly-minted notebook tab id. Null for cURL / collections. */
  readonly notebookTabId?: string;
  /** Slice 2 fold F — dominant code-cell language used to seed the notebook tab. */
  readonly dominantLanguage?: NotebookCellLanguage | null;
  /** Slice 3 — number of requests written for a collection import. */
  readonly requestCount?: number;
}

export interface UseImportPreviewResult {
  state: ImportPreviewState;
  /** Run the preview pass against pasted text. */
  previewSource: (source: string) => void;
  /** Commit the previewed import; on success closes the overlay. */
  confirm: () => ConfirmResult | null;
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
    // Stamp the `kind` discriminator at the hook boundary so the
    // outer UI doesn't have to introspect the adapter id. cURL is
    // the only adapter whose preview shape predates the discriminator
    // (ipynb carries `kind: 'ipynb-notebook'`; the collection adapters
    // carry `kind: 'http-collection'`).
    const widened: AnyImporterPreview =
      importerId === 'curl-http'
        ? ({
            ...(outcome.preview as CurlImporterPreview),
            kind: 'curl-http' as const,
          } satisfies AnyImporterPreview)
        : (outcome.preview as AnyImporterPreview);
    setState({
      phase: 'previewed',
      importerId,
      preview: widened,
      sourceBytes,
    });
  }, []);

  const confirm = useCallback((): ConfirmResult | null => {
    if (state.phase !== 'previewed' || !state.importerId || !state.preview) {
      return null;
    }
    const adapter = getImporter(state.importerId);
    if (!adapter) return null;

    if (state.importerId === 'curl-http' && state.preview.kind === 'curl-http') {
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
      // Fold G (Slice 1) → MOV.02 (FASE 3) — surface the new request
      // as a full-screen HTTP workspace tab (the dock panel is gone).
      // Adopt the just-created request id so the tab.id === request.id
      // binding contract holds.
      openHttpWorkspaceTab({ adoptEntryId: merged.id });
      trackImportApplied({
        importerId: 'curl-http',
        status: 'ok',
        sizeBucket: bucketCapsuleSize(state.sourceBytes),
      });
      setState(INITIAL_STATE);
      return { kind: 'curl-http', request: merged };
    }

    if (
      state.importerId === 'ipynb-notebook' &&
      state.preview.kind === 'ipynb-notebook'
    ) {
      const result = adapter.import(state.preview) as IpynbImporterResult;
      const editorState = useEditorStore.getState();
      const tabLanguage =
        result.dominantLanguage ??
        firstNotebookCodeLanguage(result.notebook) ??
        'javascript';
      const tabId =
        editorState.addNotebookTab?.({
          title: result.title,
          language: tabLanguage,
        }) ?? null;
      if (tabId === null) {
        // Entitlement / tab-budget rejected — push status notice
        // (the addNotebookTab itself surfaces the upsell). Treat as
        // cancelled telemetry-wise.
        trackImportApplied({
          importerId: 'ipynb-notebook',
          status: 'cancelled',
          sizeBucket: bucketCapsuleSize(state.sourceBytes),
        });
        setState(INITIAL_STATE);
        return null;
      }
      // `addNotebookTab` already seeded the notebookStore with a
      // blank notebook (2 cells). Replace those with the imported
      // notebook's cells.
      const notebookStore = useNotebookStore.getState();
      // Drop the seeded entry + reinstall with the imported payload.
      notebookStore.disposeNotebookForTab(tabId);
      notebookStore.createNotebookForTab(tabId, result.title);
      // Walk the imported cells and append; the freshly-created
      // notebook still has 2 seed cells we need to clear first.
      const seeded = notebookStore.getNotebookForTab(tabId);
      if (seeded) {
        for (const seedCell of seeded.cells) {
          notebookStore.removeCell(tabId, seedCell.id);
        }
      }
      for (const cell of result.notebook.cells) {
        if (cell.kind === 'markdown') {
          const cellId = notebookStore.addCell(tabId, null, { kind: 'markdown' });
          if (cellId !== null) {
            notebookStore.updateCellSource(tabId, cellId, cell.source);
          }
        } else {
          const cellId = notebookStore.addCell(tabId, null, {
            kind: 'code',
            language: cell.language,
          });
          if (cellId !== null) {
            notebookStore.updateCellSource(tabId, cellId, cell.source);
            if (cell.outputs.length > 0) {
              notebookStore.setCellOutputs(tabId, cellId, [...cell.outputs]);
            }
          }
        }
      }
      trackImportApplied({
        importerId: 'ipynb-notebook',
        status: 'ok',
        sizeBucket: bucketCapsuleSize(state.sourceBytes),
      });
      // Fold E — surface aggregate warning telemetry when the import
      // dropped lossy bits.
      const dominantWarning = deriveDominantNotebookWarning(
        state.preview.warnings
      );
      if (dominantWarning !== null) {
        const distinctKinds = countDistinctNotebookWarningKinds(
          state.preview.warnings
        );
        trackNotebookWarningsSurfaced({
          warningKindCount: bucketWarningKindCount(distinctKinds),
          dominantKind: dominantWarning,
        });
      }
      setState(INITIAL_STATE);
      return {
        kind: 'ipynb-notebook',
        notebookTabId: tabId,
        dominantLanguage: result.dominantLanguage,
      };
    }

    if (
      (state.importerId === 'postman-collection' ||
        state.importerId === 'bruno-collection') &&
      state.preview.kind === 'http-collection'
    ) {
      const result = adapter.import(state.preview) as CollectionImporterResult;
      const newRequests: HttpRequestV1[] = result.requests.map((parsed) => {
        const blank = createBlankHttpRequest({
          id: crypto.randomUUID(),
          name: parsed.name,
        });
        return {
          ...blank,
          method: parsed.method,
          url: parsed.url,
          headers: parsed.headers.map((h) => ({ ...h })),
          ...(parsed.body ? { body: { ...parsed.body } } : {}),
        };
      });
      if (newRequests.length === 0) {
        setState(INITIAL_STATE);
        return null;
      }
      useWorkspaceToolStore.getState().createRequests(newRequests);
      // MOV.02 (FASE 3) — surface the imported collection as the single
      // full-screen HTTP workspace tab. We make the first imported
      // request active (createRequests sets it active too), and the
      // remaining requests stay first-class rail rows inside the same
      // collection. No per-request FileTab is minted, so large imports
      // remain navigable without creating an up-front tab/upsell storm.
      openHttpWorkspaceTab({ adoptEntryId: newRequests[0]?.id });
      trackImportApplied({
        importerId: state.importerId,
        status: 'ok',
        sizeBucket: bucketCapsuleSize(state.sourceBytes),
      });
      // Fold B — Postman-only: report the collection-variable
      // resolution result when the collection referenced any
      // `{{variable}}`. Bruno has no collection-var concept in this
      // slice, so its counts stay undefined and the event is skipped.
      if (state.importerId === 'postman-collection') {
        const resolvedCount = state.preview.counts.variablesResolved ?? 0;
        const unresolvedCount = state.preview.counts.variablesUnresolved ?? 0;
        if (resolvedCount > 0 || unresolvedCount > 0) {
          trackPostmanVariablesResolved({
            resolvedBucket: bucketImportVariableCount(resolvedCount),
            unresolvedBucket: bucketImportVariableCount(unresolvedCount),
          });
        }
      }
      setState(INITIAL_STATE);
      return {
        kind: state.importerId,
        requestCount: newRequests.length,
      };
    }

    // Unknown discriminator — defensive branch (closed enums make
    // this unreachable but TypeScript can't always prove that).
    return null;
  }, [state]);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const trackCancelled = useCallback(() => {
    // Only fire the telemetry pip when there was at least a preview
    // attempt — a click on the empty overlay's Cancel button is
    // noise.
    if (state.phase === 'idle') return;
    if (!state.importerId) {
      setState(INITIAL_STATE);
      return;
    }
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
        ? [...new Set(state.preview.warnings)]
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

function firstNotebookCodeLanguage(
  notebook: NotebookV1
): NotebookCellLanguage | null {
  const firstCodeCell = notebook.cells.find(isNotebookCodeCell);
  return firstCodeCell?.language ?? null;
}
