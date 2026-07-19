/**
 * SR-20a / RL-031 — "Explain this code" consent + result dialog.
 *
 * The main-editor sibling of `ExplainErrorDialog`: it explains a code
 * excerpt (a selection, or the whole buffer) instead of a run error. It
 * NEVER sends on mount — it first shows the exact payload preview (from
 * `buildExplainCodeRequest`) and a Send control; only an explicit click
 * calls the provider client. Gated by `LOCAL_AI`; degrades to an upsell
 * (no entitlement) or a "configure in Settings" prompt (no endpoint).
 *
 * Deliberately narrower than the error dialog: no Apply-&-re-run (you
 * explain code, you don't replace it), but the same streaming answer and
 * follow-up-turn flow, where the visible transcript IS the payload.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, X } from 'lucide-react';
import {
  buildExplainCodeRequest,
} from '../../../shared/ai/explainCode';
import type { ChatMessage } from '../../../shared/ai/explainError';
import { runChatCompletion, type AiChatResult } from '../../runtime/aiClient';
import { useAiConfigStore, isAiConfigured } from '../../stores/aiConfigStore';
import { useEntitlement } from '../../hooks/useEntitlement';
import { ExplainErrorAnswer } from './ExplainErrorAnswer';

export interface ExplainCodeDialogProps {
  readonly code: string;
  readonly language: string;
  readonly filename?: string;
  readonly onClose: () => void;
  /** Test seam: inject the client so component tests never hit the network. */
  readonly runChatCompletionImpl?: typeof runChatCompletion;
}

type Phase =
  | { readonly kind: 'preview' }
  | { readonly kind: 'streaming'; readonly partial: string }
  | { readonly kind: 'done' }
  | { readonly kind: 'error'; readonly message: string };

export function ExplainCodeDialog({
  code,
  language,
  filename,
  onClose,
  runChatCompletionImpl,
}: ExplainCodeDialogProps) {
  const { t } = useTranslation();
  const entitled = useEntitlement('LOCAL_AI');
  const endpoint = useAiConfigStore((s) => s.endpoint);
  const apiKey = useAiConfigStore((s) => s.apiKey);
  const model = useAiConfigStore((s) => s.model);
  const [phase, setPhase] = useState<Phase>({ kind: 'preview' });
  const activeControllerRef = useRef<AbortController | null>(null);
  const [transcript, setTranscript] = useState<readonly ChatMessage[]>([]);
  const [followUp, setFollowUp] = useState('');

  const request = useMemo(
    () =>
      buildExplainCodeRequest({
        code,
        language,
        ...(filename ? { filename } : {}),
        ...(model ? { model } : {}),
      }),
    [code, language, filename, model]
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
        setTranscript([...messages, { role: 'assistant', content: result.content }]);
        setPhase({ kind: 'done' });
      } else {
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

  const exchanges = transcript.slice(request.messages.length);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('ai.explainCode.title')}
      data-testid="ai-explain-code-dialog"
    >
      <div className="flex max-h-[80vh] w-full max-w-[640px] flex-col overflow-hidden rounded-lg border border-border bg-bg-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles size={16} className="text-accent" aria-hidden="true" />
            {t('ai.explainCode.title')}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('ai.explain.close')}
            data-testid="ai-explain-code-close"
            className="focus-ring rounded p-1 text-fg-subtle hover:text-fg"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3 text-sm">
          {!entitled ? (
            <p data-testid="ai-explain-code-upsell" className="text-fg-muted">
              {t('ai.explainCode.upsell')}
            </p>
          ) : !configured ? (
            <p data-testid="ai-explain-code-unconfigured" className="text-fg-muted">
              {t('ai.explainCode.unconfigured')}
            </p>
          ) : phase.kind === 'preview' ? (
            <div className="space-y-2">
              <p className="text-fg-muted">{t('ai.explain.consentIntro')}</p>
              {request.redacted ? (
                <p
                  data-testid="ai-explain-code-redacted"
                  className="text-micro text-warning"
                >
                  {t('ai.explain.redactedNotice', { count: request.redactedCount })}
                </p>
              ) : null}
              <pre
                data-testid="ai-explain-code-preview"
                className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded border border-border bg-bg-panel-alt p-2 text-micro text-fg"
              >
                {request.preview}
              </pre>
            </div>
          ) : (
            <div className="space-y-3">
              {exchanges.map((message, index) =>
                message.role === 'assistant' ? (
                  <ExplainErrorAnswer key={index} content={message.content} />
                ) : (
                  <p
                    key={index}
                    data-testid="ai-explain-code-followup-question"
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
                  <p data-testid="ai-explain-code-loading" className="text-fg-muted">
                    {t('ai.explain.loading')}
                  </p>
                )
              ) : null}
              {phase.kind === 'error' ? (
                <p data-testid="ai-explain-code-error" className="text-error">
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
                data-testid="ai-explain-code-send"
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
                data-testid="ai-explain-code-retry"
                className="focus-ring rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                {t('ai.explain.retry')}
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
                  data-testid="ai-explain-code-followup-input"
                  className="field-shell flex-1 text-sm"
                />
                <button
                  type="button"
                  onClick={handleFollowUp}
                  data-testid="ai-explain-code-followup-send"
                  className="focus-ring rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground"
                >
                  {t('ai.explain.followUpSend')}
                </button>
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
