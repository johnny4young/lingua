import { useTranslation } from 'react-i18next';
import '../../i18n/httpBuilderCatalog';
import type { HttpResponseTiming, HttpResponseV1 } from '../../../shared/httpWorkspaceSchema';
import { cn } from '../../utils/cn';

const PHASES = [
  { key: 'dnsMs', label: 'dns', bar: 'bg-border-strong' },
  { key: 'connectMs', label: 'connect', bar: 'bg-border-strong' },
  { key: 'tlsMs', label: 'tls', bar: 'bg-syntax-function' },
  { key: 'waitingMs', label: 'waiting', bar: 'bg-accent' },
  { key: 'downloadMs', label: 'download', bar: 'bg-success' },
] as const satisfies ReadonlyArray<{ key: keyof HttpResponseTiming; label: string; bar: string }>;

/** The Timing tab: the phases of the hop that answered on desktop, the total everywhere. */
export function HttpTimingPanel({ response, desktop }: { response: HttpResponseV1; desktop: boolean }) {
  const { t } = useTranslation();
  const timing = response.timing;
  const total = (
    <p className="font-mono text-caption tabular-nums text-fg-base">
      {t('httpWorkspace.response.timing.total')} <span data-testid="http-timing-total">{response.durationMs} ms</span>
    </p>
  );
  if (!timing) {
    return (
      <div data-testid="http-timing" data-phases="false" className="flex flex-col gap-2">
        {total}
        <p className="text-caption text-fg-subtle">
          {t(desktop ? 'httpWorkspace.response.timing.unavailable' : 'httpWorkspace.response.timing.webNote')}
        </p>
      </div>
    );
  }
  const phases = PHASES.map((phase) => ({ ...phase, ms: timing[phase.key], name: t(`httpWorkspace.response.timing.phase.${phase.label}`) }));
  return (
    <div data-testid="http-timing" data-phases="true" className="flex flex-col gap-3">
      <p data-testid="http-timing-summary" className="font-mono text-caption tabular-nums text-fg-subtle">
        {phases.map((phase) => `${phase.name} ${phase.ms}`).join(' · ')} ms
      </p>
      <div
        role="img"
        aria-label={t('httpWorkspace.response.timing.waterfall')}
        className="flex h-2 gap-px overflow-hidden rounded-full bg-bg-inset"
      >
        {phases.map((phase) =>
          phase.ms > 0 ? <span key={phase.key} className={cn('min-w-[2px]', phase.bar)} style={{ flexGrow: phase.ms }} /> : null
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 font-mono text-caption tabular-nums">
        {phases.map((phase) => (
          <div key={phase.key} className="contents">
            <dt className="flex items-center gap-2 text-fg-subtle">
              <span className={cn('h-2 w-2 rounded-full', phase.bar)} aria-hidden="true" />
              {phase.name}
            </dt>
            <dd data-testid={`http-timing-${phase.label}`} className="text-fg-base">
              {phase.ms} ms
            </dd>
          </div>
        ))}
      </dl>
      {total}
      {timing.redirects > 0 ? (
        <p data-testid="http-timing-redirects" className="text-caption text-fg-subtle">
          {t('httpWorkspace.response.timing.redirects', { count: timing.redirects, ms: timing.redirectMs })}
        </p>
      ) : null}
    </div>
  );
}

/** How much faster or slower this response was than the previous one, beside the header meta. */
export function HttpResponseDelta({ response, previous }: { response: HttpResponseV1; previous: HttpResponseV1 | undefined }) {
  const { t } = useTranslation();
  if (!previous || response.status === 0 || previous.status === 0) return null;
  const delta = response.durationMs - previous.durationMs;
  if (delta === 0) return null;
  const faster = delta < 0;
  const label = t(faster ? 'httpWorkspace.response.delta.faster' : 'httpWorkspace.response.delta.slower', { ms: Math.abs(delta) });
  return (
    <span
      data-testid="http-response-delta"
      data-direction={faster ? 'faster' : 'slower'}
      title={label}
      className={cn('ml-2', faster ? 'text-success-fg' : 'text-warning-fg')}
    >
      <span aria-hidden="true">
        {faster ? '▼' : '▲'} {Math.abs(delta)} ms
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
