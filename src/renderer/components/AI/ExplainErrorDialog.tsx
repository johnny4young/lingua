/**
 * "Explain this error" consent + result dialog.
 *
 * The user-facing surface for the AI feature. It NEVER sends anything on
 * mount: it first shows the exact payload preview (from
 * `buildExplainErrorRequest`) and a "Send" control. Only an explicit click
 * calls the provider client — the embodiment of the "no silent network call"
 * principle. Gated by the `LOCAL_AI` entitlement; degrades to an upsell (no
 * entitlement) or a "configure in Settings" prompt (no endpoint/key/model).
 *
 * UX pack additions:
 *   - **Streaming**: the answer renders progressively as SSE deltas arrive,
 *     so a slow local model shows words in ~1s instead of a 30s spinner.
 *   - **Follow-up turns**: after an answer the user can ask a follow-up in
 *     the same conversation. Each follow-up is its own explicit send; the
 *     payload is the visible transcript plus the typed question — the
 *     transcript IS the preview, keeping the consent contract honest.
 *   - **Apply & re-run**: when the host surface can replace its code
 *     (notebook cell, editor tab, SQL query), the first code block of the
 *     last answer can be applied — behind a full line-diff preview, because
 *     applying model output is a destructive edit and the diff IS the
 *     consent surface. Confirming applies and re-runs, closing the loop:
 *     red → explain → apply → re-run.
 */

import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { OverlayBackdrop } from '../ui/chrome';
import { Sparkles, X } from 'lucide-react';
import { answerLanguageFor, buildExplainErrorRequest } from '../../../shared/ai/explainError';
import type { runChatCompletion } from '../../runtime/aiClient';
import { useAiConfigStore, isAiConfigured } from '../../stores/aiConfigStore';
import { useEntitlement } from '../../hooks/useEntitlement';
import { diffLines } from '../../utils/diff';
import { ApplyDiff, ExplainExchanges } from './ExplainConversationParts';
import { useExplainConversation } from './useExplainConversation';

export interface ExplainErrorDialogProps {
  readonly errorMessage: string;
  readonly code: string;
  readonly language: string;
  readonly filename?: string;
  /** Runtime description from `runtimeNoteFor`; shown in the consent preview. */
  readonly runtimeNote?: string;
  /**
   * Apply-&-re-run seam: when provided, the first code block of the last
   * answer gets an Apply action. The host replaces its code with the
   * argument and re-runs. The dialog closes itself after invoking this.
   */
  readonly onApplyFix?: (code: string) => void;
  readonly onClose: () => void;
  /** Test seam: inject the client so component tests never hit the network. */
  readonly runChatCompletionImpl?: typeof runChatCompletion;
}

export function ExplainErrorDialog({
  errorMessage,
  code,
  language,
  filename,
  runtimeNote,
  onApplyFix,
  onClose,
  runChatCompletionImpl,
}: ExplainErrorDialogProps) {
  const { t, i18n } = useTranslation();
  const answerLanguage = answerLanguageFor(i18n.resolvedLanguage);
  const entitled = useEntitlement('LOCAL_AI');
  const endpoint = useAiConfigStore((s) => s.endpoint);
  const apiKey = useAiConfigStore((s) => s.apiKey);
  const model = useAiConfigStore((s) => s.model);
  const [followUp, setFollowUp] = useState('');

  const request = useMemo(
    () =>
      buildExplainErrorRequest({
        errorMessage,
        code,
        language,
        ...(filename ? { filename } : {}),
        ...(runtimeNote ? { runtimeNote } : {}),
        ...(answerLanguage ? { answerLanguage } : {}),
        ...(model ? { model } : {}),
      }),
    [errorMessage, code, language, filename, runtimeNote, model, answerLanguage]
  );
  const conversation = useExplainConversation({ request, ...(runChatCompletionImpl ? { runChatCompletionImpl } : {}) });
  const { phase, setPhase, exchanges, suggestedCode } = conversation;
  const configured = isAiConfigured({ endpoint, apiKey, model });

  function handleClose(): void {
    conversation.abort('dialog-closed');
    onClose();
  }

  function handleFollowUp(): void {
    conversation.ask(followUp);
    if (followUp.trim()) setFollowUp('');
  }

  const applyDiff = useMemo(() => (phase.kind === 'confirm-apply' ? diffLines(code, phase.suggested) : []), [phase, code]);

  // The backdrop moves, traps and restores focus; Escape stops here so an
  // overlay or workspace underneath keeps its own state.
  const handleEscape = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    handleClose();
  };

  return (
    <OverlayBackdrop portal onKeyDown={handleEscape}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('ai.explain.title')}
        data-testid="ai-explain-dialog"
        className="flex max-h-[80vh] w-full max-w-[640px] flex-col overflow-hidden rounded-lg border border-border bg-bg-panel shadow-e3"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles size={16} className="text-accent" aria-hidden="true" />
            {t('ai.explain.title')}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('ai.explain.close')}
            data-testid="ai-explain-close"
            className="focus-ring rounded p-1 text-fg-subtle hover:text-fg"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3 text-sm">
          {!entitled ? (
            <p data-testid="ai-explain-upsell" className="text-fg-muted">
              {t('ai.explain.upsell')}
            </p>
          ) : !configured ? (
            <p data-testid="ai-explain-unconfigured" className="text-fg-muted">
              {t('ai.explain.unconfigured')}
            </p>
          ) : phase.kind === 'preview' ? (
            <div className="space-y-2">
              <p className="text-fg-muted">{t('ai.explain.consentIntro')}</p>
              {request.redacted ? (
                <p
                  data-testid="ai-explain-redacted"
                  className="text-micro text-warning"
                >
                  {t('ai.explain.redactedNotice', { count: request.redactedCount })}
                </p>
              ) : null}
              <pre
                data-testid="ai-explain-preview"
                className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded border border-border bg-bg-panel-alt p-2 text-micro text-fg"
              >
                {request.preview}
              </pre>
            </div>
          ) : phase.kind === 'confirm-apply' ? (
            <div className="space-y-2">
              <p className="text-fg-muted">{t('ai.explain.applyIntro')}</p>
              <ApplyDiff segments={applyDiff} />
            </div>
          ) : (
            <ExplainExchanges exchanges={exchanges} phase={phase} />
          )}
        </div>

        <div className="border-t border-border px-4 py-3">
          {entitled && configured && phase.kind === 'preview' ? (
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="focus-ring rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                {t('ai.explain.cancel')}
              </button>
              <button
                type="button"
                onClick={conversation.start}
                data-testid="ai-explain-send"
                className="focus-ring rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground"
              >
                {t('ai.explain.send')}
              </button>
            </div>
          ) : entitled && configured && phase.kind === 'error' ? (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={conversation.retry}
                data-testid="ai-explain-retry"
                className="focus-ring rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                {t('ai.explain.retry')}
              </button>
            </div>
          ) : entitled && configured && phase.kind === 'confirm-apply' ? (
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPhase({ kind: 'done' })}
                data-testid="ai-explain-apply-back"
                className="focus-ring rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                {t('ai.explain.applyBack')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onApplyFix?.(phase.suggested);
                  handleClose();
                }}
                data-testid="ai-explain-apply-confirm"
                className="focus-ring rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground"
              >
                {t('ai.explain.applyConfirm')}
              </button>
            </div>
          ) : entitled && configured && phase.kind === 'done' ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFollowUp();
                  }}
                  placeholder={t('ai.explain.followUpPlaceholder')}
                  data-testid="ai-explain-followup-input"
                  className="field-shell flex-1 text-sm"
                />
                <button
                  type="button"
                  onClick={handleFollowUp}
                  data-testid="ai-explain-followup-send"
                  className="focus-ring rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground"
                >
                  {t('ai.explain.followUpSend')}
                </button>
                {onApplyFix && suggestedCode ? (
                  <button
                    type="button"
                    onClick={() =>
                      setPhase({ kind: 'confirm-apply', suggested: suggestedCode, rerun: true })
                    }
                    data-testid="ai-explain-apply"
                    className="focus-ring shrink-0 rounded border border-accent px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/10"
                  >
                    {t('ai.explain.apply')}
                  </button>
                ) : null}
              </div>
              <p className="text-micro text-fg-subtle">
                {t('ai.explain.followUpHint')}
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="focus-ring rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                {t('ai.explain.close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </OverlayBackdrop>
  );
}
