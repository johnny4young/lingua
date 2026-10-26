import { ChevronDown, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import '../../i18n/httpBuilderCatalog';
import {
  capturePath,
  countJsonNodes,
  isContainer,
  jsonEntries,
  jsonPointer,
  normalizeCapturePath,
  primitiveText,
  truncateText,
  type JsonSearch,
  type JsonSegment,
} from './httpJsonTreeModel';
import { splitForHighlight } from './httpTextHighlight';

// Past this many nodes only the top level starts open; children render only while their parent is open.
const OPEN_ALL_UP_TO = 1_000;
const TRUNCATE_AT = 120;
const PAGE = 200;

export interface HttpJsonTreeProps {
  value: unknown;
  query: string;
  search: JsonSearch;
  wrap: boolean;
  /** Normalized capture path → the variable a rule already writes. */
  captured: ReadonlyMap<string, string>;
  onCapture?: (path: string, segments: readonly JsonSegment[]) => void;
}

/** What the keyboard can do on a visible row. */
interface VisibleRow {
  pointer: string;
  parent: string | null;
  open: boolean | null;
  toggle?: () => void;
  toggleFull?: () => void;
  capture?: () => void;
}

// Syntax hues are theme variables, used inline so they add no class to the boot stylesheet.
const KEYWORD = { color: 'var(--color-syntax-keyword)' };

function valueColor(value: unknown) {
  if (typeof value === 'string') return { color: 'var(--color-syntax-string)' };
  if (typeof value === 'number') return { color: 'var(--color-syntax-number)' };
  return KEYWORD;
}

/**
 * The response body as a foldable tree: one value per line, long strings cut
 * with an expand control. One tab stop: arrows move and fold, Enter or Space
 * folds or shows a full value, C captures. Key it by response so folds reset.
 */
export function HttpJsonTree({ value, query, search, wrap, captured, onCapture }: HttpJsonTreeProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  // A fold the user set stands until a later search needs that node open to show a match.
  const [toggled, setToggled] = useState<ReadonlyMap<string, { open: boolean; search: JsonSearch }>>(new Map());
  const [fullStrings, setFullStrings] = useState<ReadonlySet<string>>(new Set());
  const [pages, setPages] = useState<ReadonlyMap<string, number>>(new Map());
  const [focused, setFocused] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const openDepth = useMemo(() => (countJsonNodes(value, OPEN_ALL_UP_TO + 1) <= OPEN_ALL_UP_TO ? Infinity : 1), [value]);

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('[data-hit="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [search]);

  const highlight = (text: string): ReactNode =>
    query.length === 0
      ? text
      : splitForHighlight(text, query).map((piece, index) =>
          piece.match ? (
            <mark key={index} data-testid="http-response-preview-body-match" className="rounded-sm bg-warning-bg text-warning-fg">
              {piece.text}
            </mark>
          ) : (
            <Fragment key={index}>{piece.text}</Fragment>
          )
        );

  const isOpen = (pointer: string, depth: number) => {
    const own = toggled.get(pointer);
    if (own && (own.search === search || !search.open.has(pointer))) return own.open;
    return search.open.has(pointer) || depth < openDepth;
  };
  const toggle = (pointer: string, open: boolean) => setToggled((current) => new Map(current).set(pointer, { open: !open, search }));

  const rows: ReactNode[] = [];
  const visible: VisibleRow[] = [];
  // Rendered rows go first into `visible`, so the active row is known before any row renders its tab stop.
  const rowElements: Array<(active: string | undefined) => ReactNode> = [];

  const addRow = (segments: JsonSegment[], node: unknown, depth: number) => {
    const pointer = jsonPointer(segments);
    const key = segments[segments.length - 1];
    const label = key === undefined ? null : typeof key === 'number' ? String(key) : key;
    const container = isContainer(node);
    const open = container && isOpen(pointer, depth);
    const entries = container ? jsonEntries(node) : [];
    const path = capturePath(segments);
    const capturedAs = path === null ? undefined : captured.get(normalizeCapturePath(path));
    const text = container ? '' : primitiveText(node);
    const long = text.length > TRUNCATE_AT;
    const full = fullStrings.has(pointer);
    const toggleFull = () =>
      setFullStrings((current) => {
        const next = new Set(current);
        if (full) next.delete(pointer);
        else next.add(pointer);
        return next;
      });
    const capture = !container && path !== null && onCapture && capturedAs === undefined ? () => onCapture(path, segments) : undefined;
    visible.push({
      pointer,
      parent: segments.length > 1 ? jsonPointer(segments.slice(0, -1)) : null,
      open: container ? open : null,
      ...(container ? { toggle: () => toggle(pointer, open) } : {}),
      ...(long ? { toggleFull } : {}),
      ...(capture ? { capture } : {}),
    });
    rowElements.push((active) => (
      <div
        key={pointer || 'root'}
        ref={(element) => {
          if (element) rowRefs.current.set(pointer, element);
          else rowRefs.current.delete(pointer);
        }}
        role="treeitem"
        aria-level={depth + 1}
        {...(container ? { 'aria-expanded': open } : {})}
        aria-selected={pointer === active}
        tabIndex={pointer === active ? 0 : -1}
        onFocus={(event) => {
          if (event.target === event.currentTarget) setFocused(pointer);
        }}
        data-testid="http-json-row"
        data-pointer={pointer}
        data-hit={search.hits.has(pointer)}
        style={{ paddingLeft: depth * 16 }}
        className={cn(
          'group flex items-start gap-1 rounded-sm pr-2 hover:bg-bg-inset/60 focus-visible:bg-bg-inset focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70',
          wrap ? 'min-w-0' : 'w-max min-w-full'
        )}
      >
        {container ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => toggle(pointer, open)}
            className="mt-[3px] inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-fg-subtle hover:text-fg-base"
          >
            {open ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className={cn(wrap ? 'min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre')}>
          {label !== null ? (
            <>
              <span {...(typeof key === 'number' ? { className: 'text-fg-subtle' } : { style: KEYWORD })}>{highlight(label)}</span>
              <span className="text-fg-subtle">: </span>
            </>
          ) : null}
          {container ? (
            <span className="text-fg-subtle">{Array.isArray(node) ? `[${entries.length}]` : `{${entries.length}}`}</span>
          ) : (
            <span style={valueColor(node)} className={cn(wrap && 'break-all')}>{highlight(long && !full ? truncateText(text, TRUNCATE_AT) : text)}</span>
          )}
        </span>
        {long ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={t(full ? 'httpWorkspace.response.tree.showLess' : 'httpWorkspace.response.tree.showFull')}
            title={t(full ? 'httpWorkspace.response.tree.showLess' : 'httpWorkspace.response.tree.showFull')}
            onClick={toggleFull}
            className="mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-fg-subtle hover:text-fg-base"
          >
            {full ? <Minimize2 size={11} aria-hidden="true" /> : <Maximize2 size={11} aria-hidden="true" />}
          </button>
        ) : null}
        {capturedAs !== undefined ? (
          <span data-testid="http-json-captured" className="mt-[3px] shrink-0 rounded-sm bg-accent-tint px-1 text-micro font-semibold leading-[14px] text-accent-fg">
            {t('httpWorkspace.response.tree.captured', { name: capturedAs })}
          </span>
        ) : capture ? (
          <button
            type="button"
            tabIndex={-1}
            data-testid="http-json-capture"
            aria-label={t('httpWorkspace.response.tree.captureAria', { path })}
            onClick={capture}
            className="mt-[3px] shrink-0 rounded-sm px-1 text-micro font-semibold leading-[14px] text-fg-subtle opacity-0 hover:bg-bg-inset hover:text-fg-base group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {t('httpWorkspace.response.tree.capture')}
          </button>
        ) : null}
      </div>
    ));
    if (open) addChildren(pointer, segments, entries, depth + 1);
  };

  const addChildren = (pointer: string, segments: JsonSegment[], entries: ReadonlyArray<readonly [JsonSegment, unknown]>, depth: number) => {
    const shown = pages.get(pointer) ?? PAGE;
    entries.forEach(([key, child], index) => {
      const childSegments = [...segments, key];
      // Past the page, a child still shows while a search hit sits inside it.
      if (index < shown || search.open.has(jsonPointer(childSegments)) || search.hits.has(jsonPointer(childSegments))) {
        addRow(childSegments, child, depth);
      }
    });
    if (entries.length > shown) {
      const more = Math.min(PAGE, entries.length - shown);
      rowElements.push(() => (
        <div key={`more:${pointer}`} role="none" style={{ paddingLeft: depth * 16 + 18 }}>
          <button
            type="button"
            data-testid="http-json-more"
            onClick={() => setPages((current) => new Map(current).set(pointer, shown + PAGE))}
            className="rounded-sm text-micro font-semibold text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            {t('httpWorkspace.response.tree.more', { count: more })}
          </button>
        </div>
      ));
    }
  };

  if (isContainer(value)) {
    const entries = jsonEntries(value);
    if (entries.length === 0) addRow([], value, 0);
    else addChildren('', [], entries, 0);
  } else {
    addRow([], value, 0);
  }

  const active = visible.some((row) => row.pointer === focused) ? (focused ?? undefined) : visible[0]?.pointer;
  for (const render of rowElements) rows.push(render(active));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const pointer = (event.target as HTMLElement).getAttribute('role') === 'treeitem' ? (event.target as HTMLElement).dataset.pointer : undefined;
    const index = visible.findIndex((row) => row.pointer === pointer);
    const row = visible[index];
    if (!row || event.metaKey || event.ctrlKey || event.altKey) return;
    let target: string | undefined;
    if (event.key === 'ArrowDown') target = visible[index + 1]?.pointer;
    else if (event.key === 'ArrowUp') target = visible[index - 1]?.pointer;
    else if (event.key === 'Home') target = visible[0]?.pointer;
    else if (event.key === 'End') target = visible[visible.length - 1]?.pointer;
    else if (event.key === 'ArrowRight' && row.open === false) row.toggle?.();
    else if (event.key === 'ArrowRight' && row.open) target = visible[index + 1]?.pointer;
    else if (event.key === 'ArrowLeft' && row.open) row.toggle?.();
    else if (event.key === 'ArrowLeft') target = row.parent ?? undefined;
    else if ((event.key === 'Enter' || event.key === ' ') && (row.toggle ?? row.toggleFull)) (row.toggle ?? row.toggleFull)?.();
    else if ((event.key === 'c' || event.key === 'C') && row.capture) row.capture();
    else return;
    event.preventDefault();
    if (target !== undefined && rowRefs.current.has(target)) {
      setFocused(target);
      rowRefs.current.get(target)?.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      role="tree"
      onKeyDown={onKeyDown}
      aria-label={t('httpWorkspace.response.tree.ariaLabel')}
      data-testid="http-response-preview-body-tree"
      data-wrap={wrap}
      className="font-mono text-caption leading-5"
    >
      {rows}
    </div>
  );
}
