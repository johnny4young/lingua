/**
 * RL-100 — React coordinator for the global Import overlay.
 * Parsing and Postman re-previewing live in importPreviewModel; confirmed
 * store writes live in importPreviewConfirm.
 */
import { useCallback, useMemo, useState } from 'react';
import { bucketCapsuleSize } from '../../shared/runCapsule';
import { trackImportApplied } from './importTelemetry';
import { confirmImportPreview } from './importPreviewConfirm';
import {
  collectImportWarnings,
  INITIAL_IMPORT_PREVIEW_STATE,
  previewImportSource,
  withImportVariableSource,
  type ImportPreviewState,
  type UseImportPreviewResult,
  type VariableSourceSlot,
} from './importPreviewModel';

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

  const setVariableSource = useCallback(
    (slot: VariableSourceSlot, raw: string) => {
      setState((previous) => withImportVariableSource(previous, slot, raw));
    },
    []
  );

  const confirm = useCallback(() => {
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
    setVariableSource,
    confirm,
    reset,
    trackCancelled,
    warnings,
  };
}
