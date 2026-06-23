/**
 * RL-024 Slice 3 — project bundle import overlay (fold E).
 *
 * Reuses the `<CapsuleImportOverlay>` shell language: a `<ModalShell>`
 * with a 3-section body (load source / read-only preview / action bar),
 * a full-body drop zone, and a hidden `<input type="file">`. A `.zip`
 * is binary, so there is NO paste textarea (the capsule overlay's paste
 * surface does not apply); load is drop or file-picker only.
 *
 * The preview runs the shared `unpackBundle` purely in the renderer to
 * show the file list + skipped entries. It is advisory — the
 * authoritative zip-slip / zip-bomb / cap re-validation runs again in
 * the main process when the user confirms (`importProjectBundle` →
 * `fs:importBundle`), which also prompts for the destination folder.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, FileArchive, FileUp } from 'lucide-react';
import {
  unpackBundle,
  type UnpackBundleResult,
} from '../../../shared/projectBundle';
import { useProjectBundle } from '../../hooks/useProjectBundle';
import { cn } from '../../utils/cn';
import { ModalShell } from '../ui/ModalShell';
import { EmptyState } from '../ui/EmptyState';

export interface ProjectBundleImportOverlayProps {
  onClose: () => void;
}

export function ProjectBundleImportOverlay({
  onClose,
}: ProjectBundleImportOverlayProps) {
  const { t } = useTranslation();
  const { importProjectBundle } = useProjectBundle();
  // Keep the latest close callback available to async confirm handlers
  // without making the import callback churn on every parent render.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // `bytes` are the exact payload sent to the main process; `preview`
  // is renderer-only advisory state produced from the same byte array.
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [preview, setPreview] = useState<UnpackBundleResult | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const ingestFile = useCallback(async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const next = new Uint8Array(buffer);
      setBytes(next);
      // Preview failures stay local so users can correct the file before
      // the authoritative main-process import prompts for a destination.
      setPreview(unpackBundle(next));
    } catch {
      setBytes(null);
      setPreview({ ok: false, reason: 'malformed-zip' });
    }
  }, []);

  const handlePickFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFilePicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset the hidden input so choosing the same zip twice still
      // emits a change event after a failed preview.
      event.target.value = '';
      if (!file) return;
      void ingestFile(file);
    },
    [ingestFile]
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const hasFiles = Array.from(event.dataTransfer.types).includes('Files');
    // Ignore text/URL drags; only file drags should capture the modal's
    // drop zone or show the import ring.
    if (!hasFiles) return;
    event.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) setIsDragOver(false);
    },
    []
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      event.preventDefault();
      setIsDragOver(false);
      void ingestFile(file);
    },
    [ingestFile]
  );

  const decoded = preview?.ok ? preview : null;
  const rejected = preview && !preview.ok ? preview : null;

  const handleConfirm = useCallback(async () => {
    if (!bytes || !decoded || importing) return;
    setImporting(true);
    try {
      // Main re-validates zip-slip, zip-bomb, and size caps before writing;
      // the renderer preview is never treated as sufficient authority.
      await importProjectBundle(bytes);
    } finally {
      setImporting(false);
      closeRef.current();
    }
  }, [bytes, decoded, importing, importProjectBundle]);

  return (
    <ModalShell
      onClose={onClose}
      size="max-w-3xl"
      labelledById="project-bundle-import-title"
      headerClose="button"
      closeLabel={t('projectBundle.import.cancel')}
      header={
        <div className="min-w-0">
          <h2
            id="project-bundle-import-title"
            className="truncate text-body-lg font-semibold tracking-[-0.01em] text-fg-base"
          >
            {t('projectBundle.import.title')}
          </h2>
          <p className="mt-0.5 text-body-sm text-fg-subtle">
            {t('projectBundle.import.subtitle')}
          </p>
        </div>
      }
      footerLegend={<span />}
      trailing={
        <div
          data-testid="project-bundle-import-actions"
          className="flex flex-wrap items-center justify-end gap-2"
        >
          <button
            type="button"
            onClick={onClose}
            data-testid="project-bundle-import-cancel"
            className="button-ghost"
          >
            {t('projectBundle.import.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!decoded || importing}
            data-testid="project-bundle-import-cta"
            className="button-primary"
          >
            {t('projectBundle.import.cta')}
          </button>
        </div>
      }
    >
      <div
        data-testid="project-bundle-import-overlay"
        className={cn(
          'grid gap-3 rounded-md p-1',
          isDragOver && 'ring-2 ring-accent/70 ring-offset-2 ring-offset-bg-panel'
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* TOP — load source */}
        <section className="flex flex-col gap-1">
          <span className="text-caption font-semibold uppercase tracking-wider text-fg-subtle">
            {t('projectBundle.import.loadLabel')}
          </span>
          <button
            type="button"
            onClick={handlePickFile}
            data-testid="project-bundle-import-open-file"
            className={cn(
              'flex h-[80px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-default bg-bg-inset px-3 text-center text-body-sm text-fg-subtle transition-colors',
              'hover:border-border-strong hover:text-fg-base',
              isDragOver && 'border-accent bg-accent/10 text-fg-base'
            )}
          >
            <FileUp size={14} aria-hidden="true" />
            <span>{t('projectBundle.import.pickFile')}</span>
            <span className="text-eyebrow">{t('projectBundle.import.dropHint')}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/zip,.zip"
            data-testid="project-bundle-import-file-input"
            className="hidden"
            onChange={handleFilePicked}
          />
        </section>

        {/* MIDDLE — preview / reject / empty */}
        <section data-testid="project-bundle-import-body" className="min-h-0">
          {decoded ? (
            <div
              data-testid="project-bundle-import-preview"
              className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-bg-inset p-3"
            >
              <h3 className="text-body-sm font-semibold text-fg-base">
                {t('projectBundle.import.previewHeading', {
                  count: decoded.files.length,
                })}
              </h3>
              <ul className="max-h-44 overflow-auto font-mono text-caption text-fg-subtle">
                {decoded.files.map((file) => (
                  <li key={file.path} className="truncate">
                    {file.path}
                  </li>
                ))}
              </ul>
              {decoded.rejects.length > 0 ? (
                <div
                  data-testid="project-bundle-import-rejects"
                  className="mt-1 border-t border-border-subtle pt-2"
                >
                  <h4 className="text-caption font-semibold uppercase tracking-wider text-warning-fg">
                    {t('projectBundle.import.rejectsHeading')}
                  </h4>
                  <ul className="font-mono text-eyebrow text-warning-fg/80">
                    {decoded.rejects.map((reject) => (
                      <li key={reject.path} className="truncate">
                        {reject.path} — {t(`projectBundle.reject.${reject.reason}`)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : rejected ? (
            <div
              role="alert"
              data-testid="project-bundle-import-reject"
              data-reason={rejected.reason}
              className="flex flex-col gap-2 rounded-lg border border-error-border/60 bg-error-bg p-4 text-body-sm text-error-fg"
            >
              <header className="flex items-center gap-2">
                <AlertCircle size={14} aria-hidden="true" />
                <h3 className="font-semibold">
                  {t(`projectBundle.reject.${rejected.reason}`)}
                </h3>
              </header>
            </div>
          ) : (
            <div
              data-testid="project-bundle-import-empty"
              className="flex h-full items-center justify-center rounded-lg border border-dashed border-border-subtle bg-bg-inset py-8"
            >
              <EmptyState
                icon={<FileArchive size={18} aria-hidden="true" />}
                title={t('projectBundle.import.emptyTitle')}
                description={t('projectBundle.import.emptyHint')}
              />
            </div>
          )}
        </section>
      </div>
    </ModalShell>
  );
}
