import { Clock, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConsoleEntry, ConsoleEntryType, ConsolePayloadKindFilter } from '../../types';
import { useConsoleStore } from '../../stores/consoleStore';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import type { ExecutionHistoryEntry } from '../../stores/executionHistoryStore';
import { useRunner } from '../../hooks/useRunner';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { formatExecTime } from '../../hooks/runnerOutput';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { replayHistoryEntry } from '../../utils/replayHistoryEntry';
import { trackEvent } from '../../utils/telemetry';
import { originSuppressedByMagicComment } from '../../utils/magicComments';
import { useUIStore } from '../../stores/uiStore';
import { bucketCapsuleSize } from '../../../shared/runCapsule';
import {
  extractClipboardImageFile,
  readPastedImageFile,
} from './clipboardImagePaste';
import { IconButton, Kbd, Tooltip } from '../ui/chrome';
import { EyebrowMono, MonoBadge } from '../ui/primitives';
import { ExplainErrorButton } from '../AI/ExplainErrorButton';
import { ExecutionComparisonModal } from './ExecutionComparisonModal';
import { ExecutionHistoryPopover } from './ExecutionHistoryPopover';
import { ConsoleEntryRenderer } from './ConsoleEntryRenderer';
import { OutputLineBadge } from './OutputLineBadge';
import { richKindBucket } from './richConsoleFormat';
import { useListWindow } from '../../hooks/useListWindow';

interface AnsiSpan {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

/**
 * ANSI foreground codes routed through the DS canonical console
 * tokens (declared in src/renderer/index.css under :root,.light and
 * .dark / [data-theme="dark"]). The DS spec defines six console
 * roles with theme-aware values:
 *
 *   --color-console-stdout    → ANSI 37/97 (default white text)
 *   --color-console-stderr    → ANSI 31/91 (red)
 *   --color-console-warning   → ANSI 33/93 (yellow / amber)
 *   --color-console-info      → ANSI 34/94/36/96 (blue / cyan)
 *   --color-console-prompt    → ANSI 35/95 (magenta in legacy, mapped
 *                                to the slate accent here so prompts
 *                                read as the brand color rather than
 *                                a third color outside the system)
 *   --color-console-timestamp → ANSI 30/90 (the dim greys reserved
 *                                for metadata in tools like git/npm
 *                                output)
 *
 * The bright variants (90-97) deliberately collapse to the same
 * semantic var as their non-bright sibling — the original ANSI
 * "brightness boost" was arbitrary hex and preserving it would re-
 * introduce the hardcoded-hex drift the migration fixes. If a
 * future slice wants the distinction, declare
 * --color-console-stderr-strong (etc) and split the rows.
 */
const ANSI_FG: Record<number, string> = {
  30: 'var(--color-console-timestamp)',
  31: 'var(--color-console-stderr)',
  32: 'var(--color-success-fg)',
  33: 'var(--color-console-warning)',
  34: 'var(--color-console-info)',
  35: 'var(--color-console-prompt)',
  36: 'var(--color-console-info)',
  37: 'var(--color-console-stdout)',
  90: 'var(--color-console-timestamp)',
  91: 'var(--color-console-stderr)',
  92: 'var(--color-success-fg)',
  93: 'var(--color-console-warning)',
  94: 'var(--color-console-info)',
  95: 'var(--color-console-prompt)',
  96: 'var(--color-console-info)',
  97: 'var(--color-console-stdout)',
};

function parseAnsi(raw: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let color: string | undefined;
  let bold = false;
  let dim = false;

  const push = (text: string) => {
    if (text) spans.push({ text, color, bold, dim });
  };

  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    push(raw.slice(last, match.index));
    last = match.index + match[0].length;

    const controlSequence = match[1] ?? '';
    const codes = controlSequence === '' ? [0] : controlSequence.split(';').map(Number);
    for (const code of codes) {
      if (code === 0) {
        color = undefined;
        bold = false;
        dim = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 2) {
        dim = true;
      } else if (ANSI_FG[code]) {
        color = ANSI_FG[code];
      }
    }
  }

  push(raw.slice(last));
  return spans;
}

function hasAnsi(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /\x1b\[/.test(value);
}

const TYPE_COLOR: Record<ConsoleEntryType, string> = {
  log: 'text-foreground',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-error',
  result: 'text-primary',
};

const TYPE_BADGE: Record<ConsoleEntryType, string> = {
  log: 'text-muted',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-error',
  result: 'text-primary',
};

const FILTER_TYPES: ConsoleEntryType[] = ['log', 'info', 'warn', 'error'];

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// `nextReplayTabId` and `replayTabName` moved to
// `src/renderer/utils/replayHistoryEntry.ts` so the command-palette
// per-entry Replay surface can share the same helper as this popover.

function AnsiContent({ text, className }: { text: string; className: string }) {
  if (!hasAnsi(text)) {
    return <span className={`whitespace-pre-wrap ${className}`}>{text}</span>;
  }

  const spans = parseAnsi(text);
  return (
    <span className={`whitespace-pre-wrap ${className}`}>
      {spans.map((span, index) => (
        <span
          key={index}
          style={span.color ? { color: span.color } : undefined}
          className={span.bold ? 'font-bold' : span.dim ? 'opacity-50' : undefined}
        >
          {span.text}
        </span>
      ))}
    </span>
  );
}

function sourceLineForEntry(entry: ConsoleEntry): number | null {
  const payload = Array.isArray(entry.payload) ? entry.payload : null;
  const payloadLine = payload?.find((p) => p.origin)?.origin?.line;
  if (typeof payloadLine === 'number' && Number.isFinite(payloadLine) && payloadLine > 0) {
    return payloadLine;
  }
  return typeof entry.line === 'number' && Number.isFinite(entry.line) && entry.line > 0
    ? entry.line
    : null;
}

function EntryRow({
  entry,
  showTimestamps,
  typeLabel,
  repeatCount,
  pulseTargetLine,
  originSuppressed,
}: {
  entry: ConsoleEntry;
  showTimestamps: boolean;
  typeLabel: Record<ConsoleEntryType, string>;
  /** RL-044 Slice 1B fold H — number of collapsed duplicate entries. ≥2 surfaces the ×N badge. */
  repeatCount: number;
  /** RL-044 Sub-slice G Fold G — when set and matches this row's origin/entry line, the row pulses. */
  pulseTargetLine: number | null;
  /** Per-tab `@origin off` opt-out shared with the rich-render badge path. */
  originSuppressed: boolean;
}) {
  const labelClass = TYPE_BADGE[entry.type];
  const contentClass = TYPE_COLOR[entry.type];
  // Capture the payload in a const so the rich-render branch reads
  // through narrowed types without resorting to a non-null assertion.
  const payload = Array.isArray(entry.payload) ? entry.payload : null;
  const usesRichRender = payload !== null && payload.length > 0;

  // RL-044 Sub-slice G Fold G — derive this row's source line from
  // either a payload-level origin or the legacy entry.line. The
  // pulse activates when that line matches the cursor-broadcast
  // target line. `null` target = no pulse.
  const rowSourceLine = sourceLineForEntry(entry);
  const rowOrigin = rowSourceLine !== null ? { line: rowSourceLine } : null;
  const isPulsing =
    !originSuppressed &&
    pulseTargetLine !== null &&
    rowSourceLine === pulseTargetLine;

  return (
    <div
      className="group flex gap-3 rounded-4xl px-2 py-1.5 hover:bg-surface-strong/52"
      data-testid="console-entry-row"
      data-pulsing={isPulsing ? 'true' : undefined}
    >
      {showTimestamps && (
        <span className="shrink-0 select-none tabular-nums text-muted">
          {formatTime(entry.timestamp)}
        </span>
      )}
      <span className={`shrink-0 select-none font-bold text-eyebrow leading-5 ${labelClass}`}>
        {typeLabel[entry.type]}
      </span>
      {/*
        RL-044 Sub-slice G — when the rich-render path is active the
        interactive `<OutputLineBadge>` inside `<ConsoleEntryRenderer>`
        is the canonical line affordance. The fallback branch renders
        the same button here so ansi-only rows (Go / Rust subprocess
        stdout) remain clickable instead of falling back to a static
        `L<n>` hint.
      */}
      {rowOrigin && !originSuppressed && !(usesRichRender && payload !== null) && (
        <span className="shrink-0">
          <OutputLineBadge
            origin={rowOrigin}
            language={entry.language ?? 'unknown'}
          />
        </span>
      )}
      {usesRichRender && payload !== null ? (
        <div className={contentClass}>
          <ConsoleEntryRenderer
            payloads={payload}
            fallbackText={entry.content}
            language={entry.language}
            entryLine={entry.line}
            originSuppressed={originSuppressed}
          />
        </div>
      ) : (
        <AnsiContent text={entry.content} className={contentClass} />
      )}
      {repeatCount > 1 && (
        <span
          className="shrink-0 select-none rounded-full border border-border/60 px-1.5 font-mono text-eyebrow uppercase tracking-[0.14em] text-fg-subtle"
          data-testid="console-repeat-count"
          title={`×${repeatCount}`}
        >
          ×{repeatCount}
        </span>
      )}
      {entry.executionTime !== undefined && (
        <span className="ml-auto shrink-0 select-none tabular-nums text-muted">
          {formatExecTime(entry.executionTime)}
        </span>
      )}
    </div>
  );
}

/**
 * RL-044 Slice 1B fold A — closed-enum list of payload-kind filter
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

// RL-123 / AUDIT-03 — consecutive-identical collapse moved to the console
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
    // The Errors chip historically meant warn/error rows. Slice 1C
    // added payload-level `kind: 'error'` for Python BaseException
    // values, so the same chip must hide those log rows too.
    return hidden.has(bucket) || (bucket === 'error' && hidden.has('errorish'));
  });
}

/**
 * RL-044 next slice — true when a paste should be left to its native
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

export function ConsolePanel() {
  const { t } = useTranslation();
  const { run, isRunning } = useRunner();
  const effectiveTier = useEffectiveTier();
  const canUseExecutionHistory = useEntitlement('EXECUTION_HISTORY');
  const {
    entries,
    collapsedEntries,
    activeFilters,
    hiddenPayloadKinds,
    showTimestamps,
    addEntry,
    clear,
    restore,
    toggleFilter,
    togglePayloadKindFilter,
    toggleTimestamps,
  } = useConsoleStore();
  const activeTab = useEditorStore((state) => getActiveTab(state));
  // T19 — offer "Explain this error" when the active tab's run left an error
  // entry. The shared button self-gates on LOCAL_AI, so here we only assemble
  // the error text + the code context (the active tab's source). Use only the
  // MOST RECENT error entry: buildExplainErrorRequest clips from the start, so
  // joining every error in the history would let older ones truncate away the
  // one the user just hit.
  const consoleErrorText =
    entries.filter((entry) => entry.type === 'error').at(-1)?.content ?? '';
  const canExplainConsoleError =
    consoleErrorText.length > 0 &&
    activeTab !== null &&
    activeTab.content.trim().length > 0;
  const originSuppressed = activeTab
    ? originSuppressedByMagicComment(
        activeTab.language ?? 'plaintext',
        activeTab.content
      )
    : false;
  // RL-044 next slice — paste an image into the console. The listener
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
      void readPastedImageFile(file).then((result) => {
        if (result.ok) {
          addEntry({
            type: 'log',
            content: `[image ${result.mime}]`,
            payload: [{ kind: 'image', src: result.dataUri, mime: result.mime }],
          });
          // RL-044 — a resized paste gets its own toast + telemetry status
          // (fold A) so the user knows it was downscaled and adoption is
          // measurable; `byteLength` is already the POST-resize size, so the
          // bucket reflects what actually landed (fold D).
          useUIStore.getState().pushStatusNotice({
            tone: 'success',
            messageKey: result.resized
              ? 'console.imagePaste.resized'
              : 'console.imagePaste.pasted',
          });
          void trackEvent('runtime.image_clipboard_pasted', {
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
          void trackEvent('runtime.image_clipboard_pasted', {
            status: 'rejected-oversized',
            sizeBucket: bucketCapsuleSize(result.byteLength),
          });
        } else if (result.reason === 'unreadable') {
          // RL-044 — surface the unreadable failure instead of dropping it
          // silently (it previously emitted telemetry but no user notice).
          useUIStore.getState().pushStatusNotice({
            tone: 'warning',
            messageKey: 'console.imagePaste.unreadable',
          });
          void trackEvent('runtime.image_clipboard_pasted', {
            status: 'rejected-unreadable',
            sizeBucket: bucketCapsuleSize(result.byteLength),
          });
        }
      });
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [addEntry]);
  // RL-044 Slice 1B / RL-123 — entries are already collapsed store-side
  // (consecutive identical → one ×N row, computed once per push). Here we
  // only apply the legacy type filter AND the payload-kind chip filter
  // (fold A) to those rows. Collapsed groups are homogeneous, so filtering
  // after the collapse yields the same visible set as the previous
  // filter-then-collapse. Memoised so a flooded console only re-pays the
  // filter cost when entries or filters change.
  const visibleEntries = useMemo(
    () =>
      collapsedEntries.filter(
        (row) =>
          activeFilters.has(row.entry.type) &&
          !entryFilteredByPayloadKind(row.entry, hiddenPayloadKinds)
      ),
    [collapsedEntries, activeFilters, hiddenPayloadKinds]
  );
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
  // RL-044 Sub-slice G Fold G — symmetric inverse direction. Listens
  // for `lingua-source-line-hovered` events broadcast by CodeEditor
  // when the cursor settles on a line; pulses every console row
  // whose origin.line / entry.line matches. The state holds the
  // current pulse target line plus a generation so stale pulses from
  // a previous ON-state stay hidden after the master toggle flips OFF.
  //
  // Slice 2 — the master toggle is removed; the listener is always
  // installed. The `generation` field remains to invalidate stale
  // pulses across remounts but no longer reacts to a master flip.
  const [pulse, setPulse] = useState<{ line: number; generation: number } | null>(null);
  const pulseGenerationRef = useRef(0);
  const pulseClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const clearPulseTimer = () => {
      if (pulseClearTimerRef.current) {
        clearTimeout(pulseClearTimerRef.current);
        pulseClearTimerRef.current = null;
      }
    };
    const handler = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as { line?: unknown; durationMs?: unknown } | null;
      const line = typeof detail?.line === 'number' ? detail.line : 0;
      if (!Number.isFinite(line) || line <= 0) return;
      if (!visibleSourceLinesRef.current.has(line)) {
        setPulse(null);
        clearPulseTimer();
        return;
      }
      setPulse({ line, generation: pulseGenerationRef.current });
      // RL-044 Sub-slice G.1 Fold D — adoption signal for the
      // inverse direction. Once per pulse-settle (the upstream
      // CodeEditor debounce already collapses bursts), payload is
      // `{ language }` only. Read the active tab's language directly
      // from the store at fire time so we attribute the event to the
      // tab the user is actually inside when the cursor settles —
      // not the tab that was active when the listener was registered.
      const pulseTabId = useEditorStore.getState().activeTabId;
      const pulseTab = pulseTabId
        ? useEditorStore
            .getState()
            .tabs.find((tab) => tab.id === pulseTabId)
        : undefined;
      void trackEvent('runtime.cursor_pulse_emitted', {
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
    };
    window.addEventListener('lingua-source-line-hovered', handler);
    return () => {
      window.removeEventListener('lingua-source-line-hovered', handler);
      clearPulseTimer();
    };
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const rowKeys = useMemo(
    () => visibleEntries.map((row) => row.entry.id),
    [visibleEntries]
  );
  // RL-123 Slice 2 — window the (already collapsed + filtered) rows so only
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

  // RL-123 Slice 2 — re-pin to the bottom after every commit while the user is
  // parked there (no dependency array on purpose). This covers BOTH new
  // entries and late row measurement: the windower seeds each row at an
  // estimated height, then the ResizeObserver grows the content as real
  // heights arrive, which would otherwise leave a sticky-bottom view a few
  // hundred px short of the true bottom. Reading scrollHeight on each commit
  // and pinning is the robust fix for that measure-then-grow race.
  // scrollToBottom is a no-op once already at the bottom, so this converges
  // and never loops.
  useEffect(() => {
    if (!userScrolled.current) scrollToBottom();
  });

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
    userScrolled.current = !atBottom;
  };

  const handleReplayHistoryEntry = useCallback(
    (entry: ExecutionHistoryEntry) => {
      // Gate telemetry on the actual dispatch — see App.tsx replay
      // handler for rationale (already-running short-circuit, etc.).
      const dispatched = replayHistoryEntry(entry, { isRunning, run });
      if (dispatched) {
        void trackEvent('runtime.history_replay', {
          language: entry.language,
          status: entry.status,
          surface: 'popover',
        });
      }
    },
    [isRunning, run]
  );

  // UX Sweep T2 fold B — console clear is recoverable: snapshot the
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

  const [comparison, setComparison] = useState<
    [ExecutionHistoryEntry, ExecutionHistoryEntry] | null
  >(null);

  const handleCompareEntries = useCallback(
    (older: ExecutionHistoryEntry, newer: ExecutionHistoryEntry) => {
      setComparison([older, newer]);
    },
    []
  );

  const handleCloseComparison = useCallback(() => {
    setComparison(null);
  }, []);

  const handleBlockedExecutionHistory = useCallback(() => {
    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: t('upsell.feature.executionHistory'),
    });
    void trackEvent('feature.blocked', {
      entitlement: 'execution-history',
      tier: effectiveTier,
    });
  }, [effectiveTier, t]);

  const renderedPulseLine =
    // eslint-disable-next-line react-hooks/refs -- This ref is an epoch guard, read on setting-driven renders so old pulses stay hidden after toggle-off.
    pulse?.generation === pulseGenerationRef.current
      ? pulse.line
      : null;
  const totalCount = entries.length;
  return (
    <div id="guided-tour-console" className="flex h-full flex-col bg-bg-base/65">
      {/* RL-093 Slice 3 — prominent header: eyebrow + count badge +
          inline level chips (LOG · INF · WRN · ERR · RESULT) + the
          ⌘\ keyboard hint so the toggle shortcut is discoverable. */}
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border-subtle/60 px-4">
        <div className="flex items-center gap-2.5">
          <EyebrowMono>{t('console.title')}</EyebrowMono>
          {totalCount > 0 ? <MonoBadge tone="accent">{totalCount}</MonoBadge> : null}
          <p className="text-caption text-fg-muted">{t('console.description')}</p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {FILTER_TYPES.map(type => {
            const active = activeFilters.has(type);
            const count = entries.filter(entry => entry.type === type).length;

            return (
              <Tooltip
                key={type}
                content={t('console.filters.toggle', {
                  type: t(`console.filters.type.${type}`).toLowerCase(),
                })}
              >
                <button
                  onClick={() => toggleFilter(type)}
                  data-active={active ? 'true' : 'false'}
                  className={`console-filter-chip focus-ring rounded-full border px-2.5 py-1 font-mono text-eyebrow font-bold uppercase tracking-[0.14em] transition-colors ${
                    active
                      ? `border-border-strong/90 bg-bg-panel-alt ${TYPE_BADGE[type]}`
                      : 'border-border/40 text-fg-subtle hover:border-border/80 hover:bg-bg-panel-alt/70'
                  }`}
                >
                  {typeLabel[type]}
                  {count > 0 && <span className="ml-1 opacity-70">{count}</span>}
                </button>
              </Tooltip>
            );
          })}
          <span className="mx-1 hidden h-5 w-px bg-border/60 sm:block" aria-hidden />
          {/* RL-044 Slice 1B fold A — payload-kind chip row. Default
              empty (every kind visible); clicking a chip hides that
              kind. `text` is the catch-all bucket the renderer
              dispatches for primitive / function / error payloads +
              the no-payload fallback. */}
          {PAYLOAD_KIND_CHIPS.map(kind => {
            const hidden = hiddenPayloadKinds.has(kind);
            return (
              <Tooltip key={kind} content={t(`console.rich.filterChip.${kind}`)}>
                <button
                  type="button"
                  onClick={() => togglePayloadKindFilter(kind)}
                  data-active={hidden ? 'false' : 'true'}
                  data-testid={`console-payload-chip-${kind}`}
                  className={`console-filter-chip focus-ring rounded-full border px-2.5 py-1 font-mono text-eyebrow font-bold uppercase tracking-[0.14em] transition-colors ${
                    hidden
                      ? 'border-border/40 text-fg-subtle hover:border-border/80 hover:bg-bg-panel-alt/70'
                      : 'border-border-strong/90 bg-bg-panel-alt text-foreground'
                  }`}
                >
                  {t(`console.rich.filterChip.${kind}`)}
                </button>
              </Tooltip>
            );
          })}
          <span className="mx-1 hidden h-5 w-px bg-border/60 sm:block" aria-hidden />
          <Tooltip content={t('shortcuts.item.toggleConsole.label')}>
            <span className="inline-flex items-center gap-1 text-eyebrow text-fg-subtle">
              <Kbd>⌘\</Kbd>
            </span>
          </Tooltip>
          <IconButton
            onClick={toggleTimestamps}
            active={showTimestamps}
            tooltip={
              showTimestamps
                ? t('console.actions.hideTimestamps')
                : t('console.actions.showTimestamps')
            }
          >
            <Clock size={13} />
          </IconButton>
          <ExecutionHistoryPopover
            enabled={canUseExecutionHistory}
            onBlocked={handleBlockedExecutionHistory}
            onRerun={handleReplayHistoryEntry}
            onCompare={canUseExecutionHistory ? handleCompareEntries : undefined}
          />
          {canExplainConsoleError && activeTab ? (
            <ExplainErrorButton
              errorMessage={consoleErrorText}
              code={activeTab.content}
              language={activeTab.language}
              filename={activeTab.name}
              {...(activeTab.runtimeMode
                ? { runtimeMode: activeTab.runtimeMode }
                : {})}
              onApplyFix={(newCode) => {
                // Apply & re-run: replace the tab buffer with the AI
                // suggestion (marks dirty, resets lifecycle dots) and run it
                // through the same manual-run path as the Run button.
                useEditorStore.getState().updateContent(activeTab.id, newCode);
                void run();
              }}
              testId="console-explain-error"
            />
          ) : null}
          <IconButton
            onClick={handleClearConsole}
            tooltip={t('console.actions.clear')}
            tone="danger"
          >
            <Trash2 size={13} />
          </IconButton>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-window-range={`${listWindow.startIndex}:${listWindow.endIndex}`}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-body-sm leading-6"
      >
        {visibleEntries.length === 0 ? (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center px-6 py-8 text-center">
            <p className="mb-1 text-eyebrow font-semibold uppercase tracking-[0.16em] text-muted">
              {t('console.title')}
            </p>
            <p className="font-sans text-body font-medium text-foreground">
              {entries.length === 0 ? t('console.empty.output') : t('console.empty.filtered')}
            </p>
            {entries.length === 0 ? (
              <p className="mt-1 max-w-md font-sans text-caption leading-[1.45] text-muted">
                {t('console.empty.hint')}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            {/* RL-123 Slice 2 — top spacer reserves the height of the rows
                above the window so the scrollbar matches the full list. */}
            <div aria-hidden style={{ height: listWindow.topSpacer }} />
            {visibleEntries
              .slice(listWindow.startIndex, listWindow.endIndex + 1)
              .map(({ entry, repeatCount }) => (
                // The measure wrapper feeds each row's real height back to the
                // windower; content-visibility lets the browser skip painting
                // overscan rows that drift just outside the viewport.
                <div
                  key={entry.id}
                  ref={measureRef(entry.id)}
                  className="[contain-intrinsic-size:auto_28px] [content-visibility:auto]"
                >
                  <EntryRow
                    entry={entry}
                    showTimestamps={showTimestamps}
                    typeLabel={typeLabel}
                    repeatCount={repeatCount}
                    pulseTargetLine={renderedPulseLine}
                    originSuppressed={originSuppressed}
                  />
                </div>
              ))}
            {/* Bottom spacer reserves the height of the rows below the window. */}
            <div aria-hidden style={{ height: listWindow.bottomSpacer }} />
          </>
        )}
      </div>

      <ExecutionComparisonModal entries={comparison} onClose={handleCloseComparison} />
    </div>
  );
}
