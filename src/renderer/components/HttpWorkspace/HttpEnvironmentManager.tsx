/**
 * RL-097 Slice 3a — minimal HTTP environment manager modal.
 *
 * CRUD over the store's environments: add / rename / delete an
 * environment, and per-environment add / edit / delete / secret-toggle
 * of its variable rows. Reuses the canonical `ModalShell` chrome
 * (blurred scrim, header with an x close button, scrollable body, footer
 * legend) so it matches the snippets / utilities / capsules overlays.
 *
 * Privacy note: secret variable values render in a masked
 * `type="password"` input — the value is still editable, just not
 * shoulder-surfable. The mask here is a display nicety; the real
 * secret-leak guarantees live in `httpEnvironment.ts` (capsule / cURL /
 * response / telemetry never carry a resolved secret).
 *
 * The manager edits the store directly via the action props the panel
 * wires; it keeps no local draft of the environment list (the store is
 * the source of truth), so two open surfaces never diverge.
 */

import { Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '../ui/ModalShell';
import {
  createBlankHttpEnvironment,
  type HttpEnvironmentV1,
  type HttpEnvVariableV1,
} from '../../../shared/httpEnvironment';

export interface HttpEnvironmentManagerProps {
  environments: ReadonlyArray<HttpEnvironmentV1>;
  onClose: () => void;
  onCreate: (env: HttpEnvironmentV1) => void;
  onUpdate: (id: string, patch: Partial<HttpEnvironmentV1>) => void;
  onDelete: (id: string) => void;
}

const FIELD_CLASS =
  'h-7 min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-[11px] text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none';

export function HttpEnvironmentManager({
  environments,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: HttpEnvironmentManagerProps) {
  const { t } = useTranslation();
  const titleId = useId();

  // Which environment is expanded for editing. Default to the first one;
  // falls back gracefully when the list changes (the resolved selection
  // is derived during render, never stored stale).
  const [selectedId, setSelectedId] = useState<string | null>(
    environments[0]?.id ?? null
  );
  const selected =
    environments.find((e) => e.id === selectedId) ?? environments[0] ?? null;

  const handleAddEnvironment = (): void => {
    const env = createBlankHttpEnvironment({
      id: crypto.randomUUID(),
      name: '',
    });
    onCreate(env);
    setSelectedId(env.id);
  };

  const handleRename = (id: string, name: string): void => {
    onUpdate(id, { name });
  };

  const setVariables = (
    env: HttpEnvironmentV1,
    variables: HttpEnvVariableV1[]
  ): void => {
    onUpdate(env.id, { variables });
  };

  const handleAddVariable = (env: HttpEnvironmentV1): void => {
    setVariables(env, [
      ...env.variables,
      { key: '', value: '', secret: false },
    ]);
  };

  const handleUpdateVariable = (
    env: HttpEnvironmentV1,
    index: number,
    patch: Partial<HttpEnvVariableV1>
  ): void => {
    const next = env.variables.slice();
    const current = next[index];
    if (!current) return;
    next[index] = { ...current, ...patch };
    setVariables(env, next);
  };

  const handleRemoveVariable = (
    env: HttpEnvironmentV1,
    index: number
  ): void => {
    setVariables(
      env,
      env.variables.filter((_, i) => i !== index)
    );
  };

  return (
    <ModalShell
      onClose={onClose}
      labelledById={titleId}
      headerClose="button"
      closeLabel={t('httpWorkspace.environment.manager.close')}
      size="max-w-[560px]"
      header={
        <h2
          id={titleId}
          className="text-sm font-semibold text-fg-base"
          data-testid="http-environment-manager"
        >
          {t('httpWorkspace.environment.manager.title')}
        </h2>
      }
      footerLegend={
        <button
          type="button"
          onClick={handleAddEnvironment}
          data-testid="http-environment-add"
          className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-[11.5px] font-medium text-fg-base transition-colors hover:bg-bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <Plus size={12} aria-hidden="true" />
          <span>{t('httpWorkspace.environment.manager.addEnvironment')}</span>
        </button>
      }
    >
      {environments.length === 0 ? (
        <p
          data-testid="http-environment-empty"
          className="px-1 py-6 text-center text-[12px] text-fg-subtle"
        >
          {t('httpWorkspace.environment.manager.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Environment switcher row — one chip per environment. */}
          {environments.length > 1 ? (
            <div
              role="tablist"
              aria-label={t('httpWorkspace.environment.manager.title')}
              className="flex flex-wrap items-center gap-1"
            >
              {environments.map((env) => {
                const active = selected?.id === env.id;
                return (
                  <button
                    key={env.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelectedId(env.id)}
                    className={
                      active
                        ? 'rounded-md bg-bg-inset px-2.5 py-1 text-[11.5px] font-semibold text-fg-base'
                        : 'rounded-md px-2.5 py-1 text-[11.5px] text-fg-subtle transition-colors hover:text-fg-base'
                    }
                  >
                    {env.name.length > 0
                      ? env.name
                      : t('httpWorkspace.environment.unnamed')}
                  </button>
                );
              })}
            </div>
          ) : null}

          {selected ? (
            <section className="flex flex-col gap-2">
              {/* Name + delete environment */}
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="http-environment-name">
                  {t('httpWorkspace.environment.manager.nameLabel')}
                </label>
                <input
                  id="http-environment-name"
                  type="text"
                  value={selected.name}
                  onChange={(event) =>
                    handleRename(selected.id, event.target.value)
                  }
                  placeholder={t(
                    'httpWorkspace.environment.manager.namePlaceholder'
                  )}
                  aria-label={t('httpWorkspace.environment.manager.nameLabel')}
                  data-testid="http-environment-name"
                  className="h-8 min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-inset px-2.5 text-xs font-medium text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => onDelete(selected.id)}
                  data-testid="http-environment-delete"
                  aria-label={t(
                    'httpWorkspace.environment.manager.deleteEnvironment'
                  )}
                  title={t('httpWorkspace.environment.manager.deleteEnvironment')}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-subtle text-fg-subtle transition-colors hover:text-error-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>

              {/* Variable table */}
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] font-semibold text-fg-base">
                  {t('httpWorkspace.environment.manager.variablesLabel')}
                </span>
                <button
                  type="button"
                  onClick={() => handleAddVariable(selected)}
                  data-testid="http-environment-var-add"
                  aria-label={t('httpWorkspace.environment.manager.addVariable')}
                  title={t('httpWorkspace.environment.manager.addVariable')}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-border-subtle text-fg-subtle transition-colors hover:bg-bg-inset hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <Plus size={12} aria-hidden="true" />
                </button>
              </div>
              <ul role="list" className="flex flex-col gap-1.5">
                {selected.variables.map((variable, index) => (
                  <li key={index} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={variable.key}
                      onChange={(event) =>
                        handleUpdateVariable(selected, index, {
                          key: event.target.value,
                        })
                      }
                      placeholder={t(
                        'httpWorkspace.environment.manager.keyPlaceholder'
                      )}
                      aria-label={t(
                        'httpWorkspace.environment.manager.keyPlaceholder'
                      )}
                      data-testid="http-environment-var-key"
                      className="h-7 w-36 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-[11px] text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
                    />
                    <input
                      type={variable.secret ? 'password' : 'text'}
                      value={variable.value}
                      onChange={(event) =>
                        handleUpdateVariable(selected, index, {
                          value: event.target.value,
                        })
                      }
                      placeholder={t(
                        'httpWorkspace.environment.manager.valuePlaceholder'
                      )}
                      aria-label={t(
                        'httpWorkspace.environment.manager.valuePlaceholder'
                      )}
                      data-testid="http-environment-var-value"
                      className={FIELD_CLASS}
                    />
                    <label className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-fg-subtle">
                      <input
                        type="checkbox"
                        checked={variable.secret}
                        onChange={(event) =>
                          handleUpdateVariable(selected, index, {
                            secret: event.target.checked,
                          })
                        }
                        data-testid="http-environment-var-secret"
                        aria-label={t(
                          'httpWorkspace.environment.manager.secretToggle'
                        )}
                      />
                      <span>
                        {t('httpWorkspace.environment.manager.secretToggle')}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => handleRemoveVariable(selected, index)}
                      data-testid="http-environment-var-delete"
                      aria-label={t(
                        'httpWorkspace.environment.manager.removeVariable'
                      )}
                      title={t('httpWorkspace.environment.manager.removeVariable')}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:text-error-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                    >
                      <Trash2 size={11} aria-hidden="true" />
                    </button>
                  </li>
                ))}
                {selected.variables.length === 0 ? (
                  <li className="text-[11px] text-fg-subtle">
                    {t('httpWorkspace.environment.manager.noVariables')}
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </ModalShell>
  );
}
