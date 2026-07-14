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
import { Braces, Check, Copy, Keyboard, Search, Settings as SettingsIcon, X } from 'lucide-react';
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
  KEYBOARD_SHORTCUTS,
  formatShortcutCombo,
  resolveCombos,
  resolveShortcutDisplayPlatform,
} from '../../data/keyboardShortcuts';
import { useSettingsStore } from '../../stores/settingsStore';
import { cn } from '../../utils/cn';
import { useCommandListener } from '../../hooks/useCommandListener';
import { SettingsRail } from './SettingsRail';
import { RAIL_ITEMS, matchesFilter, type TabId } from './settingsRailModel';

/**
 * RL-071 Signal-Slate v2 — Settings modal with a left rail.
 *
 * The v1 layout used top tabs. v2 moves navigation to a 220px rail
 * with two groups (Workspace + Advanced) so the modal feels closer to
 * a native preferences pane, and exposes a filter bar (`⌘,`) that
 * highlights matching rail rows so keyboard-first users can jump
 * directly to a setting. An "Effective config" JSON tile renders at
 * the bottom of each tab — the same view a runtime would see.
 *
 * Tab inventory (10 rail items):
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
 *     8. shortcuts    → CTA to open the existing KeyboardShortcuts
 *                       modal (keeps the heavy table out of this
 *                       surface)
 *     9. plugins      → PluginsSection (was nested under "editor")
 *    10. recovery     → RecoverySection (was nested under "account")
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
  matchCount: number;
  onFilterChange: (next: string) => void;
  onClose: () => void;
  filterInputRef: RefObject<HTMLInputElement | null>;
}

function SettingsTopBar({
  active,
  filter,
  matchCount,
  onFilterChange,
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
      <div
        className={cn(
          'mx-2 flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border bg-bg-base px-2.5 transition-colors',
          filter ? 'border-accent bg-primary-soft' : 'border-border/80'
        )}
      >
        <Search
          size={12}
          className={cn(filter ? 'text-accent-fg' : 'text-fg-subtle')}
          aria-hidden
        />
        <input
          ref={filterInputRef}
          type="text"
          value={filter}
          onChange={e => onFilterChange(e.target.value)}
          placeholder={t('settings.filter.placeholder')}
          className={cn(
            'min-w-0 flex-1 bg-transparent font-mono text-body-sm outline-none placeholder:text-fg-subtle',
            filter ? 'font-semibold text-accent-fg' : 'text-fg-muted'
          )}
          data-testid="settings-filter-input"
          aria-label={t('settings.filter.placeholder')}
        />
        {filter ? (
          <>
            <span className="font-mono text-eyebrow text-accent-fg">
              {matchCount === 0
                ? t('settings.filter.noMatches')
                : t('settings.filter.matches', { count: matchCount })}
            </span>
            <button
              type="button"
              onClick={() => onFilterChange('')}
              className="text-accent-fg hover:opacity-70"
              aria-label={t('settings.filter.clear')}
            >
              <X size={11} aria-hidden />
            </button>
          </>
        ) : (
          <span className="flex gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>,</Kbd>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Kbd>Esc</Kbd>
        <IconButton onClick={onClose} tooltip={t('settings.close')}>
          <X size={14} />
        </IconButton>
      </div>
    </div>
  );
}

interface EffectiveConfigTileProps {
  tab: TabId;
}

// RL-093 review — keys are listed per tab. Missing keys are silently
// skipped at runtime by the `pick` helper, so adding a new setting
// just requires adding the key here.
const TAB_CONFIG_KEYS: Record<TabId, readonly string[]> = {
  general: ['theme', 'language'],
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
  // RL-095 Slice 1 (post-review refactor) — Languages tab shows
  // per-language LSP toggles + the capability scorecard; those don't
  // map to specific store keys (the LSP rows write into language-
  // specific stores like `rustLanguageStore`, and the scorecard is
  // read-only). Leave the keys empty so the effective-config tile
  // renders an empty slice rather than misattributing editor state.
  languages: [],
  environment: ['envVars'],
  // RL-096 Slice 1 — Privacy + Trust dashboard is a passive audit
  // surface. The Clear actions remove localStorage keys directly;
  // they don't mutate any settings store slice. Empty list keeps the
  // effective-config tile honest about what this tab can change.
  privacy: [],
  account: ['privacyTelemetryEnabled'],
  shortcuts: ['shortcutOverrides'],
  plugins: ['enabledPlugins', 'pluginRoots'],
  recovery: [],
};

/**
 * Renders a JSON readonly snapshot of the slice of settingsStore that
 * the active tab controls. We deliberately don't show the whole store
 * — only the keys this tab can mutate — so the user can verify "what
 * I changed here is what runtime X reads."
 *
 * RL-093 review — the tile used to call `useSettingsStore()` without a
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

  // RL-044 Slice 2b-β-α — Prerequisite fix surfaced during validation.
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
 * `KEYBOARD_SHORTCUTS` catalog the full list + command palette read —
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
        const definition = KEYBOARD_SHORTCUTS.find(entry => entry.id === id);
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
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [filter, setFilter] = useState('');
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  // RL-095 / RL-135 — siblings request a typed tab jump after opening
  // Settings, while SettingsModal remains the sole owner of activeTab.
  useCommandListener('settings.navigate', ({ tab }) => {
    if (RAIL_ITEMS.some(it => it.id === tab)) {
      setActiveTab(tab);
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

  const matchCount = useMemo(
    () => (filter ? RAIL_ITEMS.filter(it => matchesFilter(it, filter, t)).length : 0),
    [filter, t]
  );

  const handleSelect = useCallback((id: TabId) => {
    setActiveTab(id);
  }, []);

  const renderTabContent = (): ReactNode => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="space-y-6">
            <AboutSection onOpenWhatsNew={onOpenWhatsNew} onStartGuidedTour={onStartGuidedTour} />
            <UpdatesSection />
            {/* RL-101 Slice 1 — Onboarding choreography reset toggles */}
            <OnboardingSection />
            {/* RL-039 Slice B fold F — Reset recipe progress */}
            <RecipesProgressResetSection />
          </div>
        );
      case 'appearance':
        return (
          <div className="space-y-6">
            <AppearanceSection />
            <LayoutSection />
          </div>
        );
      case 'editor':
        return (
          <div className="space-y-6">
            <EditorSection />
            <ExecutionHistorySection />
            <UtilitiesSection />
          </div>
        );
      case 'languages':
        return (
          <div className="space-y-6">
            <LanguagesSection />
          </div>
        );
      case 'environment':
        return (
          <div className="space-y-6">
            <EnvVarsSection />
          </div>
        );
      case 'privacy':
        return (
          <div className="space-y-6">
            <PrivacySection />
            <PrivacyTrustSection />
          </div>
        );
      case 'account':
        return (
          <div className="space-y-6">
            <LicenseSection />
            <AiSection />
            <RunCapsulesSection />
          </div>
        );
      case 'shortcuts':
        return (
          <div className="space-y-7">
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
                  {/* UX Sweep T5 — no global keybinding opens this modal
                      (no `keyboard-shortcuts` combo in the catalog), so the
                      advertised Cmd+/ keycap was misleading; removed. */}
                </button>
              </div>
            </SettingsSection>
          </div>
        );
      case 'plugins':
        return (
          <div className="space-y-6">
            <PluginsSection />
          </div>
        );
      case 'recovery':
        return (
          <div className="space-y-6">
            <RecoverySection />
          </div>
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
          <SettingsRail active={activeTab} filter={filter} onSelect={handleSelect} />
        </div>

        {/* Top bar */}
        <SettingsTopBar
          active={activeTab}
          filter={filter}
          matchCount={matchCount}
          onFilterChange={setFilter}
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
