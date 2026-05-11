import {
  BookCopy,
  Bug,
  ChevronDown,
  FolderOpen,
  Loader2,
  PanelBottom,
  PanelLeft,
  Play,
  Plus,
  Search,
  Settings,
  Square,
  Terminal,
  Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { useRunner } from '../../hooks/useRunner';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { Language } from '../../types';
import {
  KEYBOARD_SHORTCUTS,
  formatShortcutCombo,
  resolveCombos,
  resolveShortcutDisplayPlatform,
} from '../../data/keyboardShortcuts';
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
import { LicenseBadge } from './LicenseBadge';

const BUILT_IN_LANGUAGES: { id: Language; label: string }[] = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'go', label: 'Go' },
  { id: 'python', label: 'Python' },
  { id: 'rust', label: 'Rust' },
];

function getToolbarShortcutDisplayPlatform() {
  const runtimePlatform =
    typeof window !== 'undefined' ? window.lingua?.platform ?? 'web' : 'web';
  const navigatorPlatform =
    typeof navigator !== 'undefined' ? navigator.platform : undefined;
  return resolveShortcutDisplayPlatform(runtimePlatform, navigatorPlatform);
}

interface ToolbarProps {
  onOpenSettings?: () => void;
  onOpenPalette?: () => void;
  onOpenQuickOpen?: () => void;
  onOpenSnippets?: () => void;
  onOpenUtilities?: () => void;
  utilitiesOpen?: boolean;
}

export function Toolbar({
  onOpenSettings,
  onOpenPalette,
  onOpenQuickOpen,
  onOpenSnippets,
  onOpenUtilities,
  utilitiesOpen = false,
}: ToolbarProps) {
  const { tabs, activeTabId, addTab } = useEditorStore();
  const { run, stop, isRunning, isInitializing, loadingMessage } = useRunner();
  const { sidebarVisible, consoleVisible, toggleSidebar, toggleConsole } = useUIStore();
  const shortcutOverrides = useSettingsStore((state) => state.shortcutOverrides);
  const debuggerEnabled = useSettingsStore((state) => state.debuggerEnabled);
  const plugins = usePluginStore((state) => state.plugins);
  // RL-027 Slice 1.5 fold D — breakpoint count for the toolbar pill.
  // Counts only the active tab so a user with 50 breakpoints across
  // many files sees the count that matches the visible gutter dots.
  const breakpointCount = useDebuggerStore((state) => {
    const tabId = useEditorStore.getState().activeTabId;
    if (!tabId) return 0;
    let count = 0;
    for (const bp of Object.values(state.breakpoints)) {
      if (bp.tabId === tabId) count += 1;
    }
    return count;
  });
  const effectiveTier = useEffectiveTier();
  const canUseDeveloperUtilities = useEntitlement('DEV_UTILITIES');
  const [isNewFileMenuOpen, setIsNewFileMenuOpen] = useState(false);
  const newFileMenuRef = useRef<HTMLDivElement | null>(null);
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
  const utilitiesShortcutLabel = useMemo(() => {
    const definition = KEYBOARD_SHORTCUTS.find(
      (entry) => entry.id === 'overlay-developer-utilities'
    );
    if (!definition) return null;
    const combo = resolveCombos(definition, shortcutOverrides)[0];
    if (!combo) return null;
    return formatShortcutCombo(combo, getToolbarShortcutDisplayPlatform());
  }, [shortcutOverrides]);
  const utilitiesTooltip = utilitiesShortcutLabel
    ? t('toolbar.utilities.tooltip', { shortcut: utilitiesShortcutLabel })
    : t('toolbar.utilities');

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

  const handleOpenUtilities = () => {
    if (canUseDeveloperUtilities) {
      onOpenUtilities?.();
      return;
    }
    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: t('upsell.feature.devUtilities'),
    });
    void trackEvent('feature.blocked', {
      entitlement: 'dev-utilities',
      tier: effectiveTier,
    });
  };

  useEffect(() => {
    if (!isNewFileMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const menuElement = newFileMenuRef.current;
      if (!menuElement || menuElement.contains(event.target as Node)) {
        return;
      }

      setIsNewFileMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsNewFileMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isNewFileMenuOpen]);

  return (
    <div
      data-tour-id="toolbar-shell"
      className="toolbar-drag-region surface-header relative z-10 flex min-h-16 flex-wrap items-center justify-between gap-3 px-3 py-2 sm:min-h-14 sm:flex-nowrap sm:px-4"
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-32 bg-gradient-to-r from-primary-soft/55 via-transparent to-transparent sm:block" />

      <div
        className={cn(
          'flex min-w-0 items-center gap-2',
          isWebBuild ? 'pl-2 sm:pl-3' : 'pl-[70px] sm:pl-[78px]'
        )}
      >
        <IconButton
          onClick={toggleSidebar}
          active={sidebarVisible}
          tooltip={t('toolbar.sidebar.toggle')}
          aria-controls="project-explorer"
          aria-expanded={sidebarVisible}
        >
          <PanelLeft size={15} />
        </IconButton>

        <div className="toolbar-divider" />

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
            className="button-primary min-w-[7.4rem] justify-center bg-success text-background hover:bg-success/92"
          >
            {isInitializing ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Play size={13} fill="currentColor" />
            )}
            {actionLabel}
          </button>
        </Tooltip>

        {isRunning && (
          <Tooltip content={t('toolbar.run.stop')}>
            <button onClick={stop} className="button-danger">
              <Square size={11} fill="currentColor" />
              {t('toolbar.run.stop')}
            </button>
          </Tooltip>
        )}

        <IconButton
          onClick={() => void useEditorStore.getState().openFileFromDisk()}
          tooltip={t('toolbar.openFile')}
        >
          <FolderOpen size={15} />
        </IconButton>

        <div className="toolbar-divider" />

        <div ref={newFileMenuRef} className="relative shrink-0">
          <div className="inline-flex overflow-hidden rounded-[1.35rem] border border-border/80 bg-surface-strong/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <Tooltip content={t('toolbar.newFile.primaryTitle', { language: defaultNewFileLabel })}>
              <button
                onClick={() => handleNewFile(defaultNewFileLanguage)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold tracking-[0.02em] text-foreground transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Plus size={13} />
                {t('toolbar.newFile.primary', { language: defaultNewFileLabel })}
              </button>
            </Tooltip>
            <div className="my-1 w-px bg-border/80" aria-hidden="true" />
            <Tooltip content={t('toolbar.newFile.menuTitle')}>
              <button
                onClick={() => setIsNewFileMenuOpen((currentValue) => !currentValue)}
                className={`inline-flex items-center justify-center px-3 text-foreground transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  isNewFileMenuOpen ? 'text-primary' : ''
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

      <div data-tour-id="toolbar-actions" className="flex min-w-0 items-center gap-1">
        {activeTab && (
          <div className="status-pill hidden max-w-[14rem] truncate lg:flex">
            {t('toolbar.languageActive', { language: defaultNewFileLabel })}
          </div>
        )}
        {activeTabSupportsDebugger && breakpointCount > 0 ? (
          <Tooltip
            content={
              debuggerEnabled
                ? t('debugger.toolbar.pill.activeHint')
                : t('debugger.toolbar.pill.disabledHint')
            }
          >
            <button
              type="button"
              onClick={onOpenSettings}
              data-testid="toolbar-breakpoint-pill"
              aria-label={t('debugger.toolbar.pill', { count: breakpointCount })}
              className={cn(
                'status-pill inline-flex items-center gap-1 hover:bg-surface',
                debuggerEnabled
                  ? 'border-danger/40 text-danger'
                  : 'border-border/60 text-muted'
              )}
            >
              <Bug size={11} aria-hidden="true" />
              <span>{t('debugger.toolbar.pill', { count: breakpointCount })}</span>
            </button>
          </Tooltip>
        ) : null}
        <LicenseBadge onClick={onOpenSettings} />

        <IconButton onClick={onOpenQuickOpen} tooltip={t('toolbar.quickOpen')}>
          <Search size={15} />
        </IconButton>
        <IconButton onClick={onOpenPalette} tooltip={t('toolbar.commandPalette')}>
          <Terminal size={15} />
        </IconButton>
        <IconButton onClick={onOpenSnippets} tooltip={t('toolbar.snippets')}>
          <BookCopy size={15} />
        </IconButton>
        <IconButton
          onClick={handleOpenUtilities}
          aria-label={t('toolbar.utilities')}
          tooltip={utilitiesTooltip}
          active={canUseDeveloperUtilities && utilitiesOpen}
          aria-pressed={canUseDeveloperUtilities && utilitiesOpen}
          aria-haspopup="dialog"
        >
          <Wrench size={15} />
        </IconButton>
        <div className="toolbar-divider" />
        <IconButton
          onClick={toggleConsole}
          active={consoleVisible}
          tooltip={t('toolbar.console.toggle')}
          aria-pressed={consoleVisible}
        >
          <PanelBottom size={15} />
        </IconButton>
        <IconButton onClick={onOpenSettings} tooltip={t('toolbar.settings')}>
          <Settings size={15} />
        </IconButton>
      </div>
    </div>
  );
}
