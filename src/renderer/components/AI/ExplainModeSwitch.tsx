import { useTranslation } from 'react-i18next';
import { AI_MODES, isAiConfigured, useAiConfigStore, type AiMode } from '../../stores/aiConfigStore';

/** Picks where Send goes. A profile Settings has not filled in yet stays disabled, with the reason. */
export function ExplainModeSwitch() {
  const { t } = useTranslation();
  const mode = useAiConfigStore((s) => s.mode);
  const local = useAiConfigStore((s) => s.local);
  const remote = useAiConfigStore((s) => s.remote);
  const remoteApiKey = useAiConfigStore((s) => s.remoteApiKey);
  const ready: Record<AiMode, boolean> = {
    local: isAiConfigured({ ...local, apiKey: '' }),
    remote: isAiConfigured({ ...remote, apiKey: remoteApiKey }),
  };
  const active = mode === 'local' ? local : remote;

  return (
    <div className="flex flex-col gap-1.5">
      <div role="radiogroup" aria-label={t('ai.settings.mode.label')} className="inline-flex w-fit rounded-lg border border-border-subtle bg-bg-inset p-0.5">
        {AI_MODES.map((option) => {
          const disabled = option !== mode && !ready[option];
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              disabled={disabled}
              title={disabled ? t(`ai.panel.mode.${option}Unset`) : undefined}
              data-testid={`ai-explain-mode-${option}`}
              onClick={() => useAiConfigStore.getState().setMode(option)}
              className={`focus-ring h-6 rounded-md px-2.5 text-caption font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                mode === option ? 'bg-bg-panel text-fg-base shadow-e1' : 'text-fg-muted enabled:hover:text-fg-base'
              }`}
            >
              {t(`ai.settings.mode.${option}`)}
            </button>
          );
        })}
      </div>
      {ready[mode] ? (
        <p data-testid="ai-explain-mode-caption" className="truncate text-micro text-fg-subtle">
          {t(`ai.panel.mode.${mode}Caption`, { model: active.model.trim(), host: hostOf(active.endpoint) })}
        </p>
      ) : null}
    </div>
  );
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint.trim()).host;
  } catch {
    return endpoint;
  }
}
