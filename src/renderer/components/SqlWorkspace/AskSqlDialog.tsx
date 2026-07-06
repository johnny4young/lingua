/**
 * T19 follow-on — "Ask AI" for the SQL workspace: natural language → SQL
 * over the LIVE DuckDB schema.
 *
 * Consent model (same contract as ExplainErrorDialog): the payload preview
 * renders LIVE under the question as the user types — schema + question is
 * the whole payload, no rows ever — and nothing is sent until the explicit
 * Send click. The answer streams in; its first ```sql block can be inserted
 * into the active query editor, where the user still reviews and runs it
 * themselves (generated SQL never auto-runs).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, X } from 'lucide-react';
import {
  buildNlToSqlRequest,
  formatSchemaForPrompt,
  type NlToSqlTable,
} from '../../../shared/ai/nlToSql';
import type { ChatMessage } from '../../../shared/ai/explainError';
import {
  runChatCompletion,
  type AiChatResult,
} from '../../runtime/aiClient';
import { useAiConfigStore, isAiConfigured } from '../../stores/aiConfigStore';
import { useEntitlement } from '../../hooks/useEntitlement';
import { ExplainErrorAnswer } from '../AI/ExplainErrorAnswer';
import { firstCodeBlock } from '../AI/answerCode';

export interface AskSqlDialogProps {
  readonly tables: ReadonlyArray<NlToSqlTable>;
  /** Insert the generated SQL into the active query editor. */
  readonly onInsert: (sql: string) => void;
  readonly onClose: () => void;
  /** Test seam: inject the client so component tests never hit the network. */
  readonly runChatCompletionImpl?: typeof runChatCompletion;
}

type Phase =
  | { readonly kind: 'ask' }
  | { readonly kind: 'streaming'; readonly partial: string }
  | { readonly kind: 'done'; readonly content: string }
  | { readonly kind: 'error'; readonly message: string };

export function AskSqlDialog({
  tables,
  onInsert,
  onClose,
  runChatCompletionImpl,
}: AskSqlDialogProps) {
  const { t } = useTranslation();
  const entitled = useEntitlement('LOCAL_AI');
  const endpoint = useAiConfigStore((s) => s.endpoint);
  const apiKey = useAiConfigStore((s) => s.apiKey);
  const model = useAiConfigStore((s) => s.model);
  const [phase, setPhase] = useState<Phase>({ kind: 'ask' });
  const activeControllerRef = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState('');

  const schemaText = useMemo(() => formatSchemaForPrompt(tables), [tables]);
  const request = useMemo(
    () =>
      buildNlToSqlRequest({
        question,
        schemaText,
        ...(model ? { model } : {}),
      }),
    [question, schemaText, model]
  );

  const configured = isAiConfigured({ endpoint, apiKey, model });
  const send = runChatCompletionImpl ?? runChatCompletion;
  const canSend = question.trim().length > 0;

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

  async function handleSend(): Promise<void> {
    abortActiveRequest('superseded');
    const controller = new AbortController();
    activeControllerRef.current = controller;
    setPhase({ kind: 'streaming', partial: '' });
    const messages: readonly ChatMessage[] = request.messages;
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
      if (result.ok) setPhase({ kind: 'done', content: result.content });
      else setPhase({ kind: 'error', message: result.message });
    } finally {
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
      }
    }
  }

  const generatedSql =
    phase.kind === 'done' ? firstCodeBlock(phase.content) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('ai.askSql.title')}
      data-testid="ask-sql-dialog"
    >
      <div className="flex max-h-[80vh] w-full max-w-[640px] flex-col overflow-hidden rounded-lg border border-border bg-bg-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles size={16} className="text-accent" aria-hidden="true" />
            {t('ai.askSql.title')}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('ai.explain.close')}
            data-testid="ask-sql-close"
            className="focus-ring rounded p-1 text-fg-subtle hover:text-fg"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3 text-sm">
          {!entitled ? (
            <p data-testid="ask-sql-upsell" className="text-fg-muted">
              {t('ai.explain.upsell')}
            </p>
          ) : !configured ? (
            <p data-testid="ask-sql-unconfigured" className="text-fg-muted">
              {t('ai.explain.unconfigured')}
            </p>
          ) : phase.kind === 'ask' ? (
            <div className="space-y-2">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={t('ai.askSql.placeholder')}
                rows={3}
                data-testid="ask-sql-question"
                className="field-shell w-full resize-y text-sm"
              />
              <p className="text-micro text-fg-subtle">
                {t('ai.askSql.schemaOnlyNote')}
              </p>
              <pre
                data-testid="ask-sql-preview"
                className="max-h-[35vh] overflow-auto whitespace-pre-wrap rounded border border-border bg-bg-panel-alt p-2 text-micro text-fg"
              >
                {request.preview}
              </pre>
            </div>
          ) : phase.kind === 'streaming' ? (
            phase.partial.length > 0 ? (
              <ExplainErrorAnswer content={phase.partial} />
            ) : (
              <p data-testid="ask-sql-loading" className="text-fg-muted">
                {t('ai.explain.loading')}
              </p>
            )
          ) : phase.kind === 'done' ? (
            <ExplainErrorAnswer content={phase.content} />
          ) : (
            <p data-testid="ask-sql-error" className="text-error">
              {t('ai.explain.failed', { message: phase.message })}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          {entitled && configured && phase.kind === 'ask' ? (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="focus-ring rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                {t('ai.explain.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!canSend}
                data-testid="ask-sql-send"
                className="focus-ring rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
              >
                {t('ai.explain.send')}
              </button>
            </>
          ) : entitled && configured && phase.kind === 'done' ? (
            <>
              <button
                type="button"
                onClick={() => setPhase({ kind: 'ask' })}
                data-testid="ask-sql-again"
                className="focus-ring rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                {t('ai.askSql.askAgain')}
              </button>
              {generatedSql ? (
                <button
                  type="button"
                  onClick={() => {
                    onInsert(generatedSql);
                    handleClose();
                  }}
                  data-testid="ask-sql-insert"
                  className="focus-ring rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground"
                >
                  {t('ai.askSql.insert')}
                </button>
              ) : null}
            </>
          ) : entitled && configured && phase.kind === 'error' ? (
            <button
              type="button"
              onClick={() => setPhase({ kind: 'ask' })}
              data-testid="ask-sql-retry"
              className="focus-ring rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
            >
              {t('ai.explain.retry')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleClose}
              className="focus-ring rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
            >
              {t('ai.explain.close')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
