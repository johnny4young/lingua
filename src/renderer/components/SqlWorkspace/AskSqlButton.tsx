/**
 * "Ask AI" trigger for the SQL editor header. Invisible
 * without the `LOCAL_AI` entitlement (same null-gate as ExplainErrorButton);
 * owns the open state and mounts `AskSqlDialog`.
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { AskSqlDialog } from './AskSqlDialog';
import type { NlToSqlTable } from '../../../shared/ai/nlToSql';
import { useEntitlement } from '../../hooks/useEntitlement';
import { useAskSqlStore } from '../../stores/askSqlStore';
import type { runChatCompletion } from '../../runtime/aiClient';

export interface AskSqlButtonProps {
  readonly tables: ReadonlyArray<NlToSqlTable>;
  readonly dialect?: string;
  readonly onInsert: (sql: string) => void;
  /** Test seam forwarded to the dialog. */
  readonly runChatCompletionImpl?: typeof runChatCompletion;
}

export function AskSqlButton({
  tables,
  dialect,
  onInsert,
  runChatCompletionImpl,
}: AskSqlButtonProps) {
  const { t } = useTranslation();
  const entitled = useEntitlement('LOCAL_AI');
  const question = useAskSqlStore(state => state.question);
  useEffect(() => () => useAskSqlStore.getState().close(), []);

  if (!entitled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => useAskSqlStore.getState().open()}
        data-testid="ask-sql-trigger"
        aria-label={t('ai.askSql.title')}
        title={t('ai.askSql.title')}
        className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md border border-border-default bg-bg-panel px-2.5 text-body-sm font-medium text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-panel-alt hover:text-fg-base"
      >
        <Sparkles size={11} aria-hidden="true" />
        <span>{t('ai.askSql.trigger')}</span>
      </button>
      {question !== null ? (
        <AskSqlDialog
          initialQuestion={question}
          tables={tables}
          {...(dialect ? { dialect } : {})}
          onInsert={onInsert}
          {...(runChatCompletionImpl ? { runChatCompletionImpl } : {})}
          onClose={() => useAskSqlStore.getState().close()}
        />
      ) : null}
    </>
  );
}
