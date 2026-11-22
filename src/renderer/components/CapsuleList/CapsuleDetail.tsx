import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { utf8ByteLength, type RunCapsuleV1 } from '../../../shared/runCapsule';
import type { Language } from '../../types/language';
import { formatByteSize } from '../../i18n/formatNumber';
import { languageLabel } from '../../utils/languageMeta';
import { formatRunDuration } from '../../utils/timeLabels';
import { cn } from '../../utils/cn';
import { LeaderRow, TypeTag } from '../ui/answer';
import { CapsuleAnswerNumeral, CapsuleStatusDot } from './CapsuleBrowserParts';
import { RESULT_KEY, capsuleAnswer, capsuleRunLabel, formatCapsuleWhen, type CapsuleBrowserRow } from './capsuleBrowserRows';

const SECTION = 'px-5 pt-5';
const TAG = 'mb-2 block';
const MONO = 'font-mono text-[12.5px] text-fg-base';
/** Longer code folds to its first lines; a fold of one or two lines would only cost a click. */
const CODE_PREVIEW_LINES = 8;
const CODE_FOLD_MIN = CODE_PREVIEW_LINES + 3;

function splitLines(text: string): string[] {
  return text ? text.replace(/\n$/, '').split('\n') : [];
}

function Code({ lines, label }: { lines: readonly string[]; label: string }) {
  const { t } = useTranslation();
  const folds = lines.length >= CODE_FOLD_MIN;
  const [open, setOpen] = useState(false);
  const shown = useMemo(() => {
    const visible = folds && !open ? lines.slice(0, CODE_PREVIEW_LINES) : lines;
    return { code: visible.join('\n'), gutter: visible.map((_, index) => index + 1).join('\n'), count: visible.length };
  }, [folds, open, lines]);
  const hidden = lines.length - shown.count;
  return (
    <div className="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-base">
      <div
        data-testid="capsule-detail-code"
        role="region"
        aria-label={label}
        tabIndex={0}
        className={cn('focus-ring flex overflow-auto py-2 leading-[23px] focus-visible:ring-inset', open && 'max-h-[460px]')}
      >
        <pre aria-hidden="true" className="w-10 shrink-0 select-none pr-3.5 text-right font-mono text-[11.5px] text-fg-subtle">
          {shown.gutter}
        </pre>
        <pre className={cn(MONO, 'min-w-0 flex-1 pl-2 pr-5')}>{shown.code}</pre>
      </div>
      {folds ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          data-testid="capsule-detail-code-toggle"
          className="focus-ring flex h-7 w-full items-center gap-3 pl-[34px] text-left text-caption text-fg-muted hover:text-fg-base focus-visible:ring-inset"
        >
          <span aria-hidden="true">⋮</span>
          {open ? t('capsuleList.detail.fewerLines') : t('capsuleList.detail.moreLines', { count: hidden })}
        </button>
      ) : null}
    </div>
  );
}

function inputText(capsule: RunCapsuleV1): string {
  const { stdin, args } = capsule.input;
  return [stdin ?? '', args?.length ? args.join(' ') : ''].filter(Boolean).join('\n');
}

const createdFormats = new Map<string, [Intl.DateTimeFormat, Intl.DateTimeFormat]>();

function formatCreated(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  let formats = createdFormats.get(locale);
  if (!formats) {
    formats = [
      new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
      new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    ];
    createdFormats.set(locale, formats);
  }
  return `${formats[0].format(date)} · ${formats[1].format(date)}`;
}

// Capsules never change once built; sizing one serializes up to a few MiB.
const capsuleSizes = new WeakMap<RunCapsuleV1, number>();

function capsuleSize(capsule: RunCapsuleV1): number {
  let size = capsuleSizes.get(capsule);
  if (size === undefined) {
    size = utf8ByteLength(JSON.stringify(capsule));
    capsuleSizes.set(capsule, size);
  }
  return size;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <LeaderRow
      className="h-[30px] text-[12.5px]"
      label={<span className="text-fg-muted">{label}</span>}
      value={<span title={value} className="block max-w-[200px] truncate font-mono text-fg-base">{value}</span>}
    />
  );
}

/**
 * One capsule read as an answer: its numeral and name up top, then the actions,
 * the code, input and output, and how it ran as a leader list.
 */
export function CapsuleDetail({
  row,
  now,
  actions,
  footer,
}: {
  row: CapsuleBrowserRow;
  now: number;
  actions: ReactNode;
  footer?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { capsule } = row;
  const answer = useMemo(() => capsuleAnswer(row), [row]);
  const { errorMessage } = capsule.result;
  const derived = useMemo(() => {
    const output = [capsule.result.stdout, capsule.result.stderr].filter(Boolean).join('\n');
    return {
      input: inputText(capsule),
      output,
      outputLines: splitLines(output).length + splitLines(capsule.result.errorMessage ?? '').length,
      codeLines: splitLines(capsule.source.content),
      size: capsuleSize(capsule),
    };
  }, [capsule]);
  const { input, output, outputLines, codeLines } = derived;
  const truncated = capsule.privacy.omittedFields.some((field) => field === 'result.stdout' || field === 'result.stderr');
  const runLabel = capsuleRunLabel(row, t);
  const title = runLabel ? `${capsule.tab.name} · ${runLabel}` : capsule.tab.name;
  const status = [t(RESULT_KEY[capsule.result.status]), languageLabel(capsule.tab.language as Language), formatCapsuleWhen(row, now, t)].join(' · ');

  return (
    <div data-testid="capsule-detail" className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-[66px] shrink-0 items-center gap-4 border-b border-border-subtle bg-bg-panel py-2 pl-5 pr-4">
        <TypeTag className="hidden w-[52px] shrink-0 sm:block">{t('capsuleList.detail.eyebrow')}</TypeTag>
        <CapsuleAnswerNumeral answer={answer} size="lg" testid="capsule-detail-answer" className="shrink-0 leading-[56px]" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-mono text-[13px] font-semibold text-fg-base">{title}</span>
          <span data-testid="capsule-detail-status" className="flex min-w-0 items-center gap-1.5 text-body-sm text-fg-muted">
            <CapsuleStatusDot result={capsule.result.status} />
            <span className="truncate">{status}</span>
          </span>
        </div>
      </div>

      <div className="@container min-h-0 flex-1 overflow-auto">
        <div className="flex min-h-full flex-col">
          <div className="flex flex-wrap items-center gap-2 px-5 pt-3.5">{actions}</div>

          <section className={SECTION}>
            <TypeTag className={TAG}>
              {t('capsuleList.detail.code')} · {t('capsuleList.detail.lineCount', { count: codeLines.length })}
            </TypeTag>
            <Code key={capsule.capsuleId} lines={codeLines} label={t('capsuleList.detail.code')} />
          </section>

          <section className={SECTION}>
            <TypeTag className={TAG}>{t('capsuleList.detail.input')}</TypeTag>
            {input ? (
              <pre data-testid="capsule-detail-input" role="region" aria-label={t('capsuleList.detail.input')} tabIndex={0} className={cn(MONO, 'focus-ring max-h-[120px] overflow-auto leading-[22px]')}>
                {input}
              </pre>
            ) : (
              <p data-testid="capsule-detail-input" className="text-[12.5px] text-fg-subtle">
                {t('capsuleList.detail.none')}
              </p>
            )}
          </section>

          <section className={SECTION}>
            <TypeTag className={TAG}>
              {t('capsuleList.detail.output')}
              {outputLines > 0 ? ` · ${t('capsuleList.detail.lineCount', { count: outputLines })}` : null}
              {truncated ? (
                <span data-testid="capsule-detail-output-truncated" className="ml-2 normal-case tracking-normal text-warning-fg">
                  {t('capsuleList.detail.outputTruncated')}
                </span>
              ) : null}
            </TypeTag>
            <div data-testid="capsule-detail-output" role="region" aria-label={t('capsuleList.detail.output')} tabIndex={0} className={cn(MONO, 'focus-ring max-h-[220px] overflow-auto leading-[22px]')}>
              {output ? <pre>{output}</pre> : null}
              {errorMessage ? <pre className="text-error-fg">{errorMessage}</pre> : null}
              {!output && !errorMessage ? <span className="font-sans text-fg-subtle">{t('capsuleList.detail.none')}</span> : null}
            </div>
          </section>

          <section className={SECTION}>
            <TypeTag className={TAG}>{t('capsuleList.detail.runDetails')}</TypeTag>
            <div data-testid="capsule-detail-run-details-panel" className="grid grid-cols-1 gap-x-9 @[480px]:grid-cols-2">
              <Detail label={t('capsuleList.detail.runner')} value={capsule.environment.runner} />
              <Detail label={t('capsuleList.detail.runtime')} value={capsule.tab.runtimeMode} />
              <Detail label={t('capsuleList.detail.platform')} value={capsule.environment.platform} />
              {answer.kind === 'duration' ? null : (
                <Detail label={t('capsuleList.detail.duration')} value={formatRunDuration(capsule.result.durationMs)} />
              )}
              <Detail label={t('capsuleList.detail.appVersion')} value={capsule.appVersion} />
              <Detail label={t('capsuleList.detail.created')} value={formatCreated(capsule.createdAt, i18n.language)} />
              <Detail label={t('capsuleList.detail.hash')} value={`${capsule.source.contentHash.slice(0, 8)}…`} />
              <Detail label={t('capsuleList.detail.branch')} value={capsule.environment.git?.branch || t('capsuleList.detail.noBranch')} />
              <Detail label={t('capsuleList.detail.size')} value={formatByteSize(derived.size, i18n.language)} />
              <Detail
                label={t('capsuleList.detail.omitted')}
                value={capsule.privacy.omittedFields.length > 0 ? capsule.privacy.omittedFields.join(', ') : t('capsuleList.detail.nothingLeftOut')}
              />
            </div>
          </section>

          <div className="min-h-6 flex-1" />
          {footer}
        </div>
      </div>
    </div>
  );
}
