import { useMemo, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, CornerLeftUp, CornerRightUp, Redo2 } from 'lucide-react';
import '../../i18n/timelineCatalog';
import type { TimelineStep } from '../../../shared/timeline';
import { useTimelineStore } from '../../stores/timelineStore';
import { announce } from '../../stores/announcerStore';
import { timelineEchoes, type TimelineMove } from '../../utils/timelineModel';
import { cn } from '../../utils/cn';
import { EyebrowMono } from '../ui/primitives';

/** Past this many steps the strip draws marked steps and an even sample, not every tick. */
const MAX_TICKS = 400;
const NO_STEPS: readonly TimelineStep[] = [];

function ticksFor(steps: readonly TimelineStep[], current: number, echoes: ReadonlySet<number>): number[] {
  if (steps.length <= MAX_TICKS) return steps.map((_, index) => index);
  const every = Math.ceil(steps.length / MAX_TICKS);
  return steps.flatMap((step, index) =>
    index % every === 0 || step.log || step.error || index === current || echoes.has(index) ? [index] : []
  );
}

const STEP_BUTTONS = [
  { id: 'backOut', move: 'out', backward: true, icon: CornerLeftUp },
  { id: 'back', move: 'into', backward: true, icon: ChevronLeft },
  { id: 'next', move: 'into', backward: false, icon: ChevronRight },
  { id: 'over', move: 'over', backward: false, icon: Redo2 },
  { id: 'out', move: 'out', backward: false, icon: CornerRightUp },
] as const;

/** Replay of the latest Record run: the strip of steps and the state as of the selected one. */
export function TimelinePanel() {
  const { t } = useTranslation();
  const recording = useTimelineStore(state => state.recording);
  const current = useTimelineStore(state => state.current);
  const select = useTimelineStore(state => state.select);
  const stepBy = useTimelineStore(state => state.step);
  const go = useTimelineStore(state => state.go);
  const steps = recording?.steps ?? NO_STEPS;
  const echoes = useMemo(() => timelineEchoes(steps, current), [steps, current]);
  const echoSet = useMemo(() => new Set(echoes.indices.length > 1 ? echoes.indices : []), [echoes]);
  const ticks = useMemo(() => ticksFor(steps, current, echoSet), [steps, current, echoSet]);
  if (!recording) return null;

  const step = steps[current];
  const count = steps.length;
  const position = (index: number) => (count <= 1 ? 0 : (index / (count - 1)) * 100);
  const move = (kind: TimelineMove, backward: boolean) => {
    if (!go(kind, backward)) announce(t('timeline.unreachable'));
  };
  const onStripKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const pages: Record<string, number> = { PageUp: -10, PageDown: 10 };
    if (event.key === 'Home') select(0);
    else if (event.key === 'End') select(count - 1);
    else if (pages[event.key] !== undefined) stepBy(pages[event.key]!);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      move(event.altKey ? 'out' : event.shiftKey ? 'over' : 'into', event.key === 'ArrowLeft');
    } else return;
    event.preventDefault();
  };
  const onStripClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    // Ticks sit 8 px in from each edge, so map the click over the same inner width.
    select(Math.round(((event.clientX - box.left - 8) / Math.max(1, box.width - 16)) * (count - 1)));
  };

  return (
    <div data-testid="timeline-panel" className="flex h-full min-h-0 flex-col bg-bg-panel text-body-sm">
      <header className="flex h-[34px] shrink-0 items-center gap-3 border-b border-border-subtle px-3">
        <EyebrowMono>{t('timeline.title')}</EyebrowMono>
        <span className="truncate font-mono text-caption text-fg-muted" data-testid="timeline-summary">
          {t('timeline.summary', { count: recording.total })}
          {recording.truncated ? ` · ${t('timeline.truncated', { count: recording.total })}` : ''}
        </span>
        <span className="flex-1" />
        {STEP_BUTTONS.map(button => (
          <button
            key={button.id}
            type="button"
            className="button-secondary inline-flex h-[26px] shrink-0 items-center gap-1 px-[9px] text-caption"
            aria-label={t(`timeline.${button.id}Label`)}
            onClick={() => move(button.move, button.backward)}
            data-testid={`timeline-${button.id}`}
          >
            {button.backward ? <button.icon size={12} aria-hidden="true" /> : null}
            {t(`timeline.${button.id}`)}
            {button.backward ? null : <button.icon size={12} aria-hidden="true" />}
          </button>
        ))}
      </header>

      {count === 0 ? (
        <p className="m-auto text-fg-subtle">{t('timeline.empty')}</p>
      ) : (
        <>
          <div className="shrink-0 px-3 pt-2.5">
            <div
              role="slider"
              tabIndex={0}
              aria-label={t('timeline.strip')}
              aria-valuemin={1}
              aria-valuemax={count}
              aria-valuenow={current + 1}
              aria-valuetext={t('timeline.stepText', { step: current + 1, count, line: step?.line })}
              onKeyDown={onStripKey}
              onClick={onStripClick}
              data-testid="timeline-strip"
              className="timeline-strip relative h-[30px] cursor-pointer rounded-md border border-border-subtle bg-bg-inset"
            >
              {ticks.map(index => (
                <span
                  key={index}
                  data-current={index === current ? 'true' : undefined}
                  data-kind={steps[index]!.error ? 'error' : steps[index]!.log ? 'log' : echoSet.has(index) && index !== current ? 'echo' : undefined}
                  className="timeline-tick"
                  style={{ left: `calc(8px + (100% - 16px) * ${position(index) / 100})` }}
                />
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-3.5 text-caption text-fg-muted">
              <span className="inline-flex items-center gap-1.5" data-testid="timeline-current">
                <span className="timeline-swatch" data-kind="current" />
                {t('timeline.legend.current', { step: current + 1, line: step?.line })}
              </span>
              {echoSet.size > 0 ? (
                <span className="inline-flex items-center gap-1.5" data-testid="timeline-echoes">
                  <span className="timeline-swatch" data-kind="echo" />
                  {t('timeline.legend.echoes', { line: step?.line, count: echoSet.size })}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                <span className="timeline-swatch" data-kind="log" />
                {t('timeline.legend.log')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="timeline-swatch" data-kind="error" />
                {t('timeline.legend.error')}
              </span>
              {recording.limited ? (
                <span className="ml-auto inline-flex items-center gap-1.5" data-testid="timeline-limited">
                  <span className="rounded border border-warning-border bg-warning-bg px-1 font-mono text-micro font-bold text-warning-fg">{t('actionPill.badgePro')}</span>
                  {t('timeline.limited', { count, total: recording.total })}
                </span>
              ) : null}
            </div>
          </div>

          <div className="timeline-body mt-2.5 grid min-h-0 flex-1 border-t border-border-subtle">
            <section className="min-h-0 overflow-y-auto px-3 py-2.5" data-testid="timeline-watches">
              <EyebrowMono>{t('timeline.watches', { step: current + 1 })}</EyebrowMono>
              {step && step.vars.length > 0 ? (
                <dl className="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 font-mono text-caption leading-[22px]">
                  {step.vars.map(([name, value]) => (
                    <div key={name} className="contents">
                      <dt className="text-fg-base">{name}</dt>
                      <dd className="truncate text-fg-muted" title={value}>
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-1 text-fg-subtle">{t('timeline.noVars')}</p>
              )}
            </section>
            <section className="min-h-0 overflow-y-auto px-3 py-2.5" data-testid="timeline-stack">
              <EyebrowMono>{t('timeline.callStack')}</EyebrowMono>
              <ol className="mt-1 font-mono text-caption leading-5">
                {[...(step?.frames ?? [])].reverse().map((frame, index, frames) => (
                  <li key={index} className={cn('flex gap-2', index === 0 ? 'text-fg-base' : 'text-fg-muted')}>
                    <span>
                      {frame.name} :{frame.line}
                    </span>
                    {index === 0 && frames.length > 1 ? (
                      <span className="text-fg-subtle">{t('timeline.depth', { depth: frames.length - 1 })}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
