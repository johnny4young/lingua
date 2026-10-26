import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../../shared/ai/explainError';
import type { DiffSegment } from '../../utils/diff';
import { ExplainErrorAnswer } from './ExplainErrorAnswer';
import type { ExplainPhase } from './useExplainConversation';

/** The line diff an apply shows before it changes the code. */
export function ApplyDiff({ segments }: { readonly segments: readonly DiffSegment[] }) {
  return (
    <div data-testid="ai-explain-apply-diff" className="max-h-[45vh] overflow-auto rounded border border-border bg-bg-panel-alt py-1">
      {segments.map((segment, index) => {
        const tone = segment.kind === 'add' ? 'bg-success/10 text-success' : segment.kind === 'remove' ? 'bg-error/10 text-error' : 'text-fg-muted';
        const sigil = segment.kind === 'add' ? '+' : segment.kind === 'remove' ? '−' : ' ';
        return (
          <div
            key={index}
            className={`flex gap-2 whitespace-pre-wrap px-2 py-0.5 font-mono text-micro leading-5 ${tone}`}
            data-testid={`ai-explain-apply-diff-${segment.kind}`}
          >
            <span aria-hidden="true" className="select-none opacity-60">
              {sigil}
            </span>
            <span>{segment.text}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Answers and follow-up questions so far, then the streaming answer or the failure. */
export function ExplainExchanges({ exchanges, phase }: { readonly exchanges: readonly ChatMessage[]; readonly phase: ExplainPhase }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      {exchanges.map((message, index) =>
        message.role === 'assistant' ? (
          <ExplainErrorAnswer key={index} content={message.content} />
        ) : (
          <p
            key={index}
            data-testid="ai-explain-followup-question"
            className="ml-8 rounded-lg border border-border-subtle bg-bg-inset px-3 py-2 text-fg-muted"
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
          {phase.message}
        </p>
      ) : null}
    </div>
  );
}
