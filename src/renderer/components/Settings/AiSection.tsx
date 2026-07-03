/**
 * T19 / RL-031 Slice 3 — Settings → AI. BYO-API-key entry for the "Explain
 * this error" feature. Gated by `LOCAL_AI`. Values live in the isolated
 * `aiConfigStore` (persist boundary `lingua-ai`) — never in the settings blob,
 * exports, capsules, or telemetry.
 */

import { useTranslation } from 'react-i18next';
import { SettingsSection } from '../ui/SpecRow';
import { useAiConfigStore } from '../../stores/aiConfigStore';
import { useEntitlement } from '../../hooks/useEntitlement';

export function AiSection() {
  const { t } = useTranslation();
  const entitled = useEntitlement('LOCAL_AI');
  const endpoint = useAiConfigStore((s) => s.endpoint);
  const apiKey = useAiConfigStore((s) => s.apiKey);
  const model = useAiConfigStore((s) => s.model);
  const setEndpoint = useAiConfigStore((s) => s.setEndpoint);
  const setApiKey = useAiConfigStore((s) => s.setApiKey);
  const setModel = useAiConfigStore((s) => s.setModel);
  const clear = useAiConfigStore((s) => s.clear);

  return (
    <SettingsSection
      eyebrow={t('ai.settings.title')}
      description={t('ai.settings.description')}
    >
      {!entitled ? (
        <p data-testid="ai-settings-upsell" className="text-caption text-fg-muted">
          {t('ai.settings.upsell')}
        </p>
      ) : (
        <div className="grid gap-3" data-testid="ai-settings-form">
          <label className="grid gap-1 text-caption font-medium text-fg-base">
            <span>{t('ai.settings.endpointLabel')}</span>
            <input
              type="url"
              className="field-shell"
              placeholder={t('ai.settings.endpointPlaceholder')}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              data-testid="ai-settings-endpoint"
            />
          </label>
          <label className="grid gap-1 text-caption font-medium text-fg-base">
            <span>{t('ai.settings.apiKeyLabel')}</span>
            <input
              type="password"
              autoComplete="off"
              className="field-shell"
              placeholder={t('ai.settings.apiKeyPlaceholder')}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              data-testid="ai-settings-key"
            />
          </label>
          <label className="grid gap-1 text-caption font-medium text-fg-base">
            <span>{t('ai.settings.modelLabel')}</span>
            <input
              type="text"
              className="field-shell"
              placeholder={t('ai.settings.modelPlaceholder')}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              data-testid="ai-settings-model"
            />
          </label>
          <p className="text-caption text-fg-subtle">
            {t('ai.settings.storedLocally')}
          </p>
          <p className="text-caption text-fg-subtle">{t('ai.settings.corsNote')}</p>
          <div>
            <button
              type="button"
              onClick={clear}
              data-testid="ai-settings-clear"
              className="rounded border border-border px-3 py-1.5 text-caption text-fg-muted hover:text-fg"
            >
              {t('ai.settings.clear')}
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
