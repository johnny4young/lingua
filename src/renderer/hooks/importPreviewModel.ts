import type {
  CurlImporterPreview,
  CurlImporterResult,
} from '../../shared/importers/curlImporter';
import type { IpynbImporterPreview } from '../../shared/importers/ipynbImporter';
import type { LinguanbImporterPreview } from '../../shared/importers/linguanbImporter';
import type {
  PlaygroundSourcePreview,
  PlaygroundUrlRejectReason,
} from '../../shared/importers/playgroundUrlImport';
import {
  previewPostmanWithVariables,
  type CollectionImporterPreview,
  type PostmanVariableSourceStatus,
} from '../../shared/importers/postmanImporter';
import { detectImporter, getImporter } from '../../shared/importers/registry';
import type {
  ImportFlowId,
  ImporterLossyWarning,
  ImporterRejectReason,
} from '../../shared/importers/types';
import type { HttpRequestV1 } from '../../shared/httpWorkspaceSchema';
import { utf8ByteLength } from '../../shared/httpWorkspaceSchema';
import {
  isNotebookCodeCell,
  type NotebookCellLanguage,
  type NotebookV1,
} from '../../shared/notebook';

type ImportPreviewPhase = 'idle' | 'loading' | 'previewed' | 'rejected';

type AnyImporterPreview =
  | (CurlImporterPreview & { readonly kind: 'curl-http' })
  | IpynbImporterPreview
  | LinguanbImporterPreview
  | CollectionImporterPreview
  | PlaygroundSourcePreview;

export interface ImportPreviewState {
  phase: ImportPreviewPhase;
  importerId?: ImportFlowId;
  preview?: AnyImporterPreview;
  reason?: ImporterRejectReason | PlaygroundUrlRejectReason;
  rejectDetail?: string;
  sourceBytes: number;
  source?: string;
  variableSources?: { environment?: string; globals?: string };
  variableStatus?: PostmanVariableSourceStatus;
}

export interface ConfirmResult {
  readonly kind:
    | 'curl-http'
    | 'ipynb-notebook'
    | 'linguanb-notebook'
    | 'postman-collection'
    | 'bruno-collection'
    | 'playground-url';
  readonly request?: HttpRequestV1;
  readonly notebookTabId?: string;
  readonly dominantLanguage?: NotebookCellLanguage | null;
  readonly requestCount?: number;
  readonly editorTabId?: string;
}

export interface UseImportPreviewResult {
  state: ImportPreviewState;
  previewSource: (source: string) => void;
  previewBrunoDirectory: () => Promise<
    'cancelled' | 'previewed' | 'rejected'
  >;
  previewPlaygroundUrl: (
    sourceUrl: string
  ) => Promise<'cancelled' | 'previewed' | 'rejected'>;
  cancelPlaygroundUrl: () => void;
  setVariableSource: (slot: VariableSourceSlot, raw: string) => void;
  confirm: () => Promise<ConfirmResult | null>;
  reset: () => void;
  trackCancelled: () => void;
  warnings: ReadonlyArray<ImporterLossyWarning>;
}

export type VariableSourceSlot = 'environment' | 'globals';

export const INITIAL_IMPORT_PREVIEW_STATE: ImportPreviewState = {
  phase: 'idle',
  sourceBytes: 0,
};

/** Detect and preview one raw import source without mutating renderer stores. */
export function previewImportSource(source: string): ImportPreviewState {
  const sourceText = typeof source === 'string' ? source : '';
  const sourceBytes = utf8ByteLength(sourceText);
  if (sourceText.trim().length === 0) {
    return { phase: 'rejected', reason: 'empty-input', sourceBytes };
  }

  const importerId = detectImporter(sourceText);
  if (importerId === null) {
    return { phase: 'rejected', reason: 'unrecognized-format', sourceBytes };
  }

  const adapter = getImporter(importerId);
  if (!adapter) {
    return {
      phase: 'rejected',
      reason: 'unrecognized-format',
      rejectDetail: `registry missing adapter for "${importerId}"`,
      sourceBytes,
    };
  }

  const outcome = adapter.preview(sourceText);
  if (!outcome.ok) {
    return {
      phase: 'rejected',
      importerId,
      reason: outcome.reason,
      ...(outcome.detail !== undefined ? { rejectDetail: outcome.detail } : {}),
      sourceBytes,
    };
  }

  const preview: AnyImporterPreview =
    importerId === 'curl-http'
      ? ({
          ...(outcome.preview as CurlImporterPreview),
          kind: 'curl-http' as const,
        } satisfies AnyImporterPreview)
      : (outcome.preview as AnyImporterPreview);
  return {
    phase: 'previewed',
    importerId,
    preview,
    sourceBytes,
    source: sourceText,
  };
}

/** Re-preview a Postman collection after changing environment or globals. */
export function withImportVariableSource(
  state: ImportPreviewState,
  slot: VariableSourceSlot,
  raw: string
): ImportPreviewState {
  if (
    state.phase !== 'previewed' ||
    state.importerId !== 'postman-collection' ||
    state.source === undefined
  ) {
    return state;
  }

  const merged = { ...state.variableSources, [slot]: raw };
  const variableSources: { environment?: string; globals?: string } = {};
  if (merged.environment?.trim()) {
    variableSources.environment = merged.environment;
  }
  if (merged.globals?.trim()) {
    variableSources.globals = merged.globals;
  }
  const { outcome, variableStatus } = previewPostmanWithVariables(
    state.source,
    variableSources
  );
  if (!outcome.ok) {
    return { ...state, variableSources, variableStatus };
  }
  return {
    ...state,
    preview: outcome.preview as AnyImporterPreview,
    variableSources,
    variableStatus,
  };
}

export function collectImportWarnings(
  state: ImportPreviewState
): ReadonlyArray<ImporterLossyWarning> {
  return state.phase === 'previewed' && state.preview
    ? [...new Set(state.preview.warnings)]
    : [];
}

export function deriveRequestName(result: CurlImporterResult): string {
  try {
    const parsed = new URL(result.url);
    const firstSegment = parsed.pathname
      .split('/')
      .find((segment) => segment.length > 0);
    return firstSegment
      ? `${parsed.hostname}/${firstSegment}`
      : parsed.hostname;
  } catch {
    return `${result.method} import`;
  }
}

export function firstNotebookCodeLanguage(
  notebook: NotebookV1
): NotebookCellLanguage | null {
  return notebook.cells.find(isNotebookCodeCell)?.language ?? null;
}
