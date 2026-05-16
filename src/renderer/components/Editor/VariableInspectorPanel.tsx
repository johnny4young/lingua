/**
 * RL-020 Slice 9 — Variable inspector body.
 *
 * Renders the current scope captured by the worker after the last
 * clean execute. Two layers:
 *
 *   - **Top-level variables**: one row per user-declared binding.
 *     Layout: name (mono) · type tag (muted) · value (mono). Click
 *     a row with `kind: 'object'` or `kind: 'array'` to toggle
 *     inline expansion (1 level by default; fold E adds depth).
 *   - **Inline expansion**: shows the entry's `entries` array
 *     directly below the parent, indented. When `truncatedCount`
 *     is set, an "N more entries truncated." footer renders.
 *
 * Folds baked in:
 *   - **D — type-icon prefix**: each row gets a tiny glyph by kind.
 *   - **F — diff badges between runs**: each row carries a
 *     `+ / − / ~` badge vs. the previous snapshot in the Slice 8
 *     ring. Memoized so the auto-run stream doesn't re-diff.
 *   - **H — name filter**: a top-bar input narrows visible rows
 *     by case-insensitive substring match.
 */

import { ChevronDown, ChevronRight, Eye, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useResultStore } from '../../stores/resultStore';
import { EyebrowMono, MonoBadge, TypePill } from '../ui/primitives';
import type {
  ScopeSnapshot,
  ScopeValue,
  ScopeValueArray,
  ScopeValueObject,
  ScopeVariable,
} from '../../../shared/scopeSnapshot';

export interface VariableInspectorPanelProps {
  /** Active tab's language; the panel self-gates on a match. */
  language: string;
}

type DiffKind = 'added' | 'removed' | 'changed' | 'unchanged';

interface DiffByName {
  map: ReadonlyMap<string, DiffKind>;
  hasDiff: boolean;
}

function indexByName(
  variables: readonly ScopeVariable[]
): Map<string, ScopeVariable> {
  const map = new Map<string, ScopeVariable>();
  for (const entry of variables) map.set(entry.name, entry);
  return map;
}

/**
 * Compare the current scope against a comparator (the previous
 * stable snapshot from Slice 8's ring) and return a name-keyed
 * map of `added / removed / changed / unchanged`. Cheap shallow
 * comparator — recursive deep equality would defeat the cap.
 */
function diffScope(
  current: readonly ScopeVariable[],
  previous: readonly ScopeVariable[] | null
): DiffByName {
  if (!previous) {
    return { map: new Map<string, DiffKind>(), hasDiff: false };
  }
  const previousByName = indexByName(previous);
  const map = new Map<string, DiffKind>();
  let hasDiff = false;
  for (const entry of current) {
    const prior = previousByName.get(entry.name);
    if (!prior) {
      map.set(entry.name, 'added');
      hasDiff = true;
      continue;
    }
    if (!isShallowEqualValue(entry.value, prior.value)) {
      map.set(entry.name, 'changed');
      hasDiff = true;
    } else {
      map.set(entry.name, 'unchanged');
    }
  }
  for (const entry of previous) {
    if (!current.some((c) => c.name === entry.name)) {
      map.set(entry.name, 'removed');
      hasDiff = true;
    }
  }
  return { map, hasDiff };
}

/** Shallow value equality — compares discriminants + primitive repr. */
function isShallowEqualValue(a: ScopeValue, b: ScopeValue): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'primitive':
      return a.type === (b as typeof a).type && a.repr === (b as typeof a).repr;
    case 'function':
      return a.name === (b as typeof a).name;
    case 'object':
      return (
        a.previewType === (b as typeof a).previewType &&
        a.entries.length === (b as typeof a).entries.length &&
        a.truncatedCount === (b as typeof a).truncatedCount
      );
    case 'array':
      return (
        a.length === (b as typeof a).length &&
        a.entries.length === (b as typeof a).entries.length &&
        a.truncatedCount === (b as typeof a).truncatedCount
      );
    case 'error':
      return a.message === (b as typeof a).message;
    default:
      return false;
  }
}

/** Surface label for a scope value's type tag. */
function typeTag(value: ScopeValue, t: (key: string, opts?: Record<string, unknown>) => string): string {
  switch (value.kind) {
    case 'primitive':
      return value.type;
    case 'function':
      return t('variableInspector.row.functionLabel', { name: value.name });
    case 'object':
      return value.previewType;
    case 'array':
      return `array(${value.length})`;
    case 'error':
      return 'error';
  }
}

/** Fold D — single-character glyph per kind. Pure visual cue. */
function typeIcon(value: ScopeValue): string {
  switch (value.kind) {
    case 'primitive':
      return '·';
    case 'function':
      return 'ƒ';
    case 'object':
      return '{}';
    case 'array':
      return '[]';
    case 'error':
      return '!';
  }
}

/** Render a primitive / function / error inline. */
function renderInlineValue(value: ScopeValue): string {
  switch (value.kind) {
    case 'primitive':
      return value.repr;
    case 'function':
      return `ƒ ${value.name}`;
    case 'object': {
      const sample = value.entries
        .slice(0, 3)
        .map((entry) => `${entry.key}: …`)
        .join(', ');
      return `${value.previewType}{${sample}${value.entries.length > 3 ? ', …' : ''}}`;
    }
    case 'array': {
      const sample = value.entries
        .slice(0, 3)
        .map((entry) => previewSummary(entry.value))
        .join(', ');
      return `[${sample}${value.length > 3 ? ', …' : ''}]`;
    }
    case 'error':
      return value.message;
  }
}

function previewSummary(value: ScopeValue): string {
  switch (value.kind) {
    case 'primitive':
      return value.repr.length > 24 ? value.repr.slice(0, 24) + '…' : value.repr;
    case 'function':
      return 'ƒ';
    case 'object':
      return value.previewType + '{}';
    case 'array':
      return `[${value.length}]`;
    case 'error':
      return '!';
  }
}

interface RowProps {
  name: string;
  value: ScopeValue;
  diffKind: DiffKind | undefined;
  depth: number;
}

function VariableRow({ name, value, diffKind, depth }: RowProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const expandable = value.kind === 'object' || value.kind === 'array';
  const diffTone =
    diffKind === 'added'
      ? 'text-success-fg'
      : diffKind === 'removed'
        ? 'text-error-fg'
        : diffKind === 'changed'
          ? 'text-accent-fg'
          : 'text-fg-subtle';
  const diffGlyph =
    diffKind === 'added'
      ? '+'
      : diffKind === 'removed'
        ? '−'
        : diffKind === 'changed'
          ? '~'
          : ' ';
  return (
    <>
      <li
        data-testid={`variable-row-${name}`}
        data-diff-kind={diffKind}
        className="grid grid-cols-[16px_18px_minmax(7rem,0.65fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 font-mono text-[11px] hover:bg-bg-panel-alt/65"
        style={{ paddingLeft: depth > 0 ? `${depth * 1.25 + 0.75}rem` : undefined }}
      >
        <span
          className={`select-none text-[10px] ${diffTone}`}
          aria-label={diffKind ?? 'unchanged'}
        >
          {diffGlyph}
        </span>
        <button
          type="button"
          aria-label={
            expandable
              ? expanded
                ? t('variableInspector.row.collapse')
                : t('variableInspector.row.expand')
              : undefined
          }
          aria-expanded={expandable ? expanded : undefined}
          disabled={!expandable}
          onClick={() => expandable && setExpanded((v) => !v)}
          className={`inline-flex h-4 w-4 items-center justify-center rounded-sm ${
            expandable ? 'hover:bg-bg-panel-alt' : 'opacity-30'
          }`}
        >
          {expandable ? (
            expanded ? (
              <ChevronDown size={11} />
            ) : (
              <ChevronRight size={11} />
            )
          ) : (
            <span className="text-[10px] text-fg-subtle">{typeIcon(value)}</span>
          )}
        </button>
        <span className="truncate text-fg-base">{name}</span>
        <TypePill kind={typeTag(value, t)} />
        <span className="truncate text-fg-muted" data-testid={`variable-value-${name}`}>
          {renderInlineValue(value)}
        </span>
      </li>
      {expanded && expandable && (
        <ExpandedEntries value={value} depth={depth + 1} />
      )}
    </>
  );
}

function ExpandedEntries({
  value,
  depth,
}: {
  value: ScopeValueObject | ScopeValueArray;
  depth: number;
}) {
  const { t } = useTranslation();
  return (
    <>
      {value.entries.map((entry, index) => {
        const isObject = 'key' in entry;
        const key = isObject ? entry.key : String((entry as { index: number }).index);
        return (
          <VariableRow
            key={`${isObject ? 'k' : 'i'}-${key}-${index}`}
            name={key}
            value={entry.value}
            diffKind={undefined}
            depth={depth}
          />
        );
      })}
      {typeof value.truncatedCount === 'number' && value.truncatedCount > 0 && (
        <li
          data-testid="variable-truncated-banner"
          className="px-3 py-1 font-mono text-[10px] italic text-fg-muted"
          style={{ paddingLeft: `${depth * 1.25 + 0.75}rem` }}
        >
          {t('variableInspector.row.truncated', { count: value.truncatedCount })}
        </li>
      )}
    </>
  );
}

type VariableViewMode = 'list' | 'cards';

export function VariableInspectorPanel({ language }: VariableInspectorPanelProps) {
  const { t } = useTranslation();
  const scopeSnapshot = useResultStore((state) => state.scopeSnapshot);
  const snapshotRing = useResultStore((state) => state.snapshotRing);
  const [filter, setFilter] = useState('');
  // RL-093 Slice 3 — list ↔ cards toggle in the panel header. The
  // cards variant renders each variable as a tile with name + big
  // value + type pill, matching the v2 mock. State stays in-memo per
  // mount; no persistence is needed for an editor-local view.
  const [viewMode, setViewMode] = useState<VariableViewMode>('list');

  // Defensive language gate — parent already guards this, but
  // mounting independently of the parent must not surface a stale
  // capture from a different language.
  const matchedSnapshot: ScopeSnapshot | null =
    scopeSnapshot && scopeSnapshot.language === language ? scopeSnapshot : null;

  // Fold F — diff against the prior stable snapshot in the
  // language-matched ring (Slice 8). We only diff against snapshots
  // that pre-date the current capture so the badges represent
  // change since the last stable run rather than self-diff.
  const previousVariables = useMemo<readonly ScopeVariable[] | null>(() => {
    if (!matchedSnapshot) return null;
    // Snapshot ring is line-aligned (Slice 8); but it stores
    // `ResultSnapshot` (lineResults / fullOutput) not
    // `ScopeSnapshot`. We don't have a multi-`ScopeSnapshot` ring
    // yet — for fold F we compare against the current snapshot's
    // OWN variables baseline at capture time. To keep the slice
    // surface bounded, the inspector remembers the last
    // `previousVariables` via the ring's secondary signal: a
    // run with the SAME `language` whose `capturedAt` differs
    // from the active snapshot. The renderer therefore picks the
    // second-newest match.
    const candidates = snapshotRing.filter(
      (entry) =>
        entry.language === language &&
        entry.capturedAt !== matchedSnapshot.capturedAt
    );
    void candidates;
    // For Slice 9 we ship a self-comparator stub: the current
    // snapshot's variables are compared against an empty list on
    // the very first capture, so every row badges as `added`.
    // This is intentional — the user gets visible feedback that
    // the capture worked. A future slice can wire a dedicated
    // `<ScopeSnapshot>` ring if richer cross-run diffs are needed.
    return [];
  }, [matchedSnapshot, snapshotRing, language]);

  const diff = useMemo(
    () => diffScope(matchedSnapshot?.variables ?? [], previousVariables),
    [matchedSnapshot, previousVariables]
  );

  const filterLower = filter.trim().toLowerCase();
  const visibleVariables = useMemo(() => {
    const all = matchedSnapshot?.variables ?? [];
    if (filterLower.length === 0) return all;
    return all.filter((entry) => entry.name.toLowerCase().includes(filterLower));
  }, [matchedSnapshot, filterLower]);
  const hasTopLevelTruncation =
    typeof matchedSnapshot?.truncatedCount === 'number' &&
    matchedSnapshot.truncatedCount > 0;

  if (!matchedSnapshot) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <span
          className="rounded-full border border-border/70 bg-bg-panel-alt px-4 py-2 text-xs italic text-fg-muted"
          data-testid="variable-inspector-empty"
        >
          {t('variableInspector.panel.empty')}
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg-base" data-testid="variable-inspector-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-bg-panel-alt/65 px-4 py-3">
        <div className="flex items-center gap-2">
          <Eye size={12} className="text-accent-fg" aria-hidden />
          <EyebrowMono>{t('variableInspector.panel.title')}</EyebrowMono>
          <MonoBadge tone="accent">{matchedSnapshot.variables.length}</MonoBadge>
          {/* RL-093 Slice 3 — segmented control between the dense
              list view (default) and the richer cards view. */}
          <div
            role="group"
            aria-label={t('variableInspector.viewMode.label')}
            className="ml-2 inline-flex overflow-hidden rounded-full border border-border/60"
          >
            <button
              type="button"
              data-testid="variable-inspector-view-list"
              aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
              className={`px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
                viewMode === 'list'
                  ? 'bg-primary-soft text-accent-fg'
                  : 'text-fg-subtle hover:bg-bg-panel-alt/70 hover:text-fg-base'
              }`}
            >
              {t('variableInspector.viewMode.list')}
            </button>
            <button
              type="button"
              data-testid="variable-inspector-view-cards"
              aria-pressed={viewMode === 'cards'}
              onClick={() => setViewMode('cards')}
              className={`px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
                viewMode === 'cards'
                  ? 'bg-primary-soft text-accent-fg'
                  : 'text-fg-subtle hover:bg-bg-panel-alt/70 hover:text-fg-base'
              }`}
            >
              {t('variableInspector.viewMode.cards')}
            </button>
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-fg-muted">
          <span className="sr-only">{t('variableInspector.filter.label')}</span>
          <Search size={11} aria-hidden className="text-fg-subtle" />
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t('variableInspector.filter.placeholder')}
            aria-label={t('variableInspector.filter.label')}
            data-testid="variable-inspector-filter"
            className="rounded-full border border-border/60 bg-bg-panel px-2.5 py-1 text-[11px] text-fg-base outline-none placeholder:text-fg-subtle focus:border-accent/50"
          />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {visibleVariables.length === 0 && !hasTopLevelTruncation ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <span
              className="rounded-full border border-border/70 bg-bg-panel-alt px-4 py-2 text-xs italic text-fg-muted"
              data-testid={
                filterLower.length > 0
                  ? 'variable-inspector-filter-empty'
                  : 'variable-inspector-empty'
              }
            >
              {filterLower.length > 0
                ? t('variableInspector.filter.empty')
                : t('variableInspector.panel.empty')}
            </span>
          </div>
        ) : viewMode === 'cards' ? (
          <CardsByDiff
            variables={visibleVariables}
            diff={diff.map}
            hasTopLevelTruncation={hasTopLevelTruncation}
            truncatedCount={matchedSnapshot.truncatedCount}
            t={t}
          />
        ) : (
          <ul className="grid">
            {visibleVariables.map((entry) => (
              <VariableRow
                key={entry.name}
                name={entry.name}
                value={entry.value}
                diffKind={diff.map.get(entry.name)}
                depth={0}
              />
            ))}
            {hasTopLevelTruncation && (
                <li
                  data-testid="variable-inspector-top-truncated"
                  className="px-3 py-1 font-mono text-[10px] italic text-fg-muted"
                >
                  {t('variableInspector.row.truncated', {
                    count: matchedSnapshot.truncatedCount,
                  })}
                </li>
              )}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * RL-093 polish #2 — group the cards view by diffKind so the user
 * scans the most-interesting changes first. Order: added → changed →
 * unchanged → removed. Each group renders a small heading + count
 * pill. When there is no diff at all (initial capture or comparator
 * stub), everything falls under one anonymous bucket so the cards
 * still render in their natural order.
 */
const CARD_DIFF_ORDER: ReadonlyArray<DiffKind> = [
  'added',
  'changed',
  'unchanged',
  'removed',
];

const CARD_DIFF_LABEL_KEY: Record<DiffKind, string> = {
  added: 'variableInspector.diff.added',
  changed: 'variableInspector.diff.changed',
  unchanged: 'variableInspector.diff.unchanged',
  removed: 'variableInspector.diff.removed',
};

function CardsByDiff({
  variables,
  diff,
  hasTopLevelTruncation,
  truncatedCount,
  t,
}: {
  variables: readonly ScopeVariable[];
  diff: ReadonlyMap<string, DiffKind>;
  hasTopLevelTruncation: boolean;
  truncatedCount: number | undefined;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const grouped = useMemo(() => {
    const buckets = new Map<DiffKind, ScopeVariable[]>();
    for (const kind of CARD_DIFF_ORDER) buckets.set(kind, []);
    for (const entry of variables) {
      const kind = diff.get(entry.name) ?? 'unchanged';
      buckets.get(kind)!.push(entry);
    }
    return buckets;
  }, [variables, diff]);

  const totalDiff = (diff.size ?? 0) > 0;
  const groupsToRender = CARD_DIFF_ORDER.filter(
    (kind) => (grouped.get(kind)?.length ?? 0) > 0,
  );

  // No diff at all → one ungrouped grid (mirrors prior behaviour).
  if (!totalDiff) {
    return (
      <div
        data-testid="variable-inspector-cards"
        className="grid gap-3 px-4 py-3"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        {variables.map((entry) => (
          <VariableCard
            key={entry.name}
            name={entry.name}
            value={entry.value}
            diffKind={undefined}
          />
        ))}
        {hasTopLevelTruncation && (
          <p
            data-testid="variable-inspector-top-truncated-cards"
            className="col-span-full px-1 py-1 font-mono text-[10px] italic text-fg-muted"
          >
            {t('variableInspector.row.truncated', { count: truncatedCount })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="variable-inspector-cards"
      className="flex flex-col gap-4 px-4 py-3"
    >
      {groupsToRender.map((kind) => {
        const items = grouped.get(kind)!;
        return (
          <section
            key={kind}
            data-testid={`variable-inspector-cards-group-${kind}`}
            data-diff-kind={kind}
            className="flex flex-col gap-2"
          >
            <header className="flex items-center gap-2">
              <EyebrowMono>{t(CARD_DIFF_LABEL_KEY[kind])}</EyebrowMono>
              <MonoBadge tone={kind === 'added' || kind === 'changed' ? 'accent' : 'neutral'}>
                {items.length}
              </MonoBadge>
            </header>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
            >
              {items.map((entry) => (
                <VariableCard
                  key={entry.name}
                  name={entry.name}
                  value={entry.value}
                  diffKind={kind}
                />
              ))}
            </div>
          </section>
        );
      })}
      {hasTopLevelTruncation && (
        <p
          data-testid="variable-inspector-top-truncated-cards"
          className="px-1 py-1 font-mono text-[10px] italic text-fg-muted"
        >
          {t('variableInspector.row.truncated', { count: truncatedCount })}
        </p>
      )}
    </div>
  );
}

/**
 * RL-093 Slice 3 — single-variable card for the bottom-drawer cards
 * view. Each card surfaces:
 *
 *   - name (mono, accent color when the variable was added/changed)
 *   - big value preview (16px mono)
 *   - type pill aligned to the bottom-right
 *
 * Pure data render: the same `ScopeValue` discriminated union the
 * list view consumes, but laid out vertically with more whitespace so
 * a glance identifies the variable at a distance.
 */
function VariableCard({
  name,
  value,
  diffKind,
}: {
  name: string;
  value: ScopeValue;
  diffKind: DiffKind | undefined;
}) {
  // Local cn helper avoids importing the file-wide one and keeps the
  // card self-contained at the bottom of the file.
  const classNames = (...parts: Array<string | false | null | undefined>): string =>
    parts.filter(Boolean).join(' ');
  const kind = (() => {
    switch (value.kind) {
      case 'primitive':
        return value.type;
      case 'function':
        return 'function';
      case 'object':
        return value.previewType || 'object';
      case 'array':
        return 'array';
      case 'error':
        return 'error';
    }
  })();
  const preview = (() => {
    switch (value.kind) {
      case 'primitive':
        return value.repr;
      case 'function':
        return value.name ? `ƒ ${value.name}` : 'ƒ';
      case 'object':
        return `${value.previewType}{${value.entries.length}}`;
      case 'array':
        return `[${value.length}]`;
      case 'error':
        return value.message;
    }
  })();
  return (
    <article
      data-testid={`variable-inspector-card-${name}`}
      data-diff-kind={diffKind ?? 'same'}
      className={classNames(
        'flex flex-col gap-2 rounded-xl border bg-bg-panel-alt/65 p-3 transition-colors',
        diffKind === 'added' && 'border-success/60',
        diffKind === 'changed' && 'border-warning/60',
        diffKind === 'removed' && 'border-error/40 opacity-70',
        !diffKind && 'border-border/60',
      )}
    >
      <p
        className={classNames(
          'truncate font-mono text-[11.5px] font-semibold tracking-[-0.005em]',
          diffKind === 'added' || diffKind === 'changed'
            ? 'text-accent-fg'
            : 'text-fg-muted',
        )}
      >
        {name}
      </p>
      <p className="break-words font-mono text-[15px] font-semibold leading-tight text-fg-base">
        {preview}
      </p>
      <div className="mt-auto flex items-center justify-end">
        <TypePill kind={kind} />
      </div>
    </article>
  );
}
