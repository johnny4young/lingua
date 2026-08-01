/**
 * internal — React coordinator for the global Import overlay.
 * Parsing and Postman re-previewing live in importPreviewModel; confirmed
 * store writes live in importPreviewConfirm.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { loadPlaygroundUrlPreview } from '../../shared/importers/playgroundUrlImport';
import { utf8ByteLength } from '../../shared/httpWorkspaceSchema';
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
  confirmModulePromise ??= import('./importPreviewConfirm').catch(error => {
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
  const [state, setState] = useState<ImportPreviewState>(INITIAL_IMPORT_PREVIEW_STATE);
  const activeUrlRequest = useRef<AbortController | null>(null);

  const abortUrlRequest = useCallback(() => {
    activeUrlRequest.current?.abort();
    activeUrlRequest.current = null;
  }, []);

  const previewSource = useCallback(
    (source: string) => {
      abortUrlRequest();
      setState(previewImportSource(source));
    },
    [abortUrlRequest]
  );

  const previewBrunoDirectory = useCallback(async () => {
    abortUrlRequest();
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
  }, [abortUrlRequest]);

  const previewPlaygroundUrl = useCallback(
    async (sourceUrl: string) => {
      abortUrlRequest();
      const controller = new AbortController();
      activeUrlRequest.current = controller;
      setState({
        phase: 'loading',
        importerId: 'playground-url',
        sourceBytes: utf8ByteLength(sourceUrl),
      });

      const outcome = await loadPlaygroundUrlPreview(sourceUrl, {
        signal: controller.signal,
      });
      if (activeUrlRequest.current !== controller) return 'cancelled';
      activeUrlRequest.current = null;

      if (outcome.status === 'cancelled') {
        setState(INITIAL_IMPORT_PREVIEW_STATE);
        return outcome.status;
      }
      if (outcome.status === 'rejected') {
        setState({
          phase: 'rejected',
          importerId: 'playground-url',
          reason: outcome.reason,
          rejectDetail: outcome.reason,
          sourceBytes: outcome.sourceBytes,
        });
        return outcome.status;
      }
      setState({
        phase: 'previewed',
        importerId: 'playground-url',
        preview: outcome.preview,
        sourceBytes: outcome.sourceBytes,
      });
      return outcome.status;
    },
    [abortUrlRequest]
  );

  const cancelPlaygroundUrl = useCallback(() => {
    const request = activeUrlRequest.current;
    if (!request) return;
    const sourceBytes = state.sourceBytes;
    request.abort();
    activeUrlRequest.current = null;
    trackImportApplied({
      importerId: 'playground-url',
      status: 'cancelled',
      sizeBucket: bucketCapsuleSize(sourceBytes),
    });
    setState(INITIAL_IMPORT_PREVIEW_STATE);
  }, [state.sourceBytes]);

  const setVariableSource = useCallback((slot: VariableSourceSlot, raw: string) => {
    setState(previous => withImportVariableSource(previous, slot, raw));
  }, []);

  const confirm = useCallback(async () => {
    const { confirmImportPreview } = await loadImportPreviewConfirm();
    const outcome = confirmImportPreview(state);
    if (outcome.completed) setState(INITIAL_IMPORT_PREVIEW_STATE);
    return outcome.result;
  }, [state]);

  const reset = useCallback(() => {
    abortUrlRequest();
    setState(INITIAL_IMPORT_PREVIEW_STATE);
  }, [abortUrlRequest]);

  const trackCancelled = useCallback(() => {
    abortUrlRequest();
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
  }, [abortUrlRequest, state]);

  const warnings = useMemo(() => collectImportWarnings(state), [state]);

  return {
    state,
    previewSource,
    previewBrunoDirectory,
    previewPlaygroundUrl,
    cancelPlaygroundUrl,
    setVariableSource,
    confirm,
    reset,
    trackCancelled,
    warnings,
  };
}
