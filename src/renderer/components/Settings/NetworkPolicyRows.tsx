import { useTranslation } from 'react-i18next';
import { NETWORK_POLICIES } from '../../../shared/networkPolicy';
import { emitCommand } from '../../stores/commandBus';
import { useAiConfigStore } from '../../stores/aiConfigStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { cn } from '../../utils/cn';
import { isLoopbackHostname } from '../../utils/loopbackHost';
import { SpecRow } from '../ui/SpecRow';

/** Allow / Ask / Block for code in the sandboxed runtimes. Shown only with the Labs flag on. */
export function NetworkFromRunningCodeRow() {
  const { t } = useTranslation();
  const enabled = useSettingsStore(state => state.featureFlags.networkPolicy === true);
  const policy = useSettingsStore(state => state.networkFromRunningCode);
  const setPolicy = useSettingsStore(state => state.setNetworkFromRunningCode);
  if (!enabled) return null;

  return (
    <SpecRow
      searchTargetId="privacy-network-policy"
      label={t('settings.privacy.networkPolicy.label')}
      description={t('settings.privacy.networkPolicy.hint')}
      control={
        <div className="flex flex-col items-end gap-1">
          <div
            role="group"
            aria-label={t('settings.privacy.networkPolicy.label')}
            data-testid="privacy-network-policy"
            className="flex rounded-[7px] border border-border-subtle bg-bg-inset p-0.5"
          >
            {NETWORK_POLICIES.map(option => (
              <button
                key={option}
                type="button"
                aria-pressed={policy === option}
                onClick={() => setPolicy(option)}
                data-testid={`privacy-network-policy-${option}`}
                className={cn(
                  'h-6 rounded-[5px] px-2.5 text-body-sm font-medium',
                  policy === option
                    ? 'bg-bg-panel text-fg-base shadow-e1'
                    : 'text-fg-muted hover:text-fg-base'
                )}
              >
                {t(`settings.privacy.networkPolicy.option.${option}`)}
              </button>
            ))}
          </div>
          <span className="max-w-[44ch] text-right text-caption text-fg-subtle">
            {t('settings.privacy.networkPolicy.scope')}
          </span>
        </div>
      }
    />
  );
}

/** Read-only: where the AI features send their prompt. Account › AI stays the one place to change it. */
export function AiSourceRow({ last = false }: { last?: boolean }) {
  const { t } = useTranslation();
  const endpoint = useAiConfigStore(state => state.endpoint.trim());
  const model = useAiConfigStore(state => state.model.trim());

  let host: string | null;
  try {
    host = endpoint ? new URL(endpoint).hostname : null;
  } catch {
    host = null;
  }
  const value =
    host === null
      ? t('settings.privacy.aiSource.notSet')
      : isLoopbackHostname(host)
        ? t('settings.privacy.aiSource.local', { model: model || host })
        : t('settings.privacy.aiSource.remote', { host });

  return (
    <SpecRow
      label={t('settings.privacy.aiSource.label')}
      description={t('settings.privacy.aiSource.hint')}
      last={last}
      control={
        <div className="flex flex-col items-end gap-1">
          <span data-testid="privacy-ai-source" className="text-body-sm text-fg-base">
            {value}
          </span>
          <button
            type="button"
            data-testid="privacy-ai-source-open"
            onClick={() =>
              emitCommand('settings.navigate', { tab: 'account', targetId: 'section-ai' })
            }
            className="text-caption font-medium text-accent underline-offset-2 hover:text-accent-fg hover:underline"
          >
            {t('settings.privacy.aiSource.open')}
          </button>
        </div>
      }
    />
  );
}
