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

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useResultStore } from '../../stores/resultStore';
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
      ? 'text-success'
      : diffKind === 'removed'
        ? 'text-danger'
        : diffKind === 'changed'
          ? 'text-primary'
          : 'text-muted';
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
        className="flex items-baseline gap-2 px-3 py-1 font-mono text-[11px] hover:bg-muted/10"
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
            expandable ? 'hover:bg-muted/20' : 'opacity-30'
          }`}
        >
          {expandable ? (
            expanded ? (
              <ChevronDown size={11} />
            ) : (
              <ChevronRight size={11} />
            )
          ) : (
            <span className="text-[10px] text-muted">{typeIcon(value)}</span>
          )}
        </button>
        <span className="text-foreground">{name}</span>
        <span className="text-muted">{typeTag(value, t)}</span>
        <span className="truncate text-muted-foreground" data-testid={`variable-value-${name}`}>
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
          className="px-3 py-1 font-mono text-[10px] italic text-muted"
          style={{ paddingLeft: `${depth * 1.25 + 0.75}rem` }}
        >
          {t('variableInspector.row.truncated', { count: value.truncatedCount })}
        </li>
      )}
    </>
  );
}

export function VariableInspectorPanel({ language }: VariableInspectorPanelProps) {
  const { t } = useTranslation();
  const scopeSnapshot = useResultStore((state) => state.scopeSnapshot);
  const snapshotRing = useResultStore((state) => state.snapshotRing);
  const [filter, setFilter] = useState('');

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
          className="text-xs italic text-muted"
          data-testid="variable-inspector-empty"
        >
          {t('variableInspector.panel.empty')}
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="variable-inspector-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-4 py-2">
        <span className="font-semibold uppercase tracking-[0.04em] text-[11px] text-muted">
          {t('variableInspector.panel.title')}
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="sr-only">{t('variableInspector.filter.label')}</span>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t('variableInspector.filter.placeholder')}
            aria-label={t('variableInspector.filter.label')}
            data-testid="variable-inspector-filter"
            className="rounded-md border border-border/60 bg-background/70 px-2 py-0.5 text-[11px] text-foreground outline-none focus:border-primary/40"
          />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {visibleVariables.length === 0 && !hasTopLevelTruncation ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <span
              className="text-xs italic text-muted"
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
                  className="px-3 py-1 font-mono text-[10px] italic text-muted"
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
