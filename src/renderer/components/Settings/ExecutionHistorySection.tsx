import { useTranslation } from 'react-i18next';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { Row, Section } from './shared';

/**
 * RL-028 second slice — Settings row that surfaces the in-memory
 * execution history counter and a Clear button.
 *
 * The store itself is intentionally never persisted across reloads
 * (privacy posture documented in executionHistoryStore.ts). This row
 * lets the user wipe the buffer manually without reloading. A richer
 * "Recent runs" table comes in a follow-up slice; keeping this minimal
 * avoids committing to a specific UX before the surface has shipped.
 */
export function ExecutionHistorySection() {
  const { t } = useTranslation();
  const entryCount = useExecutionHistoryStore((state) => state.entries.length);
  const clear = useExecutionHistoryStore((state) => state.clear);

  return (
    <Section
      id="execution-history"
      title={t('executionHistory.title')}
      description={t('executionHistory.description')}
    >
      <Row
        label={t('executionHistory.countLabel', { count: entryCount })}
        hint={t('executionHistory.privacyNote')}
      >
        <button
          type="button"
          className="button-secondary"
          onClick={() => clear()}
          disabled={entryCount === 0}
          data-testid="execution-history-clear"
          aria-label={t('executionHistory.clearButton')}
        >
          {t('executionHistory.clearButton')}
        </button>
      </Row>
    </Section>
  );
}
