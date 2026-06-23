import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { OverlayBackdrop, OverlayCard } from '../ui/chrome';

/**
 * RL-036 Phase A1 fold A — pre-share confirmation modal.
 *
 * Shown before the share-link URL lands on the clipboard so the user
 * can preview the exact source + stdin content being serialised. Required by
 * `docs/CAPSULE_TEST_MATRIX.md § FIXTURE_LICENSE_LEAK_PROBE`: source
 * is the replay artifact so the sanitizer never strips it; the modal
 * is the explicit consent surface that mitigates accidental token
 * leakage.
 *
 * Gated by `settings.shareLinkConfirmEnabled` (fold F). When the
 * setting is OFF the caller skips the modal entirely and writes to
 * the clipboard directly.
 *
 * Telemetry: the caller fires `share.created { status: 'cancelled' }`
 * via `onCancel` and `share.created { status: 'success' }` via
 * `onConfirm` after the clipboard write resolves.
 */
export interface ShareConfirmationModalProps {
  readonly previewContent: string;
  readonly stdinPreview?: string;
  readonly language: string;
  readonly sizeBytes: number;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

const PREVIEW_CHAR_CAP = 4000;

export function ShareConfirmationModal({
  previewContent,
  stdinPreview,
  language,
  sizeBytes,
  onConfirm,
  onCancel,
}: ShareConfirmationModalProps) {
  const { t } = useTranslation();

  // Autofocus the cancel button (safer default). Native <button>s fire on
  // Enter when focused, so the Confirm key path needs no manual handler.
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const sourcePreview = truncatePreview(previewContent);
  const stdinPreviewBlock =
    stdinPreview && stdinPreview.length > 0
      ? truncatePreview(stdinPreview)
      : null;

  const modal = (
    <OverlayBackdrop
      onClose={onCancel}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onCancel();
      }}
    >
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-confirm-modal-title"
        aria-describedby="share-confirm-modal-warning"
        className="w-[min(92vw,640px)] max-w-none"
        data-testid="share-confirm-modal"
      >
        <div className="surface-header px-5 py-4">
          <h2
            id="share-confirm-modal-title"
            className="font-display text-h2 font-semibold text-foreground"
          >
            {t('share.confirm.title')}
          </h2>
        </div>
        <div className="space-y-3 px-5 py-5 text-body leading-6 text-fg-muted">
          <p id="share-confirm-modal-warning" role="alert">
            {t('share.confirm.warning')}
          </p>
          <dl className="grid grid-cols-2 gap-y-1 text-body-sm font-mono text-fg-subtle">
            <dt>{t('share.confirm.metaLanguage')}</dt>
            <dd
              className="text-fg-base"
              data-testid="share-confirm-language"
            >
              {language}
            </dd>
            <dt>{t('share.confirm.metaSize')}</dt>
            <dd
              className="text-fg-base"
              data-testid="share-confirm-size"
            >
              {t('share.confirm.metaSizeValue', { bytes: sizeBytes })}
            </dd>
          </dl>
          <div>
            <p className="mb-1 text-body-sm uppercase text-fg-subtle">
              {t('share.confirm.previewLabel')}
            </p>
            <pre
              data-testid="share-confirm-preview"
              className="max-h-[40vh] overflow-auto rounded-md border border-border/80 bg-bg-elevated/80 p-3 text-caption leading-snug text-fg-base whitespace-pre-wrap break-words"
            >
              {sourcePreview.text}
            </pre>
            {sourcePreview.truncated ? (
              <p
                className="mt-1 text-body-sm text-fg-subtle"
                data-testid="share-confirm-preview-truncated"
              >
                {t('share.confirm.previewTruncated', {
                  chars: sourcePreview.truncatedChars,
                })}
              </p>
            ) : null}
          </div>
          {stdinPreviewBlock ? (
            <div>
              <p className="mb-1 text-body-sm uppercase text-fg-subtle">
                {t('share.confirm.stdinPreviewLabel')}
              </p>
              <pre
                data-testid="share-confirm-stdin-preview"
                className="max-h-[24vh] overflow-auto rounded-md border border-border/80 bg-bg-elevated/80 p-3 text-caption leading-snug text-fg-base whitespace-pre-wrap break-words"
              >
                {stdinPreviewBlock.text}
              </pre>
              {stdinPreviewBlock.truncated ? (
                <p
                  className="mt-1 text-body-sm text-fg-subtle"
                  data-testid="share-confirm-stdin-preview-truncated"
                >
                  {t('share.confirm.previewTruncated', {
                    chars: stdinPreviewBlock.truncatedChars,
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/80 px-5 py-4">
          <button
            ref={cancelRef}
            type="button"
            className="button-secondary"
            onClick={onCancel}
            data-testid="share-confirm-cancel"
          >
            {t('share.confirm.cancel')}
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={onConfirm}
            data-testid="share-confirm-confirm"
          >
            {t('share.confirm.confirm')}
          </button>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );

  if (typeof document === 'undefined') {
    return modal;
  }

  return createPortal(modal, document.body);
}

function truncatePreview(value: string): {
  readonly text: string;
  readonly truncated: boolean;
  readonly truncatedChars: number;
} {
  const truncated = value.length > PREVIEW_CHAR_CAP;
  return {
    text: truncated ? value.slice(0, PREVIEW_CHAR_CAP) : value,
    truncated,
    truncatedChars: truncated ? value.length - PREVIEW_CHAR_CAP : 0,
  };
}
