import {
  Bug,
  ChevronDown,
  Loader2,
  PanelLeft,
  Play,
  Plus,
  Square,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useEffectiveTier } from '../../hooks/useEntitlement';
import { useRunner } from '../../hooks/useRunner';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { Language } from '../../types';
import {
  executionModeForLanguage,
  languageCapabilityBadgeKey,
  languageLabel,
  languageSupportsDebugger,
} from '../../utils/languageMeta';
import { usePluginStore } from '../../stores/pluginStore';
import { useDebuggerStore } from '../../stores/debuggerStore';
import { isLanguageAllowed } from '../../../shared/entitlements';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { trackEvent } from '../../utils/telemetry';
import { IconButton, Tooltip } from '../ui/chrome';
import { cn } from '../../utils/cn';
import { RuntimeModeSelector } from './RuntimeModeSelector';
import { WorkflowModeSegment } from './WorkflowModeSegment';
import { languageHasRuntimeModes } from '../../../shared/runtimeModes';

const BUILT_IN_LANGUAGES: { id: Language; label: string }[] = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'go', label: 'Go' },
  { id: 'python', label: 'Python' },
  { id: 'rust', label: 'Rust' },
];

interface ToolbarProps {
  /**
   * RL-093 — when the floating action pill is mounted alongside the
   * toolbar, the toolbar trims its centre cluster (Run/Debug split,
   * Workflow segment, Runtime selector, New-file menu) and renders
   * only the sidebar toggle on the left.
   */
  showFloatingPill?: boolean;
}

export function Toolbar({ showFloatingPill = false }: ToolbarProps) {
  const { tabs, activeTabId, addTab } = useEditorStore();
  const { run, stop, isRunning, isInitializing, loadingMessage, runMode } = useRunner();
  const { sidebarVisible, toggleSidebar } = useUIStore();
  const debuggerEnabled = useSettingsStore((state) => state.debuggerEnabled);
  const plugins = usePluginStore((state) => state.plugins);
  const enabledBreakpointCount = useDebuggerStore((state) => {
    const tabId = useEditorStore.getState().activeTabId;
    if (!tabId) return 0;
    let count = 0;
    for (const bp of Object.values(state.breakpoints)) {
      if (bp.tabId === tabId && bp.enabled !== false) count += 1;
    }
    return count;
  });
  const effectiveTier = useEffectiveTier();
  const [isNewFileMenuOpen, setIsNewFileMenuOpen] = useState(false);
  const newFileMenuRef = useRef<HTMLDivElement | null>(null);
  const [isRunMenuOpen, setIsRunMenuOpen] = useState(false);
  const [selectedExecutionAction, setSelectedExecutionAction] =
    useState<'run' | 'debug'>('run');
  const runMenuRef = useRef<HTMLDivElement | null>(null);
  const { t } = useTranslation();

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeTabSupportsDebugger = languageSupportsDebugger(activeTab?.language);
  const hasTabs = tabs.length > 0;
  const languages = [
    ...BUILT_IN_LANGUAGES,
    ...plugins
      .filter((plugin) => plugin.status === 'loaded' && plugin.language)
      .map((plugin) => ({
        id: plugin.language as Language,
        label: languageLabel(plugin.language as Language),
      })),
  ];
  const defaultNewFileLanguage = activeTab?.language ?? 'javascript';
  const defaultNewFileLabel = languageLabel(defaultNewFileLanguage);
  const activeLanguage = activeTab?.language ?? 'javascript';
  const executionMode = executionModeForLanguage(activeLanguage);
  const showDebugAction = activeTabSupportsDebugger && executionMode === 'run';
  // RL-038 Slice C — when the active language needs a host toolchain
  // (Go, Rust) AND this is the web build, the Run button is honest about
  // the gap: disabled + a localized tooltip pointing at the desktop
  // build. Desktop users still see the normal Run affordance.
  const isWebBuild =
    typeof window !== 'undefined' && window.lingua?.platform === 'web';
  const languageIsDesktopOnly =
    languageCapabilityBadgeKey(activeLanguage) === 'language.capability.desktopOnly';
  const proLanguageGate =
    executionMode === 'run' && !isLanguageAllowed(effectiveTier, activeLanguage);
  const desktopOnlyGate =
    !proLanguageGate && isWebBuild && languageIsDesktopOnly && executionMode === 'run';
  const actionDisabled =
    !hasTabs || isRunning || executionMode === 'view' || desktopOnlyGate || proLanguageGate;
  const actionLabel =
    executionMode === 'validate'
      ? loadingMessage ?? (isRunning ? t('toolbar.validate.running') : t('toolbar.validate.label'))
      : executionMode === 'view'
        ? t('toolbar.viewOnly.label')
        : loadingMessage ?? (isRunning ? t('toolbar.run.running') : t('toolbar.run.label'));
  const actionTooltip = proLanguageGate
    ? t('toolbar.run.proOnlyTooltip')
    : desktopOnlyGate
      ? t('toolbar.run.desktopOnlyTooltip')
      : executionMode === 'validate'
        ? t('toolbar.validate.title')
        : executionMode === 'view'
          ? t('toolbar.viewOnly.title')
          : t('toolbar.run.title');
  const debugActionDisabled =
    actionDisabled || !debuggerEnabled || enabledBreakpointCount === 0;
  const debugLabel =
    runMode === 'debug' && isRunning
      ? loadingMessage ?? t('toolbar.debug.running')
      : t('toolbar.debug.label');
  const debugTooltip = !debuggerEnabled
    ? t('toolbar.debug.disabledSettings')
    : enabledBreakpointCount === 0
      ? t('toolbar.debug.noBreakpoint')
      : t('toolbar.debug.title');
  const primaryActionIsDebug = showDebugAction && selectedExecutionAction === 'debug';
  const primaryActionDisabled = primaryActionIsDebug ? debugActionDisabled : actionDisabled;
  const primaryActionLabel = primaryActionIsDebug ? debugLabel : actionLabel;
  const primaryActionTooltip = primaryActionIsDebug ? debugTooltip : actionTooltip;
  const primaryActionClassName = cn(
    primaryActionIsDebug
      ? 'button-danger inline-flex h-10 w-10 items-center justify-center rounded-l-xl rounded-r-none'
      : 'button-primary inline-flex h-10 w-10 items-center justify-center rounded-l-xl rounded-r-none bg-success text-background hover:bg-success/92',
    // RL-071 v2 — visible pulse around the run button while a task is
    // executing. The animation is declared in index.css under
    // @keyframes run-pulse and only applies when data-running="true".
    'data-[running=true]:[animation:run-pulse_1.4s_ease-in-out_infinite]'
  );
  const handleNewFile = (language: Language) => {
    if (!isLanguageAllowed(effectiveTier, language)) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: t('upsell.feature.languagePack'),
      });
      void trackEvent('feature.blocked', {
        entitlement: 'language-pack-extended',
        tier: effectiveTier,
        language,
      });
      setIsNewFileMenuOpen(false);
      return;
    }

    const tab = createDefaultTab(language);
    addTab(tab);
    setIsNewFileMenuOpen(false);
  };

  const runSelectedAction = () => {
    if (primaryActionIsDebug) {
      void run({ debug: true });
      return;
    }
    void run();
  };

  const runFromMenu = (mode: 'run' | 'debug') => {
    setSelectedExecutionAction(mode);
    setIsRunMenuOpen(false);
    if (mode === 'debug') {
      void run({ debug: true });
      return;
    }
    void run();
  };

  useEffect(() => {
    if (!showDebugAction && selectedExecutionAction !== 'run') {
      setSelectedExecutionAction('run');
    }
  }, [selectedExecutionAction, showDebugAction]);

  useEffect(() => {
    if (isRunning) {
      setIsRunMenuOpen(false);
    }
  }, [isRunning]);

  useEffect(() => {
    if (!isNewFileMenuOpen && !isRunMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const newFileMenuElement = newFileMenuRef.current;
      const runMenuElement = runMenuRef.current;
      if (
        newFileMenuElement?.contains(target) ||
        runMenuElement?.contains(target)
      ) {
        return;
      }

      setIsNewFileMenuOpen(false);
      setIsRunMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsNewFileMenuOpen(false);
        setIsRunMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isNewFileMenuOpen, isRunMenuOpen]);

  return (
    <div
      data-tour-id="toolbar-shell"
      className="toolbar-drag-region surface-header relative z-10 flex min-h-16 flex-wrap items-center justify-between gap-3 px-3 py-2 sm:min-h-14 sm:flex-nowrap sm:px-4"
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-32 bg-gradient-to-r from-primary-soft/55 via-transparent to-transparent sm:block" />

      <div className="flex min-w-0 items-center gap-2 pl-2 sm:pl-3">
        <IconButton
          onClick={toggleSidebar}
          active={sidebarVisible}
          tooltip={t('toolbar.sidebar.toggle')}
          aria-controls="project-explorer"
          aria-expanded={sidebarVisible}
        >
          <PanelLeft size={15} />
        </IconButton>

        {!showFloatingPill ? <div className="toolbar-divider" /> : null}

        {!showFloatingPill && (showDebugAction ? (
          <div ref={runMenuRef} className="relative shrink-0">
            <div className="inline-flex overflow-hidden rounded-xl">
              <Tooltip
                content={primaryActionTooltip}
                disabled={
                  primaryActionDisabled &&
                  !desktopOnlyGate &&
                  !proLanguageGate &&
                  !primaryActionIsDebug
                }
              >
                <button
                  onClick={runSelectedAction}
                  disabled={primaryActionDisabled}
                  data-tour-id="run-button"
                  data-testid="toolbar-run-button"
                  data-running={isRunning ? 'true' : 'false'}
                  aria-label={primaryActionLabel}
                  className={primaryActionClassName}
                >
                  {isInitializing ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : primaryActionIsDebug ? (
                    <Bug size={15} aria-hidden="true" />
                  ) : (
                    <Play size={15} fill="currentColor" />
                  )}
                </button>
              </Tooltip>
              <Tooltip content={t('toolbar.run.menu')}>
                <button
                  type="button"
                  onClick={() => setIsRunMenuOpen((current) => !current)}
                  disabled={isRunning || !hasTabs}
                  data-testid="toolbar-run-menu-button"
                  aria-label={t('toolbar.run.menu')}
                  aria-haspopup="menu"
                  aria-expanded={isRunMenuOpen}
                  className={cn(
                    'inline-flex w-10 items-center justify-center border-l px-2 text-xs font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45',
                    primaryActionIsDebug
                      ? 'border-error/20 bg-error/12 text-error hover:bg-error/18'
                      : 'border-white/15 bg-success text-background hover:bg-success/92'
                  )}
                >
                  <ChevronDown size={13} />
                </button>
              </Tooltip>
            </div>

            {isRunMenuOpen ? (
              <div
                role="menu"
                aria-label={t('toolbar.run.menu')}
                className="surface-panel-strong absolute left-0 top-[calc(100%+0.55rem)] z-20 min-w-48 p-1.5"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => runFromMenu('run')}
                  disabled={actionDisabled}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                    selectedExecutionAction === 'run'
                      ? 'bg-success/12 text-success'
                      : 'text-foreground hover:bg-surface-strong/78'
                  )}
                >
                  <Play size={13} fill="currentColor" />
                  {t('toolbar.run.label')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => runFromMenu('debug')}
                  disabled={debugActionDisabled}
                  data-testid="toolbar-debug-button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                    selectedExecutionAction === 'debug'
                      ? 'bg-danger/12 text-danger'
                      : 'text-danger hover:bg-danger/10'
                  )}
                  title={debugActionDisabled ? debugTooltip : undefined}
                >
                  <Bug size={13} aria-hidden="true" />
                  {t('toolbar.debug.label')}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <Tooltip
            content={actionTooltip}
            // Suppress the tooltip only for "disabled because there are no
            // tabs / still running / view-only" — those cases carry no
            // value. Keep it visible for the desktop-only + Pro-language
            // gates so the user sees the explanation on hover.
            disabled={actionDisabled && !desktopOnlyGate && !proLanguageGate}
          >
            <button
              onClick={() => void run()}
              disabled={actionDisabled}
              data-tour-id="run-button"
              data-testid="toolbar-run-button"
              data-running={isRunning ? 'true' : 'false'}
              aria-label={actionLabel}
              title={actionLabel}
              className="button-primary inline-flex h-10 w-10 items-center justify-center rounded-xl bg-success text-background hover:bg-success/92 data-[running=true]:[animation:run-pulse_1.4s_ease-in-out_infinite]"
            >
              {isInitializing ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Play size={15} fill="currentColor" />
              )}
            </button>
          </Tooltip>
        ))}

        {!showFloatingPill && isRunning && (
          <IconButton
            onClick={stop}
            tone="danger"
            tooltip={t('toolbar.run.stop')}
            data-testid="toolbar-stop-button"
          >
            <Square size={12} fill="currentColor" />
          </IconButton>
        )}

        {/* UI refinement — workflow + runtime selectors live with the
            Run button. They configure HOW + WHERE the run executes,
            so the whole execution cluster reads as one group.
            RL-093 — hidden when the floating action pill is mounted;
            those controls move into the pill. */}
        {!showFloatingPill && activeTab ? <WorkflowModeSegment /> : null}
        {!showFloatingPill && languageHasRuntimeModes(activeTab?.language) ? (
          <RuntimeModeSelector />
        ) : null}

        {!showFloatingPill ? <div className="toolbar-divider" /> : null}

        <div
          ref={newFileMenuRef}
          className={cn('relative shrink-0', showFloatingPill && 'hidden')}
        >
          <div className="inline-flex h-10 overflow-hidden rounded-xl border border-border/70 bg-surface-strong/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <Tooltip content={t('toolbar.newFile.primaryTitle', { language: defaultNewFileLabel })}>
              <button
                onClick={() => handleNewFile(defaultNewFileLanguage)}
                aria-label={t('toolbar.newFile.primary', { language: defaultNewFileLabel })}
                className="inline-flex h-full w-10 items-center justify-center text-foreground transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Plus size={15} />
              </button>
            </Tooltip>
            <div className="my-1 w-px bg-border/70" aria-hidden="true" />
            <Tooltip content={t('toolbar.newFile.menuTitle')}>
              <button
                onClick={() => setIsNewFileMenuOpen((currentValue) => !currentValue)}
                className={`inline-flex h-full w-8 items-center justify-center text-foreground transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  isNewFileMenuOpen ? 'text-primary' : 'text-muted'
                }`}
                aria-label={t('toolbar.newFile.menuAriaLabel')}
                aria-haspopup="menu"
                aria-expanded={isNewFileMenuOpen}
              >
                <ChevronDown size={13} />
              </button>
            </Tooltip>
          </div>

          {isNewFileMenuOpen && (
            <div
              role="menu"
              aria-label={t('toolbar.newFile.menuAriaLabel')}
              className="surface-panel-strong absolute left-0 top-[calc(100%+0.55rem)] z-20 min-w-52 p-1.5"
            >
              {languages.map((language) => {
                const capabilityKey = languageCapabilityBadgeKey(language.id);
                return (
                  <button
                    key={language.id}
                    role="menuitem"
                    onClick={() => handleNewFile(language.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-colors ${
                      language.id === defaultNewFileLanguage
                        ? 'bg-primary-soft text-primary'
                        : 'text-foreground hover:bg-surface-strong/78'
                    }`}
                  >
                    <span>{language.label}</span>
                    <span className="flex items-center gap-2">
                      {!isLanguageAllowed(effectiveTier, language.id) ? (
                        <span
                          className="status-pill border-primary/25 bg-transparent px-2 text-[0.7rem] text-primary"
                          data-testid={`toolbar-new-file-capability-${language.id}`}
                        >
                          {t('language.capability.proOnly')}
                        </span>
                      ) : capabilityKey && (
                        <span
                          className="status-pill border-border/60 bg-transparent px-2 text-[0.7rem] text-muted"
                          data-testid={`toolbar-new-file-capability-${language.id}`}
                        >
                          {t(capabilityKey)}
                        </span>
                      )}
                      {language.id === defaultNewFileLanguage && (
                        <span className="status-pill border-primary/20 bg-transparent px-0 text-primary">
                          {t('toolbar.newFile.current')}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* RL-093 Slice 3 — the right-side icon cluster (license badge,
          search, palette, snippets, utilities, console toggle, settings)
          moved into <AppChrome>. The relocated actions remain reachable
          via the command palette + keyboard shortcuts; the chrome
          surfaces the two most-used (search → palette, gear → settings)
          directly. */}
    </div>
  );
}
