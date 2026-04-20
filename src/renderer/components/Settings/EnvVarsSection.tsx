import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEnvVarsStore } from '../../stores/envVarsStore';
import { Section } from './shared';

/**
 * RL-011 Slice C first increment — Settings UI for the **global**
 * env-var tier. Project and tab tiers need a richer selector + context
 * plumbing and are intentionally scoped to a later slice.
 *
 * The three-state picture stays truthful: this panel only edits `global`.
 * The badge copy explains precedence so users don't assume this is the
 * full story before project/tab tiers ship.
 */
export function EnvVarsSection() {
  const { t } = useTranslation();
  const globalScope = useEnvVarsStore((state) => state.global);
  const setGlobalVar = useEnvVarsStore((state) => state.setGlobalVar);
  const removeGlobalVar = useEnvVarsStore((state) => state.removeGlobalVar);

  const [keyDraft, setKeyDraft] = useState('');
  const [valueDraft, setValueDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const entries = Object.entries(globalScope).sort(([a], [b]) => a.localeCompare(b));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmedKey = keyDraft.trim();
    if (trimmedKey.length === 0) {
      setError(t('envVars.error.keyRequired'));
      return;
    }
    const accepted = setGlobalVar(trimmedKey, valueDraft);
    if (!accepted) {
      setError(t('envVars.error.rejected'));
      return;
    }
    setKeyDraft('');
    setValueDraft('');
  };

  const handleKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    setKeyDraft(event.target.value);
    if (error) setError(null);
  };

  const handleValueChange = (event: ChangeEvent<HTMLInputElement>) => {
    setValueDraft(event.target.value);
    if (error) setError(null);
  };

  return (
    <Section
      id="env-vars"
      title={t('envVars.title')}
      description={t('envVars.description')}
    >
      <form
        className="flex flex-col gap-2 rounded-[1.15rem] border border-border/80 bg-background-elevated/72 px-3.5 py-3 sm:flex-row sm:items-end sm:gap-3"
        onSubmit={handleSubmit}
        data-testid="env-vars-form"
      >
        <label className="grid flex-1 gap-1 text-xs font-medium text-foreground">
          <span>{t('envVars.keyLabel')}</span>
          <input
            type="text"
            className="field-shell"
            placeholder={t('envVars.keyPlaceholder')}
            value={keyDraft}
            onChange={handleKeyChange}
            aria-describedby={error ? 'env-vars-error' : undefined}
            aria-invalid={error ? true : undefined}
            data-testid="env-vars-key-input"
          />
        </label>
        <label className="grid flex-1 gap-1 text-xs font-medium text-foreground">
          <span>{t('envVars.valueLabel')}</span>
          <input
            type="text"
            className="field-shell"
            placeholder={t('envVars.valuePlaceholder')}
            value={valueDraft}
            onChange={handleValueChange}
            data-testid="env-vars-value-input"
          />
        </label>
        <button
          type="submit"
          className="button-primary sm:h-9"
          data-testid="env-vars-add-button"
        >
          {t('envVars.addButton')}
        </button>
      </form>

      {error && (
        <p
          id="env-vars-error"
          role="alert"
          className="text-xs text-error"
          data-testid="env-vars-error"
        >
          {error}
        </p>
      )}

      {entries.length === 0 ? (
        <p
          className="rounded-[1.15rem] border border-dashed border-border/60 bg-transparent px-3.5 py-4 text-xs text-muted"
          data-testid="env-vars-empty"
        >
          {t('envVars.empty')}
        </p>
      ) : (
        <ul className="space-y-1.5" data-testid="env-vars-list">
          {entries.map(([key, value]) => (
            <li
              key={key}
              className="flex items-center justify-between gap-3 rounded-[1.15rem] border border-border/80 bg-background-elevated/72 px-3.5 py-2.5 text-xs"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono font-semibold text-foreground">{key}</p>
                <p className="truncate font-mono text-muted" title={value}>
                  {value === '' ? t('envVars.emptyValueDisplay') : value}
                </p>
              </div>
              <button
                type="button"
                className="button-secondary h-8 w-8 px-0"
                aria-label={t('envVars.removeAriaLabel', { key })}
                onClick={() => removeGlobalVar(key)}
                data-testid={`env-vars-remove-${key}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted" data-testid="env-vars-precedence-note">
        {t('envVars.precedenceNote')}
      </p>
    </Section>
  );
}
