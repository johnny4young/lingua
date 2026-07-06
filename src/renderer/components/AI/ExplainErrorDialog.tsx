/**
 * T19 / RL-031 Slice 4 — "Explain this error" consent + result dialog.
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, X } from 'lucide-react';
import {
  buildExplainErrorRequest,
  type ChatMessage,
} from '../../../shared/ai/explainError';
import {
  runChatCompletion,
  type AiChatResult,
} from '../../runtime/aiClient';
import { useAiConfigStore, isAiConfigured } from '../../stores/aiConfigStore';
import { useEntitlement } from '../../hooks/useEntitlement';
import { ExplainErrorAnswer } from './ExplainErrorAnswer';
import { firstCodeBlock } from './answerCode';
import { diffLines, type DiffSegment } from '../../utils/diff';

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

type Phase =
  | { readonly kind: 'preview' }
  | { readonly kind: 'streaming'; readonly partial: string }
  | { readonly kind: 'done' }
  | { readonly kind: 'confirm-apply'; readonly suggested: string }
  | { readonly kind: 'error'; readonly message: string };

/** One diff row in the apply confirmation, styled per ExecutionComparisonModal. */
function ApplyDiffLine({ segment }: { readonly segment: DiffSegment }) {
  const isAdd = segment.kind === 'add';
  const isRemove = segment.kind === 'remove';
  const tone = isAdd
    ? 'bg-success/10 text-success'
    : isRemove
      ? 'bg-error/10 text-error'
      : 'text-fg-muted';
  const sigil = isAdd ? '+' : isRemove ? '−' : ' ';
  return (
    <div
      className={`flex gap-2 whitespace-pre-wrap px-2 py-0.5 font-mono text-micro leading-5 ${tone}`}
      data-testid={`ai-explain-apply-diff-${segment.kind}`}
    >
      <span aria-hidden="true" className="select-none opacity-60">
        {sigil}
      </span>
      <span>{segment.text}</span>
    </div>
  );
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
  const { t } = useTranslation();
  const entitled = useEntitlement('LOCAL_AI');
  const endpoint = useAiConfigStore((s) => s.endpoint);
  const apiKey = useAiConfigStore((s) => s.apiKey);
  const model = useAiConfigStore((s) => s.model);
  const [phase, setPhase] = useState<Phase>({ kind: 'preview' });
  const activeControllerRef = useRef<AbortController | null>(null);
  // The conversation so far: the approved initial payload + every completed
  // exchange. Follow-up sends re-transmit this whole array (chat models are
  // stateless), which is why the transcript view doubles as the payload
  // preview for follow-up turns.
  const [transcript, setTranscript] = useState<readonly ChatMessage[]>([]);
  const [followUp, setFollowUp] = useState('');

  const request = useMemo(
    () =>
      buildExplainErrorRequest({
        errorMessage,
        code,
        language,
        ...(filename ? { filename } : {}),
        ...(runtimeNote ? { runtimeNote } : {}),
        ...(model ? { model } : {}),
      }),
    [errorMessage, code, language, filename, runtimeNote, model]
  );

  const configured = isAiConfigured({ endpoint, apiKey, model });
  const send = runChatCompletionImpl ?? runChatCompletion;

  useEffect(
    () => () => {
      activeControllerRef.current?.abort('dialog-unmounted');
      activeControllerRef.current = null;
    },
    []
  );

  function abortActiveRequest(reason: string): void {
    activeControllerRef.current?.abort(reason);
    activeControllerRef.current = null;
  }

  function handleClose(): void {
    abortActiveRequest('dialog-closed');
    onClose();
  }

  async function handleSend(messages: readonly ChatMessage[]): Promise<void> {
    abortActiveRequest('superseded');
    const controller = new AbortController();
    activeControllerRef.current = controller;
    setPhase({ kind: 'streaming', partial: '' });
    try {
      const result: AiChatResult = await send(
        { messages, model },
        { endpoint, apiKey, model },
        {
          signal: controller.signal,
          onChunk: (textSoFar) => {
            if (!controller.signal.aborted) {
              setPhase({ kind: 'streaming', partial: textSoFar });
            }
          },
        }
      );
      if (controller.signal.aborted) return;
      if (result.ok) {
        setTranscript([
          ...messages,
          { role: 'assistant', content: result.content },
        ]);
        setPhase({ kind: 'done' });
      } else {
        // Keep the attempted messages so a mid-conversation retry can resend.
        setTranscript(messages);
        setPhase({ kind: 'error', message: result.message });
      }
    } finally {
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
      }
    }
  }

  function handleRetry(): void {
    // First-attempt failure returns to the consent preview (re-approve);
    // a failed FOLLOW-UP retries the conversation directly — the payload was
    // already approved turn by turn and is fully visible above.
    if (transcript.length <= request.messages.length) {
      setPhase({ kind: 'preview' });
    } else {
      void handleSend(transcript);
    }
  }

  function handleFollowUp(): void {
    const question = followUp.trim();
    if (question.length === 0) return;
    setFollowUp('');
    void handleSend([...transcript, { role: 'user', content: question }]);
  }

  // Everything after the initial [system, user] payload is a visible
  // exchange: assistant answers + the user's follow-up questions.
  const exchanges = transcript.slice(request.messages.length);

  // Apply-&-re-run: offered only when the host wired the seam AND the last
  // answer actually proposes code. `code` (the current source) diffs against
  // it in the confirmation step.
  const lastAssistant = [...transcript]
    .reverse()
    .find((m) => m.role === 'assistant');
  const suggestedCode = lastAssistant ? firstCodeBlock(lastAssistant.content) : null;
  const applyDiff = useMemo(
    () =>
      phase.kind === 'confirm-apply' ? diffLines(code, phase.suggested) : [],
    [phase, code]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('ai.explain.title')}
      data-testid="ai-explain-dialog"
    >
      <div className="flex max-h-[80vh] w-full max-w-[640px] flex-col overflow-hidden rounded-lg border border-border bg-bg-panel shadow-xl">
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
              <div
                data-testid="ai-explain-apply-diff"
                className="max-h-[45vh] overflow-auto rounded border border-border bg-bg-panel-alt py-1"
              >
                {applyDiff.map((segment, index) => (
                  <ApplyDiffLine key={index} segment={segment} />
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {exchanges.map((message, index) =>
                message.role === 'assistant' ? (
                  <ExplainErrorAnswer key={index} content={message.content} />
                ) : (
                  <p
                    key={index}
                    data-testid="ai-explain-followup-question"
                    className="rounded border-l-2 border-accent bg-bg-panel-alt px-3 py-2 text-fg-muted"
                  >
                    {message.content}
                  </p>
                )
              )}
              {phase.kind === 'streaming' ? (
                phase.partial.length > 0 ? (
                  <ExplainErrorAnswer content={phase.partial} />
                ) : (
                  <p data-testid="ai-explain-loading" className="text-fg-muted">
                    {t('ai.explain.loading')}
                  </p>
                )
              ) : null}
              {phase.kind === 'error' ? (
                <p data-testid="ai-explain-error" className="text-error">
                  {t('ai.explain.failed', { message: phase.message })}
                </p>
              ) : null}
            </div>
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
                onClick={() => void handleSend(request.messages)}
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
                onClick={handleRetry}
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
                      setPhase({ kind: 'confirm-apply', suggested: suggestedCode })
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
    </div>
  );
}
