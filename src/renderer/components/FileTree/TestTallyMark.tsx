import { useTranslation } from 'react-i18next';
import type { TestTally } from './fileTreeMarks';

const DOT_TONE: Record<TestTally['tone'], string> = {
  failed: 'bg-error-fg',
  passed: 'bg-success-fg',
  pending: 'bg-fg-subtle',
};

/** `2 / 3` and a status dot; screen readers hear the sentence instead. */
export function TestTallyMark({ tally, testId }: { tally: TestTally; testId: string }) {
  const { t } = useTranslation();
  return (
    <span className="flex shrink-0 items-center gap-1.5" data-testid={testId} data-tone={tally.tone}>
      {tally.total > 0 ? (
        <>
          <span aria-hidden className="whitespace-nowrap font-mono text-caption tabular-nums text-muted">
            {tally.passed} / {tally.total}
          </span>
          <span className="sr-only">{t('explorer.testTally', { passed: tally.passed, count: tally.total })}</span>
        </>
      ) : null}
      <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${DOT_TONE[tally.tone]}`} />
    </span>
  );
}
