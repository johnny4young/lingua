import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Braces, Check, Copy, Keyboard, Settings as SettingsIcon, X } from 'lucide-react';
import { AboutSection } from './AboutSection';
import { AppearanceSection } from './AppearanceSection';
import { EditorSection } from './EditorSection';
import { EnvVarsSection } from './EnvVarsSection';
import { ExecutionHistorySection } from './ExecutionHistorySection';
import { LanguagesSection } from './LanguagesSection';
import { LayoutSection } from './LayoutSection';
import { LicenseSection } from './LicenseSection';
import { AiSection } from './AiSection';
import { PluginsSection } from './PluginsSection';
import { LocalMcpSection } from './LocalMcpSection';
import { PrivacySection } from './PrivacySection';
import { RecoverySection } from './RecoverySection';
import { RunCapsulesSection } from './RunCapsulesSection';
import { UpdatesSection } from './UpdatesSection';
import { OnboardingSection } from './OnboardingSection';
import { RecipesProgressResetSection } from './RecipesProgressResetSection';
import { PrivacyTrustSection } from './PrivacyTrustSection';
import { UtilitiesSection } from './UtilitiesSection';
import { useShallow } from 'zustand/react/shallow';
import { IconButton, Kbd, OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { EyebrowMono } from '../ui/primitives';
import { SettingsSection, SpecCard, SpecRow } from '../ui/SpecRow';
import {
  formatShortcutCombo,
  resolveCombos,
  resolveShortcutDisplayPlatform,
} from '../../data/keyboardShortcuts';
import { KEYBOARD_SHORTCUT_REFERENCE } from '../../data/keyboardShortcutReference';
import { useSettingsStore } from '../../stores/settingsStore';
import { useCommandListener } from '../../hooks/useCommandListener';
import { SettingsRail } from './SettingsRail';
import { RAIL_ITEMS, type TabId } from './settingsRailModel';
import {
  clearPendingSettingsTab,
  peekPendingSettingsTab,
  peekPendingSettingsTarget,
} from './pendingSettingsTab';
import { SettingsSearch } from './SettingsSearch';
import {
  searchSettings,
  type SettingsSearchResult,
} from './settingsSearchModel';

/**
 * internal Signal-Slate v2 — Settings modal with a left rail.
 *
 * The v1 layout used top tabs. v2 moves navigation to a 220px rail
 * with two groups (Workspace + Advanced) so the modal feels closer to
 * a native preferences pane. Its searchable command bar (`⌘,`) indexes
 * sections and high-value controls across every tab, then activates,
 * scrolls to, and focuses the selected target. An "Effective config"
 * JSON tile renders at the bottom of each tab — the same view a runtime
 * would see.
 *
 * Tab inventory (11 rail items):
 *
 *   Workspace
 *     1. general      → About + Updates
 *     2. appearance   → Appearance + Layout
 *     3. editor       → Editor + ExecutionHistory + Utilities
 *     4. languages    → Languages
 *     5. environment  → EnvVars
 *     6. privacy      → Privacy + PrivacyTrust
 *     7. account      → License + AI + RunCapsules
 *
 *   Advanced
 *     8. integrations → local MCP server controls and trust boundary
 *     9. shortcuts    → CTA to open the existing KeyboardShortcuts
 *                       modal (keeps the heavy table out of this
 *                       surface)
 *    10. plugins      → PluginsSection (was nested under "editor")
 *    11. recovery     → RecoverySection (was nested under "account")
 *
 * Keyboard nav: ⌘1–⌘0 jumps to the matching section while the modal
 * is focused; Esc closes. Ctrl/Cmd + , focuses the filter bar.
 */
interface SettingsModalProps {
  onClose: () => void;
  onOpenWhatsNew: () => void;
  onStartGuidedTour: () => void;
  onOpenKeyboardShortcuts?: () => void;
}

interface SettingsTopBarProps {
  active: TabId;
  filter: string;
  searchResults: readonly SettingsSearchResult[];
  onFilterChange: (next: string) => void;
  onSearchSelect: (result: SettingsSearchResult) => void;
  onClose: () => void;
  filterInputRef: RefObject<HTMLInputElement | null>;
}

function SettingsTopBar({
  active,
  filter,
  searchResults,
  onFilterChange,
  onSearchSelect,
  onClose,
  filterInputRef,
}: SettingsTopBarProps) {
  const { t } = useTranslation();
  const activeLabel = RAIL_ITEMS.find(it => it.id === active)?.labelKey;
  return (
    <div className="flex h-12 flex-none items-center gap-3 border-b border-border/80 bg-bg-panel px-4">
      <div className="flex items-center gap-2 text-body-sm">
        <SettingsIcon size={14} className="text-fg-subtle" aria-hidden />
        <span className="text-fg-muted">{t('settings.title')}</span>
        <span className="text-fg-subtle">›</span>
        <span className="font-medium text-fg-base">{activeLabel ? t(activeLabel) : ''}</span>
      </div>
      <SettingsSearch
        inputRef={filterInputRef}
        query={filter}
        results={searchResults}
        onQueryChange={onFilterChange}
        onSelect={onSearchSelect}
      />
      <div className="flex items-center gap-2">
        <Kbd>Esc</Kbd>
        <IconButton onClick={onClose} tooltip={t('settings.close')}>
          <X size={14} />
        </IconButton>
      </div>
    </div>
  );
}

function SettingsSearchTarget({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <div
      data-settings-search-target={id}
      tabIndex={-1}
      className="scroll-mt-5 rounded-lg outline-none focus:ring-2 focus:ring-accent/70 focus:ring-offset-4 focus:ring-offset-bg-base"
    >
      {children}
    </div>
  );
}

interface EffectiveConfigTileProps {
  tab: TabId;
}

// internal review — keys are listed per tab. Missing keys are silently
// skipped at runtime by the `pick` helper, so adding a new setting
// just requires adding the key here.
const TAB_CONFIG_KEYS: Record<TabId, readonly string[]> = {
  general: ['theme', 'language', 'whatsNewNotificationsEnabled', 'contextualHintsEnabled'],
  appearance: [
    'theme',
    'fontFamily',
    'fontSize',
    'fontLigatures',
    'editorTheme',
    'themePack',
    'layoutPreset',
    'language',
  ],
  editor: [
    'editorTheme',
    'wordWrap',
    'tabSize',
    'lineNumbers',
    'minimap',
    'formatOnSave',
    'executionHistorySnapshotEnabled',
    'scratchpadAutoLogByLanguage',
    'workflowModeDefaultsByLanguage',
    'showStdinPanel',
  ],
  // implementation (post-review refactor) — Languages tab shows
  // per-language LSP toggles + the capability scorecard; those don't
  // map to specific store keys (the LSP rows write into language-
  // specific stores like `rustLanguageStore`, and the scorecard is
  // read-only). Leave the keys empty so the effective-config tile
  // renders an empty slice rather than misattributing editor state.
  languages: [],
  environment: ['envVars'],
  // implementation — Privacy + Trust dashboard is a passive audit
  // surface. The Clear actions remove localStorage keys directly;
  // they don't mutate any settings store slice. Empty list keeps the
  // effective-config tile honest about what this tab can change.
  privacy: [],
  account: ['privacyTelemetryEnabled'],
  shortcuts: ['shortcutOverrides'],
  integrations: [],
  plugins: ['enabledPlugins', 'pluginRoots'],
  recovery: [],
};

/**
 * Renders a JSON readonly snapshot of the slice of settingsStore that
 * the active tab controls. We deliberately don't show the whole store
 * — only the keys this tab can mutate — so the user can verify "what
 * I changed here is what runtime X reads."
 *
 * internal review — the tile used to call `useSettingsStore()` without a
 * selector and re-render on every store change, blowing the
 * `JSON.stringify` budget each time. It now subscribes only to the
 * exact slice the active tab cares about via a per-tab selector.
 */
function EffectiveConfigTile({ tab }: EffectiveConfigTileProps) {
  const { t } = useTranslation();
  const keys = TAB_CONFIG_KEYS[tab] ?? [];
  // Shallow compare so a setting change in a DIFFERENT tab doesn't
  // re-render this tile.
  const slice = useSettingsStore(
    useShallow(state => {
      const s = state as unknown as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        if (k in s && typeof s[k] !== 'function') out[k] = s[k];
      }
      return out;
    })
  );
  const [copied, setCopied] = useState(false);

  const json = useMemo(() => JSON.stringify(slice, null, 2), [slice]);

  if (Object.keys(slice).length === 0) return null;

  // implementation — Prerequisite fix surfaced during validation.
  // The raw JSON dump dominated the bottom of every Settings tab and
  // was visually noisy for the typical user. Hide it behind a native
  // <details> so the surface stays clean by default; power users
  // (and bug reporters) can expand to inspect or copy.
  return (
    <details className="effective-config-tile">
      <summary className="effective-config-tile-header cursor-pointer list-none pr-28">
        <div className="flex items-center gap-2">
          <Braces size={13} className="text-fg-subtle" aria-hidden />
          <EyebrowMono>{t('settings.effectiveConfig.label')}</EyebrowMono>
          <span className="text-caption text-fg-muted">{t('settings.effectiveConfig.hint')}</span>
        </div>
      </summary>
      <button
        type="button"
        className="button-ghost absolute right-3 top-2 text-caption"
        onClick={() => {
          void navigator.clipboard.writeText(json).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        aria-label={t('settings.effectiveConfig.copy')}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? t('settings.effectiveConfig.copied') : t('settings.effectiveConfig.copy')}
      </button>
      <pre className="effective-config-tile-body whitespace-pre">{json}</pre>
    </details>
  );
}

interface SettingsStatusBarProps {
  active: TabId;
}

function SettingsStatusBar({ active }: SettingsStatusBarProps) {
  const { t } = useTranslation();
  return (
    <div className="settings-status-bar">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block size-1.5 rounded-full bg-success" />
        <span className="font-mono">{t('settings.sync.label')}</span>
      </span>
      <span className="text-fg-subtle">·</span>
      <span className="font-mono">
        {t('settings.footer.trail', { section: t(`settings.tabs.${active}`) })}
      </span>
      <span className="flex-1" />
      <span className="flex items-center gap-1.5">
        <Kbd>⌘1</Kbd>
        <Kbd>⌘0</Kbd>
        <span className="text-fg-muted">{t('settings.statusBar.section')}</span>
      </span>
      <span className="text-fg-subtle">·</span>
      <span className="flex items-center gap-1.5">
        <Kbd>Esc</Kbd>
        <span className="text-fg-muted">{t('settings.statusBar.escape')}</span>
      </span>
    </div>
  );
}

/**
 * The six most-common shortcuts surfaced inline on the Shortcuts tab so
 * the surface reads as a preview, not a bare CTA (proto
 * `settings-proto.jsx` shortcuts section). Each row reuses the canonical
 * `shortcuts.item.*.label` key and resolves its keystroke from the same
 * lazy shortcut reference catalog that the full shortcut editor reads —
 * so user overrides and the platform-aware glyphs (⌘ / Ctrl) match
 * what the KeyboardShortcuts modal renders. We keep the keystroke as a
 * `<Kbd>` chip (chrome primitive), not a StatusBadge: it's an input
 * affordance, not a status signal.
 */
const SHORTCUTS_PREVIEW_IDS = [
  'run-toggle',
  'overlay-command-palette',
  'nav-quick-open',
  'view-toggle-console',
  'overlay-settings',
  'overlay-capsule-list',
] as const;

function ShortcutsPreviewCard() {
  const { t } = useTranslation();
  const overrides = useSettingsStore(state => state.shortcutOverrides);
  const platform = resolveShortcutDisplayPlatform(
    window.lingua?.platform ?? 'unknown',
    window.navigator?.platform
  );

  const rows = useMemo(
    () =>
      SHORTCUTS_PREVIEW_IDS.flatMap(id => {
        const definition = KEYBOARD_SHORTCUT_REFERENCE.find(entry => entry.id === id);
        if (!definition) return [];
        const [primaryCombo] = resolveCombos(definition, overrides);
        return [
          {
            id,
            label: t(definition.labelKey),
            combo: primaryCombo ? formatShortcutCombo(primaryCombo, platform) : null,
          },
        ];
      }),
    [overrides, platform, t]
  );

  return (
    <SpecCard>
      {rows.map((row, index) => (
        <SpecRow
          key={row.id}
          label={row.label}
          last={index === rows.length - 1}
          control={row.combo ? <Kbd>{row.combo}</Kbd> : null}
        />
      ))}
    </SpecCard>
  );
}

export function SettingsModal({
  onClose,
  onOpenWhatsNew,
  onStartGuidedTour,
  onOpenKeyboardShortcuts,
}: SettingsModalProps) {
  const { t } = useTranslation();
  // Seeded from the one-shot handoff, not from a command issued after open:
  // this modal is lazy, so a caller that opens Settings and immediately emits
  // `settings.navigate` is racing the chunk fetch and loses.
  const [activeTab, setActiveTab] = useState<TabId>(
    () => peekPendingSettingsTab() ?? 'general'
  );
  // Consume on mount, not during render: this component is lazy, so its first
  // render suspends and is discarded, and a consuming read there would spend
  // the stash on a render that never commits.
  useEffect(() => {
    clearPendingSettingsTab();
  }, []);
  const [filter, setFilter] = useState('');
  const [pendingSearchTarget, setPendingSearchTarget] = useState<string | null>(
    () => peekPendingSettingsTarget()
  );
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  // implementation detail — siblings request a typed tab jump after opening
  // Settings, while SettingsModal remains the sole owner of activeTab.
  useCommandListener('settings.navigate', ({ tab, targetId }, context) => {
    if (RAIL_ITEMS.some(it => it.id === tab)) {
      setActiveTab(tab);
      setPendingSearchTarget(targetId ?? null);
      context.markHandled();
    }
  });

  // Map ⌘1..⌘0 → tab. Cmd on macOS, Ctrl on others.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Filter focus: ⌘,
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        filterInputRef.current?.focus();
        return;
      }
      // Rail jumps: ⌘1..⌘0 (only when not typing in an input/textarea)
      if (event.metaKey || event.ctrlKey) {
        const tag = (event.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        const match = RAIL_ITEMS.find(it => it.kbdToken === event.key);
        if (match) {
          event.preventDefault();
          setActiveTab(match.id);
          window.requestAnimationFrame(() => {
            document.getElementById(`settings-rail-${match.id}`)?.focus();
          });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filterInputRef]);

  const searchResults = useMemo(() => searchSettings(filter, t), [filter, t]);
  const matchingTabs = useMemo(
    () => [...new Set(searchResults.map(result => result.tab))],
    [searchResults]
  );

  useEffect(() => {
    if (!pendingSearchTarget) return;

    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-settings-search-target="${pendingSearchTarget}"]`
      );
      target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      target?.focus({ preventScroll: true });
      setPendingSearchTarget(current =>
        current === pendingSearchTarget ? null : current
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, pendingSearchTarget]);

  const handleSelect = useCallback((id: TabId) => {
    setActiveTab(id);
  }, []);

  const handleSearchSelect = useCallback((result: SettingsSearchResult) => {
    setActiveTab(result.tab);
    setFilter('');
    setPendingSearchTarget(result.targetId);
  }, []);

  const renderTabContent = (): ReactNode => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="space-y-6">
            <SettingsSearchTarget id="section-about">
              <AboutSection
                onOpenWhatsNew={onOpenWhatsNew}
                onStartGuidedTour={onStartGuidedTour}
              />
            </SettingsSearchTarget>
            <SettingsSearchTarget id="section-updates">
              <UpdatesSection />
            </SettingsSearchTarget>
            {/* implementation — Onboarding choreography reset toggles */}
            <SettingsSearchTarget id="section-onboarding">
              <OnboardingSection />
            </SettingsSearchTarget>
            {/* implementation Slice B implementation note — Reset recipe progress */}
            <SettingsSearchTarget id="section-recipe-progress">
              <RecipesProgressResetSection />
            </SettingsSearchTarget>
          </div>
        );
      case 'appearance':
        return (
          <div className="space-y-6">
            <SettingsSearchTarget id="section-appearance">
              <AppearanceSection />
            </SettingsSearchTarget>
            <SettingsSearchTarget id="section-layout">
              <LayoutSection />
            </SettingsSearchTarget>
          </div>
        );
      case 'editor':
        return (
          <div className="space-y-6">
            <SettingsSearchTarget id="section-editor">
              <EditorSection />
            </SettingsSearchTarget>
            <SettingsSearchTarget id="section-execution-history">
              <ExecutionHistorySection />
            </SettingsSearchTarget>
            <SettingsSearchTarget id="section-utilities">
              <UtilitiesSection />
            </SettingsSearchTarget>
          </div>
        );
      case 'languages':
        return (
          <SettingsSearchTarget id="section-languages">
            <LanguagesSection />
          </SettingsSearchTarget>
        );
      case 'environment':
        return (
          <SettingsSearchTarget id="section-environment">
            <EnvVarsSection />
          </SettingsSearchTarget>
        );
      case 'privacy':
        return (
          <div className="space-y-6">
            <SettingsSearchTarget id="section-privacy">
              <PrivacySection />
            </SettingsSearchTarget>
            <SettingsSearchTarget id="section-privacy-trust">
              <PrivacyTrustSection />
            </SettingsSearchTarget>
          </div>
        );
      case 'account':
        return (
          <div className="space-y-6">
            <SettingsSearchTarget id="section-license">
              <LicenseSection />
            </SettingsSearchTarget>
            <SettingsSearchTarget id="section-ai">
              <AiSection />
            </SettingsSearchTarget>
            <SettingsSearchTarget id="section-run-capsules">
              <RunCapsulesSection />
            </SettingsSearchTarget>
          </div>
        );
      case 'shortcuts':
        return (
          <SettingsSearchTarget id="section-shortcuts">
            <SettingsSection
              eyebrow={t('settings.shortcuts.eyebrow')}
              description={t('settings.shortcuts.description')}
            >
              <ShortcutsPreviewCard />
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border-subtle bg-bg-inset px-[18px] py-[13px]">
                <div className="min-w-0">
                  <div className="text-body font-medium text-fg-base">
                    {t('settings.shortcuts.linkLabel')}
                  </div>
                  <div className="mt-[2px] max-w-[52ch] text-caption leading-relaxed text-fg-subtle">
                    {t('settings.shortcuts.linkHint')}
                  </div>
                </div>
                <button
                  type="button"
                  className="button-primary shrink-0 text-body-sm"
                  onClick={() => {
                    if (onOpenKeyboardShortcuts) {
                      onClose();
                      window.setTimeout(onOpenKeyboardShortcuts, 0);
                    }
                  }}
                  disabled={!onOpenKeyboardShortcuts}
                >
                  <Keyboard size={12} />
                  {t('settings.shortcuts.modal.cta')}
                  {/* accessibility pass — no global keybinding opens this modal
                      (no `keyboard-shortcuts` combo in the catalog), so the
                      advertised Cmd+/ keycap was misleading; removed. */}
                </button>
              </div>
            </SettingsSection>
          </SettingsSearchTarget>
        );
      case 'plugins':
        return (
          <SettingsSearchTarget id="section-plugins">
            <PluginsSection />
          </SettingsSearchTarget>
        );
      case 'integrations':
        return (
          <SettingsSearchTarget id="section-local-mcp">
            <LocalMcpSection />
          </SettingsSearchTarget>
        );
      case 'recovery':
        return (
          <SettingsSearchTarget id="section-recovery">
            <RecoverySection />
          </SettingsSearchTarget>
        );
    }
  };

  return (
    <OverlayBackdrop onClose={onClose}>
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="relative grid w-[min(96vw,1240px)] max-w-none grid-cols-[220px_1fr] grid-rows-[auto_1fr_auto] overflow-hidden"
        style={{ height: 'min(86vh, 820px)' }}
      >
        <h2 id="settings-modal-title" className="sr-only">
          {t('settings.subtitle')}
        </h2>

        {/* Rail spans all rows on the left */}
        <div className="row-span-3">
          <SettingsRail
            active={activeTab}
            filter={filter}
            matchingTabs={matchingTabs}
            onSelect={handleSelect}
          />
        </div>

        {/* Top bar */}
        <SettingsTopBar
          active={activeTab}
          filter={filter}
          searchResults={searchResults}
          onFilterChange={setFilter}
          onSearchSelect={handleSearchSelect}
          onClose={onClose}
          filterInputRef={filterInputRef}
        />

        {/* Tab content */}
        <div
          id={`settings-panel-${activeTab}`}
          className="min-h-0 overflow-y-auto bg-bg-base px-6 py-5"
          role="tabpanel"
          aria-labelledby={`settings-rail-${activeTab}`}
          key={activeTab}
        >
          {renderTabContent()}
          <EffectiveConfigTile tab={activeTab} />
        </div>

        {/* Status bar */}
        <SettingsStatusBar active={activeTab} />
      </OverlayCard>
    </OverlayBackdrop>
  );
}
