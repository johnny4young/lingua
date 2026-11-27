/**
 * "Ask AI" trigger for the SQL editor header. Invisible
 * without the `LOCAL_AI` entitlement (same null-gate as ExplainErrorButton);
 * mounts `AskSqlDialog` while `askSqlStore` holds a question, set by this
 * button or by an empty query's starter prompt.
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { SqlHeaderButton } from './SqlHeaderButton';
import { AskSqlDialog } from './AskSqlDialog';
import type { NlToSqlTable } from '../../../shared/ai/nlToSql';
import { useEntitlement } from '../../hooks/useEntitlement';
import { useAskSqlStore } from '../../stores/askSqlStore';
import type { runChatCompletion } from '../../runtime/aiClient';

export interface AskSqlButtonProps {
  readonly tables: ReadonlyArray<NlToSqlTable>;
  readonly dialect?: string;
  readonly onInsert: (sql: string) => void;
  /** Glyph only, named by its tooltip, on a row too narrow for the label. */
  readonly iconOnly?: boolean;
  /** Test seam forwarded to the dialog. */
  readonly runChatCompletionImpl?: typeof runChatCompletion;
}

export function AskSqlButton({
  tables,
  dialect,
  onInsert,
  iconOnly = false,
  runChatCompletionImpl,
}: AskSqlButtonProps) {
  const { t } = useTranslation();
  const entitled = useEntitlement('LOCAL_AI');
  const question = useAskSqlStore(state => state.question);
  useEffect(() => () => useAskSqlStore.getState().close(), []);

  if (!entitled) return null;

  return (
    <>
      <SqlHeaderButton
        icon={Sparkles}
        label={t('ai.askSql.trigger')}
        name={t('ai.askSql.title')}
        iconOnly={iconOnly}
        onClick={() => useAskSqlStore.getState().open()}
        data-testid="ask-sql-trigger"
      />
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
