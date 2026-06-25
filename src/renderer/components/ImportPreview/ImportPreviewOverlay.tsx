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
 *              opens or focuses the HTTP workspace editor tab for cURL;
 *              fold F (Slice 2) — the hook creates notebook tabs with
 *              the detected dominant code-cell language.
 *
 * Slice 2 folds:
 *   A. Drag-drop accepts notebook files (file input `accept` widened).
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
 *
 * FASE 1 (MOV.01) — the ad-hoc backdrop/card chrome was replaced by the
 * shared `<ModalShell>` (title-header variant + `x` close button + the
 * 900px clamp). Escape / scrim-click / the header `x` all route through
 * the shell's `onClose` (wired to `handleClose`, which fires the cancel
 * telemetry). Full-overlay drag-drop is preserved by attaching the drag
 * handlers to the body wrapper the shell renders our children into.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, FileUp } from 'lucide-react';
import { detectImporter } from '../../../shared/importers/registry';
import {
  parsePostmanVariableExport,
  type PostmanVariableSlotStatus,
  type PostmanVariableSourceStatus,
} from '../../../shared/importers/postmanImporter';
import type { ImporterId } from '../../../shared/importers/types';
import { useImportPreview } from '../../hooks/useImportPreview';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { cn } from '../../utils/cn';
import { ModalShell } from '../ui/ModalShell';
import { ImportPreviewBody } from './ImportPreviewBody';

export interface ImportPreviewOverlayProps {
  onClose: () => void;
}

function formatLabelKeyForImporter(importerId: ImporterId): string {
  switch (importerId) {
    case 'curl-http':
      return 'importPreview.format.curl';
    case 'ipynb-notebook':
      return 'importPreview.format.ipynb';
    case 'linguanb-notebook':
      return 'importPreview.format.linguanb';
    case 'postman-collection':
      return 'importPreview.format.postman';
    case 'bruno-collection':
      return 'importPreview.format.bruno';
  }
}

export function ImportPreviewOverlay({ onClose }: ImportPreviewOverlayProps) {
  const { t } = useTranslation();
  // Async handlers call the latest close callback without forcing every
  // import/clipboard callback to rebind when the parent rerenders.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const {
    state,
    previewSource,
    setVariableSource,
    confirm,
    reset,
    trackCancelled,
    warnings,
  } = useImportPreview();
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

  // Escape is owned by `<ModalShell>` now — it routes Escape (and
  // scrim-click and the header `x`) through the `onClose` we pass it
  // (`handleClose`), which fires `trackCancelled()`. No document-level
  // listener here, otherwise the cancel telemetry would double-fire.

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
        // Auto-detect stops at preview. The user still has to press the
        // adapter-specific confirm button before any workspace/tab is created.
        setPasteValue(text);
        previewSource(text);
        pushStatusNotice({
          tone: 'info',
          messageKey: 'importPreview.notice.clipboardAutoDetected',
          values: {
            format: t(formatLabelKeyForImporter(detectedImporter)),
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
  }, [clipboardConsent, previewSource, pushStatusNotice, t]);

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
          // Text drops intentionally share the paste path so detection,
          // warning telemetry, and reject handling stay centralized.
          setPasteValue(text);
          previewSource(text);
        }
        return;
      }
      // Fold C — multiple files: detect a Postman collection + route any
      // environment/globals exports into the variable slots. Falls back to
      // first-file-wins when no collection+variables combo is present.
      if (files.length > 1) {
        const entries = await Promise.all(
          files.map(async (f) => ({
            file: f,
            text: await f.text().catch(() => null),
          }))
        );
        const readable = entries.filter(
          (e): e is { file: File; text: string } => e.text !== null
        );
        const primary = readable.find((e) => detectImporter(e.text) !== null);
        const variableExports = readable.filter(
          (e) => e !== primary && parsePostmanVariableExport(e.text).ok
        );
        if (
          primary &&
          detectImporter(primary.text) === 'postman-collection' &&
          variableExports.length > 0
        ) {
          setPasteValue(primary.text);
          previewSource(primary.text);
          let envFilled = false;
          let globalsFilled = false;
          for (const entry of variableExports) {
            const parsed = parsePostmanVariableExport(entry.text);
            if (!parsed.ok) continue;
            let slot: 'environment' | 'globals' =
              parsed.export.scope === 'globals' ? 'globals' : 'environment';
            // Two same-scope exports: spill the second into the free slot.
            if (slot === 'environment' && envFilled) slot = 'globals';
            else if (slot === 'globals' && globalsFilled) slot = 'environment';
            if (slot === 'environment') envFilled = true;
            else globalsFilled = true;
            setVariableSource(slot, entry.text);
          }
          pushStatusNotice({
            tone: 'info',
            messageKey: 'importPreview.notice.variablesFromDrop',
            values: { count: variableExports.length },
          });
          return;
        }
      }
      // First readable file wins — surface a notice if the user dropped more.
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
    [previewSource, setVariableSource, pushStatusNotice]
  );

  const handleConfirm = useCallback(() => {
    const created = confirm();
    if (!created) {
      // Confirm failed (tier ceiling etc.) — the hook already
      // surfaced the upsell notice. Just close the overlay.
      closeRef.current();
      return;
    }
    // `confirm()` owns the state mutation; the overlay only translates the
    // returned adapter kind into the most specific success copy.
    if (created.kind === 'curl-http') {
      pushStatusNotice({
        tone: 'success',
        messageKey: 'importPreview.success.toast',
      });
    } else if (
      created.kind === 'ipynb-notebook' ||
      created.kind === 'linguanb-notebook'
    ) {
      pushStatusNotice({
        tone: 'success',
        messageKey: 'importPreview.success.notebookOpened',
      });
    } else if (
      created.kind === 'postman-collection' ||
      created.kind === 'bruno-collection'
    ) {
      pushStatusNotice({
        tone: 'success',
        messageKey: 'importPreview.success.collectionImported',
        values: { count: created.requestCount ?? 0 },
      });
    }
    closeRef.current();
  }, [confirm, pushStatusNotice]);

  const previewed = state.phase === 'previewed' ? state.preview : undefined;
  const rejected = state.phase === 'rejected' ? state.reason : null;
  // The confirm button stays tied to the state machine phase rather than to
  // local text/file state, so malformed-but-present source cannot import.
  const canConfirm = state.phase === 'previewed' && !!previewed;
  const importerId = state.importerId;
  const isCollection =
    importerId === 'postman-collection' || importerId === 'bruno-collection';
  const collectionCount =
    previewed && previewed.kind === 'http-collection' ? previewed.counts.total : 0;
  // Fold C — confirm label per importer kind.
  const confirmLabel =
    importerId === 'ipynb-notebook' || importerId === 'linguanb-notebook'
      ? t('importPreview.action.confirm.notebook')
      : importerId === 'curl-http'
        ? t('importPreview.action.confirm.curl')
        : isCollection
          ? t('importPreview.action.confirm.collection', { count: collectionCount })
          : t('importPreview.action.confirm');
  // Footer-left hint — the detected source format, mirroring the
  // MOV.01 prototype's "Detected: …" legend. Only shown once a preview
  // resolves (so `importerId` is known); reuses the existing
  // `importPreview.format.*` value strings.
  const detectedFormatLabel =
    previewed && importerId
      ? t(formatLabelKeyForImporter(importerId))
      : null;
  // Reject hint copy. Generic outer reason + optional importer-specific
  // detail (ipynb / postman carry a `detail` reject code mapped to a
  // more precise localized hint).
  const rejectKey = rejected ? `importPreview.reject.${rejected}` : null;
  const rejectDetailKey =
    rejected && state.rejectDetail
      ? importerId === 'ipynb-notebook'
        ? `importPreview.reject.ipynb.${state.rejectDetail}`
        : importerId === 'postman-collection'
          ? `importPreview.reject.postman.${state.rejectDetail}`
          : importerId === 'linguanb-notebook'
            ? `importPreview.reject.linguanb.${state.rejectDetail}`
            : null
      : null;

  return (
    <ModalShell
      onClose={handleClose}
      size="max-w-[900px]"
      labelledById="import-preview-title"
      headerClose="button"
      closeLabel={t('importPreview.overlay.close')}
      header={
        <div className="min-w-0">
          <h2
            id="import-preview-title"
            className="truncate text-body-lg font-semibold tracking-[-0.01em] text-fg-base"
          >
            {t('importPreview.overlay.title')}
          </h2>
          <p className="mt-0.5 text-body-sm text-fg-subtle">
            {t('importPreview.overlay.description')}
          </p>
        </div>
      }
      footerLegend={
        detectedFormatLabel ? (
          <span
            data-testid="import-preview-detected"
            className="text-caption text-fg-subtle"
          >
            {t('importPreview.footer.detected', { format: detectedFormatLabel })}
          </span>
        ) : (
          <span />
        )
      }
      trailing={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleClose}
            data-testid="import-preview-cancel"
            className="button-ghost"
          >
            {t('importPreview.action.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            data-testid="import-preview-confirm"
            className="button-primary"
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      {/* The shell renders our children into its scrollable body. We
          attach the drag-drop handlers + the drag-over ring here so a
          file dropped anywhere over the modal body still imports, and
          carry the legacy `import-preview-overlay` testid the suite
          asserts against. `bodyClassName` is intentionally left at the
          shell default; this inner wrapper owns the grid layout. */}
      <div
        data-testid="import-preview-overlay"
        className={cn(
          'grid grid-cols-1 gap-4 rounded-md p-1.5 md:grid-cols-2',
          isDragOver && 'ring-2 ring-accent/70 ring-offset-2 ring-offset-bg-panel'
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* TOP — load source (two columns: paste + pick-a-file) */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="import-preview-paste"
            className="text-eyebrow font-semibold uppercase tracking-[0.12em] text-fg-subtle"
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
            className="min-h-[88px] resize-none rounded-md border border-border-default bg-bg-inset p-2.5 font-mono text-body-sm text-fg-base outline-none focus:border-border-strong"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-eyebrow font-semibold uppercase tracking-[0.12em] text-fg-subtle">
            {t('importPreview.source.fileCta')}
          </span>
          <button
            type="button"
            onClick={handlePickFile}
            data-testid="import-preview-pick-file"
            className={cn(
              'flex min-h-[88px] flex-1 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-default bg-bg-inset px-3 text-center text-body-sm text-fg-subtle transition-colors',
              'hover:border-border-strong hover:text-fg-base',
              isDragOver && 'border-accent bg-accent/10 text-fg-base'
            )}
          >
            <FileUp size={14} aria-hidden="true" />
            <span>{t('importPreview.source.dropHintWithIpynb')}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".curl,.txt,.ipynb,.linguanb,.json,.postman_collection.json,.bru,text/plain,application/json,application/x-ipynb+json,application/x-linguanb+json"
            onChange={handleFileChange}
            className="sr-only"
            data-testid="import-preview-file-input"
          />
        </div>

        {/* MIDDLE — preview band OR reject band (full width) */}
        <section data-testid="import-preview-band" className="md:col-span-2">
          {previewed ? (
            <div className="grid gap-2">
              <ImportPreviewBody preview={previewed} />
              {importerId === 'postman-collection' &&
              previewed.kind === 'http-collection' ? (
                <PostmanVariablesSection
                  sources={state.variableSources}
                  status={state.variableStatus}
                  onSet={setVariableSource}
                />
              ) : null}
              {warnings.length > 0 ? (
                <div
                  data-testid="import-preview-warnings"
                  role="status"
                  className="grid gap-1 rounded-md border border-warning-border/60 bg-warning-bg p-3 text-caption text-warning-fg"
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
              className="grid gap-1 rounded-md border border-error-border/60 bg-error-bg p-3 text-body-sm text-error-fg"
            >
              {/* When an importer-specific detail exists (e.g. an
                  `.ipynb` `wrong-version` / `oversized` reject), the
                  detail IS the accurate message — promote it to the
                  bold header and skip the generic outer-reason copy,
                  which is written for the Slice 1 "importer not
                  wired" meaning and reads wrong for these cases. */}
              {rejectDetailKey ? (
                <div
                  data-testid="import-preview-reject-detail"
                  className="flex items-center gap-1 font-semibold"
                >
                  <AlertCircle size={12} aria-hidden="true" />
                  {t(rejectDetailKey)}
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
              className="grid place-items-center rounded-md border border-dashed border-border-subtle bg-bg-inset p-6 text-center text-body-sm text-fg-subtle"
            >
              {t('importPreview.preview.emptyHint')}
            </div>
          )}
        </section>
      </div>
    </ModalShell>
  );
}

/**
 * RL-100 Slice 4 fold B — optional environment + globals variable sources for
 * a Postman collection import. Each slot accepts a paste or a file; providing
 * one re-runs the preview with the merged variables (env > globals >
 * collection). Rendered only for `postman-collection`.
 */
function PostmanVariablesSection({
  sources,
  status,
  onSet,
}: {
  sources?: { environment?: string; globals?: string };
  status?: PostmanVariableSourceStatus;
  onSet: (slot: 'environment' | 'globals', raw: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      data-testid="import-preview-variables"
      className="grid gap-2 rounded-md border border-border-subtle bg-bg-inset p-3"
    >
      <div className="text-eyebrow font-bold uppercase tracking-wider text-fg-subtle">
        {t('importPreview.variables.title')}
      </div>
      <p className="text-caption text-fg-subtle">
        {t('importPreview.variables.hint')}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <VariableSlot
          slot="environment"
          value={sources?.environment ?? ''}
          status={status?.environment}
          onSet={onSet}
        />
        <VariableSlot
          slot="globals"
          value={sources?.globals ?? ''}
          status={status?.globals}
          onSet={onSet}
        />
      </div>
    </section>
  );
}

function VariableSlot({
  slot,
  value,
  status,
  onSet,
}: {
  slot: 'environment' | 'globals';
  value: string;
  status?: PostmanVariableSlotStatus;
  onSet: (slot: 'environment' | 'globals', raw: string) => void;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const label =
    slot === 'environment'
      ? t('importPreview.variables.environmentLabel')
      : t('importPreview.variables.globalsLabel');
  return (
    <div className="grid gap-1" data-testid={`import-preview-variables-${slot}`}>
      <span className="text-eyebrow font-semibold uppercase tracking-[0.1em] text-fg-subtle">
        {label}
      </span>
      <textarea
        data-testid={`import-preview-variables-${slot}-paste`}
        value={value}
        onChange={(event) => onSet(slot, event.target.value)}
        placeholder={t('importPreview.variables.pastePlaceholder')}
        aria-label={label}
        rows={2}
        spellCheck={false}
        className="min-h-[52px] resize-none rounded-md border border-border-default bg-bg-panel p-2 font-mono text-eyebrow text-fg-base outline-none focus:border-border-strong"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          data-testid={`import-preview-variables-${slot}-file`}
          className="button-ghost text-eyebrow"
        >
          {t('importPreview.variables.fileCta')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.postman_environment.json,.postman_globals.json,application/json"
          className="sr-only"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) {
              const text = await file.text().catch(() => null);
              if (text !== null) onSet(slot, text);
            }
            event.target.value = '';
          }}
        />
        {status ? (
          status.ok ? (
            <span
              data-testid={`import-preview-variables-${slot}-ok`}
              className="text-micro text-success-fg"
            >
              {t('importPreview.variables.applied', { count: status.count })}
            </span>
          ) : (
            <span
              data-testid={`import-preview-variables-${slot}-error`}
              className="text-micro text-error-fg"
            >
              {t(`importPreview.variables.reject.${status.reason}`)}
            </span>
          )
        ) : null}
      </div>
    </div>
  );
}
