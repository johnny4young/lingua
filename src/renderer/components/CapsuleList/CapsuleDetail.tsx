import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { utf8ByteLength, type RunCapsuleV1 } from '../../../shared/runCapsule';
import { formatByteSize, formatNumber } from '../../i18n/formatNumber';
import { cn } from '../../utils/cn';

const SECTION = 'mb-1.5 font-mono text-eyebrow font-semibold uppercase tracking-[0.14em] text-fg-subtle';
const BOX = 'overflow-auto rounded-lg border border-border-subtle bg-bg-inset font-mono text-body-sm text-fg-base';

function Code({ source, label }: { source: string; label: string }) {
  const lines = useMemo(() => source.split('\n'), [source]);
  const gutter = useMemo(() => lines.map((_, index) => index + 1).join('\n'), [lines]);
  return (
    <div data-testid="capsule-detail-code" role="region" aria-label={label} tabIndex={0} className={cn(BOX, 'focus-ring flex max-h-[240px] py-2 leading-5')}>
      <pre aria-hidden="true" className="select-none pl-2 pr-3 text-right text-fg-subtle">
        {gutter}
      </pre>
      <pre className="min-w-0 flex-1 pr-3">{source}</pre>
    </div>
  );
}

function inputText(capsule: RunCapsuleV1): string {
  const { stdin, args } = capsule.input;
  return [stdin ?? '', args?.length ? args.join(' ') : ''].filter(Boolean).join('\n');
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-fg-base">{children}</dd>
    </div>
  );
}

/** Code, input and output of one capsule; how it ran stays folded under Run details. */
export function CapsuleDetail({ capsule }: { capsule: RunCapsuleV1 }) {
  const { t, i18n } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const input = inputText(capsule);
  const { stdout, stderr, errorMessage } = capsule.result;
  const output = [stdout, stderr].filter(Boolean).join('\n');
  const truncated = capsule.privacy.omittedFields.some((field) => field === 'result.stdout' || field === 'result.stderr');
  const byteLength = useMemo(() => (detailsOpen ? utf8ByteLength(JSON.stringify(capsule)) : 0), [capsule, detailsOpen]);

  return (
    <div data-testid="capsule-detail" className="space-y-4">
      <section>
        <h3 className={SECTION}>{t('capsuleList.detail.code')}</h3>
        <Code source={capsule.source.content} label={t('capsuleList.detail.code')} />
      </section>
      <section>
        <h3 className={SECTION}>{t('capsuleList.detail.input')}</h3>
        {input ? (
          <pre data-testid="capsule-detail-input" role="region" aria-label={t('capsuleList.detail.input')} tabIndex={0} className={cn(BOX, 'focus-ring max-h-[120px] px-3 py-2')}>
            {input}
          </pre>
        ) : (
          <p data-testid="capsule-detail-input" className="text-body-sm text-fg-muted">
            {t('capsuleList.detail.none')}
          </p>
        )}
      </section>
      <section>
        <h3 className={SECTION}>
          {t('capsuleList.detail.output')}
          {truncated ? (
            <span data-testid="capsule-detail-output-truncated" className="ml-2 normal-case tracking-normal text-warning-fg">
              {t('capsuleList.detail.outputTruncated')}
            </span>
          ) : null}
        </h3>
        <div data-testid="capsule-detail-output" role="region" aria-label={t('capsuleList.detail.output')} tabIndex={0} className={cn(BOX, 'focus-ring max-h-[220px] px-3 py-2 leading-[1.35]')}>
          {output ? <pre>{output}</pre> : null}
          {errorMessage ? <pre className="text-error-fg">{errorMessage}</pre> : null}
          {!output && !errorMessage ? <span className="font-sans text-fg-muted">{t('capsuleList.detail.none')}</span> : null}
        </div>
      </section>
      <section className="rounded-lg border border-border-subtle bg-bg-base">
        <button
          type="button"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
          data-testid="capsule-detail-run-details"
          className="focus-ring flex h-9 w-full items-center gap-2 rounded-lg px-3 text-body-sm font-medium text-fg-muted hover:text-fg-base"
        >
          <ChevronRight size={11} aria-hidden="true" className={cn('transition-transform', detailsOpen && 'rotate-90')} />
          {t('capsuleList.detail.runDetails')}
        </button>
        {detailsOpen ? (
          <dl data-testid="capsule-detail-run-details-panel" className="border-t border-border-subtle px-3 py-2 text-caption">
            <DetailRow label={t('capsuleList.detail.runner')}>{capsule.environment.runner}</DetailRow>
            <DetailRow label={t('capsuleList.detail.runtime')}>{capsule.tab.runtimeMode}</DetailRow>
            <DetailRow label={t('capsuleList.detail.platform')}>{capsule.environment.platform}</DetailRow>
            <DetailRow label={t('capsuleList.detail.duration')}>
              {t('capsuleList.detail.durationValue', { ms: formatNumber(capsule.result.durationMs, i18n.language) })}
            </DetailRow>
            <DetailRow label={t('capsuleList.detail.appVersion')}>{capsule.appVersion}</DetailRow>
            <DetailRow label={t('capsuleList.detail.created')}>{capsule.createdAt}</DetailRow>
            <DetailRow label={t('capsuleList.detail.hash')}>{capsule.source.contentHash.slice(0, 12)}</DetailRow>
            {capsule.environment.git?.branch ? (
              <DetailRow label={t('capsuleList.detail.branch')}>{capsule.environment.git.branch}</DetailRow>
            ) : null}
            <DetailRow label={t('capsuleList.detail.size')}>
              {formatByteSize(byteLength, i18n.language)}
            </DetailRow>
            {capsule.privacy.omittedFields.length > 0 ? (
              <DetailRow label={t('capsuleList.detail.omitted')}>{capsule.privacy.omittedFields.join(', ')}</DetailRow>
            ) : null}
          </dl>
        ) : null}
      </section>
    </div>
  );
}
