/**
 * internal — Recovery section under Settings → Account.
 *
 * Five scoped reset actions plus an "Open recovery folder" affordance
 * for desktop. Every reset gates behind a native confirm modal via
 * `recovery:confirm-reset` (web stub: cancel → inline notice). The
 * destructive surface is intentionally separate from internal's profile
 * import so the copy reads correctly per scope.
 *
 * Per-scope preservation rules:
 *
 *   - **Settings reset** preserves `telemetryConsent` and
 *     `nativeExecutionAcknowledged` so the user is not re-prompted
 *     for consent or for the native-execution trust acknowledgement
 *     after a reset.
 *   - **Factory reset** wipes every localStorage key except
 *     `lingua-license`. Pro tier survives; everything else (including
 *     telemetry consent and native-exec ack) is cleared and re-prompted
 *     on the next boot. This is intentional — a factory reset is the
 *     last-line-of-defense action; the license invariant is the only
 *     hard guarantee for support to communicate.
 */

import { FolderOpen, RefreshCcw, RotateCcw, ShieldOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getActiveAppLanguage } from '../../i18n';
import { useEnvVarsStore } from '../../stores/envVarsStore';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSnippetsStore } from '../../stores/snippetsStore';
import { useUIStore } from '../../stores/uiStore';
import { applyFactoryReset } from '../../utils/safeBoot';
import { SettingsSection, SpecCard, SpecRow } from '../ui/SpecRow';

type ResetScope = RecoveryResetScope;

const SAFE_MODE_HREF = '?safe-mode=1';

interface ScopeAction {
  scope: ResetScope;
  labelKey: string;
  hintKey: string;
  apply: () => void;
}

function buildScopeActions(): ScopeAction[] {
  return [
    {
      scope: 'settings',
      labelKey: 'recovery.action.settings.label',
      hintKey: 'recovery.action.settings.hint',
      apply: () => {
        // Preserve the keys that aren't tied to UX preferences:
        // telemetryConsent (the user already gave / declined consent;
        // making them re-consent on every reset is annoying) and
        // nativeExecutionAcknowledged (one-shot trust acknowledgement
        // — should not re-trigger after a reset).
        const current = useSettingsStore.getState();
        useSettingsStore.persist.clearStorage();
        useSettingsStore.setState((draft) => ({
          ...draft,
          theme: 'dark',
          editorTheme: 'lingua-dark',
          fontSize: 14,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          fontLigatures: true,
          showLineNumbers: true,
          wordWrap: false,
          minimap: false,
          layoutPreset: 'horizontal',
          loopProtection: true,
          maxLoopIterations: 10000,
          hideUndefined: true,
          restoreSessionMode: 'ask',
          formatOnSave: false,
          vimMode: false,
          syncShellWithEditorTheme: true,
          executionHistorySnapshotEnabled: true,
          shortcutOverrides: {},
          keymapPreset: 'default',
          themePack: 'default',
          telemetryConsent: current.telemetryConsent,
          nativeExecutionAcknowledged: current.nativeExecutionAcknowledged,
        }));
      },
    },
    {
      scope: 'snippets',
      labelKey: 'recovery.action.snippets.label',
      hintKey: 'recovery.action.snippets.hint',
      apply: () => {
        useSnippetsStore.setState((draft) => ({ ...draft, snippets: [] }));
      },
    },
    {
      scope: 'envVars',
      labelKey: 'recovery.action.envVars.label',
      hintKey: 'recovery.action.envVars.hint',
      apply: () => {
        useEnvVarsStore.setState((draft) => ({
          ...draft,
          global: {},
          project: {},
          tab: {},
        }));
      },
    },
    {
      scope: 'session',
      labelKey: 'recovery.action.session.label',
      hintKey: 'recovery.action.session.hint',
      apply: () => {
        useExecutionHistoryStore.setState((draft) => ({ ...draft, entries: [] }));
        useProjectStore.setState((draft) => ({ ...draft, recentProjects: [] }));
      },
    },
    {
      scope: 'factory',
      labelKey: 'recovery.action.factory.label',
      hintKey: 'recovery.action.factory.hint',
      apply: () => {
        applyFactoryReset();
      },
    },
  ];
}

function iconFor(scope: ResetScope) {
  switch (scope) {
    case 'factory':
      return <ShieldOff size={14} />;
    case 'session':
      return <RefreshCcw size={14} />;
    default:
      return <RotateCcw size={14} />;
  }
}

export function RecoverySection() {
  const { t } = useTranslation();
  const pushStatusNotice = useUIStore((state) => state.pushStatusNotice);
  const [revealSupported, setRevealSupported] = useState<boolean>(false);
  const [busyScope, setBusyScope] = useState<ResetScope | null>(null);

  // implementation — hide the "Open recovery folder" button on web. The web
  // stub returns { ok: false, reason: 'unsupported' } from the very
  // first call so we use a quick capability probe to gate the row.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      // Treat the IPC as supported on desktop (window.lingua.platform
      // is anything other than 'web'). Web stub always reports
      // unsupported, which we'll surface by hiding the button.
      const platform = window.lingua?.platform;
      if (!cancelled) setRevealSupported(platform !== 'web');
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleReset = async (action: ScopeAction): Promise<void> => {
    setBusyScope(action.scope);
    try {
      const result = await window.lingua.recovery.confirmReset(
        action.scope,
        getActiveAppLanguage()
      );
      if (!result.ok || result.data !== 0) {
        pushStatusNotice({ tone: 'info', messageKey: 'recovery.cancelled' });
        return;
      }
      action.apply();
      pushStatusNotice({ tone: 'success', messageKey: 'recovery.success' });
    } finally {
      setBusyScope(null);
    }
  };

  const handleRevealFolder = async (): Promise<void> => {
    const result = await window.lingua.recovery.revealFolder();
    if (!result.ok) {
      pushStatusNotice({ tone: 'warning', messageKey: 'recovery.openFolder.hint' });
    }
  };

  const handleSafeModeReload = (): void => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('safe-mode', '1');
      window.location.href = url.toString();
    } catch {
      window.location.search = SAFE_MODE_HREF;
    }
  };

  // Per settings-proto.jsx (recovery section): the routine scoped resets
  // group into one quiet SpecCard, while the most destructive action —
  // 'factory' ('Reset everything (keep license)') — is split into its own
  // emphasized, error-toned card so it never reads as a routine reset.
  const scopeActions = buildScopeActions();
  const routineActions = scopeActions.filter((action) => action.scope !== 'factory');
  const factoryAction = scopeActions.find((action) => action.scope === 'factory');

  return (
    <SettingsSection eyebrow={t('recovery.title')} description={t('recovery.description')}>
      <div id="settings-recovery" className="flex flex-col gap-7">
        {/* Routine, recoverable resets — quiet surface, button-secondary. */}
        <SpecCard>
          {routineActions.map((action, index) => (
            <SpecRow
              key={action.scope}
              label={t(action.labelKey)}
              description={t(action.hintKey)}
              last={index === routineActions.length - 1}
              control={
                <button
                  type="button"
                  onClick={() => void handleReset(action)}
                  className="button-secondary"
                  disabled={busyScope !== null}
                  data-testid={`recovery-reset-${action.scope}`}
                >
                  {iconFor(action.scope)}
                  <span>{t('recovery.action.button')}</span>
                </button>
              }
            />
          ))}
        </SpecCard>

        {/* Most destructive action — emphasized, error-toned card + button-danger. */}
        {factoryAction ? (
          <SpecCard className="border-error/30 bg-error/[0.06]">
            <SpecRow
              label={t(factoryAction.labelKey)}
              description={t(factoryAction.hintKey)}
              last
              control={
                <button
                  type="button"
                  onClick={() => void handleReset(factoryAction)}
                  className="button-danger"
                  disabled={busyScope !== null}
                  data-testid={`recovery-reset-${factoryAction.scope}`}
                >
                  {iconFor(factoryAction.scope)}
                  <span>{t('recovery.action.button')}</span>
                </button>
              }
            />
          </SpecCard>
        ) : null}

        {/* Safe mode — quiet operational card. */}
        <SpecCard>
          <SpecRow
            label={t('recovery.safeMode.heading')}
            description={t('recovery.safeMode.hint')}
            last
            control={
              <button
                type="button"
                onClick={handleSafeModeReload}
                className="button-secondary"
                data-testid="recovery-safe-mode-reload"
              >
                <RefreshCcw size={14} />
                <span>{t('recovery.safeMode.button')}</span>
              </button>
            }
          />
        </SpecCard>

        {/* Reveal recovery folder — quiet card, desktop-only. */}
        {revealSupported ? (
          <SpecCard>
            <SpecRow
              label={t('recovery.openFolder.button')}
              description={t('recovery.openFolder.hint')}
              last
              control={
                <button
                  type="button"
                  onClick={() => void handleRevealFolder()}
                  className="button-secondary"
                  data-testid="recovery-reveal-folder"
                >
                  <FolderOpen size={14} />
                  <span>{t('recovery.openFolder.button')}</span>
                </button>
              }
            />
          </SpecCard>
        ) : null}
      </div>
    </SettingsSection>
  );
}
