/**
 * RL-093 Slice 2 — Floating, draggable action pill.
 *
 * Replaces the centre cluster of the chrome toolbar (Run+Debug split,
 * Workflow segment, Runtime selector, New-file menu) with a single
 * floating pill positioned over the editor. The user can drag it
 * anywhere; the position persists across reloads via `useDraggable`'s
 * localStorage backing.
 *
 * Segments (left → right):
 *
 *   1. Drag handle   — ⋮⋮ button, the only region that initiates drag.
 *   2. Lang chip     — language pill + label + chevron. Click to
 *                      switch active tab's language (creates a new
 *                      tab in that language to preserve current code).
 *   3. Runtime chip  — Worker / Node / Browser preview. Only rendered
 *                      when the language has runtime modes (JS/TS).
 *   4. Run button    — split: left fires run/debug/scratchpad; chevron
 *                      opens the workflow dropdown. Pulses with
 *                      `run-pulse` while `isRunning === true`.
 *   5. History dots  — last 5 runs from `executionHistoryStore`.
 *   6. Autosave dot  — static green indicator (Lingua saves on every
 *                      keystroke; the segment exists for design
 *                      parity until a real "autosave" setting lands).
 *
 * The pill cohabits with the existing Toolbar.tsx — when this is
 * mounted the Toolbar trims its centre cluster (sees prop
 * `showFloatingPill`). No store logic is duplicated; everything reads
 * from the same Zustand stores the Toolbar uses.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  BookOpenText,
  Bug,
  Braces,
  ChevronDown,
  Command,
  FileSearch,
  GraduationCap,
  GripVertical,
  Loader2,
  Play,
  Settings as SettingsIcon,
  Sparkles,
  Terminal,
  Globe,
  Package,
  Wrench,
} from 'lucide-react';
import { getActiveTab, useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useRunner } from '../../hooks/useRunner';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useLessonProgressStore } from '../../stores/lessonProgressStore';
import { useUIStore } from '../../stores/uiStore';
import { useDraggable } from '../../hooks/useDraggable';
import { Kbd, Tooltip } from '../ui/chrome';
import { MonoBadge, RunHistoryDots, type RunHistoryEntry } from '../ui/primitives';
import { cn } from '../../utils/cn';
import type { Language } from '../../types';
import { languageHasRuntimeModes } from '../../../shared/runtimeModes';
import type { WorkflowMode } from '../../../shared/workflowMode';
import {
  executionModeForLanguage,
  languageCapabilityBadgeKey,
  languageBadgeTone,
  languageLabel,
  languageSupportsDebugger,
} from '../../utils/languageMeta';
import { useEffectiveTier } from '../../hooks/useEntitlement';
import { isLanguageAllowed } from '../../../shared/entitlements';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { LANGUAGE_PACKS } from '../../../shared/languagePacks';

const LANGUAGE_LIST: Language[] = LANGUAGE_PACKS.filter(
  (pack) =>
    (pack.execution === 'run' || pack.execution === 'compile') &&
    pack.templateIds.length > 0
).map((pack) => pack.id as Language);
const FULL_PILL_WIDTH = 820;
const COMPACT_PILL_WIDTH = 560;
const RIGHT_EDITOR_HEADER_RESERVE = 420;

function LanguageChip({
  language,
  size = 'pill',
}: {
  language: Language;
  size?: 'pill' | 'menu';
}) {
  const meta = languageBadgeTone(language);
  const dimension = size === 'menu' ? 22 : 18;
  // Most badge codes are 2–3 glyphs (JS, TS, GO, PY, SQL). A 4-glyph
  // code (e.g. HTTP) overflows the fixed square at the base 9px size,
  // so tighten the type for long codes instead of widening the box —
  // keeps every chip a uniform square. Length-driven so it covers any
  // future 4-char code, not just HTTP.
  const isLongCode = meta.code.length >= 4;
  const baseFont = size === 'menu' ? 9.5 : 9;
  return (
    <span
      className="inline-flex items-center justify-center font-mono font-bold"
      style={{
        width: dimension,
        height: dimension,
        borderRadius: size === 'menu' ? 5 : 4,
        fontSize: isLongCode ? baseFont - 1.5 : baseFont,
        letterSpacing: isLongCode ? '0' : '0.04em',
        background: meta.background,
        color: meta.foreground,
      }}
      aria-hidden
    >
      {meta.code}
    </span>
  );
}

// RL-093 — workflow and runtime are TWO orthogonal axes:
//   workflowMode: scratchpad | run | debug   — what kind of execution
//   runtimeMode : worker | node | browser-preview — what engine
//
// The pill exposes them as two separate chips so the user never sees
// a misleading "two Actual rows" state. The Runtime chip is only
// rendered when the language has runtime modes (JS/TS today).
function workflowChipLabel(
  t: (k: string) => string,
  workflowMode: WorkflowMode | undefined,
): { icon: ReactNode; label: string } {
  if (workflowMode === 'debug') {
    return { icon: <Bug size={11} />, label: t('toolbar.debug.label') };
  }
  if (workflowMode === 'scratchpad') {
    return { icon: <Sparkles size={11} />, label: t('workflowMode.scratchpad.label') };
  }
  return { icon: <Play size={11} />, label: t('actionPill.run') };
}

function runtimeChipLabel(
  runtimeMode: string | undefined,
): { icon: ReactNode; label: string } {
  if (runtimeMode === 'node') return { icon: <Terminal size={11} />, label: 'Node' };
  if (runtimeMode === 'browser-preview')
    return { icon: <Globe size={11} />, label: 'Browser' };
  return { icon: <Package size={11} />, label: 'Worker' };
}

interface FloatingActionPillProps {
  onOpenPalette?: () => void;
  onOpenQuickOpen?: () => void;
  onOpenSnippets?: () => void;
  onOpenUtilities?: () => void;
  /**
   * RL-039 Slice B fold G — Opens the Recipes overlay (`Mod+Alt+L`).
   * When provided, the pill mounts a graduation-cap icon button +
   * progress badge between Utilities and Settings.
   */
  onOpenRecipes?: () => void;
  utilitiesOpen?: boolean;
  /**
   * Optional callback invoked when the user clicks the trailing
   * Settings cog (also reachable via `⌘,`). The cog is hidden when
   * no callback is provided, matching the design's "Settings shortcut
   * lives in the chrome bar" alternative.
   */
  onOpenSettings?: () => void;
}

export function FloatingActionPill({
  onOpenPalette,
  onOpenQuickOpen,
  onOpenSnippets,
  onOpenUtilities,
  onOpenRecipes,
  utilitiesOpen = false,
  onOpenSettings,
}: FloatingActionPillProps) {
  const { t } = useTranslation();
  const tabCount = useEditorStore((s) => s.tabs.length);
  const addTab = useEditorStore((s) => s.addTab);
  const addNotebookTab = useEditorStore((s) => s.addNotebookTab);
  const setTabRuntimeMode = useEditorStore((s) => s.setTabRuntimeMode);
  const setTabWorkflowMode = useEditorStore((s) => s.setTabWorkflowMode);
  const { run, stop, isRunning, isInitializing } = useRunner();
  // RL-093 — Lingua doesn't currently surface an "autosave" setting; the
  // pill shows a static green status dot per the design intent (the
  // editor saves locally on every keystroke today).
  const autoSaveEnabled = true;
  // Slice 2 — debugger is baseline; the Settings master toggle is gone.
  const debuggerEnabled = true;
  const historyEntries = useExecutionHistoryStore((s) => s.entries);
  const effectiveTier = useEffectiveTier();
  const actionPillPosition = useUIStore((s) => s.actionPillPosition);
  const setActionPillPosition = useUIStore((s) => s.setActionPillPosition);
  const floatingPositionsResetRevision = useUIStore(
    (s) => s.floatingPositionsResetRevision,
  );
  const wasDraggingRef = useRef(false);
  // Local UI state for the dropdowns. Declare before effects that close menus
  // during drag so React Compiler can prove the closure is initialized.
  const [openMenu, setOpenMenu] = useState<
    'lang' | 'workflow' | 'runtime' | 'run' | null
  >(null);

  const activeTab = useActiveTab();
  const isNotebookTab = activeTab?.kind === 'notebook';
  const language = activeTab?.language ?? 'javascript';
  const supportsDebug = languageSupportsDebugger(language);
  const supportsRuntimeModes = languageHasRuntimeModes(language);
  const executionMode = executionModeForLanguage(language);
  const isWebBuild =
    typeof window !== 'undefined' && window.lingua?.platform === 'web';
  const languageIsDesktopOnly =
    languageCapabilityBadgeKey(language) === 'language.capability.desktopOnly';
  const proLanguageGate =
    executionMode === 'run' && !isLanguageAllowed(effectiveTier, language);
  const desktopOnlyGate =
    !proLanguageGate && isWebBuild && languageIsDesktopOnly && executionMode === 'run';
  const estimatedPillWidth =
    typeof window !== 'undefined' && window.innerWidth >= 1500
      ? FULL_PILL_WIDTH
      : COMPACT_PILL_WIDTH;

  // Default position computed synchronously so the pill renders in its
  // final slot on first paint (no flicker from a measure useEffect).
  // Handoff position: AppChrome is 36px tall; 44px keeps the pill in
  // the same visual row as editor details while leaving an 8px drag gap.
  const defaultPos = useMemo(() => {
    if (typeof window === 'undefined') return { x: 16, y: 44 };
    const centeredX = Math.floor((window.innerWidth - estimatedPillWidth) / 2);
    const rightSafeX = window.innerWidth - estimatedPillWidth - RIGHT_EDITOR_HEADER_RESERVE;
    return {
      x: Math.max(16, Math.min(centeredX, rightSafeX)),
      y: 44,
    };
  }, [estimatedPillWidth]);

  const { position, handleProps, isDragging } = useDraggable({
    storageKey: 'lingua-ui:action-pill-pos:v4',
    defaultPosition: actionPillPosition ?? defaultPos,
    size: { width: estimatedPillWidth, height: 42 },
    viewportMargin: 8,
    resetSignal: floatingPositionsResetRevision,
  });
  const dragHandleProps = useMemo(
    () => ({
      ...handleProps,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        setOpenMenu(null);
        handleProps.onPointerDown?.(event);
      },
    }),
    [handleProps],
  );

  // Mirror committed drags to uiStore so external resets can clear it
  // later without writing the default position on first render.
  useEffect(() => {
    if (isDragging) {
      wasDraggingRef.current = true;
      return;
    }
    if (!wasDraggingRef.current) return;
    wasDraggingRef.current = false;
    setActionPillPosition(position);
  }, [isDragging, position, setActionPillPosition]);

  const pillRef = useRef<HTMLDivElement | null>(null);

  // Close any open dropdown on outside click or Escape.
  useEffect(() => {
    if (!openMenu) return;
    function onClickAway(e: MouseEvent) {
      if (!pillRef.current) return;
      if (!pillRef.current.contains(e.target as Node)) setOpenMenu(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenMenu(null);
    }
    window.addEventListener('mousedown', onClickAway);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onClickAway);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  // History → last 5 runs (newest right).
  const history = useMemo<readonly RunHistoryEntry[]>(() => {
    const list = historyEntries
      .slice(-5)
      .map<RunHistoryEntry>((entry) => ({
        status: entry.status === 'ok' ? 'ok' : 'err',
        ms: entry.durationMs ?? undefined,
      }));
    while (list.length < 5) list.unshift({ status: 'pending' });
    return list;
  }, [historyEntries]);
  const lastRunMs = historyEntries.length > 0
    ? historyEntries[historyEntries.length - 1]?.durationMs ?? null
    : null;

  // -------- Handlers
  const handleLanguagePick = (lang: Language) => {
    setOpenMenu(null);
    if (!isLanguageAllowed(effectiveTier, lang)) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: t('upsell.feature.languagePack'),
      });
      return;
    }
    const tab = createDefaultTab(lang);
    addTab(tab);
  };

  // RL-093 Slice 3 — the unified mode-aware action button fires the
  // current workflow's primary action. `run` and `debug` mode both
  // call the runner (with the debug flag for the latter). In
  // `scratchpad` mode the runner is normally driven by edit-time
  // auto-run, but clicking the button still triggers a manual rerun
  // so the user has a one-click force-rerun affordance when they
  // want to re-evaluate without typing first. When `isRunning`,
  // clicks always stop the active task regardless of workflow.
  const currentWorkflow: WorkflowMode = activeTab?.workflowMode ?? 'run';
  const handleRunClick = () => {
    if (isRunning) {
      stop();
      return;
    }
    if (currentWorkflow === 'debug') {
      void run({ debug: true });
      return;
    }
    void run();
  };

  // RL-093 follow-up — Run stays clickable even with no tab so the
  // primary surface keeps the workflow-menu reachable (the chevron
  // next to Run is how the user picks scratchpad / run / debug
  // upfront). The Lang / Runtime / Workflow chip handlers below
  // auto-create a tab when none exists so the chip always advances
  // the user instead of silently no-op'ing — that's the
  // "click no funciona" report from review.
  const runDisabled =
    executionMode === 'view' || isNotebookTab || desktopOnlyGate || proLanguageGate;
  const runDisabledTooltip = proLanguageGate
    ? t('toolbar.run.proOnlyTooltip')
    : desktopOnlyGate
      ? t('toolbar.run.desktopOnlyTooltip')
      : undefined;
  const noActiveTab = tabCount === 0;
  const ensureTabForLanguage = (lang: Language) => {
    const existing = getActiveTab(useEditorStore.getState());
    if (existing) return existing;
    const fresh = createDefaultTab(lang);
    addTab(fresh);
    return fresh;
  };

  const workflowChip = workflowChipLabel(t, activeTab?.workflowMode);
  const runtimeChip = runtimeChipLabel(activeTab?.runtimeMode);
  const cssVars = { '--floating-pill-x': `${position.x}px`, '--floating-pill-y': `${position.y}px` } as React.CSSProperties;
  const hasToolbarActions = Boolean(
    onOpenQuickOpen || onOpenPalette || onOpenSnippets || onOpenUtilities || onOpenRecipes
  );

  // Render via portal so the pill is positioned relative to the viewport,
  // not constrained to whatever ancestor establishes a containing block.
  const container = typeof document !== 'undefined' ? document.body : null;
  if (!container) return null;

  return createPortal(
    // RL-093 review — only the drag handle gets the grab cursor.
    // The previous version applied `cursor-grab`/`cursor-grabbing` to
    // the whole pill div, which made every chip (Lang, Workflow, Run,
    // …) look draggable when only the leading handle is.
    <div
      ref={pillRef}
      data-testid="floating-action-pill"
      className={cn('action-pill fixed', isDragging && 'select-none')}
      style={{
        left: 'var(--floating-pill-x)',
        top: 'var(--floating-pill-y)',
        zIndex: 40,
        ...cssVars,
      }}
    >
      {/* Drag handle */}
      <button
        type="button"
        aria-label={t('actionPill.dragHandle')}
        className="action-pill-drag-handle ml-0.5 inline-flex items-center justify-center rounded-full text-fg-subtle hover:text-fg-base"
        {...dragHandleProps}
      >
        <GripVertical size={12} aria-hidden />
      </button>

      {/* Runtime control — language · runtime · run read as ONE
          structured segmented group (Signal-Slate RuntimeSelector
          recipe): a single inset shell (rounded-lg border-border-subtle
          bg-bg-inset) with hairline `.action-pill-divider` separators
          between segments and a GREEN run segment at the end. The shell
          is NOT `overflow-hidden` so the run group's resting glow + the
          `data-running` run-pulse box-shadow still escape its bounds.
          The drag handle, meta cluster, command actions, and settings
          cog stay OUTSIDE this group — they are not part of the runtime
          control. */}
      <div className="action-pill-runtime-group inline-flex items-stretch self-stretch rounded-lg border border-border-subtle bg-bg-inset">
        {/* 1. Language chip */}
        <div className="relative inline-flex items-stretch">
        <button
          type="button"
          className="action-pill-segment action-pill-lang rounded-l-lg rounded-r-none"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'lang'}
          onClick={() => setOpenMenu(openMenu === 'lang' ? null : 'lang')}
          data-testid="action-pill-lang"
        >
          <LanguageChip language={language} />
          <span>{languageLabel(language)}</span>
          <ChevronDown size={10} className="text-fg-subtle" aria-hidden />
        </button>
        {openMenu === 'lang' ? (
          <div className="dropdown-rich absolute left-0 top-[calc(100%+0.4rem)] z-50 w-[280px]" role="menu">
            {LANGUAGE_LIST.map((lang) => {
              const isPro = !isLanguageAllowed(effectiveTier, lang);
              const isDesktopOnly =
                isWebBuild &&
                languageCapabilityBadgeKey(lang) === 'language.capability.desktopOnly';
              return (
                <button
                  key={lang}
                  type="button"
                  role="menuitem"
                  className="dropdown-rich-row w-full"
                  onClick={() => handleLanguagePick(lang)}
                >
                  <LanguageChip language={lang} size="menu" />
                  <span className="row-label self-center">{languageLabel(lang)}</span>
                  {isPro ? (
                    <MonoBadge tone="accent">{t('actionPill.badgePro')}</MonoBadge>
                  ) : isDesktopOnly ? (
                    <MonoBadge tone="accent">{t('language.capability.desktopOnly')}</MonoBadge>
                  ) : (
                    <span />
                  )}
                </button>
              );
            })}
            <div
              className="my-1 h-px bg-border/40"
              role="separator"
              aria-hidden="true"
            />
            <button
              type="button"
              role="menuitem"
              className="dropdown-rich-row w-full"
              data-testid="action-pill-new-notebook"
              onClick={() => {
                setOpenMenu(null);
                addNotebookTab();
              }}
            >
              <BookOpenText
                size={14}
                className="text-fg-subtle"
                aria-hidden="true"
              />
              <span className="row-label self-center">
                {t('shortcuts.item.newNotebook.label')}
              </span>
              <span />
            </button>
            <div className="dropdown-rich-footer">
              <Kbd>↑↓</Kbd>
              <span>{t('actionPill.navigate')}</span>
              <span className="flex-1" />
              <Kbd>↵</Kbd>
              <Kbd>Esc</Kbd>
            </div>
          </div>
        ) : null}
      </div>

      <span className="action-pill-divider" />

      {/* RL-093 Slice 3 — runtime chip stays separate (orthogonal to
          workflow). The old "Workflow" chip + separate "Run" split
          button were merged into a single mode-aware action button at
          the end of the pill (see "Mode-aware action button" below). */}

      {/* 2. Runtime chip — "what engine": Worker / Node / Browser preview.
              Only visible for languages that have runtime modes (JS/TS). */}
      {supportsRuntimeModes ? (
        <>
          <div className="relative">
            <button
              type="button"
              className="action-pill-segment rounded-none"
              aria-haspopup="menu"
              aria-expanded={openMenu === 'runtime'}
              onClick={() => setOpenMenu(openMenu === 'runtime' ? null : 'runtime')}
              data-testid="action-pill-runtime"
            >
              <span aria-hidden>{runtimeChip.icon}</span>
              <span>{runtimeChip.label}</span>
              <ChevronDown size={10} aria-hidden className="text-fg-subtle" />
            </button>
            {openMenu === 'runtime' ? (
              <div className="dropdown-rich absolute left-0 top-[calc(100%+0.4rem)] z-50 w-[340px]" role="menu">
                {(
                  [
                    {
                      k: 'worker',
                      icon: <Package size={13} />,
                      label: 'Worker',
                      desc: t('actionPill.mode.worker'),
                    },
                    {
                      k: 'node',
                      icon: <Terminal size={13} />,
                      label: 'Node',
                      desc: t('actionPill.mode.node'),
                    },
                    {
                      k: 'browser-preview',
                      icon: <Globe size={13} />,
                      label: 'Browser preview',
                      desc: t('actionPill.mode.browser'),
                    },
                  ] as const
                ).map((item) => {
                  const isActive = activeTab?.runtimeMode === item.k;
                  return (
                    <button
                      key={item.k}
                      type="button"
                      role="menuitem"
                      className="dropdown-rich-row w-full"
                      data-testid={`action-pill-runtime-option-${item.k}`}
                      data-active={isActive ? 'true' : 'false'}
                      onClick={() => {
                        setOpenMenu(null);
                        // RL-093 follow-up — when the user opens
                        // the Runtime picker without a tab, create
                        // one in the chip's current language and
                        // apply the chosen runtime to it. Avoids
                        // the silent no-op the empty state used to
                        // surface as "click no funciona".
                        const target = ensureTabForLanguage(language);
                        setTabRuntimeMode(target.id, item.k);
                      }}
                    >
                      <span className="row-icon self-start mt-0.5">{item.icon}</span>
                      <span>
                        <span className="row-label block">{item.label}</span>
                        <span className="row-desc block">{item.desc}</span>
                      </span>
                      {isActive ? (
                        <MonoBadge tone="accent">{t('actionPill.badgeActive')}</MonoBadge>
                      ) : (
                        <span />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <span className="action-pill-divider" />
        </>
      ) : null}

      {/* 3. Mode-aware action button (RL-093 Slice 3).
              Replaces the previous "Workflow chip + separate Run
              split-button" pair. The main button:
                · Colours itself by the active workflow (green for run,
                  red-soft for debug, accent for scratchpad).
                · Shows that workflow's label and icon, with a kbd hint.
                · Fires the workflow on click. When `isRunning`, fires
                  `stop()` instead (same as the previous Run button).
              The chevron opens a dropdown that LETS THE USER PICK a
              different workflow; selecting one switches the per-tab
              workflow mode AND fires it immediately, so "switch and
              run" stays a single click. */}
      <div
        className="action-pill-run-group relative inline-flex items-stretch"
        data-workflow={currentWorkflow}
      >
        <button
          type="button"
          onClick={handleRunClick}
          disabled={runDisabled}
          data-running={isRunning ? 'true' : 'false'}
          data-workflow={currentWorkflow}
          data-testid="action-pill-run"
          aria-label={workflowChip.label}
          title={runDisabledTooltip}
          className="action-pill-run action-pill-run-main rounded-l-none"
        >
          {isInitializing || isRunning ? (
            <Loader2 size={11} className="animate-spin" aria-hidden />
          ) : (
            <span aria-hidden>{workflowChip.icon}</span>
          )}
          <span>{isRunning ? t('actionPill.running') : workflowChip.label}</span>
          {!isRunning ? <Kbd>⌘⏎</Kbd> : null}
        </button>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'run'}
          aria-label={t('actionPill.workflowMenu')}
          data-workflow={currentWorkflow}
          data-testid="action-pill-run-menu"
          className="action-pill-run action-pill-run-menu rounded-r-lg"
          onClick={() => setOpenMenu(openMenu === 'run' ? null : 'run')}
        >
          <ChevronDown size={11} aria-hidden />
        </button>
        {openMenu === 'run' ? (
          <div className="dropdown-rich absolute right-0 top-[calc(100%+0.4rem)] z-50 w-[320px]" role="menu">
            {(
              [
                {
                  k: 'run',
                  icon: <Play size={13} />,
                  label: t('actionPill.run'),
                  desc: t('actionPill.workflow.run'),
                  kbd: '⌘⏎',
                  disabled: runDisabled,
                  fire: () => void run(),
                },
                {
                  k: 'debug',
                  icon: <Bug size={13} />,
                  label: t('toolbar.debug.label'),
                  desc: t('actionPill.workflow.debug'),
                  kbd: '⌥⏎',
                  disabled: runDisabled || !supportsDebug || !debuggerEnabled,
                  fire: () => void run({ debug: true }),
                },
                {
                  k: 'scratchpad',
                  icon: <Sparkles size={13} />,
                  label: t('workflowMode.scratchpad.label'),
                  desc: t('actionPill.workflow.scratchpad'),
                  kbd: null as string | null,
                  disabled: isNotebookTab || desktopOnlyGate || proLanguageGate,
                  fire: () => undefined,
                },
              ] as const
            ).map((item) => {
              const isActive = currentWorkflow === item.k;
              return (
                <button
                  key={item.k}
                  type="button"
                  role="menuitem"
                  className="dropdown-rich-row w-full disabled:opacity-45 disabled:cursor-not-allowed"
                  data-active={isActive ? 'true' : 'false'}
                  data-workflow={item.k}
                  data-testid={`action-pill-workflow-option-${item.k}`}
                  disabled={item.disabled}
                  onClick={() => {
                    setOpenMenu(null);
                    if (item.disabled) return;
                    // RL-093 follow-up — same fallback as the
                    // Runtime chip: create a tab in the chip's
                    // current language if there's none so the
                    // workflow picker always advances the user.
                    const target = ensureTabForLanguage(language);
                    if (target.workflowMode !== item.k) {
                      setTabWorkflowMode(target.id, item.k as WorkflowMode);
                    }
                    // Switching INTO scratchpad doesn't fire a manual
                    // run (scratchpad re-evaluates automatically as
                    // the user edits). Run / Debug fire the action so
                    // "switch + run" stays one click — but only when
                    // we already had a real tab; a freshly-created
                    // tab is empty so firing would just log "nothing
                    // to run".
                    if (item.k !== 'scratchpad' && !noActiveTab) {
                      item.fire();
                    }
                  }}
                >
                  <span className="row-icon self-start mt-0.5">{item.icon}</span>
                  <span>
                    <span className="row-label block">{item.label}</span>
                    <span className="row-desc block">{item.desc}</span>
                  </span>
                  {item.kbd ? (
                    <MonoBadge tone="accent">{item.kbd}</MonoBadge>
                  ) : isActive ? (
                    <MonoBadge tone="accent">{t('actionPill.badgeActive')}</MonoBadge>
                  ) : (
                    <span />
                  )}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      </div>
      {/* end runtime segmented group (language · runtime · run) */}

      <span className="action-pill-divider action-pill-meta-divider" />

      {/* 4. History dots */}
      <div className="action-pill-meta inline-flex items-center gap-2 pl-2 pr-3 text-[10.5px] font-mono text-fg-subtle">
        <span className="uppercase font-bold">{t('actionPill.runs')}</span>
        <RunHistoryDots history={history} />
        {lastRunMs !== null ? (
          <span className="text-fg-base font-medium">{lastRunMs.toFixed(1)}ms</span>
        ) : null}
      </div>

      <span className="action-pill-divider action-pill-meta-divider" />

      {/* 5. Autosave dot — Lingua persists every keystroke locally, so
              the chip is informational rather than a toggle. Surfaces
              a tooltip explaining the always-on behaviour. */}
      <Tooltip content={t('actionPill.autosaveTooltip')}>
        <div
          className="action-pill-meta inline-flex items-center gap-1.5 pl-2 pr-3 text-[10.5px] font-mono text-fg-muted"
          data-testid="action-pill-autosave"
        >
          <span
            aria-hidden
            className={cn(
              'inline-block size-1.5 rounded-full',
              autoSaveEnabled ? 'bg-success-fg' : 'bg-border-strong',
            )}
          />
          <span>{t('actionPill.autosave')}</span>
        </div>
      </Tooltip>

      {hasToolbarActions ? (
        <>
          <span className="action-pill-divider" />
          <div
            className="action-pill-command-actions inline-flex items-center gap-1"
            role="toolbar"
            aria-label={t('chrome.actions.aria')}
          >
            {onOpenQuickOpen ? (
              <Tooltip content={t('chrome.quickOpen.tooltip')}>
                <button
                  type="button"
                  data-testid="action-pill-quick-open"
                  aria-label={t('chrome.quickOpen.aria')}
                  onClick={() => {
                    setOpenMenu(null);
                    onOpenQuickOpen();
                  }}
                  className="action-pill-icon-button"
                >
                  <FileSearch size={13} aria-hidden />
                </button>
              </Tooltip>
            ) : null}
            {onOpenPalette ? (
              <Tooltip content={t('chrome.search.tooltip')}>
                <button
                  type="button"
                  data-testid="action-pill-search"
                  aria-label={t('chrome.search.aria')}
                  onClick={() => {
                    setOpenMenu(null);
                    onOpenPalette();
                  }}
                  className="action-pill-icon-button"
                >
                  <Command size={13} aria-hidden />
                </button>
              </Tooltip>
            ) : null}
            {onOpenSnippets ? (
              <Tooltip content={t('chrome.snippets.tooltip')}>
                <button
                  type="button"
                  data-testid="action-pill-snippets"
                  aria-label={t('chrome.snippets.aria')}
                  onClick={() => {
                    setOpenMenu(null);
                    onOpenSnippets();
                  }}
                  className="action-pill-icon-button"
                >
                  <Braces size={13} aria-hidden />
                </button>
              </Tooltip>
            ) : null}
            {onOpenUtilities ? (
              <Tooltip content={t('chrome.utilities.tooltip')}>
                <button
                  type="button"
                  data-testid="action-pill-utilities"
                  aria-label={t('chrome.utilities.aria')}
                  aria-pressed={utilitiesOpen}
                  data-active={utilitiesOpen ? 'true' : 'false'}
                  onClick={() => {
                    setOpenMenu(null);
                    onOpenUtilities();
                  }}
                  className="action-pill-icon-button"
                >
                  <Wrench size={13} aria-hidden />
                </button>
              </Tooltip>
            ) : null}
            {onOpenRecipes ? <RecipesActionPillButton onOpenRecipes={onOpenRecipes} onMenuClose={() => setOpenMenu(null)} /> : null}
            {/* RL-094 Slice 3 fold F — Browse run capsules. Dispatches
                the window event App.tsx listens for (no prop threading
                through AppLayout); the overlay owns Pro-gating. */}
            <Tooltip content={t('chrome.browseCapsules.tooltip')}>
              <button
                type="button"
                data-testid="action-pill-browse-capsules"
                aria-label={t('chrome.browseCapsules.aria')}
                onClick={() => {
                  setOpenMenu(null);
                  window.dispatchEvent(
                    new CustomEvent('lingua-open-capsule-list', {
                      detail: { surface: 'action-pill' },
                    })
                  );
                }}
                className="action-pill-icon-button"
              >
                <Archive size={13} aria-hidden />
              </button>
            </Tooltip>
          </div>
        </>
      ) : null}

      {/* RL-039 Slice B fold G — Recipes badge button. Rendered as a
              sibling component so the lessonProgressStore subscription
              stays scoped (no parent re-render storms). */}
      {/* 6. Settings cog — opens the Settings modal. Only mounted when
              the consumer wired `onOpenSettings`. */}
      {onOpenSettings ? (
        <>
          <span className="action-pill-divider" />
          <Tooltip content={t('actionPill.settingsTooltip')}>
            <button
              type="button"
              aria-label={t('actionPill.settingsTooltip')}
              data-testid="action-pill-settings"
              onClick={() => {
                setOpenMenu(null);
                onOpenSettings();
              }}
              className="action-pill-segment ml-0.5 mr-0.5 px-2 text-fg-subtle hover:text-fg-base"
            >
              <SettingsIcon size={12} aria-hidden />
            </button>
          </Tooltip>
        </>
      ) : null}
    </div>,
    container,
  );
}

/**
 * RL-039 Slice B fold G — Recipes pill button + progress badge.
 * Reads the lessonProgressStore directly so a passed-count change
 * does not force the parent pill to re-render (and so the badge
 * stays in sync the moment Run + Test flips a recipe to passed).
 * Mounted between Utilities and the Settings cog so the button row
 * keeps a stable left-to-right order: Quick Open → Palette →
 * Snippets → Utilities → Recipes → Settings.
 */
function RecipesActionPillButton({
  onOpenRecipes,
  onMenuClose,
}: {
  onOpenRecipes: () => void;
  onMenuClose: () => void;
}) {
  const { t } = useTranslation();
  const passedCount = useLessonProgressStore((s) => s.passedCount());
  return (
    <Tooltip content={t('chrome.recipes.tooltip')}>
      <button
        type="button"
        data-testid="action-pill-recipes"
        aria-label={t('chrome.recipes.aria')}
        onClick={() => {
          onMenuClose();
          onOpenRecipes();
        }}
        className="action-pill-icon-button relative"
      >
        <GraduationCap size={13} aria-hidden />
        {passedCount > 0 ? (
          <span
            data-testid="action-pill-recipes-badge"
            data-passed-count={passedCount}
            aria-label={t('chrome.recipes.badgeAria', { count: passedCount })}
            className="absolute -right-1 -top-1 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full border border-success-border bg-success-fg px-0.5 text-[8px] font-bold leading-none text-fg-on-accent shadow-sm"
          >
            {passedCount > 99 ? '99+' : passedCount}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}
