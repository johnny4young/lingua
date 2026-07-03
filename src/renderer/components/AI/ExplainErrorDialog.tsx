/**
 * T19 / RL-031 Slice 4 — "Explain this error" consent + result dialog.
 *
 * The user-facing surface for the AI feature. It NEVER sends anything on
 * mount: it first shows the exact payload preview (from
 * `buildExplainErrorRequest`) and a "Send" control. Only an explicit click
 * calls the provider client — the embodiment of the "no silent network call"
 * principle. Gated by the `LOCAL_AI` entitlement; degrades to an upsell (no
 * entitlement) or a "configure in Settings" prompt (no endpoint/key/model).
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, X } from 'lucide-react';
import { buildExplainErrorRequest } from '../../../shared/ai/explainError';
import {
  runChatCompletion,
  type AiChatResult,
} from '../../runtime/aiClient';
import { useAiConfigStore, isAiConfigured } from '../../stores/aiConfigStore';
import { useEntitlement } from '../../hooks/useEntitlement';

export interface ExplainErrorDialogProps {
  readonly errorMessage: string;
  readonly code: string;
  readonly language: string;
  readonly filename?: string;
  readonly onClose: () => void;
  /** Test seam: inject the client so component tests never hit the network. */
  readonly runChatCompletionImpl?: typeof runChatCompletion;
}

type Phase =
  | { readonly kind: 'preview' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'done'; readonly content: string }
  | { readonly kind: 'error'; readonly message: string };

export function ExplainErrorDialog({
  errorMessage,
  code,
  language,
  filename,
  onClose,
  runChatCompletionImpl,
}: ExplainErrorDialogProps) {
  const { t } = useTranslation();
  const entitled = useEntitlement('LOCAL_AI');
  const endpoint = useAiConfigStore((s) => s.endpoint);
  const apiKey = useAiConfigStore((s) => s.apiKey);
  const model = useAiConfigStore((s) => s.model);
  const [phase, setPhase] = useState<Phase>({ kind: 'preview' });

  const request = useMemo(
    () =>
      buildExplainErrorRequest({
        errorMessage,
        code,
        language,
        ...(filename ? { filename } : {}),
        ...(model ? { model } : {}),
      }),
    [errorMessage, code, language, filename, model]
  );

  const configured = isAiConfigured({ endpoint, apiKey, model });
  const send = runChatCompletionImpl ?? runChatCompletion;

  async function handleSend(): Promise<void> {
    setPhase({ kind: 'loading' });
    const result: AiChatResult = await send(
      { messages: request.messages, model },
      { endpoint, apiKey, model }
    );
    if (result.ok) setPhase({ kind: 'done', content: result.content });
    else setPhase({ kind: 'error', message: result.message });
  }

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
            onClick={onClose}
            aria-label={t('ai.explain.close')}
            data-testid="ai-explain-close"
            className="rounded p-1 text-fg-subtle hover:text-fg"
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
                  {t('ai.explain.redactedNotice')}
                </p>
              ) : null}
              <pre
                data-testid="ai-explain-preview"
                className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded border border-border bg-bg-panel-alt p-2 text-micro text-fg"
              >
                {request.preview}
              </pre>
            </div>
          ) : phase.kind === 'loading' ? (
            <p data-testid="ai-explain-loading" className="text-fg-muted">
              {t('ai.explain.loading')}
            </p>
          ) : phase.kind === 'done' ? (
            <div
              data-testid="ai-explain-result"
              className="whitespace-pre-wrap text-fg"
            >
              {phase.content}
            </div>
          ) : (
            <p data-testid="ai-explain-error" className="text-error">
              {t('ai.explain.failed', { message: phase.message })}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          {entitled && configured && phase.kind === 'preview' ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                {t('ai.explain.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleSend()}
                data-testid="ai-explain-send"
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground"
              >
                {t('ai.explain.send')}
              </button>
            </>
          ) : entitled && configured && phase.kind === 'error' ? (
            <button
              type="button"
              onClick={() => setPhase({ kind: 'preview' })}
              data-testid="ai-explain-retry"
              className="rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
            >
              {t('ai.explain.retry')}
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
            >
              {t('ai.explain.close')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
