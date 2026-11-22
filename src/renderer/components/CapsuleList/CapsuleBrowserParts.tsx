import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine } from 'lucide-react';
import type { Language } from '../../types/language';
import { formatShortcutLabel } from '../../data/keyboardShortcuts';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFileDropZone } from '../../hooks/useFileDropZone';
import { formatNumber } from '../../i18n/formatNumber';
import { cn } from '../../utils/cn';
import { DotLeader, ResultNumeral } from '../ui/answer';
import { Kbd } from '../ui/chrome';
import { LanguageSquare } from '../Start/StartParts';
import {
  capsuleAnswer,
  capsuleRunLabel,
  formatCapsuleWhen,
  RESULT_DOT,
  RESULT_KEY,
  type CapsuleAnswer,
  type CapsuleBrowserRow,
  type CapsuleRowResult,
} from './capsuleBrowserRows';

export function CapsuleStatusDot({ result }: { result: CapsuleRowResult }) {
  return <span className={cn('size-1.5 shrink-0 rounded-full', RESULT_DOT[result])} aria-hidden="true" />;
}

/** The row's or the detail's answer as a numeral: time, rows, status line or error name. */
export function CapsuleAnswerNumeral({
  answer,
  size,
  className,
  testid,
}: {
  answer: CapsuleAnswer;
  size: 'sm' | 'lg';
  className?: string;
  testid?: string;
}) {
  const { t, i18n } = useTranslation();
  const common = { size, className, 'data-testid': testid } as const;
  switch (answer.kind) {
    case 'duration':
      return <ResultNumeral {...common} value={answer.value} unit={answer.unit ?? undefined} />;
    case 'rows':
      return (
        <ResultNumeral
          {...common}
          value={formatNumber(answer.count, i18n.language)}
          unit={t('sqlWorkspace.response.rowsUnit', { count: answer.count })}
        />
      );
    case 'http':
      return (
        <ResultNumeral
          {...common}
          value={answer.status}
          unit={answer.statusText.toLowerCase() || undefined}
          tone={answer.status >= 400 ? 'error' : 'neutral'}
        />
      );
    case 'failed':
      return (
        <ResultNumeral
          {...common}
          word
          value={answer.name ?? t(RESULT_KEY[answer.status])}
          tone={answer.status === 'stopped' ? 'neutral' : 'error'}
        />
      );
  }
}

/** Status dot, language, name over run and age, a leader, and the run's answer. */
export function CapsuleRowCells({ row, now, locked = false }: { row: CapsuleBrowserRow; now: number; locked?: boolean }) {
  const { t } = useTranslation();
  const answer = useMemo(() => capsuleAnswer(row), [row]);
  const sub = [capsuleRunLabel(row, t), formatCapsuleWhen(row, now, t)].filter(Boolean).join(' · ');
  return (
    <>
      <CapsuleStatusDot result={row.result} />
      <LanguageSquare language={row.capsule.tab.language as Language} />
      <span className="flex min-w-0 shrink flex-col">
        <span className={cn('truncate font-mono text-[12.5px] leading-[17px]', locked ? 'text-fg-subtle' : 'text-fg-base')}>{row.capsule.tab.name}</span>
        <span className="truncate text-[11px] leading-[15px] text-fg-subtle">{sub}</span>
      </span>
      <span data-testid="capsule-list-row-result" data-result={row.result} className="sr-only">
        {t(RESULT_KEY[row.result])}
      </span>
      <DotLeader className="leader-fill !mx-1 !min-w-3.5" />
      <CapsuleAnswerNumeral answer={answer} size="sm" testid="capsule-list-row-answer" className={cn('shrink-0', locked && 'text-fg-subtle')} />
    </>
  );
}

export function CapsuleDialogHeader({ titleId, trailing }: { titleId: string; trailing: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div data-testid="capsule-list-overlay" className="flex items-center gap-3">
      <h2 id={titleId} className="min-w-0 flex-1 truncate text-body-lg font-semibold tracking-[-0.01em] text-fg-base">
        {t('capsuleList.overlay.title')}
      </h2>
      {trailing}
    </div>
  );
}

function useShortcutLabel(id: 'overlay-capsule-import' | 'overlay-capsule-list'): string | null {
  const overrides = useSettingsStore((state) => state.shortcutOverrides);
  return useMemo(() => formatShortcutLabel(id, overrides), [id, overrides]);
}

export function ImportButton({ onImport }: { onImport: () => void }) {
  const { t } = useTranslation();
  const combo = useShortcutLabel('overlay-capsule-import');
  return (
    <button type="button" onClick={onImport} data-testid="capsule-list-import" className="focus-ring action-pill-run shrink-0 rounded-lg px-3">
      <ArrowDownToLine size={13} aria-hidden="true" />
      {t('capsuleList.import')}
      {combo ? (
        <span aria-hidden="true" className="hidden sm:inline-flex">
          <Kbd>{combo}</Kbd>
        </span>
      ) : null}
    </button>
  );
}

export function CapsuleListShortcut() {
  const { t } = useTranslation();
  const combo = useShortcutLabel('overlay-capsule-list');
  if (!combo) return null;
  return (
    <span data-testid="capsule-list-shortcut" className="text-body-sm text-fg-muted">
      {t('capsuleList.shortcutHint', { combo })}
    </span>
  );
}

/** Opens Import on click and hands a dropped file straight to it. */
export function CapsuleImportStrip({ onImport, onDropFile }: { onImport: () => void; onDropFile: (file: File) => void }) {
  const { t } = useTranslation();
  const { state, handlers } = useFileDropZone({ onFile: onDropFile });
  const over = state === 'over';
  return (
    <button
      type="button"
      onClick={onImport}
      {...handlers}
      data-testid="capsule-list-import-strip"
      data-drag-over={over ? 'true' : undefined}
      className={cn(
        'focus-ring m-3.5 hidden shrink-0 rounded-[10px] border border-dashed p-3.5 text-left text-body-sm leading-[17px] text-fg-muted md:block',
        over ? 'border-accent bg-accent/10' : 'border-border-default hover:border-border-strong'
      )}
    >
      <span className="mb-1 flex items-center gap-2 font-semibold text-fg-base">
        <ArrowDownToLine size={14} aria-hidden="true" />
        {t('capsuleList.import')}
      </span>
      {t('capsuleList.importStrip')}
    </button>
  );
}
