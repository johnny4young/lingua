/**
 * Editable, drag-reorderable variable rows (key / value / secret / delete)
 * shared by environments, the collection and a request. Every edit goes
 * through the functional `onUpdate(updater)` so two edits in one tick compose.
 */

import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SecretStorageNote } from '../ui/SecretStorageNote';
import { createEnvVariable, looksSecret, type HttpEnvVariableV1 } from '../../../shared/httpEnvironment';

type VariablesUpdater = (variables: ReadonlyArray<HttpEnvVariableV1>) => HttpEnvVariableV1[];

export interface HttpVariableListProps {
  variables: ReadonlyArray<HttpEnvVariableV1>;
  onUpdate: (updater: VariablesUpdater) => void;
  /** Row whose value field takes focus when the list opens. */
  focusId?: string;
}

const FIELD_CLASS =
  'h-7 min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none';

export function HttpVariableList({ variables, onUpdate, focusId }: HttpVariableListProps) {
  const { t } = useTranslation();

  const patchRow = (rowId: string, patch: Partial<HttpEnvVariableV1>): void =>
    onUpdate((current) => current.map((variable) => (variable.id === rowId ? { ...variable, ...patch } : variable)));

  // Suggest `secret` once, when a key first starts to look secret; never re-set a secret the user turned off.
  const changeKey = (rowId: string, nextKey: string): void =>
    onUpdate((current) =>
      current.map((variable) => {
        if (variable.id !== rowId) return variable;
        const suggestSecret = !variable.secret && !looksSecret(variable.key) && looksSecret(nextKey);
        return suggestSecret ? { ...variable, key: nextKey, secret: true } : { ...variable, key: nextKey };
      })
    );

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onUpdate((current) => {
      const oldIndex = current.findIndex((v) => v.id === active.id);
      const newIndex = current.findIndex((v) => v.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return current.slice();
      return arrayMove(current.slice(), oldIndex, newIndex);
    });
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-caption font-semibold text-fg-base">{t('httpWorkspace.environment.manager.variablesLabel')}</span>
        <button
          type="button"
          onClick={() => onUpdate((current) => [...current, createEnvVariable({ key: '', value: '', secret: false })])}
          data-testid="http-environment-var-add"
          aria-label={t('httpWorkspace.environment.manager.addVariable')}
          title={t('httpWorkspace.environment.manager.addVariable')}
          className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-border-subtle text-fg-subtle transition-colors hover:bg-bg-inset hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </div>
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={variables.map((variable) => variable.id)} strategy={verticalListSortingStrategy}>
          <ul role="list" className="flex flex-col gap-1.5">
            {variables.map((variable) => (
              <HttpVariableRow
                key={variable.id}
                variable={variable}
                focusValue={variable.id === focusId}
                onKeyChange={(nextKey) => changeKey(variable.id, nextKey)}
                onValueChange={(value) => patchRow(variable.id, { value })}
                onSecretChange={(secret) => patchRow(variable.id, { secret })}
                onRemove={() => onUpdate((current) => current.filter((row) => row.id !== variable.id))}
              />
            ))}
            {variables.length === 0 ? (
              <li className="text-caption text-fg-subtle">{t('httpWorkspace.environment.manager.noVariables')}</li>
            ) : null}
          </ul>
        </SortableContext>
      </DndContext>
      {variables.some((variable) => variable.secret) ? <SecretStorageNote testId="http-environment-secret-storage" /> : null}
    </>
  );
}

interface HttpVariableRowProps {
  variable: HttpEnvVariableV1;
  focusValue: boolean;
  onKeyChange: (nextKey: string) => void;
  onValueChange: (value: string) => void;
  onSecretChange: (secret: boolean) => void;
  onRemove: () => void;
}

/** One sortable row; keyboard-reorderable per dnd-kit defaults (focus the handle, Space, arrows). */
function HttpVariableRow({ variable, focusValue, onKeyChange, onValueChange, onSecretChange, onRemove }: HttpVariableRowProps) {
  const { t } = useTranslation();
  const valueRef = useRef<HTMLInputElement>(null);
  // Runs before the modal's own initial focus, which keeps focus already inside it.
  useEffect(() => {
    if (focusValue) valueRef.current?.focus();
  }, [focusValue]);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: variable.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <li ref={setNodeRef} style={style} data-testid="http-environment-var-row" className="flex items-center gap-1.5">
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
        ref={valueRef}
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
