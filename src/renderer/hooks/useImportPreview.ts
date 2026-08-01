/**
 * internal — React coordinator for the global Import overlay.
 * Parsing and Postman re-previewing live in importPreviewModel; confirmed
 * store writes live in importPreviewConfirm.
 */
import { useCallback, useMemo, useState } from 'react';
import { bucketCapsuleSize } from '../../shared/runCapsule';
import { trackImportApplied } from './importTelemetry';
import { loadBrunoDirectoryPreview } from './brunoDirectoryImport';
import {
  collectImportWarnings,
  INITIAL_IMPORT_PREVIEW_STATE,
  previewImportSource,
  withImportVariableSource,
  type ImportPreviewState,
  type UseImportPreviewResult,
  type VariableSourceSlot,
} from './importPreviewModel';

type ImportPreviewConfirmModule = typeof import('./importPreviewConfirm');

let confirmModulePromise: Promise<ImportPreviewConfirmModule> | null = null;

/** Load store-writing import behavior only after the user confirms a preview. */
function loadImportPreviewConfirm(): Promise<ImportPreviewConfirmModule> {
  confirmModulePromise ??= import('./importPreviewConfirm').catch((error) => {
    confirmModulePromise = null;
    throw error;
  });
  return confirmModulePromise;
}

export type {
  AnyImporterPreview,
  ConfirmResult,
  ImportPreviewPhase,
  ImportPreviewState,
  UseImportPreviewResult,
} from './importPreviewModel';

export function useImportPreview(): UseImportPreviewResult {
  const [state, setState] = useState<ImportPreviewState>(
    INITIAL_IMPORT_PREVIEW_STATE
  );

  const previewSource = useCallback((source: string) => {
    setState(previewImportSource(source));
  }, []);

  const previewBrunoDirectory = useCallback(async () => {
    const outcome = await loadBrunoDirectoryPreview();
    if (outcome.status === 'cancelled') return outcome.status;
    if (outcome.status === 'rejected') {
      setState({
        phase: 'rejected',
        importerId: 'bruno-collection',
        reason: outcome.reason,
        rejectDetail: outcome.detail,
        sourceBytes: outcome.sourceBytes,
      });
      return outcome.status;
    }
    setState({
      phase: 'previewed',
      importerId: 'bruno-collection',
      preview: outcome.preview,
      sourceBytes: outcome.sourceBytes,
    });
    return outcome.status;
  }, []);

  const setVariableSource = useCallback(
    (slot: VariableSourceSlot, raw: string) => {
      setState((previous) => withImportVariableSource(previous, slot, raw));
    },
    []
  );

  const confirm = useCallback(async () => {
    const { confirmImportPreview } = await loadImportPreviewConfirm();
    const outcome = confirmImportPreview(state);
    if (outcome.completed) setState(INITIAL_IMPORT_PREVIEW_STATE);
    return outcome.result;
  }, [state]);

  const reset = useCallback(() => {
    setState(INITIAL_IMPORT_PREVIEW_STATE);
  }, []);

  const trackCancelled = useCallback(() => {
    if (state.phase === 'idle') return;
    if (!state.importerId) {
      setState(INITIAL_IMPORT_PREVIEW_STATE);
      return;
    }
    trackImportApplied({
      importerId: state.importerId,
      status: state.phase === 'rejected' ? 'rejected' : 'cancelled',
      sizeBucket: bucketCapsuleSize(state.sourceBytes),
    });
    setState(INITIAL_IMPORT_PREVIEW_STATE);
  }, [state]);

  const warnings = useMemo(() => collectImportWarnings(state), [state]);

  return {
    state,
    previewSource,
    previewBrunoDirectory,
    setVariableSource,
    confirm,
    reset,
    trackCancelled,
    warnings,
  };
}
