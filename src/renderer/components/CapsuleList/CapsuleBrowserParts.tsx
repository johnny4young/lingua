import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive } from 'lucide-react';
import type { Language } from '../../types/language';
import { languageBadgeTone } from '../../utils/languageMeta';
import { cn } from '../../utils/cn';
import { formatCapsuleWhen, type CapsuleBrowserRow, type CapsuleRowResult } from './capsuleBrowserRows';

function CapsuleLanguageBadge({ language }: { language: string }) {
  const tone = languageBadgeTone(language as Language);
  return (
    <span
      className="inline-flex h-[15px] min-w-[22px] shrink-0 items-center justify-center rounded-sm px-1 font-mono text-[9px] font-bold leading-none tracking-[0.04em]"
      style={{ background: tone.background, color: tone.foreground }}
    >
      {tone.code}
    </span>
  );
}

const RESULT_TONE: Record<CapsuleRowResult, { text: string; dot: string }> = {
  success: { text: 'text-success-fg', dot: 'bg-success-fg' },
  error: { text: 'text-error-fg', dot: 'bg-error-fg' },
  timeout: { text: 'text-warning-fg', dot: 'bg-warning-fg' },
  stopped: { text: 'text-error-fg', dot: 'bg-error-fg' },
  'not-run': { text: 'text-fg-muted', dot: 'bg-border-strong' },
};

const RESULT_KEY: Record<CapsuleRowResult, string> = {
  success: 'capsuleList.result.success',
  error: 'capsuleList.result.error',
  timeout: 'capsuleList.result.timeout',
  stopped: 'capsuleList.result.stopped',
  'not-run': 'capsuleList.result.notRun',
};

function CapsuleResult({ result }: { result: CapsuleRowResult }) {
  const { t } = useTranslation();
  const tone = RESULT_TONE[result];
  return (
    <span data-testid="capsule-list-row-result" data-result={result} className={cn('inline-flex items-center gap-1.5 text-caption font-medium', tone.text)}>
      <span className={cn('size-[7px] shrink-0 rounded-full', tone.dot)} aria-hidden="true" />
      {t(RESULT_KEY[result])}
    </span>
  );
}

/** Language, name, when and result: the four columns every capsule row shows. */
export function CapsuleRowCells({ row, now }: { row: CapsuleBrowserRow; now: number }) {
  const { t } = useTranslation();
  return (
    <>
      <CapsuleLanguageBadge language={row.capsule.tab.language} />
      <span className="min-w-0 truncate font-mono text-body-sm text-fg-base">{row.capsule.tab.name}</span>
      <span className="truncate text-caption text-fg-muted">{formatCapsuleWhen(row, now, t)}</span>
      <CapsuleResult result={row.result} />
    </>
  );
}

export function CapsuleDialogHeader({ titleId, trailing }: { titleId: string; trailing: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div data-testid="capsule-list-overlay" className="flex items-center gap-3">
      <span className="grid size-[34px] shrink-0 place-items-center rounded-[9px] bg-accent/10 text-accent-fg" aria-hidden="true">
        <Archive size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="text-body-lg font-semibold tracking-[-0.01em] text-fg-base">
          {t('capsuleList.overlay.title')}
        </h2>
        <p className="mt-0.5 text-body-sm text-fg-muted">{t('capsuleList.definition')}</p>
      </div>
      {trailing}
    </div>
  );
}
