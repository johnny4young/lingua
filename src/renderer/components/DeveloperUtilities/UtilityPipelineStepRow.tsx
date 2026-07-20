/**
 * implementation — single-step row in the pipeline editor.
 *
 * Renders the utility dropdown, the schema-driven options form
 * (implementation note: each adapter declares its options shape; this component
 * auto-renders the matching `<input>` / `<select>` / `<textarea>` /
 * checkbox), and the step status badge. Sortable via @dnd-kit
 * (implementation note).
 */

import { GripVertical, Trash2 } from 'lucide-react';
import { useCallback, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../../utils/cn';
import {
  type PipelineStepStatus,
  type PipelineStepV1,
} from '../../../shared/utilityPipeline';
import {
  UTILITY_ADAPTER_IDS,
  type UtilityAdapterId,
  type UtilityOptionField,
} from '../../../shared/utilities/types';
import { getAdapter } from '../../../shared/utilities/registry';

const STATUS_TONE: Record<PipelineStepStatus, string> = {
  ok: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 ring-emerald-500/30',
  error: 'text-rose-700 dark:text-rose-300 bg-rose-500/15 ring-rose-500/30',
  skipped: 'text-muted bg-surface-strong/40 ring-border/40',
  timeout: 'text-amber-700 dark:text-amber-300 bg-amber-500/15 ring-amber-500/30',
  incompatible:
    'text-amber-700 dark:text-amber-300 bg-amber-500/15 ring-amber-500/30',
};

// Keep this map total over PipelineStepStatus: adding a runner status should
// fail typecheck until the row has an intentional visual affordance for it.
const STATUS_GLYPH: Record<PipelineStepStatus, string> = {
  ok: '✓',
  error: '✗',
  skipped: '⊘',
  timeout: '⏱',
  incompatible: '⚠',
};

export interface UtilityPipelineStepRowProps {
  step: PipelineStepV1;
  index: number;
  status: PipelineStepStatus | null;
  errorMessage?: string;
  onUtilityChange: (stepId: string, newUtilityId: UtilityAdapterId) => void;
  onOptionsChange: (stepId: string, nextOptions: Record<string, unknown>) => void;
  onDelete: (stepId: string) => void;
}

export function UtilityPipelineStepRow({
  step,
  index,
  status,
  errorMessage,
  onUtilityChange,
  onOptionsChange,
  onDelete,
}: UtilityPipelineStepRowProps) {
  const { t } = useTranslation();
  const adapter = getAdapter(step.utilityId);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: step.id });

  const handleUtilityChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onUtilityChange(step.id, event.target.value as UtilityAdapterId);
    },
    [step.id, onUtilityChange]
  );

  const handleOptionChange = useCallback(
    (key: string, value: unknown) => {
      // Preserve unknown option keys during edits. Older saved pipelines can
      // carry adapter options that current schemas no longer render; dropping
      // them here would make a harmless UI visit mutate persisted data.
      onOptionsChange(step.id, { ...step.options, [key]: value });
    },
    [step.id, step.options, onOptionsChange]
  );

  // @dnd-kit supplies transform-only movement, so the row keeps a stable box
  // in the list while the drag overlay handles the pointer-following clone.
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="utility-pipeline-step-row"
      data-step-id={step.id}
      data-status={status ?? 'pending'}
      className="flex flex-col gap-2 rounded-lg border border-border/60 bg-surface/30 p-3"
    >
      <header className="flex items-center gap-2">
        <button
          type="button"
          aria-label={t('utilityPipeline.step.dragHandleAria', { index: index + 1 })}
          className="cursor-grab text-muted hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>
        <span className="text-eyebrow font-bold uppercase tracking-wider text-muted">
          {t('utilityPipeline.step.indexLabel', { index: index + 1 })}
        </span>
        <select
          value={step.utilityId}
          onChange={handleUtilityChange}
          data-testid="utility-pipeline-step-utility"
          aria-label={t('utilityPipeline.step.utilityLabel')}
          className="min-w-[180px] rounded-md border border-border/60 bg-background px-2 py-1 text-body-sm"
        >
          {UTILITY_ADAPTER_IDS.map((id) => {
            const a = getAdapter(id);
            return (
              <option key={id} value={id}>
                {a ? t(a.titleKey) : id}
              </option>
            );
          })}
        </select>
        {status ? (
          <span
            data-testid="utility-pipeline-step-status"
            data-status={status}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-eyebrow font-medium ring-1',
              STATUS_TONE[status]
            )}
          >
            <span aria-hidden="true">{STATUS_GLYPH[status]}</span>
            <span>{t(`utilityPipeline.step.status.${status}`)}</span>
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => onDelete(step.id)}
          aria-label={t('utilityPipeline.step.deleteAria', { index: index + 1 })}
          data-testid="utility-pipeline-step-delete"
          className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:text-rose-500"
        >
          <Trash2 size={11} aria-hidden="true" />
        </button>
      </header>

      {adapter && adapter.optionsSchema.length > 0 ? (
        <div className="grid gap-2">
          {adapter.optionsSchema.map((field) => (
            <OptionFieldInput
              key={field.key}
              field={field}
              value={step.options[field.key]}
              onChange={(value) => handleOptionChange(field.key, value)}
            />
          ))}
        </div>
      ) : null}

      {status === 'error' || status === 'timeout' || status === 'incompatible' ? (
        errorMessage ? (
          <pre
            data-testid="utility-pipeline-step-error"
            className="whitespace-pre-wrap break-all rounded bg-rose-500/10 p-2 font-mono text-eyebrow text-rose-200"
          >
            {errorMessage}
          </pre>
        ) : null
      ) : null}
    </div>
  );
}

interface OptionFieldInputProps {
  field: UtilityOptionField;
  value: unknown;
  onChange: (value: unknown) => void;
}

function OptionFieldInput({ field, value, onChange }: OptionFieldInputProps) {
  const { t } = useTranslation();
  // The registry owns user-facing option metadata. This component only
  // coerces stale/unknown persisted values back to schema defaults so one
  // broken option cannot poison the whole pipeline editor.
  const placeholder =
    field.type === 'text' || field.type === 'textarea'
      ? field.placeholderKey
        ? t(field.placeholderKey)
        : undefined
      : undefined;
  if (field.type === 'text') {
    return (
      <label className="grid gap-1 text-eyebrow">
        <span className="text-muted">{t(field.labelKey)}</span>
        <input
          type="text"
          value={typeof value === 'string' ? value : field.defaultValue}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          data-testid={`utility-pipeline-step-option-${field.key}`}
          className="rounded border border-border/60 bg-background px-2 py-1 font-mono text-caption"
        />
      </label>
    );
  }
  if (field.type === 'textarea') {
    return (
      <label className="grid gap-1 text-eyebrow">
        <span className="text-muted">{t(field.labelKey)}</span>
        <textarea
          value={typeof value === 'string' ? value : field.defaultValue}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          rows={3}
          data-testid={`utility-pipeline-step-option-${field.key}`}
          className="rounded border border-border/60 bg-background px-2 py-1 font-mono text-caption"
        />
      </label>
    );
  }
  if (field.type === 'select') {
    return (
      <label className="grid gap-1 text-eyebrow">
        <span className="text-muted">{t(field.labelKey)}</span>
        <select
          value={typeof value === 'string' ? value : field.defaultValue}
          onChange={(event) => onChange(event.target.value)}
          data-testid={`utility-pipeline-step-option-${field.key}`}
          className="rounded border border-border/60 bg-background px-2 py-1 text-caption"
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  // boolean
  return (
    <label className="inline-flex items-center gap-2 text-eyebrow">
      <input
        type="checkbox"
        checked={typeof value === 'boolean' ? value : field.defaultValue}
        onChange={(event) => onChange(event.target.checked)}
        data-testid={`utility-pipeline-step-option-${field.key}`}
      />
      <span className="text-muted">{t(field.labelKey)}</span>
    </label>
  );
}
