/**
 * The one result header every workspace shares: workspace tag, a Fraunces
 * numeral with its unit in italic, metrics over a small bar, views and actions.
 * Views are real buttons with `aria-pressed`, so they stay keyboard-reachable.
 */

import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { ResultNumeral, TypeTag, type AnswerTone } from './answer';
import { IconButton } from './chrome';
import { Glyph } from './Glyph';
import type { GlyphName } from './glyphSet';
import { PhaseBar, type PhaseBarSegment } from './PhaseBar';

/** Workspace vocabulary, like a language tag: never translated. */
const WORKSPACE_TAG = { code: 'CODE', sql: 'SQL', http: 'HTTP', pipe: 'PIPE' } as const;

export type ResultWorkspace = keyof typeof WORKSPACE_TAG;

/** CODE / SQL / HTTP / PIPE: the first word of every result header. */
export function WorkspaceTag({ workspace, className }: { workspace: ResultWorkspace; className?: string }) {
  return (
    <span data-testid="result-header-workspace" className={cn('flex', className)}>
      <TypeTag>{WORKSPACE_TAG[workspace]}</TypeTag>
    </span>
  );
}

/** How the time split, drawn under the metrics and spelled out beside them. */
export interface ResultHeaderPhases {
  segments: ReadonlyArray<PhaseBarSegment>;
  label: string;
  /** Test id of the bar; the label takes `<testId>-label`. */
  testId: string;
  /** Hide the spelled-out split, e.g. while a view shows it in full. */
  hideLabel?: boolean;
}

export interface ResultHeaderTab {
  id: string;
  label: ReactNode;
}

export interface ResultHeaderNumeral {
  value: ReactNode;
  unit?: ReactNode;
  tone?: AnswerTone;
  /** Full reading for the tooltip, e.g. the untruncated status text. */
  title?: string;
  /** Extra attributes for the numeral's wrapper (test ids, state). */
  attributes?: Record<`data-${string}`, string | number | undefined>;
}

export interface ResultHeaderAction {
  id: string;
  glyph: GlyphName;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  testId?: string;
}

export interface ResultHeaderProps {
  workspace?: ResultWorkspace;
  /** The result as a number: 12 rows, 200 ok, 1.24 s. */
  numeral?: ResultHeaderNumeral;
  /** A status badge, for results without a number (errors, cancelled runs). */
  status?: ReactNode;
  /** Mono metrics line, e.g. "340 ms · 83 B". */
  meta?: string;
  /** Right after the meta on the same line, e.g. the statement position or a delta. */
  metaTrailing?: ReactNode;
  phases?: ResultHeaderPhases;
  tabs?: ReadonlyArray<ResultHeaderTab>;
  activeTab?: string;
  onTabChange?: (id: string) => void;
  actions?: ReadonlyArray<ResultHeaderAction>;
  /** Far-right slot after the actions. */
  trailing?: ReactNode;
  /** `pane` heads a workspace result (44 px numeral); `compact` heads an inline output. */
  density?: 'pane' | 'compact';
}

export function ResultHeader({
  workspace,
  numeral,
  status,
  meta,
  metaTrailing,
  phases,
  tabs,
  activeTab,
  onTabChange,
  actions,
  trailing,
  density = 'pane',
}: ResultHeaderProps) {
  const compact = density === 'compact';
  const hasTabs = tabs !== undefined && tabs.length > 0;
  const hasActions = actions !== undefined && actions.length > 0;
  const detail = phases && !phases.hideLabel;
  return (
    <div
      data-testid="result-header"
      data-density={density}
      className={cn(
        'flex flex-wrap items-center border-b border-border-subtle bg-bg-panel',
        detail && '@container',
        compact ? 'min-h-[44px] gap-x-3 gap-y-1 px-3 py-1.5' : 'min-h-[66px] gap-x-4 gap-y-1.5 py-2 pl-5 pr-4'
      )}
    >
      {workspace ? <WorkspaceTag workspace={workspace} className="shrink-0" /> : null}
      {numeral ? (
        <span
          data-testid="result-header-numeral"
          title={numeral.title}
          className="flex min-w-0 shrink items-baseline overflow-hidden"
          {...numeral.attributes}
        >
          <ResultNumeral
            size={compact ? 'md' : 'lg'}
            value={numeral.value}
            unit={numeral.unit}
            tone={numeral.tone ?? 'neutral'}
            className="min-w-0 [&_.result-numeral-unit]:truncate"
          />
        </span>
      ) : null}
      {/* The status shrinks first so the meta line never wraps. */}
      {status ? <span className="flex min-w-0 shrink">{status}</span> : null}
      {meta || metaTrailing || phases ? (
        <span className="flex shrink-0 flex-col gap-[5px]">
          {meta || metaTrailing ? (
            <span className="whitespace-nowrap font-mono text-body-sm tabular-nums text-fg-muted">
              {meta}
              {metaTrailing}
            </span>
          ) : null}
          {phases ? (
            <PhaseBar
              data-testid={phases.testId}
              title={phases.label}
              aria-hidden="true"
              segments={phases.segments}
              className="h-2 w-[150px] rounded-[2px]"
            />
          ) : null}
        </span>
      ) : null}
      {/* A narrow pane drops the spelled-out split; the bar keeps it as a tooltip. */}
      {detail ? (
        <span className="hidden min-w-0 flex-[1_1_0] items-center @[560px]:flex">
          <span
            data-testid={`${phases.testId}-label`}
            title={phases.label}
            className="truncate font-mono text-caption tabular-nums text-fg-subtle"
          >
            {phases.label}
          </span>
        </span>
      ) : null}
      {hasTabs || hasActions || trailing ? (
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
          {hasTabs ? (
            <div className="flex flex-wrap justify-end gap-0.5">
              {tabs.map((tab) => {
                const active = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onTabChange?.(tab.id)}
                    className={cn(
                      'whitespace-nowrap rounded-md px-2.5 py-[5px] text-body-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-panel',
                      active ? 'bg-bg-panel-alt font-semibold text-fg-base' : 'text-fg-subtle hover:text-fg-base'
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          {hasActions ? (
            <div className={cn('flex items-center gap-0.5', hasTabs && 'ml-2')}>
              {actions.map((action) => (
                <IconButton
                  key={action.id}
                  tooltip={action.label}
                  tooltipSide="bottom"
                  onClick={action.onClick}
                  active={action.pressed === true}
                  {...(action.pressed !== undefined ? { 'aria-pressed': action.pressed } : {})}
                  data-testid={action.testId}
                  className="rounded-md text-fg-muted"
                >
                  <Glyph name={action.glyph} />
                </IconButton>
              ))}
            </div>
          ) : null}
          {trailing ? <span className="ml-1 flex shrink-0 items-center gap-2">{trailing}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
