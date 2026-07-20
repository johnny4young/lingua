/**
 * implementation — Settings → AI. BYO-API-key entry for the "Explain
 * this error" feature. Gated by `LOCAL_AI`. Values live in the isolated
 * `aiConfigStore` (persist boundary `lingua-ai`) — never in the settings blob,
 * exports, capsules, or telemetry.
 *
 * UX pack — "Detect local AI": one click probes the conventional Ollama
 * port (11434, OpenAI-compatible `/v1/models`), fills the endpoint +
 * placeholder key, and lists the installed models to pick from. This is the
 * zero-config path for the privacy-first user the feature is aimed at. On
 * web production builds the CSP blocks plain-http localhost — the failure
 * copy says so honestly (works in dev and on desktop).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsSection } from '../ui/SpecRow';
import { useAiConfigStore } from '../../stores/aiConfigStore';
import { useEntitlement } from '../../hooks/useEntitlement';

const OLLAMA_MODELS_URL = 'http://localhost:11434/v1/models';
const OLLAMA_CHAT_URL = 'http://localhost:11434/v1/chat/completions';
/** Ollama ignores the key, but the client requires one; this is the convention. */
const OLLAMA_PLACEHOLDER_KEY = 'ollama';
/** A local server answers in milliseconds; don't hang the Settings pane. */
const DETECT_TIMEOUT_MS = 3000;

type DetectState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'detecting' }
  | { readonly kind: 'found'; readonly models: readonly string[] }
  | { readonly kind: 'failed' };

/** Parse the OpenAI-compatible `GET /v1/models` payload into model ids. */
function parseModelIds(payload: unknown): string[] {
  if (payload === null || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => (entry as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export interface AiSectionProps {
  /** Test seam: override fetch so tests never touch the network. */
  readonly fetchImpl?: typeof fetch;
}

export function AiSection({ fetchImpl }: AiSectionProps = {}) {
  const { t } = useTranslation();
  const entitled = useEntitlement('LOCAL_AI');
  const endpoint = useAiConfigStore((s) => s.endpoint);
  const apiKey = useAiConfigStore((s) => s.apiKey);
  const model = useAiConfigStore((s) => s.model);
  const setEndpoint = useAiConfigStore((s) => s.setEndpoint);
  const setApiKey = useAiConfigStore((s) => s.setApiKey);
  const setModel = useAiConfigStore((s) => s.setModel);
  const clear = useAiConfigStore((s) => s.clear);
  const [detect, setDetect] = useState<DetectState>({ kind: 'idle' });

  async function handleDetect(): Promise<void> {
    setDetect({ kind: 'detecting' });
    const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);
    try {
      const response = await doFetch(OLLAMA_MODELS_URL, {
        signal: controller.signal,
      });
      if (!response.ok) {
        setDetect({ kind: 'failed' });
        return;
      }
      const models = parseModelIds(await response.json());
      if (models.length === 0) {
        setDetect({ kind: 'failed' });
        return;
      }
      // A reachable server IS the endpoint; the model stays the user's pick.
      setEndpoint(OLLAMA_CHAT_URL);
      if (apiKey.trim().length === 0) setApiKey(OLLAMA_PLACEHOLDER_KEY);
      setDetect({ kind: 'found', models });
    } catch {
      setDetect({ kind: 'failed' });
    } finally {
      clearTimeout(timer);
    }
  }

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
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void handleDetect()}
              disabled={detect.kind === 'detecting'}
              data-testid="ai-settings-detect"
              className="focus-ring rounded border border-border px-3 py-1.5 text-caption text-fg-muted hover:text-fg disabled:opacity-60"
            >
              {detect.kind === 'detecting'
                ? t('ai.settings.detecting')
                : t('ai.settings.detect')}
            </button>
            {detect.kind === 'failed' ? (
              <p
                data-testid="ai-settings-detect-failed"
                className="text-caption text-warning"
              >
                {t('ai.settings.detectFailed')}
              </p>
            ) : null}
            {detect.kind === 'found' ? (
              <div data-testid="ai-settings-detect-models" className="space-y-1">
                <p className="text-caption text-fg-subtle">
                  {t('ai.settings.detectFound')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {detect.models.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setModel(id)}
                      data-testid="ai-settings-detect-model"
                      aria-pressed={model === id}
                      className={`focus-ring rounded border px-2 py-1 font-mono text-micro ${
                        model === id
                          ? 'border-accent text-fg'
                          : 'border-border text-fg-muted hover:text-fg'
                      }`}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <p className="text-caption text-fg-subtle">
            {t('ai.settings.storedLocally')}
          </p>
          <p className="text-caption text-fg-subtle">{t('ai.settings.corsNote')}</p>
          <div>
            <button
              type="button"
              onClick={clear}
              data-testid="ai-settings-clear"
              className="focus-ring rounded border border-border px-3 py-1.5 text-caption text-fg-muted hover:text-fg"
            >
              {t('ai.settings.clear')}
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
