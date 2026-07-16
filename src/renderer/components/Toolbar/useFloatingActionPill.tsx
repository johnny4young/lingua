/**
 * RL-093 / T8 — logic hook backing {@link FloatingActionPill}.
 *
 * Holds every store subscription, derived value, and handler the
 * floating pill needs so the component file stays a thin presentational
 * shell that wires the extracted segments together. Behaviour is
 * identical to the previous inline implementation — this is a pure
 * split, no logic change.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type PointerEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { Bug, Globe, Package, Play, Sparkles, Terminal } from 'lucide-react';
import { getActiveTab, useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useRunner } from '../../hooks/useRunner';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useUIStore } from '../../stores/uiStore';
import { useDraggable } from '../../hooks/useDraggable';
import type { RunHistoryEntry } from '../ui/primitives';
import type { Language } from '../../types';
import { languageHasRuntimeModes } from '../../../shared/runtimeModes';
import type { WorkflowMode } from '../../../shared/workflowMode';
import {
  executionModeForLanguage,
  languageCapabilityBadgeKey,
  languageSupportsDebugger,
} from '../../utils/languageMeta';
import { useEffectiveTier } from '../../hooks/useEntitlement';
import { isLanguageAllowed } from '../../../shared/entitlements';
import { pushUpsellNotice } from '../../utils/upsellNotice';

export type ActionPillMenu = 'lang' | 'workflow' | 'runtime' | 'run';
export type ActionPillMenuSetter = Dispatch<SetStateAction<ActionPillMenu | null>>;

const FULL_PILL_WIDTH = 820;
const COMPACT_PILL_WIDTH = 560;
const RIGHT_EDITOR_HEADER_RESERVE = 420;

// RL-093 — workflow and runtime are TWO orthogonal axes:
//   workflowMode: scratchpad | run | debug   — what kind of execution
//   runtimeMode : worker | node | browser-preview — what engine
//
// The pill exposes them as two separate chips so the user never sees
// a misleading "two Actual rows" state. The Runtime chip is only
// rendered when the language has runtime modes (JS/TS today).
export function workflowChipLabel(
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

export function runtimeChipLabel(
  runtimeMode: string | undefined,
): { icon: ReactNode; label: string } {
  if (runtimeMode === 'node') return { icon: <Terminal size={11} />, label: 'Node' };
  if (runtimeMode === 'browser-preview')
    return { icon: <Globe size={11} />, label: 'Browser' };
  return { icon: <Package size={11} />, label: 'Worker' };
}

export function useFloatingActionPill(t: (k: string) => string) {
  const tabCount = useEditorStore((s) => s.tabs.length);
  const addTab = useEditorStore((s) => s.addTab);
  const addNotebookTab = useEditorStore((s) => s.addNotebookTab);
  const setTabRuntimeMode = useEditorStore((s) => s.setTabRuntimeMode);
  const setTabWorkflowMode = useEditorStore((s) => s.setTabWorkflowMode);
  const { run, stop, isRunning, isInitializing, loadingMessage } = useRunner();
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
  const [openMenu, setOpenMenu] = useState<ActionPillMenu | null>(null);

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
  const cssVars = {
    '--floating-pill-x': `${position.x}px`,
    '--floating-pill-y': `${position.y}px`,
  } as CSSProperties;

  // Render via portal so the pill is positioned relative to the viewport,
  // not constrained to whatever ancestor establishes a containing block.
  const container = typeof document !== 'undefined' ? document.body : null;

  return {
    container,
    pillRef,
    isDragging,
    cssVars,
    dragHandleProps,
    openMenu,
    setOpenMenu,
    language,
    effectiveTier,
    isWebBuild,
    handleLanguagePick,
    addNotebookTab,
    supportsRuntimeModes,
    runtimeChip,
    activeRuntimeMode: activeTab?.runtimeMode,
    setTabRuntimeMode,
    currentWorkflow,
    isRunning,
    isInitializing,
    loadingMessage,
    runDisabled,
    runDisabledTooltip,
    workflowChip,
    handleRunClick,
    run,
    supportsDebug,
    debuggerEnabled,
    isNotebookTab,
    desktopOnlyGate,
    proLanguageGate,
    noActiveTab,
    ensureTabForLanguage,
    setTabWorkflowMode,
    history,
    lastRunMs,
    autoSaveEnabled,
  };
}
