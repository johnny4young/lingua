import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import '../../i18n/timelineCatalog';
import './runTrace.css';
import type { TimelineStep } from '../../../shared/timeline';
import { useTimelineStore } from '../../stores/timelineStore';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import { detectLoops, lineSnippet, pickLoops, pickTicks, sampleSteps, slowestLine, traceShown } from '../../utils/runTraceModel';
import { formatRunDuration } from '../../utils/timeLabels';

const HEIGHT = 132;
const PAD_Y = 6;
const PLOT_LEFT = 30;
const PLOT_RIGHT = 10;
const GRID_LEFT = 22;
const DEFAULT_WIDTH = 690;
/** Up to this many steps each one gets its own dot. */
const MAX_DOTS = 48;
const MIN_PASS_LABEL = 36;
/** While the run records, its steps fill this much of the plot and the rest stays for what comes next. */
const LIVE_REACH = 0.88;
const NO_STEPS: readonly TimelineStep[] = [];

const openTimeline = () => useUIStore.getState().openBottomPanel('timeline');

/** H-then-V staircase through the points, as the run moves from line to line. */
function stairs(points: ReadonlyArray<readonly [number, number]>): string {
  return points
    .map(([x, y], index) => (index === 0 ? `M${x.toFixed(1)} ${y.toFixed(1)}` : `H${x.toFixed(1)}V${y.toFixed(1)}`))
    .join('');
}

/** The latest Record run as a chart of the line at each step, beside the Console tape; it draws while the run records. */
export function RunTrace() {
  const { t } = useTranslation();
  const recording = useTimelineStore(state => state.recording);
  const current = useTimelineStore(state => state.current);
  const select = useTimelineStore(state => state.select);
  const activeTabId = useEditorStore(state => state.activeTabId);
  const shown = traceShown(recording, activeTabId);
  const steps = shown ? recording.steps : NO_STEPS;
  const count = steps.length;

  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const node = chartRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown]);

  const slowest = useMemo(
    () => (shown && !recording.truncated ? slowestLine(steps, recording.ms) : null),
    [shown, recording, steps]
  );
  const slowestCode = useMemo(
    () => (slowest && recording ? lineSnippet(recording.code, slowest.line, 20) : ''),
    [recording, slowest]
  );
  // Loops and ticks depend on the steps only, so resizing the dock redraws without re-reading them.
  const loopsFound = useMemo(() => pickLoops(detectLoops(steps)), [steps]);
  const logs = useMemo(() => steps.reduce((sum, item) => sum + (item.log ? 1 : 0), 0), [steps]);

  const live = shown && recording.live === true;
  const reach = live ? LIVE_REACH : 1;
  const chart = useMemo(() => {
    if (count < 2) return null;
    let minLine = Infinity;
    let maxLine = -Infinity;
    for (const step of steps) {
      minLine = Math.min(minLine, step.line);
      maxLine = Math.max(maxLine, step.line);
    }
    const span = maxLine - minLine;
    const fullWidth = Math.max(1, width - PLOT_LEFT - PLOT_RIGHT);
    const plotWidth = fullWidth * reach;
    const xOf = (index: number) => PLOT_LEFT + (index / (count - 1)) * plotWidth;
    const yOf = (line: number) => (span === 0 ? HEIGHT / 2 : PAD_Y + ((line - minLine) / span) * (HEIGHT - 2 * PAD_Y));
    const loops = loopsFound.map(loop => {
      const x = Math.max(GRID_LEFT, xOf(loop.start) - 6);
      const y = yOf(loop.minLine) - 7;
      return {
        key: `${loop.start}-${loop.head}`,
        x,
        y,
        // A loop still running when the recording is live reaches into the projection.
        width: (live && loop.end === count - 1 ? PLOT_LEFT + fullWidth : Math.min(width - 1, xOf(loop.end) + 9)) - x,
        height: yOf(loop.maxLine) - yOf(loop.minLine) + 14,
        labels: loop.passes.flatMap((pass, at) => {
          const slotEnd = at + 1 < loop.passes.length ? xOf(loop.passes[at + 1]!.start) : xOf(pass.end) + plotWidth / (count - 1);
          return slotEnd - xOf(pass.start) >= MIN_PASS_LABEL
            ? [{ number: at + 1, x: (xOf(pass.start) + xOf(pass.end)) / 2, y: Math.max(8, y - 5) }]
            : [];
        }),
      };
    });
    return { xOf, yOf, loops, ticks: pickTicks(steps.map(step => step.line), yOf), plotWidth, right: PLOT_LEFT + fullWidth };
  }, [steps, count, width, loopsFound, reach, live]);

  if (!shown || !chart) return null;
  const { xOf, yOf, loops, ticks, plotWidth, right } = chart;
  const last = steps[count - 1]!;
  const step = steps[current];
  const drawn = sampleSteps(steps, current, Math.floor(plotWidth / 2));
  const point = (index: number) => [xOf(index), yOf(steps[index]!.line)] as const;
  const reached = drawn.filter(index => index <= current);
  const ahead = drawn.filter(index => index >= current);

  const pick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const usable = (bounds.width - PLOT_LEFT - PLOT_RIGHT) * reach;
    if (usable > 0) select(Math.round(((event.clientX - bounds.left - PLOT_LEFT) / usable) * (count - 1)));
    openTimeline();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') openTimeline();
    else if (event.key === 'ArrowLeft') select(current - 1);
    else if (event.key === 'ArrowRight') select(current + 1);
    else if (event.key === 'Home') select(0);
    else if (event.key === 'End') select(count - 1);
    else return;
    event.preventDefault();
  };

  // Floor, so 100% only ever means the line took the whole run.
  const share = slowest ? Math.max(1, Math.floor(slowest.share * 100)) : 0;
  const slowestValues = slowest ? { line: slowest.line, time: formatRunDuration(slowest.ms), share } : null;

  return (
    <section className="run-trace" data-testid="run-trace" data-live={live || undefined} aria-busy={live || undefined} aria-label={t('timeline.trace.title')}>
      <div className="run-trace-head">
        <span className="run-trace-title">{t('timeline.trace.title')}</span>
        <button type="button" className="run-trace-open" onClick={openTimeline} data-testid="run-trace-open">
          {t('timeline.trace.steps', { count })}
        </button>
      </div>
      <div
        ref={chartRef}
        className="run-trace-chart"
        role="slider"
        tabIndex={0}
        aria-label={t('timeline.trace.chart')}
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={current + 1}
        aria-valuetext={t('timeline.stepText', { step: current + 1, count, line: step?.line })}
        onClick={pick}
        onKeyDown={onKeyDown}
        data-testid="run-trace-chart"
      >
        <svg width="100%" height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          {ticks.map(line => (
            <g key={line}>
              <text className="run-trace-tick" x={16} y={yOf(line) + 3.5} textAnchor="end">
                {line}
              </text>
              <path className="run-trace-grid" d={`M${GRID_LEFT} ${yOf(line).toFixed(1)}H${width}`} />
            </g>
          ))}
          {loops.map(loop => (
            <rect key={loop.key} className="run-trace-wash" x={loop.x} y={loop.y} width={Math.max(0, loop.width)} height={loop.height} rx={5} />
          ))}
          {ahead.length > 1 && <path className="run-trace-ahead" d={stairs(ahead.map(point))} />}
          {live && (
            <path
              className="run-trace-ahead"
              d={`M${xOf(count - 1).toFixed(1)} ${yOf(last.line).toFixed(1)}H${right.toFixed(1)}`}
              data-testid="run-trace-projection"
            />
          )}
          {reached.length > 1 && <path className="run-trace-path" d={stairs(reached.map(point))} />}
          {drawn.map(index => {
            const item = steps[index]!;
            const kind = item.error ? 'error' : item.log ? 'log' : 'step';
            if (kind === 'step' && (count > MAX_DOTS || index > current)) return null;
            if (kind === 'log' && (logs > MAX_DOTS || index > current)) return null;
            const [cx, cy] = point(index);
            return <circle key={index} className="run-trace-dot" data-kind={kind} cx={cx} cy={cy} r={kind === 'step' ? 1.8 : 3} />;
          })}
          {step && (
            <g data-kind={step.error ? 'error' : undefined}>
              <circle className="run-trace-ring" cx={xOf(current)} cy={yOf(step.line)} r={9} />
              <circle className="run-trace-now" cx={xOf(current)} cy={yOf(step.line)} r={4} />
            </g>
          )}
          {loops.flatMap(loop =>
            loop.labels.map(label => (
              <text key={`${loop.key}-${label.number}`} className="run-trace-loop" x={label.x} y={label.y} textAnchor="middle" data-testid="run-trace-loop">
                {t('timeline.trace.loop', { number: label.number })}
              </text>
            ))
          )}
        </svg>
      </div>
      {slowestValues && (
        <div className="run-trace-time" data-testid="run-trace-time">
          <span>{t('timeline.trace.time')}</span>
          <div className="run-trace-bar" aria-hidden="true">
            <i style={{ width: `${100 - share}%` }} />
          </div>
          <span className="run-trace-slowest" aria-label={t('timeline.trace.slowestLabel', slowestValues)} data-testid="run-trace-slowest">
            {t('timeline.trace.slowest', { ...slowestValues, code: slowestCode }).replace(/ {2,}/gu, ' ')}
          </span>
        </div>
      )}
    </section>
  );
}

