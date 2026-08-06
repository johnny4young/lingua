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
import { useActiveTab } from '../../hooks/useActiveTab';
import { useEffectiveTier } from '../../hooks/useEntitlement';
import { useRunner } from '../../hooks/useRunner';
import { useUIStore } from '../../stores/uiStore';
import type { Language } from '../../types/language';
import {
  languageCapabilityBadgeKey,
  languageLabel,
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
import { LANGUAGE_PACKS } from '../../../shared/languagePacks';
import {
  executionDisabledTooltipKey,
  resolveExecutionControlPolicy,
} from './executionControlPolicy';

const BUILT_IN_LANGUAGES: { id: Language; label: string }[] = LANGUAGE_PACKS.filter(
  (pack) =>
    (pack.execution === 'run' || pack.execution === 'compile') &&
    pack.templateIds.length > 0
).map((pack) => ({ id: pack.id as Language, label: languageLabel(pack.id) }));

export function Toolbar() {
  const tabCount = useEditorStore((state) => state.tabs.length);
  const addTab = useEditorStore((state) => state.addTab);
  const { run, stop, isRunning, isInitializing, loadingMessage, runMode } = useRunner();
  const activeTab = useActiveTab();
  const { sidebarVisible, toggleSidebar } = useUIStore();
  const plugins = usePluginStore((state) => state.plugins);
  const enabledBreakpointCount = useDebuggerStore((state) => {
    if (!activeTab) return 0;
    return state
      .breakpointsForTab(activeTab.id)
      .filter((breakpoint) => breakpoint.enabled !== false).length;
  });
  const effectiveTier = useEffectiveTier();
  const [isNewFileMenuOpen, setIsNewFileMenuOpen] = useState(false);
  const newFileMenuRef = useRef<HTMLDivElement | null>(null);
  const [isRunMenuOpen, setIsRunMenuOpen] = useState(false);
  const [selectedExecutionAction, setSelectedExecutionAction] =
    useState<'run' | 'debug'>('run');
  const runMenuRef = useRef<HTMLDivElement | null>(null);
  const { t } = useTranslation();

  const hasTabs = tabCount > 0;
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
  const isWebBuild =
    typeof window !== 'undefined' && window.lingua?.platform === 'web';
  const executionPolicy = resolveExecutionControlPolicy({
    language: activeLanguage,
    effectiveTier,
    isWebBuild,
    isNotebookTab: activeTab?.kind === 'notebook',
    enabledBreakpointCount,
  });
  const {
    executionMode,
    desktopOnlyGate,
    proLanguageGate,
    supportsDebug,
  } = executionPolicy;
  const showDebugAction = supportsDebug && executionMode === 'run';
  const actionDisabled =
    !hasTabs || isRunning || executionPolicy.actions.run.disabled;
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
    !hasTabs || isRunning || executionPolicy.actions.debug.disabled;
  const debugLabel =
    runMode === 'debug' && isRunning
      ? loadingMessage ?? t('toolbar.debug.running')
      : t('toolbar.debug.label');
  const debugDisabledTooltipKey = executionDisabledTooltipKey(
    'debug',
    executionPolicy.actions.debug.reason,
  );
  const debugTooltip = debugDisabledTooltipKey
    ? t(debugDisabledTooltipKey)
    : t('toolbar.debug.title');
  const effectiveExecutionAction = showDebugAction ? selectedExecutionAction : 'run';
  const primaryActionIsDebug = effectiveExecutionAction === 'debug';
  const primaryActionDisabled = primaryActionIsDebug ? debugActionDisabled : actionDisabled;
  const primaryActionLabel = primaryActionIsDebug ? debugLabel : actionLabel;
  const primaryActionTooltip = primaryActionIsDebug ? debugTooltip : actionTooltip;
  const primaryActionClassName = cn(
    primaryActionIsDebug
      ? 'button-danger inline-flex h-10 w-10 items-center justify-center rounded-l-lg rounded-r-none'
      : 'button-primary inline-flex h-10 w-10 items-center justify-center rounded-l-lg rounded-r-none bg-success-fg text-fg-on-accent hover:opacity-90',
    // internal v2 — visible pulse around the run button while a task is
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
    setIsRunMenuOpen(false);
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
      data-testid="toolbar-shell"
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
          <PanelLeft size={16} />
        </IconButton>

        <div className="toolbar-divider" />

        {showDebugAction ? (
          <div ref={runMenuRef} className="relative shrink-0">
            <div className="inline-flex overflow-hidden rounded-lg">
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
                    'inline-flex w-10 items-center justify-center border-l px-2 text-body-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45',
                    primaryActionIsDebug
                      ? 'border-error/20 bg-error/12 text-error hover:bg-error/18'
                      : 'border-fg-on-accent/15 bg-success-fg text-fg-on-accent hover:opacity-90'
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
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-body-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                    selectedExecutionAction === 'run'
                      ? 'bg-success-bg text-success-fg'
                      : 'text-fg-base hover:bg-bg-panel-alt'
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
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-body-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45',
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
              className="button-primary inline-flex h-10 w-10 items-center justify-center rounded-lg bg-success-fg text-fg-on-accent hover:opacity-90 data-[running=true]:[animation:run-pulse_1.4s_ease-in-out_infinite]"
            >
              {isInitializing ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Play size={15} fill="currentColor" />
              )}
            </button>
          </Tooltip>
        )}

        {isRunning && (
          <IconButton
            onClick={stop}
            tone="danger"
            tooltip={t('toolbar.run.stop')}
            data-testid="toolbar-stop-button"
          >
            <Square size={16} fill="currentColor" />
          </IconButton>
        )}

        {/* Workflow + runtime selectors live with the Run button. They
            configure HOW + WHERE the standalone fallback executes, so
            the execution cluster reads as one group. */}
        {activeTab ? <WorkflowModeSegment /> : null}
        {languageHasRuntimeModes(activeTab?.language) ? (
          <RuntimeModeSelector />
        ) : null}

        <div className="toolbar-divider" />

        <div ref={newFileMenuRef} className="relative shrink-0">
          <div className="inline-flex h-10 overflow-hidden rounded-xl border border-border/70 bg-surface-strong/80 shadow-[var(--shadow-sm)]">
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
                    className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-body-sm font-medium transition-colors ${
                      language.id === defaultNewFileLanguage
                        ? 'bg-primary-soft text-primary'
                        : 'text-foreground hover:bg-surface-strong/78'
                    }`}
                  >
                    <span>{language.label}</span>
                    <span className="flex items-center gap-2">
                      {!isLanguageAllowed(effectiveTier, language.id) ? (
                        <span
                          className="status-pill border-primary/25 bg-transparent px-2 text-caption text-primary"
                          data-testid={`toolbar-new-file-capability-${language.id}`}
                        >
                          {t('language.capability.proOnly')}
                        </span>
                      ) : capabilityKey && (
                        <span
                          className="status-pill border-border/60 bg-transparent px-2 text-caption text-muted"
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

      {/* implementation — the right-side icon cluster (license badge,
          search, palette, snippets, utilities, console toggle, settings)
          moved into <AppChrome>. The relocated actions remain reachable
          via the command palette + keyboard shortcuts; the chrome
          surfaces the two most-used (search → palette, gear → settings)
          directly. */}
    </div>
  );
}
