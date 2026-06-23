/**
 * RL-097 Slices 3a + 3b — HTTP environment manager modal.
 *
 * CRUD over the store's environments: add / rename / duplicate / delete an
 * environment, per-environment add / edit / delete / secret-toggle /
 * DRAG-REORDER of its variable rows (Slice 3b fold A), and environment
 * import / export as JSON (Slice 3b fold B). Reuses the canonical
 * `ModalShell` chrome so it matches the snippets / utilities / capsules
 * overlays.
 *
 * Privacy notes (Slice 3b):
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
 * Mutation discipline (Slice 3b fold D): add / edit / delete / reorder of
 * variable rows route through the store's FUNCTIONAL
 * `onUpdateVariables(updater)` rather than a render-time
 * `onUpdate({ variables: [...prop] })`, so two adds dispatched in one tick
 * compose instead of clobbering. The manager keeps no local draft of the
 * environment list (the store is the source of truth).
 */

import { Copy, GripVertical, Plus, Trash2, Upload } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ModalShell } from '../ui/ModalShell';
import { useUIStore } from '../../stores/uiStore';
import { writeToClipboard } from '../../utils/clipboard';
import {
  createBlankHttpEnvironment,
  createEnvVariable,
  looksSecret,
  type HttpEnvironmentV1,
  type HttpEnvVariableV1,
} from '../../../shared/httpEnvironment';

export interface HttpEnvironmentManagerProps {
  environments: ReadonlyArray<HttpEnvironmentV1>;
  onClose: () => void;
  onCreate: (env: HttpEnvironmentV1) => void;
  onUpdate: (id: string, patch: Partial<HttpEnvironmentV1>) => void;
  /**
   * RL-097 Slice 3b — functional variable update (collapse-safe). The
   * manager passes an `updater` the store applies to the CURRENT variable
   * list. Routes every add / edit / delete / reorder so concurrent updates
   * compose.
   */
  onUpdateVariables: (
    id: string,
    updater: (variables: ReadonlyArray<HttpEnvVariableV1>) => HttpEnvVariableV1[]
  ) => void;
  onDelete: (id: string) => void;
  /** RL-097 Slice 3b — clone an environment (no auto-activate). */
  onDuplicate: (id: string) => void;
  /**
   * RL-097 Slice 3b — serialise the env to share-safe JSON (secrets
   * blanked, ids stripped). Null on failure.
   */
  onExport: (id: string) => string | null;
  /**
   * RL-097 Slice 3b — import an exported environment JSON (mints a fresh
   * id, appends). `{ ok: false }` on malformed input.
   */
  onImport: (json: string) => { ok: true; id: string } | { ok: false };
}

const FIELD_CLASS =
  'h-7 min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none';

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

  const handleAddVariable = (env: HttpEnvironmentV1): void => {
    // Functional update — appends a freshly-id'd blank row onto whatever
    // the current list is, so a double-click never collapses two adds.
    onUpdateVariables(env.id, (variables) => [
      ...variables,
      createEnvVariable({ key: '', value: '', secret: false }),
    ]);
  };

  const handleUpdateVariable = (
    env: HttpEnvironmentV1,
    rowId: string,
    patch: Partial<HttpEnvVariableV1>
  ): void => {
    onUpdateVariables(env.id, (variables) =>
      variables.map((variable) =>
        variable.id === rowId ? { ...variable, ...patch } : variable
      )
    );
  };

  // Secret-by-default (Slice 3b fold E) — on a KEY edit, auto-suggest
  // `secret: true` exactly once when the NEW key looks secret, the OLD key
  // did not, and the row is not already secret. Never overrides a user who
  // explicitly unset secret (the guard `!variable.secret` plus the
  // old-key-did-not-match condition ensures a single nudge, not a sticky
  // override on every subsequent keystroke of a token-like name).
  const handleKeyChange = (
    env: HttpEnvironmentV1,
    rowId: string,
    nextKey: string
  ): void => {
    onUpdateVariables(env.id, (variables) =>
      variables.map((variable) => {
        if (variable.id !== rowId) return variable;
        const shouldSuggestSecret =
          !variable.secret &&
          !looksSecret(variable.key) &&
          looksSecret(nextKey);
        return shouldSuggestSecret
          ? { ...variable, key: nextKey, secret: true }
          : { ...variable, key: nextKey };
      })
    );
  };

  const handleRemoveVariable = (
    env: HttpEnvironmentV1,
    rowId: string
  ): void => {
    onUpdateVariables(env.id, (variables) =>
      variables.filter((variable) => variable.id !== rowId)
    );
  };

  const handleDragEnd = (env: HttpEnvironmentV1, event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onUpdateVariables(env.id, (variables) => {
      const oldIndex = variables.findIndex((v) => v.id === active.id);
      const newIndex = variables.findIndex((v) => v.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return variables.slice();
      return arrayMove(variables.slice(), oldIndex, newIndex);
    });
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
              className="inline-flex h-6 items-center rounded-md border border-accent bg-accent px-2 text-caption font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              {t('httpWorkspace.environment.manager.importConfirm')}
            </button>
          </div>
        </div>
      ) : null}

      {environments.length === 0 ? (
        <p
          data-testid="http-environment-empty"
          className="px-1 py-6 text-center text-body-sm text-fg-subtle"
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
                        ? 'rounded-md bg-bg-inset px-2.5 py-1 text-caption font-semibold text-fg-base'
                        : 'rounded-md px-2.5 py-1 text-caption text-fg-subtle transition-colors hover:text-fg-base'
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

              {/* Variable table */}
              <div className="flex items-center gap-2">
                <span className="text-caption font-semibold text-fg-base">
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
              <DndContext
                collisionDetection={closestCenter}
                onDragEnd={(event) => handleDragEnd(selected, event)}
              >
                <SortableContext
                  items={selected.variables.map((variable) => variable.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul role="list" className="flex flex-col gap-1.5">
                    {selected.variables.map((variable) => (
                      <HttpEnvironmentVariableRow
                        key={variable.id}
                        variable={variable}
                        onKeyChange={(nextKey) =>
                          handleKeyChange(selected, variable.id, nextKey)
                        }
                        onValueChange={(value) =>
                          handleUpdateVariable(selected, variable.id, { value })
                        }
                        onSecretChange={(secret) =>
                          handleUpdateVariable(selected, variable.id, { secret })
                        }
                        onRemove={() =>
                          handleRemoveVariable(selected, variable.id)
                        }
                      />
                    ))}
                    {selected.variables.length === 0 ? (
                      <li className="text-caption text-fg-subtle">
                        {t('httpWorkspace.environment.manager.noVariables')}
                      </li>
                    ) : null}
                  </ul>
                </SortableContext>
              </DndContext>
            </section>
          ) : null}
        </div>
      )}
    </ModalShell>
  );
}

interface HttpEnvironmentVariableRowProps {
  variable: HttpEnvVariableV1;
  onKeyChange: (nextKey: string) => void;
  onValueChange: (value: string) => void;
  onSecretChange: (secret: boolean) => void;
  onRemove: () => void;
}

/**
 * One sortable variable row. Drag handle + key / value / secret-toggle /
 * delete. Sortable via @dnd-kit (keyed by the row's opaque
 * `variable.id` — Slice 3b fold A); keyboard-reorderable per dnd-kit
 * defaults (focus the handle, Space to lift, arrows to move).
 */
function HttpEnvironmentVariableRow({
  variable,
  onKeyChange,
  onValueChange,
  onSecretChange,
  onRemove,
}: HttpEnvironmentVariableRowProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: variable.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid="http-environment-var-row"
      className="flex items-center gap-1.5"
    >
      <button
        type="button"
        data-testid="http-environment-var-drag"
        aria-label={t('httpWorkspace.environment.manager.reorderVariable')}
        title={t('httpWorkspace.environment.manager.reorderVariable')}
        className="inline-flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={13} aria-hidden="true" />
      </button>
      <input
        type="text"
        value={variable.key}
        onChange={(event) => onKeyChange(event.target.value)}
        placeholder={t('httpWorkspace.environment.manager.keyPlaceholder')}
        aria-label={t('httpWorkspace.environment.manager.keyPlaceholder')}
        data-testid="http-environment-var-key"
        className="h-7 w-36 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
      />
      <input
        type={variable.secret ? 'password' : 'text'}
        value={variable.value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={t('httpWorkspace.environment.manager.valuePlaceholder')}
        aria-label={t('httpWorkspace.environment.manager.valuePlaceholder')}
        data-testid="http-environment-var-value"
        className={FIELD_CLASS}
      />
      <label className="inline-flex shrink-0 items-center gap-1 text-eyebrow text-fg-subtle">
        <input
          type="checkbox"
          checked={variable.secret}
          onChange={(event) => onSecretChange(event.target.checked)}
          data-testid="http-environment-var-secret"
          aria-label={t('httpWorkspace.environment.manager.secretToggle')}
        />
        <span>{t('httpWorkspace.environment.manager.secretToggle')}</span>
      </label>
      <button
        type="button"
        onClick={onRemove}
        data-testid="http-environment-var-delete"
        aria-label={t('httpWorkspace.environment.manager.removeVariable')}
        title={t('httpWorkspace.environment.manager.removeVariable')}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:text-error-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        <Trash2 size={11} aria-hidden="true" />
      </button>
    </li>
  );
}
