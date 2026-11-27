import { useTranslation } from 'react-i18next';

/** The live row: the line the run is blocked on (`live`), or the line it is expected to print from next. */
export function ConsoleWaitingRow({ line, snippet, live = false }: { line: number | null; snippet: string | null; live?: boolean }) {
  const { t } = useTranslation();
  const label =
    snippet !== null
      ? t('console.tape.waitingOn', { code: snippet })
      : line !== null
        ? t('console.tape.waitingOnLine', { line })
        : t('console.tape.waitingForOutput');
  return (
    <div
      className="flex h-[22px] items-center pr-4 text-accent-fg"
      data-testid="console-waiting-row"
      data-line={line ?? undefined}
      data-live={live || undefined}
    >
      <span className="w-[46px] shrink-0 select-none pr-3 text-right text-[11px] tabular-nums">
        {line ?? ''}
      </span>
      <span
        aria-hidden
        className="console-waiting-bar h-[9px] w-[92px] shrink-0 rounded-[2px]"
      />
      <span className="ml-auto min-w-0 truncate pl-4 text-[11px]">{label}</span>
    </div>
  );
}
