import { useTranslation } from 'react-i18next';
import '../../i18n/runMeterCatalog';
import type { StackRow } from '../../utils/debuggerStack';
import { cn } from '../../utils/cn';

/** Rows that fit the meter column at the default dock height; outer frames fold into one count. */
const MAX_ROWS = 3;

/**
 * The paused call stack as a staircase: the outermost frame at the left, each
 * call one step in, the paused frame last and highlighted.
 */
export function RunMeterStack({ rows, className, testid = 'debugger-callstack' }: { rows: readonly StackRow[]; className?: string; testid?: string }) {
  const { t } = useTranslation();
  const hidden = Math.max(0, rows.length - MAX_ROWS);
  const shown = rows.slice(hidden);
  return (
    <section className={cn('run-meter-stack', className)} data-testid={testid}>
      <h4 className="type-tag run-meter-stack-title">{t('runMeter.callStack', { count: rows.length })}</h4>
      <ol className="run-meter-stack-rows">
        {hidden > 0 ? (
          <li className="run-meter-stack-more" data-testid="debugger-callstack-more">
            {t('runMeter.callStackMore', { count: hidden })}
          </li>
        ) : null}
        {shown.map((row, index) => {
          const depth = hidden + index;
          const current = index === shown.length - 1;
          return (
            <li
              key={`${depth}:${row.functionName}`}
              className="run-meter-stack-row"
              style={{ '--step': Math.min(index, 4) } as React.CSSProperties}
              data-current={current || undefined}
              aria-current={current ? 'step' : undefined}
            >
              <span className="run-meter-stack-name">{row.functionName}</span>
              {row.line !== undefined ? <span className="run-meter-stack-line">:{row.line}</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
