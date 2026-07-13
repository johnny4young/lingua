import {
  createBlankHttpRequest,
  type HttpRequestV1,
} from '../../shared/httpWorkspace';
import type { CurlImporterResult } from '../../shared/importers/curlImporter';
import type { IpynbImporterResult } from '../../shared/importers/ipynbImporter';
import type { LinguanbImporterResult } from '../../shared/importers/linguanbImporter';
import type { CollectionImporterResult } from '../../shared/importers/postmanImporter';
import { getImporter } from '../../shared/importers/registry';
import { bucketCapsuleSize } from '../../shared/runCapsule';
import { openHttpWorkspaceTab } from '../runtime/openWorkspaceTab';
import { useEditorStore } from '../stores/editorStore';
import { useNotebookStore } from '../stores/notebookStore';
import { useWorkspaceToolStore } from '../stores/workspaceToolStore';
import {
  bucketImportVariableCount,
  bucketWarningKindCount,
  countDistinctNotebookWarningKinds,
  deriveDominantNotebookWarning,
  trackImportApplied,
  trackNotebookWarningsSurfaced,
  trackPostmanVariablesResolved,
} from './importTelemetry';
import {
  deriveRequestName,
  firstNotebookCodeLanguage,
  type ConfirmResult,
  type ImportPreviewState,
} from './importPreviewModel';

export interface ImportConfirmationOutcome {
  readonly completed: boolean;
  readonly result: ConfirmResult | null;
}

const NOT_CONFIRMED: ImportConfirmationOutcome = {
  completed: false,
  result: null,
};

/** Apply one preview to the renderer stores; React owns resetting the overlay. */
export function confirmImportPreview(
  state: ImportPreviewState
): ImportConfirmationOutcome {
  if (state.phase !== 'previewed' || !state.importerId || !state.preview) {
    return NOT_CONFIRMED;
  }
  const adapter = getImporter(state.importerId);
  if (!adapter) return NOT_CONFIRMED;

  if (state.importerId === 'curl-http' && state.preview.kind === 'curl-http') {
    const result = adapter.import(state.preview) as CurlImporterResult;
    const request = toHttpRequest(result, deriveRequestName(result));
    useWorkspaceToolStore.getState().createRequest(request);
    openHttpWorkspaceTab({ adoptEntryId: request.id });
    trackApplied(state, 'curl-http', 'ok');
    return completed({ kind: 'curl-http', request });
  }

  if (
    state.importerId === 'ipynb-notebook' &&
    state.preview.kind === 'ipynb-notebook'
  ) {
    const result = adapter.import(state.preview) as IpynbImporterResult;
    const tabId = createNotebookTab(result);
    if (tabId === null) {
      trackApplied(state, 'ipynb-notebook', 'cancelled');
      return completed(null);
    }
    installIpynbNotebook(tabId, result);
    trackApplied(state, 'ipynb-notebook', 'ok');
    trackIpynbWarnings(state);
    return completed({
      kind: 'ipynb-notebook',
      notebookTabId: tabId,
      dominantLanguage: result.dominantLanguage,
    });
  }

  if (
    state.importerId === 'linguanb-notebook' &&
    state.preview.kind === 'linguanb-notebook'
  ) {
    const result = adapter.import(state.preview) as LinguanbImporterResult;
    const tabId = createNotebookTab(result);
    if (tabId === null) {
      trackApplied(state, 'linguanb-notebook', 'cancelled');
      return completed(null);
    }
    useNotebookStore
      .getState()
      .installImportedNotebook(tabId, result.notebook, result.executionOrder);
    trackApplied(state, 'linguanb-notebook', 'ok');
    return completed({
      kind: 'linguanb-notebook',
      notebookTabId: tabId,
      dominantLanguage: result.dominantLanguage,
    });
  }

  if (
    (state.importerId === 'postman-collection' ||
      state.importerId === 'bruno-collection') &&
    state.preview.kind === 'http-collection'
  ) {
    const result = adapter.import(state.preview) as CollectionImporterResult;
    const requests = result.requests.map((parsed) =>
      toHttpRequest(parsed, parsed.name)
    );
    if (requests.length === 0) return completed(null);

    useWorkspaceToolStore.getState().createRequests(requests);
    openHttpWorkspaceTab({ adoptEntryId: requests[0]?.id });
    trackApplied(state, state.importerId, 'ok');
    trackPostmanResolution(state);
    return completed({
      kind: state.importerId,
      requestCount: requests.length,
    });
  }

  return NOT_CONFIRMED;
}

function toHttpRequest(
  parsed: CurlImporterResult | CollectionImporterResult['requests'][number],
  name: string
): HttpRequestV1 {
  const blank = createBlankHttpRequest({ id: crypto.randomUUID(), name });
  return {
    ...blank,
    method: parsed.method,
    url: parsed.url,
    headers: parsed.headers.map((header) => ({ ...header })),
    ...(parsed.body ? { body: { ...parsed.body } } : {}),
  };
}

function createNotebookTab(
  result: IpynbImporterResult | LinguanbImporterResult
): string | null {
  const language =
    result.dominantLanguage ??
    firstNotebookCodeLanguage(result.notebook) ??
    'javascript';
  return (
    useEditorStore.getState().addNotebookTab?.({
      title: result.title,
      language,
    }) ?? null
  );
}

function installIpynbNotebook(
  tabId: string,
  result: IpynbImporterResult
): void {
  const store = useNotebookStore.getState();
  store.disposeNotebookForTab(tabId);
  store.createNotebookForTab(tabId, result.title);
  const seeded = store.getNotebookForTab(tabId);
  if (seeded) {
    for (const cell of seeded.cells) store.removeCell(tabId, cell.id);
  }
  for (const cell of result.notebook.cells) {
    const cellId = store.addCell(
      tabId,
      null,
      cell.kind === 'markdown'
        ? { kind: 'markdown' }
        : { kind: 'code', language: cell.language }
    );
    if (cellId === null) continue;
    store.updateCellSource(tabId, cellId, cell.source);
    if (cell.kind === 'code' && cell.outputs.length > 0) {
      store.setCellOutputs(tabId, cellId, [...cell.outputs]);
    }
  }
}

function trackApplied(
  state: ImportPreviewState,
  importerId: NonNullable<ImportPreviewState['importerId']>,
  status: 'ok' | 'cancelled'
): void {
  trackImportApplied({
    importerId,
    status,
    sizeBucket: bucketCapsuleSize(state.sourceBytes),
  });
}

function trackIpynbWarnings(state: ImportPreviewState): void {
  if (state.preview?.kind !== 'ipynb-notebook') return;
  const dominantKind = deriveDominantNotebookWarning(state.preview.warnings);
  if (dominantKind === null) return;
  trackNotebookWarningsSurfaced({
    warningKindCount: bucketWarningKindCount(
      countDistinctNotebookWarningKinds(state.preview.warnings)
    ),
    dominantKind,
  });
}

function trackPostmanResolution(state: ImportPreviewState): void {
  if (
    state.importerId !== 'postman-collection' ||
    state.preview?.kind !== 'http-collection'
  ) {
    return;
  }
  const resolvedCount = state.preview.counts.variablesResolved ?? 0;
  const unresolvedCount = state.preview.counts.variablesUnresolved ?? 0;
  if (resolvedCount === 0 && unresolvedCount === 0) return;
  trackPostmanVariablesResolved({
    resolvedBucket: bucketImportVariableCount(resolvedCount),
    unresolvedBucket: bucketImportVariableCount(unresolvedCount),
  });
}

function completed(result: ConfirmResult | null): ImportConfirmationOutcome {
  return { completed: true, result };
}
