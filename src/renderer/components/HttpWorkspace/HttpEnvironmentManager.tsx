/**
 * implementationa + 3b — HTTP environment manager modal.
 *
 * CRUD over the store's environments: add / rename / duplicate / delete an
 * environment, per-environment add / edit / delete / secret-toggle /
 * DRAG-REORDER of its variable rows, and environment
 * import / export as JSON. Reuses the canonical
 * `ModalShell` chrome so it matches the snippets / utilities / capsules
 * overlays.
 *
 * Privacy notes :
 *
 *   - Secret variable values render in a masked `type="password"` input —
 *     a display nicety; the real secret-leak guarantees live in
 *     `httpEnvironment.ts`.
 *   - EXPORT is privacy-sensitive: a `secret: true` value is blanked to
 *     `''` and all instance-local ids stripped by `toExportableEnvironment`
 *     (invoked via the store's `exportEnvironmentJson`). A shared file
 *     NEVER carries a resolved secret. The manager only copies that
 *     already-safe JSON to the clipboard.
 *
 * Mutation discipline: add / edit / delete / reorder of
 * variable rows route through the store's FUNCTIONAL
 * `onUpdateVariables(updater)` rather than a render-time
 * `onUpdate({ variables: [...prop] })`, so two adds dispatched in one tick
 * compose instead of clobbering. The manager keeps no local draft of the
 * environment list (the store is the source of truth).
 */

import { Copy, Plus, Trash2, Upload } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '../ui/ModalShell';
import { useUIStore } from '../../stores/uiStore';
import { writeToClipboard } from '../../utils/clipboard';
import '../../i18n/httpBuilderCatalog';
import {
  createBlankHttpEnvironment,
  environmentColor,
  HTTP_COLLECTION_SCOPE_ID,
  HTTP_ENVIRONMENT_COLORS,
  type HttpEnvironmentColor,
  type HttpEnvironmentV1,
  type HttpEnvVariableV1,
} from '../../../shared/httpEnvironment';
import { ENVIRONMENT_TINTS } from './httpScopeColors';
import type { HttpEnvironmentFocus } from './httpScopes';
import { HttpVariableList } from './HttpVariableList';

type VariablesUpdater = (variables: ReadonlyArray<HttpEnvVariableV1>) => HttpEnvVariableV1[];

export interface HttpEnvironmentManagerProps {
  environments: ReadonlyArray<HttpEnvironmentV1>;
  onClose: () => void;
  onCreate: (env: HttpEnvironmentV1) => void;
  onUpdate: (id: string, patch: Partial<HttpEnvironmentV1>) => void;
  /**
   * Functional variable update (collapse-safe). The
   * manager passes an `updater` the store applies to the CURRENT variable
   * list. Routes every add / edit / delete / reorder so concurrent updates
   * compose.
   */
  onUpdateVariables: (
    id: string,
    updater: (variables: ReadonlyArray<HttpEnvVariableV1>) => HttpEnvVariableV1[]
  ) => void;
  onDelete: (id: string) => void;
  /** Clone an environment (no auto-activate). */
  onDuplicate: (id: string) => void;
  /**
   * Serialise the env to share-safe JSON (secrets
   * blanked, ids stripped). Null on failure.
   */
  onExport: (id: string) => string | null;
  /**
   * Import an exported environment JSON (mints a fresh
   * id, appends). `{ ok: false }` on malformed input.
   */
  onImport: (json: string) => { ok: true; id: string } | { ok: false };
  /** With variable scopes on: the collection's variables and a colour per environment. */
  scopes?: {
    collectionVariables: ReadonlyArray<HttpEnvVariableV1>;
    onUpdateCollection: (updater: VariablesUpdater) => void;
  };
  /** Opens on this environment with the row's value field focused. */
  focus?: HttpEnvironmentFocus | null;
}

export function HttpEnvironmentManager({
  environments,
  onClose,
  onCreate,
  onUpdate,
  onUpdateVariables,
  onDelete,
  onDuplicate,
  onExport,
  onImport,
  scopes,
  focus,
}: HttpEnvironmentManagerProps) {
  const { t } = useTranslation();
  const titleId = useId();

  // Which environment is expanded for editing. Default to the first one;
  // falls back gracefully when the list changes (the resolved selection
  // is derived during render, never stored stale).
  const [selectedId, setSelectedId] = useState<string | null>(
    focus?.environmentId ?? environments[0]?.id ?? (scopes ? HTTP_COLLECTION_SCOPE_ID : null)
  );
  const collectionSelected = scopes !== undefined && (selectedId === HTTP_COLLECTION_SCOPE_ID || environments.length === 0);
  const selected = collectionSelected
    ? null
    : (environments.find((e) => e.id === selectedId) ?? environments[0] ?? null);

  // Import affordance (mirrors the pipeline importer): a textarea + confirm.
  const importTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importValue, setImportValue] = useState('');

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

  const handleExport = useCallback(
    async (env: HttpEnvironmentV1) => {
      const json = onExport(env.id);
      if (json === null) {
        useUIStore.getState().pushStatusNotice({
          tone: 'warning',
          messageKey: 'httpWorkspace.environment.manager.importFailed',
        });
        return;
      }
      const ok = await writeToClipboard(json);
      useUIStore.getState().pushStatusNotice({
        tone: ok ? 'success' : 'warning',
        messageKey: ok
          ? 'httpWorkspace.environment.manager.exported'
          : 'httpWorkspace.editor.copyCurl.failed',
      });
    },
    [onExport]
  );

  const handleOpenImport = useCallback(() => {
    setImportOpen(true);
    setImportValue('');
    // Defer focus so the textarea exists in the DOM.
    setTimeout(() => importTextareaRef.current?.focus(), 0);
  }, []);

  const handleConfirmImport = useCallback(() => {
    if (!importValue.trim()) return;
    const result = onImport(importValue);
    if (result.ok) {
      setImportOpen(false);
      setImportValue('');
      setSelectedId(result.id);
    } else {
      useUIStore.getState().pushStatusNotice({
        tone: 'error',
        messageKey: 'httpWorkspace.environment.manager.importFailed',
      });
    }
  }, [importValue, onImport]);

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
          className="text-body font-semibold text-fg-base"
          data-testid="http-environment-manager"
        >
          {t('httpWorkspace.environment.manager.title')}
        </h2>
      }
      footerLegend={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAddEnvironment}
            data-testid="http-environment-add"
            className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-caption font-medium text-fg-base transition-colors hover:bg-bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            <Plus size={12} aria-hidden="true" />
            <span>{t('httpWorkspace.environment.manager.addEnvironment')}</span>
          </button>
          <button
            type="button"
            onClick={handleOpenImport}
            data-testid="http-environment-import"
            className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-caption font-medium text-fg-subtle transition-colors hover:bg-bg-inset hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            <Upload size={12} aria-hidden="true" />
            <span>{t('httpWorkspace.environment.manager.import')}</span>
          </button>
        </div>
      }
    >
      {importOpen ? (
        <div
          data-testid="http-environment-import-panel"
          className="mb-3 flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-inset p-2"
        >
          <textarea
            spellCheck={false}
            ref={importTextareaRef}
            value={importValue}
            onChange={(event) => setImportValue(event.target.value)}
            data-testid="http-environment-import-textarea"
            placeholder={t('httpWorkspace.environment.manager.importPlaceholder')}
            rows={4}
            className="rounded-md border border-border-subtle bg-bg-panel px-2 py-1 font-mono text-eyebrow text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setImportOpen(false);
                setImportValue('');
              }}
              data-testid="http-environment-import-cancel"
              className="inline-flex h-6 items-center rounded-md border border-border-subtle px-2 text-caption text-fg-subtle transition-colors hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              {t('httpWorkspace.environment.manager.importCancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirmImport}
              disabled={!importValue.trim()}
              data-testid="http-environment-import-confirm"
              className="inline-flex h-6 items-center rounded-md border border-accent bg-accent px-2 text-caption font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              {t('httpWorkspace.environment.manager.importConfirm')}
            </button>
          </div>
        </div>
      ) : null}

      {environments.length === 0 && !scopes ? (
        <p
          data-testid="http-environment-empty"
          className="px-1 py-6 text-center text-body-sm text-fg-subtle"
        >
          {t('httpWorkspace.environment.manager.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Environment switcher row — one chip per environment. */}
          {environments.length > 1 || scopes ? (
            <div
              role="tablist"
              aria-label={t('httpWorkspace.environment.manager.title')}
              className="flex flex-wrap items-center gap-1"
            >
              {scopes ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={collectionSelected}
                  data-testid="http-environment-collection-tab"
                  onClick={() => setSelectedId(HTTP_COLLECTION_SCOPE_ID)}
                  className={
                    collectionSelected
                      ? 'rounded-md bg-bg-inset px-2.5 py-1 text-caption font-semibold text-fg-base'
                      : 'rounded-md px-2.5 py-1 text-caption text-fg-subtle transition-colors hover:text-fg-base'
                  }
                >
                  {t('httpWorkspace.environment.manager.collection')}
                </button>
              ) : null}
              {environments.map((env) => {
                const active = selected?.id === env.id;
                const tint = scopes ? environmentColor(env) : undefined;
                return (
                  <button
                    key={env.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelectedId(env.id)}
                    className={
                      active
                        ? 'rounded-md bg-bg-inset px-2.5 py-1 text-caption font-semibold text-fg-base'
                        : 'rounded-md px-2.5 py-1 text-caption text-fg-subtle transition-colors hover:text-fg-base'
                    }
                  >
                    {tint ? (
                      <span
                        aria-hidden="true"
                        className="mr-1.5 inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: ENVIRONMENT_TINTS[tint].line }}
                      />
                    ) : null}
                    {env.name.length > 0
                      ? env.name
                      : t('httpWorkspace.environment.unnamed')}
                  </button>
                );
              })}
            </div>
          ) : null}

          {collectionSelected && scopes ? (
            <section data-testid="http-environment-collection" className="flex flex-col gap-2">
              <p className="text-caption text-fg-subtle">{t('httpWorkspace.environment.manager.collectionHint')}</p>
              <HttpVariableList variables={scopes.collectionVariables} onUpdate={scopes.onUpdateCollection} />
            </section>
          ) : null}

          {selected ? (
            <section className="flex flex-col gap-2">
              {/* Name + duplicate + delete environment */}
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
                  className="h-8 min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-inset px-2.5 text-body-sm font-medium text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleExport(selected)}
                  data-testid="http-environment-export"
                  aria-label={t('httpWorkspace.environment.manager.export')}
                  title={t('httpWorkspace.environment.manager.export')}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-subtle text-fg-subtle transition-colors hover:bg-bg-inset hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <Copy size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onDuplicate(selected.id)}
                  data-testid="http-environment-duplicate"
                  aria-label={t(
                    'httpWorkspace.environment.manager.duplicateEnvironment'
                  )}
                  title={t(
                    'httpWorkspace.environment.manager.duplicateEnvironment'
                  )}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-subtle text-fg-subtle transition-colors hover:bg-bg-inset hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <Plus size={13} aria-hidden="true" />
                </button>
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

              {scopes ? (
                <HttpEnvironmentColorPicker
                  value={environmentColor(selected)}
                  onChange={(color) => onUpdate(selected.id, { color: color ?? 'none' })}
                />
              ) : null}
              <HttpVariableList
                variables={selected.variables}
                onUpdate={(updater) => onUpdateVariables(selected.id, updater)}
                {...(focus?.environmentId === selected.id ? { focusId: focus.variableId } : {})}
              />
            </section>
          ) : null}
        </div>
      )}
    </ModalShell>
  );
}

/** None plus one swatch per theme hue; the chosen colour tints the HTTP tab and Send. */
function HttpEnvironmentColorPicker({
  value,
  onChange,
}: {
  value: HttpEnvironmentColor | undefined;
  onChange: (color: HttpEnvironmentColor | undefined) => void;
}) {
  const { t } = useTranslation();
  const swatch = 'inline-flex h-6 w-6 items-center justify-center rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70';
  return (
    <div
      role="radiogroup"
      aria-label={t('httpWorkspace.environment.manager.color')}
      data-testid="http-environment-color"
      className="flex items-center gap-1.5"
    >
      <span className="mr-1 text-caption font-semibold text-fg-base">{t('httpWorkspace.environment.manager.color')}</span>
      <button
        type="button"
        role="radio"
        aria-checked={value === undefined}
        aria-label={t('httpWorkspace.environment.manager.colorNone')}
        title={t('httpWorkspace.environment.manager.colorNone')}
        onClick={() => onChange(undefined)}
        className={`${swatch} border-border-default text-micro text-fg-subtle`}
      >
        {value === undefined ? '✓' : ''}
      </button>
      {HTTP_ENVIRONMENT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={t(`httpWorkspace.environment.manager.colorName.${color}`)}
          title={t(`httpWorkspace.environment.manager.colorName.${color}`)}
          data-color={color}
          onClick={() => onChange(color)}
          className={`${swatch} text-micro text-fg-on-accent`}
          style={{ backgroundColor: ENVIRONMENT_TINTS[color].line, borderColor: ENVIRONMENT_TINTS[color].line }}
        >
          {value === color ? '✓' : ''}
        </button>
      ))}
    </div>
  );
}
