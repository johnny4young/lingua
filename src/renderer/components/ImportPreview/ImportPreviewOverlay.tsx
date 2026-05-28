/**
 * RL-100 Slice 1 + Slice 2 — global Import overlay.
 *
 * Mod+Alt+I from anywhere opens this overlay. 3-section layout
 * mirroring `<CapsuleImportOverlay>` (RL-094 Slice 2):
 *
 *   - TOP    : Load source (Paste textarea + Pick-a-file button +
 *              full-overlay drag-drop). Fold B = drag-drop with
 *              visible ring on `dragover`.
 *   - MIDDLE : Read-only preview band (<ImportPreviewBody>) OR a
 *              reject band when the source doesn't parse.
 *              Warning band lists lossy cURL flags (fold C codes).
 *   - BOTTOM : Action bar — Cancel + Import (disabled until valid
 *              preview). Fold G (Slice 1) — confirm flips the
 *              bottom-panel to the HTTP workspace tab for cURL;
 *              fold F (Slice 2) — the hook creates notebook tabs with
 *              the detected dominant code-cell language.
 *
 * Slice 2 folds:
 *   A. Drag-drop accepts `.ipynb` (file input `accept` widened).
 *   B. `detectImporter` content-sniff handles both adapters; file
 *      extension hint kicks in for drop events.
 *   C. Confirm button label adapts per importer kind.
 *   D. Notebook preview band renders cell summary + snippets.
 *   E. Warning telemetry fires for ipynb imports with lossy bits.
 *   F. After-confirm language chip auto-flip.
 *   G. Clipboard auto-detect on overlay focus when consent granted.
 *
 * Escape closes. Click-outside closes. Telemetry (fold E) is
 * owned by `useImportPreview`; the overlay just calls
 * `trackCancelled()` on dismiss.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, FileUp, X } from 'lucide-react';
import { detectImporter } from '../../../shared/importers/registry';
import { useImportPreview } from '../../hooks/useImportPreview';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { cn } from '../../utils/cn';
import { ImportPreviewBody } from './ImportPreviewBody';

export interface ImportPreviewOverlayProps {
  onClose: () => void;
}

export function ImportPreviewOverlay({ onClose }: ImportPreviewOverlayProps) {
  const { t } = useTranslation();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const { state, previewSource, confirm, reset, trackCancelled, warnings } =
    useImportPreview();
  const pushStatusNotice = useUIStore((s) => s.pushStatusNotice);
  const clipboardConsent = useSettingsStore(
    (s) => s.importPreviewClipboardOnFocusConsent
  );

  const [pasteValue, setPasteValue] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  // Reset hook state on unmount so a re-open starts clean.
  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  // Escape closes.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        trackCancelled();
        closeRef.current();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [trackCancelled]);

  // Fold G — when consent is granted and the clipboard contains
  // recognized content, auto-populate the paste textarea on mount.
  // ALWAYS gated on consent. NEVER auto-imports — only previews;
  // the user must still click Confirm.
  useEffect(() => {
    if (clipboardConsent !== 'granted') return;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      return;
    }
    let cancelled = false;
    navigator.clipboard
      .readText()
      .then((text) => {
        if (cancelled) return;
        const trimmed = text.trim();
        if (trimmed.length === 0) return;
        // Cheap pre-check: only auto-populate when the content looks
        // like one of our known formats. Avoids leaking arbitrary
        // clipboard contents into the overlay.
        const detectedImporter = detectImporter(trimmed);
        if (detectedImporter === null) return;
        setPasteValue(text);
        previewSource(text);
        pushStatusNotice({
          tone: 'info',
          messageKey: 'importPreview.notice.clipboardAutoDetected',
          values: {
            format:
              detectedImporter === 'curl-http' ? 'cURL' : 'Jupyter .ipynb',
          },
        });
      })
      .catch(() => {
        // Clipboard read denied — silently ignore. The user can
        // still paste manually.
      });
    return () => {
      cancelled = true;
    };
  }, [clipboardConsent, previewSource, pushStatusNotice]);

  const handleClose = useCallback(() => {
    trackCancelled();
    closeRef.current();
  }, [trackCancelled]);

  const handlePasteChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setPasteValue(value);
      if (value.trim().length === 0) {
        reset();
      } else {
        previewSource(value);
      }
    },
    [previewSource, reset]
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handlePickFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        setPasteValue(text);
        previewSource(text);
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'unreadable file';
        pushStatusNotice({
          tone: 'warning',
          messageKey: 'importPreview.notice.fileReadFailed',
          values: { filename: file.name, detail },
        });
      } finally {
        // Reset the input so picking the same file twice still fires `change`.
        event.target.value = '';
      }
    },
    [previewSource, pushStatusNotice]
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((event: React.DragEvent) => {
    if (event.target === event.currentTarget) {
      setIsDragOver(false);
    }
  }, []);
  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragOver(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) {
        // Maybe text was dragged (some browsers serialize as text/plain).
        const text = event.dataTransfer?.getData('text/plain') ?? '';
        if (text.trim().length > 0) {
          setPasteValue(text);
          previewSource(text);
        }
        return;
      }
      // First file wins — surface a notice if the user dropped more.
      const file = files[0]!;
      if (files.length > 1) {
        pushStatusNotice({
          tone: 'info',
          messageKey: 'importPreview.notice.multipleFilesIgnored',
          values: { filename: file.name },
        });
      }
      try {
        const text = await file.text();
        setPasteValue(text);
        previewSource(text);
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'unreadable file';
        pushStatusNotice({
          tone: 'warning',
          messageKey: 'importPreview.notice.fileReadFailed',
          values: { filename: file.name, detail },
        });
      }
    },
    [previewSource, pushStatusNotice]
  );

  const handleConfirm = useCallback(() => {
    const created = confirm();
    if (!created) {
      // Confirm failed (tier ceiling etc.) — the hook already
      // surfaced the upsell notice. Just close the overlay.
      closeRef.current();
      return;
    }
    if (created.kind === 'curl-http') {
      pushStatusNotice({
        tone: 'success',
        messageKey: 'importPreview.success.toast',
      });
    } else if (created.kind === 'ipynb-notebook') {
      pushStatusNotice({
        tone: 'success',
        messageKey: 'importPreview.success.notebookOpened',
      });
    }
    closeRef.current();
  }, [confirm, pushStatusNotice]);

  const previewed = state.phase === 'previewed' ? state.preview : undefined;
  const rejected = state.phase === 'rejected' ? state.reason : null;
  const canConfirm = state.phase === 'previewed' && !!previewed;
  const importerId = state.importerId;
  // Fold C — confirm label per importer kind.
  const confirmLabel =
    importerId === 'ipynb-notebook'
      ? t('importPreview.action.confirm.notebook')
      : importerId === 'curl-http'
        ? t('importPreview.action.confirm.curl')
        : t('importPreview.action.confirm');
  // Slice 2 — reject hint copy. Generic outer reason + optional
  // ipynb-specific detail.
  const rejectKey = rejected ? `importPreview.reject.${rejected}` : null;
  const rejectIpynbKey =
    rejected && state.rejectDetail && importerId === 'ipynb-notebook'
      ? `importPreview.reject.ipynb.${state.rejectDetail}`
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('importPreview.overlay.title')}
      data-testid="import-preview-overlay"
      className={cn(
        'fixed inset-0 z-40 flex items-start justify-center bg-bg-base/80 p-6 backdrop-blur-sm',
        isDragOver && 'ring-2 ring-emerald-500/80 ring-offset-2 ring-offset-bg-base'
      )}
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="mt-12 flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-xl">
        <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
          <div>
            <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-foreground">
              {t('importPreview.overlay.title')}
            </h2>
            <p className="mt-0.5 text-[11px] text-muted">
              {t('importPreview.overlay.description')}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('importPreview.overlay.close')}
            data-testid="import-preview-overlay-close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-strong/60 hover:text-foreground"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr_auto] gap-3 p-4">
          {/* TOP — load source */}
          <section
            data-testid="import-preview-load"
            className="grid gap-3 md:grid-cols-2"
          >
            <div className="flex flex-col gap-1">
              <label
                htmlFor="import-preview-paste"
                className="text-[11px] font-semibold uppercase tracking-wider text-muted"
              >
                {t('importPreview.source.pasteLabel')}
              </label>
              <textarea
                id="import-preview-paste"
                data-testid="import-preview-paste"
                value={pasteValue}
                onChange={handlePasteChange}
                placeholder={t('importPreview.source.pastePlaceholderNotebook')}
                rows={4}
                spellCheck={false}
                className="min-h-[80px] resize-none rounded-md border border-border/60 bg-bg-elevated p-2 font-mono text-xs text-foreground outline-none focus:border-border-strong"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                {t('importPreview.source.fileCta')}
              </span>
              <button
                type="button"
                onClick={handlePickFile}
                data-testid="import-preview-pick-file"
                className={cn(
                  'flex h-[80px] flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border/60 bg-surface/30 px-3 text-center text-xs text-muted transition-colors',
                  'hover:border-border-strong hover:text-foreground',
                  isDragOver && 'border-emerald-500/80 bg-emerald-500/10 text-foreground'
                )}
              >
                <FileUp size={14} aria-hidden="true" />
                <span>{t('importPreview.source.dropHintWithIpynb')}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".curl,.txt,.ipynb,text/plain,application/json,application/x-ipynb+json"
                onChange={handleFileChange}
                className="sr-only"
                data-testid="import-preview-file-input"
              />
            </div>
          </section>

          {/* MIDDLE — preview band OR reject band */}
          <section
            data-testid="import-preview-band"
            className="min-h-0 overflow-y-auto"
          >
            {previewed ? (
              <div className="grid gap-2">
                <ImportPreviewBody preview={previewed} />
                {warnings.length > 0 ? (
                  <div
                    data-testid="import-preview-warnings"
                    role="status"
                    className="grid gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-700 dark:text-amber-300"
                  >
                    <div className="flex items-center gap-1 font-semibold">
                      <AlertCircle size={12} aria-hidden="true" />
                      {t('importPreview.warning.title')}
                    </div>
                    <ul role="list" className="grid gap-0.5 pl-4">
                      {warnings.map((code) => (
                        <li key={code} data-warning-code={code}>
                          {t(`importPreview.warning.lossy.${code}`)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : rejected && rejectKey ? (
              <div
                role="alert"
                data-testid="import-preview-reject"
                data-reject-reason={rejected}
                data-reject-detail={state.rejectDetail ?? ''}
                className="grid gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-[12px] text-rose-700 dark:text-rose-300"
              >
                {/* When an importer-specific detail exists (e.g. an
                    `.ipynb` `wrong-version` / `oversized` reject), the
                    detail IS the accurate message — promote it to the
                    bold header and skip the generic outer-reason copy,
                    which is written for the Slice 1 "importer not
                    wired" meaning and reads wrong for these cases. */}
                {rejectIpynbKey ? (
                  <div
                    data-testid="import-preview-reject-ipynb-detail"
                    className="flex items-center gap-1 font-semibold"
                  >
                    <AlertCircle size={12} aria-hidden="true" />
                    {t(rejectIpynbKey)}
                  </div>
                ) : (
                  <div className="flex items-center gap-1 font-semibold">
                    <AlertCircle size={12} aria-hidden="true" />
                    {t(rejectKey)}
                  </div>
                )}
              </div>
            ) : (
              <div
                data-testid="import-preview-empty"
                className="grid place-items-center rounded-md border border-dashed border-border/40 bg-surface/20 p-6 text-center text-xs text-muted"
              >
                {t('importPreview.preview.emptyHint')}
              </div>
            )}
          </section>

          {/* BOTTOM — action bar */}
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={handleClose}
              data-testid="import-preview-cancel"
              className="inline-flex h-7 items-center rounded border border-border/60 bg-surface/40 px-3 text-[11px] text-muted hover:text-foreground"
            >
              {t('importPreview.action.cancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              data-testid="import-preview-confirm"
              className="inline-flex h-7 items-center rounded border border-emerald-500/40 bg-emerald-500/10 px-3 text-[11px] font-medium text-emerald-700 hover:border-emerald-500 dark:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
