import { Check, Clock, ListFilter, Trash2 } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type {
  CollapsedConsoleRow,
  ConsoleEntry,
  ConsoleEntryType,
  ConsolePayloadKindFilter,
} from '../../types/console';
import { useConsoleStore } from '../../stores/consoleStore';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useTelemetry } from '../../hooks/useTelemetry';
import { originSuppressedByMagicComment } from '../../utils/magicComments';
import { useExplainPanelStore } from '../../stores/explainPanelStore';
import { useResultStore } from '../../stores/resultStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { traceShown } from '../../utils/runTraceModel';
import { describeError } from '../../utils/describeError';
import { useUIStore } from '../../stores/uiStore';
import {
  PRESENTER_CONSOLE_FONT_LIFT,
  usePresenterModeStore,
} from '../../stores/presenterModeStore';
import { bucketCapsuleSize } from '../../../shared/runCapsule';
import { extractClipboardImageFile, readPastedImageFile } from './clipboardImagePaste';
import { IconButton, Tooltip } from '../ui/chrome';
import { ICON_GLYPH } from '../ui/iconScale';
import { ContextualHint } from '../ContextualHints/ContextualHint';
import { ExplainErrorButton } from '../AI/ExplainErrorButton';
import { ConsoleEntryRow } from './ConsoleEntryRow';
import { ConsoleWaitingRow } from './ConsoleWaitingRow';
import { ConsoleLevelSegment, ConsoleSearch } from './ConsoleTapeFilters';
import {
  entryMatchesLevel,
  formatRunOffset,
  pendingFromPreviousRun,
  sourceLineForEntry,
  sourceSnippet,
} from '../../utils/consoleTape';
import { PausedConsoleSummary } from './PausedConsoleSummary';
import { richKindBucket } from './richConsoleFormat';
import { useListWindow } from '../../hooks/useListWindow';
import { useCommandListener } from '../../hooks/useCommandListener';

type TapeItem =
  | { kind: 'live'; row: CollapsedConsoleRow }
  | { kind: 'waiting' }
  | { kind: 'ghost'; row: CollapsedConsoleRow };

const WAITING_KEY = 'tape-waiting';
const GHOST_LIMIT = 4;
const TAPE_FONT_PX = 12.5;

/** A search hit past the first line would sit behind the fold, so that row opens. */
function matchIsFolded(content: string, needle: string): boolean {
  if (needle === '') return false;
  const firstBreak = content.indexOf('\n');
  return firstBreak >= 0 && !content.slice(0, firstBreak).toLowerCase().includes(needle);
}

// The trace loads only once a paid Record run of this tab exists.
const RunTrace = lazy(() => import('./RunTrace').then(module => ({ default: module.RunTrace })));

function tapeItemKey(item: TapeItem): string {
  if (item.kind === 'waiting') return WAITING_KEY;
  return item.kind === 'ghost' ? `ghost-${item.row.entry.id}` : item.row.entry.id;
}

/**
 * closed-enum list of payload-kind filter
 * chips. Mirrors the order of the rendered RichValue dispatch so the
 * chip row reads the same left-to-right as a typical row of payloads.
 */
const PAYLOAD_KIND_CHIPS: ConsolePayloadKindFilter[] = [
  'table',
  'object',
  'array',
  'mapSet',
  'text',
  'errorish',
];

// consecutive-identical collapse moved to the console
// store (computed once per push via a stable equality hash) instead of
// re-running here on every render. The panel reads `collapsedEntries` and only
// filters them; collapsed groups are homogeneous so filter-after-collapse
// matches the previous filter-then-collapse result.

/** True when the row belongs to a payload-kind bucket currently hidden. */
function entryFilteredByPayloadKind(
  entry: ConsoleEntry,
  hidden: ReadonlySet<ConsolePayloadKindFilter> | undefined
): boolean {
  if (!hidden || hidden.size === 0) return false;
  // Errorish entries (warn / error) are filtered when the special
  // `'errorish'` bucket is hidden, regardless of payload kind.
  if (hidden.has('errorish') && (entry.type === 'warn' || entry.type === 'error')) {
    return true;
  }
  if (!entry.payload || entry.payload.length === 0) {
    // No payload — show unless the user hid `'text'` (the catch-all
    // bucket the renderer dispatches for primitive / function / error
    // payloads + the no-payload fallback).
    return hidden.has('text');
  }
  return entry.payload.some(p => {
    const bucket = richKindBucket(p);
    // The Errors chip historically meant warn/error rows. Python
    // now adds payload-level `kind: 'error'` for BaseException
    // values, so the same chip must hide those log rows too.
    return hidden.has(bucket) || (bucket === 'error' && hidden.has('errorish'));
  });
}

/**
 * True when a paste should be left to its native
 * target instead of being captured as a console image. Editors and
 * form fields own their own paste semantics (Monaco code paste, env-var
 * inputs, the share/import textareas), so an image paste while one of
 * them is focused must NOT be hijacked into the console.
 */
function isEditablePasteTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  // Monaco renders into a focusable container with `.monaco-editor`.
  if (target.closest('.monaco-editor')) return true;
  return false;
}

/** `quietEmpty` drops the empty-state copy when another Dock surface explains the empty Console. */
export function ConsolePanel({ quietEmpty = false }: { quietEmpty?: boolean } = {}) {
  const { t } = useTranslation();
  const { track } = useTelemetry();
  const {
    entries,
    collapsedEntries,
    level,
    hiddenPayloadKinds,
    showTimestamps,
    currentRun,
    previousRun,
    addEntry,
    clear,
    restore,
    setLevel,
    togglePayloadKindFilter,
    toggleTimestamps,
  } = useConsoleStore(
    useShallow(state => ({
      entries: state.entries,
      collapsedEntries: state.collapsedEntries,
      level: state.level,
      hiddenPayloadKinds: state.hiddenPayloadKinds,
      showTimestamps: state.showTimestamps,
      currentRun: state.currentRun,
      previousRun: state.previousRun,
      addEntry: state.addEntry,
      clear: state.clear,
      restore: state.restore,
      setLevel: state.setLevel,
      togglePayloadKindFilter: state.togglePayloadKindFilter,
      toggleTimestamps: state.toggleTimestamps,
    }))
  );
  // Ghost and waiting rows only make sense while a streamed, non-paused run is live.
  const runLive =
    useResultStore(state => state.isManualRunning && state.manualRunMode !== 'debug') &&
    currentRun?.startedAt != null;
  const ranCode = useResultStore(state => state.ranCode);
  const [query, setQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds(previous => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const presenterActive = usePresenterModeStore(state => state.active);
  const activeTab = useEditorStore(state => getActiveTab(state));
  const traced = useTimelineStore(state => traceShown(state.recording, activeTab?.id));
  // Offer "Explain this error" when the active tab's run left an error
  // entry. The shared button self-gates on LOCAL_AI, so here we only assemble
  // the error text + the code context (the active tab's source). Use only the
  // MOST RECENT error entry: buildExplainErrorRequest clips from the start, so
  // joining every error in the history would let older ones truncate away the
  // one the user just hit.
  const consoleErrorText = entries.filter(entry => entry.type === 'error').at(-1)?.content ?? '';
  const canExplainConsoleError =
    consoleErrorText.length > 0 && activeTab !== null && activeTab.content.trim().length > 0;
  const originSuppressed = activeTab
    ? originSuppressedByMagicComment(activeTab.language ?? 'plaintext', activeTab.content)
    : false;
  // Paste an image into the console. The listener
  // lives on `document` (a read-only console row is not a focusable
  // paste target) but is scoped to the ConsolePanel lifetime via this
  // effect, and bails on editable targets so Monaco / inputs keep their
  // native paste. An image becomes an in-memory `image` rich console
  // entry (reusing `<RichValueImage>`); oversize images are dropped
  // with a toast. No bytes ever leave the renderer — telemetry carries
  // only the closed status + size bucket.
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (isEditablePasteTarget(event.target)) return;
      const data = event.clipboardData;
      if (!data) return;
      // Cheap synchronous probe: only engage when an image File is
      // present so plain-text pastes are never intercepted / delayed.
      // Reuse the helper instead of checking `items` inline so browsers
      // that only populate the legacy `files` list still work.
      const file = extractClipboardImageFile(data);
      if (!file) return;
      event.preventDefault();
      void readPastedImageFile(file).then(result => {
        if (result.ok) {
          addEntry({
            type: 'log',
            content: `[image ${result.mime}]`,
            payload: [{ kind: 'image', src: result.dataUri, mime: result.mime }],
          });
          // A resized paste gets its own toast + telemetry status
          // so the user knows it was downscaled and adoption is
          // measurable; `byteLength` is already the POST-resize size, so the
          // bucket reflects what actually landed.
          useUIStore.getState().pushStatusNotice({
            tone: 'success',
            messageKey: result.resized ? 'console.imagePaste.resized' : 'console.imagePaste.pasted',
          });
          track('runtime.image_clipboard_pasted', {
            status: result.resized ? 'resized' : 'pasted',
            sizeBucket: bucketCapsuleSize(result.byteLength),
          });
          return;
        }
        if (result.reason === 'too-large') {
          useUIStore.getState().pushStatusNotice({
            tone: 'warning',
            messageKey: 'console.imagePaste.tooLarge',
          });
          track('runtime.image_clipboard_pasted', {
            status: 'rejected-oversized',
            sizeBucket: bucketCapsuleSize(result.byteLength),
          });
        } else if (result.reason === 'unreadable') {
          // Surface the unreadable failure instead of dropping it
          // silently (it previously emitted telemetry but no user notice).
          useUIStore.getState().pushStatusNotice({
            tone: 'warning',
            messageKey: 'console.imagePaste.unreadable',
          });
          track('runtime.image_clipboard_pasted', {
            status: 'rejected-unreadable',
            sizeBucket: bucketCapsuleSize(result.byteLength),
          });
        }
      });
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [addEntry, track]);
  // Rows are collapsed store-side; collapsed groups are homogeneous, so
  // filtering after the collapse matches filter-then-collapse.
  const needle = query.trim().toLowerCase();
  const rowVisible = useCallback(
    (row: CollapsedConsoleRow) =>
      entryMatchesLevel(row.entry.type, level) &&
      !entryFilteredByPayloadKind(row.entry, hiddenPayloadKinds) &&
      (needle === '' || row.entry.content.toLowerCase().includes(needle)),
    [level, hiddenPayloadKinds, needle]
  );
  const filtering = level !== 'all' || hiddenPayloadKinds.size > 0 || needle !== '';
  const visibleEntries = useMemo(
    () => (filtering ? collapsedEntries.filter(rowVisible) : collapsedEntries),
    [filtering, collapsedEntries, rowVisible]
  );
  const pending = useMemo(
    () =>
      runLive && previousRun
        ? pendingFromPreviousRun(collapsedEntries, previousRun.rows)
        : { waitingLine: null, ghosts: [] },
    [runLive, previousRun, collapsedEntries]
  );
  const tapeItems = useMemo<TapeItem[]>(() => {
    const items: TapeItem[] = visibleEntries.map(row => ({ kind: 'live', row }));
    if (!runLive) return items;
    items.push({ kind: 'waiting' });
    // A few upcoming rows are enough; more would push live output off a pinned view.
    for (const row of pending.ghosts.filter(rowVisible).slice(0, GHOST_LIMIT)) {
      items.push({ kind: 'ghost', row });
    }
    return items;
  }, [visibleEntries, runLive, pending, rowVisible]);
  const waitingSnippet = useMemo(
    () =>
      pending.waitingLine !== null && ranCode && ranCode.tabId === currentRun?.tabId
        ? sourceSnippet(ranCode.code, pending.waitingLine)
        : null,
    [pending.waitingLine, ranCode, currentRun?.tabId]
  );
  const runStartedAt = currentRun?.startedAt ?? null;
  const visibleSourceLines = useMemo(() => {
    const lines = new Set<number>();
    if (originSuppressed) return lines;
    for (const { entry } of visibleEntries) {
      const sourceLine = sourceLineForEntry(entry);
      if (sourceLine !== null) lines.add(sourceLine);
    }
    return lines;
  }, [originSuppressed, visibleEntries]);
  const visibleSourceLinesRef = useRef(visibleSourceLines);
  useEffect(() => {
    visibleSourceLinesRef.current = visibleSourceLines;
  }, [visibleSourceLines]);
  // Symmetric inverse direction. Listens
  // for editor.sourceLineHovered commands emitted by CodeEditor
  // when the cursor settles on a line; pulses every console row
  // whose origin.line / entry.line matches. The state holds the
  // current pulse target line plus a generation so stale pulses from
  // a previous ON-state stay hidden after the master toggle flips OFF.
  //
  // The master toggle is removed; the listener is always
  // installed. The `generation` field remains to invalidate stale
  // pulses across remounts but no longer reacts to a master flip.
  const [pulse, setPulse] = useState<{ line: number; generation: number } | null>(null);
  const pulseGenerationRef = useRef(0);
  const pulseClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPulseTimer = useCallback(() => {
    if (pulseClearTimerRef.current) {
      clearTimeout(pulseClearTimerRef.current);
      pulseClearTimerRef.current = null;
    }
  }, []);
  useCommandListener('editor.sourceLineHovered', detail => {
    const { line } = detail;
    if (!Number.isFinite(line) || line <= 0) return;
    if (!visibleSourceLinesRef.current.has(line)) {
      setPulse(null);
      clearPulseTimer();
      return;
    }
    setPulse({ line, generation: pulseGenerationRef.current });
    // Adoption signal for the
    // inverse direction. Once per pulse-settle (the upstream
    // CodeEditor debounce already collapses bursts), payload is
    // `{ language }` only. Read the active tab's language directly
    // from the store at fire time so we attribute the event to the
    // tab the user is actually inside when the cursor settles —
    // not the tab that was active when the listener was registered.
    const pulseTabId = useEditorStore.getState().activeTabId;
    const pulseTab = pulseTabId
      ? useEditorStore.getState().tabs.find(tab => tab.id === pulseTabId)
      : undefined;
    track('runtime.cursor_pulse_emitted', {
      language: pulseTab?.language ?? 'unknown',
    });
    clearPulseTimer();
    const duration =
      typeof detail?.durationMs === 'number' && detail.durationMs > 0
        ? Math.min(detail.durationMs, 10_000)
        : 1500;
    pulseClearTimerRef.current = setTimeout(() => {
      setPulse(null);
      pulseClearTimerRef.current = null;
    }, duration + 50);
  });
  useEffect(
    () => () => {
      clearPulseTimer();
    },
    [clearPulseTimer]
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const lastPinned = useRef<{ top: number; height: number; viewport: number } | null>(null);
  const rowKeys = useMemo(() => tapeItems.map(tapeItemKey), [tapeItems]);
  // Window the (already collapsed + filtered) rows so only
  // the viewport band mounts. Off-window rows unmount, releasing their
  // RichValueChart Vega canvases for free.
  const { listWindow, measureRef, scrollToBottom } = useListWindow({
    scrollRef,
    keys: rowKeys,
  });
  const typeLabel: Record<ConsoleEntryType, string> = {
    log: t('console.filters.type.log'),
    info: t('console.filters.type.info'),
    warn: t('console.filters.type.warn'),
    error: t('console.filters.type.error'),
    result: t('console.filters.type.result'),
  };

  // re-pin to the bottom after every commit while the user is
  // parked there (no dependency array on purpose). This covers BOTH new
  // entries and late row measurement: the windower seeds each row at an
  // estimated height, then the ResizeObserver grows the content as real
  // heights arrive, which would otherwise leave a sticky-bottom view a few
  // hundred px short of the true bottom. Reading scrollHeight on each commit
  // and pinning is the robust fix for that measure-then-grow race.
  // scrollToBottom is a no-op once already at the bottom, so this converges
  // and never loops. A scroll event can arrive after a commit triggered by a
  // new row. Compare live geometry with our last pin so a manual move away
  // wins even before handleScroll has recorded it.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || userScrolled.current) return;
    const previous = lastPinned.current;
    if (
      previous &&
      element.scrollTop < previous.top - 2 &&
      element.scrollHeight >= previous.height - 2 &&
      Math.abs(element.clientHeight - previous.viewport) < 2
    ) {
      userScrolled.current = true;
      return;
    }
    scrollToBottom();
    lastPinned.current = {
      top: element.scrollTop,
      height: element.scrollHeight,
      viewport: element.clientHeight,
    };
  });

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
    userScrolled.current = !atBottom;
    if (atBottom) {
      lastPinned.current = {
        top: element.scrollTop,
        height: element.scrollHeight,
        viewport: element.clientHeight,
      };
    }
  };

  // accessibility pass — console clear is recoverable: snapshot the
  // cleared state, clear, then offer an Undo toast that restores it.
  // Skip the toast when there was nothing to clear so an empty console
  // never surfaces a meaningless Undo.
  const handleClearConsole = useCallback(() => {
    const state = useConsoleStore.getState();
    if (state.entries.length === 0) {
      clear();
      return;
    }
    const snapshot = {
      entries: state.entries,
      collapsedEntries: state.collapsedEntries,
      hiddenPayloadKinds: state.hiddenPayloadKinds,
    };
    const clearedCount = snapshot.entries.length;
    clear();
    useUIStore.getState().pushStatusNotice({
      tone: 'info',
      messageKey: 'console.notice.cleared',
      values: { count: clearedCount },
      actions: [
        {
          labelKey: 'common.undo',
          onClick: () => restore(snapshot),
        },
      ],
    });
  }, [clear, restore]);

  const renderedPulseLine =
    // eslint-disable-next-line react-hooks/refs -- This ref is an epoch guard, read on setting-driven renders so old pulses stay hidden after toggle-off.
    pulse?.generation === pulseGenerationRef.current ? pulse.line : null;
  // Payload-kind menu. Same dismissal hygiene as the other lightweight
  // dropdowns in the shell: outside mousedown or Escape closes it.
  const [payloadMenuOpen, setPayloadMenuOpen] = useState(false);
  const payloadMenuRef = useRef<HTMLDivElement>(null);
  const payloadPanelRef = useRef<HTMLDivElement>(null);
  const payloadTriggerRef = useRef<HTMLButtonElement>(null);

  // The panel is portaled to <body> and positioned by hand because every
  // in-tree placement is clipped: the console sits inside a chain of
  // overflow-hidden ancestors whose innermost box is barely taller than the
  // filter row itself, so neither `bottom-full` nor `top-full` survives it.
  // Prefer opening downward and flip up only when the viewport is too short.
  //
  // The measured position is written straight to the node rather than held in
  // state: it is derived from layout, not a source of truth, and routing it
  // through setState would schedule a second render for every open.
  useLayoutEffect(() => {
    if (!payloadMenuOpen) return;
    const trigger = payloadTriggerRef.current;
    const panel = payloadPanelRef.current;
    if (!trigger || !panel) return;
    const place = () => {
      const rect = trigger.getBoundingClientRect();
      const gap = 6;
      const { offsetHeight: height, offsetWidth: width } = panel;
      const roomBelow = window.innerHeight - rect.bottom - gap;
      panel.style.top = `${roomBelow >= height ? rect.bottom + gap : Math.max(gap, rect.top - gap - height)}px`;
      panel.style.left = `${Math.max(gap, Math.min(rect.right - width, window.innerWidth - width - gap))}px`;
      panel.style.visibility = 'visible';
    };
    place();
    // Resizing the window or dragging the panel splitter moves the trigger out
    // from under a panel that would otherwise stay pinned where it opened.
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [payloadMenuOpen]);

  useEffect(() => {
    if (!payloadMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // The panel lives in a portal, so it is NOT a descendant of the trigger
      // wrapper; both roots have to be consulted or clicking a row closes it.
      if (payloadMenuRef.current?.contains(target)) return;
      if (payloadPanelRef.current?.contains(target)) return;
      setPayloadMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPayloadMenuOpen(false);
      // Escape unmounts the panel; without this the focused row disappears
      // and focus falls back to <body>, stranding keyboard users.
      payloadTriggerRef.current?.focus();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [payloadMenuOpen]);

  return (
    <div id="guided-tour-console" className="flex h-full flex-col bg-bg-base/65">
      {/* Toolbar only: the dock tab above names the panel and carries the
          count, and its hide button carries the shortcut. */}
      <div className="console-toolbar flex min-h-9 items-center justify-between gap-3 border-b border-border-subtle/60 px-4">
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5 py-1">
          <ConsoleLevelSegment entries={entries} level={level} onSelect={setLevel} />
          <ConsoleSearch query={query} onQueryChange={setQuery} />
          <span className="mx-1 hidden h-5 w-px bg-border/60 sm:block" aria-hidden />
          {/* Payload-kind filters live in a menu rather than a second chip
              row. Two reasons. Width: the ten chips took 48% of a 1280px
              viewport and clipped the trailing actions at 1024px. Meaning:
              these chips are opt-OUT (every kind starts visible, clicking
              hides one) while the severity chips beside them are opt-IN, so
              two rows that looked identical behaved inversely. A menu of
              checked items states "shown" without relying on chip styling. */}
          <div ref={payloadMenuRef} className="relative">
            <Tooltip content={t('console.rich.payloadKinds.tooltip')}>
              <button
                ref={payloadTriggerRef}
                type="button"
                aria-expanded={payloadMenuOpen}
                aria-controls="console-payload-kinds-panel"
                data-testid="console-payload-kinds-menu"
                onClick={() => setPayloadMenuOpen(open => !open)}
                className={`console-filter-chip focus-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-eyebrow font-bold uppercase tracking-[0.14em] transition-colors ${
                  hiddenPayloadKinds.size > 0
                    ? 'border-border-strong/90 bg-bg-panel-alt text-foreground'
                    : 'border-border/40 text-fg-subtle hover:border-border/80 hover:bg-bg-panel-alt/70'
                }`}
              >
                <ListFilter size={14} aria-hidden />
                <span className="console-types-label">{t('console.rich.payloadKinds.label')}</span>
                {hiddenPayloadKinds.size > 0 ? (
                  <span className="opacity-70">{hiddenPayloadKinds.size}</span>
                ) : null}
              </button>
            </Tooltip>
            {/* Disclosure + checkbox semantics, deliberately NOT role=menu:
                role=menu obliges the full Arrow/Home/End roving-focus
                contract, and these rows are independent toggles rather than a
                command list. Tab order plus Space is the right model here. */}
            {payloadMenuOpen
              ? createPortal(
                  <div
                    ref={payloadPanelRef}
                    id="console-payload-kinds-panel"
                    className="dropdown-rich fixed z-[1000] w-[220px]"
                    // Hidden until the layout effect measures and places it, so
                    // the panel never paints at 0,0 first.
                    style={{ top: 0, left: 0, visibility: 'hidden' }}
                    role="group"
                    aria-label={t('console.rich.payloadKinds.tooltip')}
                  >
                    {PAYLOAD_KIND_CHIPS.map(kind => {
                      const hidden = hiddenPayloadKinds.has(kind);
                      return (
                        <button
                          key={kind}
                          type="button"
                          role="checkbox"
                          aria-checked={!hidden}
                          data-testid={`console-payload-chip-${kind}`}
                          onClick={() => togglePayloadKindFilter(kind)}
                          className="dropdown-rich-row focus-ring w-full"
                        >
                          <span className="row-icon inline-flex w-4 justify-center">
                            {hidden ? null : <Check size={14} aria-hidden />}
                          </span>
                          <span className="row-label">{t(`console.rich.filterChip.${kind}`)}</span>
                        </button>
                      );
                    })}
                  </div>,
                  document.body
                )
              : null}
          </div>
          <span className="mx-1 hidden h-5 w-px bg-border/60 sm:block" aria-hidden />
          <IconButton
            onClick={toggleTimestamps}
            active={showTimestamps}
            tooltip={
              showTimestamps
                ? t('console.actions.hideTimestamps')
                : t('console.actions.showTimestamps')
            }
          >
            <Clock size={ICON_GLYPH.md} />
          </IconButton>
          {canExplainConsoleError && activeTab ? (
            <ExplainErrorButton
              errorMessage={consoleErrorText}
              code={activeTab.content}
              language={activeTab.language}
              filename={activeTab.name}
              {...(activeTab.runtimeMode ? { runtimeMode: activeTab.runtimeMode } : {})}
              onOpen={() => {
                const error = useResultStore.getState().error;
                useExplainPanelStore.getState().open({
                  tabId: activeTab.id,
                  // Same text as the failing-line action, so both reach the same thread.
                  errorMessage: error ? describeError(error).full : consoleErrorText,
                  line: error?.line ?? null,
                  column: error?.column ?? null,
                });
              }}
              testId="console-explain-error"
            />
          ) : null}
          <IconButton
            onClick={handleClearConsole}
            tooltip={t('console.actions.clear')}
            tone="danger"
          >
            <Trash2 size={ICON_GLYPH.md} />
          </IconButton>
        </div>
      </div>

      <div className="@container flex min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-window-range={`${listWindow.startIndex}:${listWindow.endIndex}`}
        className="min-w-0 flex-1 overflow-y-auto pb-2 pt-2.5 font-mono"
        style={{
          // Presenter mode lifts from the tape size itself, so the promised delta holds.
          fontSize: `${TAPE_FONT_PX + (presenterActive ? PRESENTER_CONSOLE_FONT_LIFT : 0)}px`,
        }}
      >
        {tapeItems.length === 0 && quietEmpty && entries.length === 0 ? null : tapeItems.length === 0 ? (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center px-6 py-16 text-center">
            <p className="font-sans text-body font-medium text-foreground">
              {entries.length === 0 ? t('console.empty.output') : t('console.empty.filtered')}
            </p>
            {entries.length === 0 ? <ContextualHint surface="console" className="mt-4" /> : null}
          </div>
        ) : (
          <>
            {/* Top spacer reserves the height of the rows
                above the window so the scrollbar matches the full list. */}
            <div aria-hidden style={{ height: listWindow.topSpacer }} />
            {tapeItems.slice(listWindow.startIndex, listWindow.endIndex + 1).map(item => {
              const key = tapeItemKey(item);
              // The measure wrapper feeds each row's real height back to the
              // windower; content-visibility skips painting overscan rows.
              return (
                <div
                  key={key}
                  ref={measureRef(key)}
                  className="[contain-intrinsic-size:auto_22px] [content-visibility:auto]"
                >
                  {item.kind === 'waiting' ? (
                    <ConsoleWaitingRow line={pending.waitingLine} snippet={waitingSnippet} />
                  ) : (
                    <ConsoleEntryRow
                      entry={item.row.entry}
                      runOffset={
                        item.kind === 'live' && runStartedAt !== null
                          ? formatRunOffset(item.row.entry.timestamp, runStartedAt)
                          : null
                      }
                      showTimestamps={showTimestamps}
                      typeLabel={typeLabel}
                      repeatCount={item.row.repeatCount}
                      sourceLine={sourceLineForEntry(item.row.entry)}
                      pulseTargetLine={renderedPulseLine}
                      originSuppressed={originSuppressed}
                      expanded={
                        expandedIds.has(item.row.entry.id) || matchIsFolded(item.row.entry.content, needle)
                      }
                      onToggleExpanded={toggleExpanded}
                      ghostRun={item.kind === 'ghost' ? previousRun?.number : undefined}
                    />
                  )}
                </div>
              );
            })}
            {/* Bottom spacer reserves the height of the rows below the window. */}
            <div aria-hidden style={{ height: listWindow.bottomSpacer }} />
          </>
        )}
      </div>
      {traced ? (
        <div className="hidden w-[54%] min-w-[380px] max-w-[848px] shrink-0 border-l border-border-subtle/60 @3xl:block">
          <Suspense fallback={null}>
            <RunTrace />
          </Suspense>
        </div>
      ) : null}
      </div>
      <PausedConsoleSummary />

    </div>
  );
}
