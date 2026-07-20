/**
 * implementation — Stdin panel redesigned as an ordered queue.
 *
 * One line in the buffer = one response to `prompt()` / `input()`.
 * The panel layers rich feedback on top of the existing per-tab
 * `stdinBuffer` string:
 *
 *   - drag handle on every row (reorder)
 *   - status icon: consumed (check) · next-to-consume (play) · empty
 *   - line number
 *   - inline editable value
 *   - auto-detected type pill (number · string · boolean)
 *   - "→ next call" hint on the line that will fire next
 *   - presets strip at the bottom (sane defaults / edge cases / random)
 */

import {
  ArrowRight,
  Check,
  GripVertical,
  MessageSquare,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  useMemo,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEditorStore } from '../../stores/editorStore';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useResultStore } from '../../stores/resultStore';
import { Kbd } from '../ui/chrome';
import { TypePill, type TypePillKind, MonoBadge, EyebrowMono } from '../ui/primitives';
import { cn } from '../../utils/cn';
import type { InputSet, Language } from '../../types';
import {
  MAX_INPUT_SET_NAME_LENGTH,
  MAX_INPUT_SETS_PER_TAB,
} from '../../stores/editorTabUtils';

const SUPPORTED: ReadonlySet<Language> = new Set<Language>([
  'javascript',
  'typescript',
  'python',
]);

function inferTypeKind(value: string): TypePillKind | null {
  if (value === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return 'number';
  if (/^(true|false)$/i.test(value)) return 'boolean';
  return 'string';
}

function splitLines(buffer: string): string[] {
  if (!buffer) return [];
  const lines = buffer.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function joinLines(lines: readonly string[]): string {
  return lines.length === 0 ? '' : lines.join('\n');
}

interface PresetDef {
  k: string;
  labelKey: string;
  /**
   * Meta string for the preset chip's right-aligned hint. Resolved at
   * render time from the per-language `meta` map so callers always
   * see the values they would actually paste.
   */
  meta: string;
  values: readonly string[];
}

/**
 * internal polish #11 — preset values vary by host language so the
 * "boolean defaults" reflect what `prompt()` / `input()` actually
 * receive in that runtime. JS/TS prompt() returns strings, so any
 * truthy alias works (`y`, `true`); Python `input()` returns strings
 * but idiomatic test data uses `True`/`False` to match how the
 * subsequent `bool(input())` usually behaves.
 */
function presetsForLanguage(language: 'javascript' | 'typescript' | 'python'): PresetDef[] {
  const isPython = language === 'python';
  const yes = isPython ? 'True' : 'y';
  const no = isPython ? 'False' : 'n';
  return [
    {
      k: 'sane',
      labelKey: 'stdin.presets.sane',
      meta: `5 · 8 · ${yes} · ${yes}`,
      values: ['5', '8', yes, yes],
    },
    {
      k: 'edge',
      labelKey: 'stdin.presets.edge',
      meta: `0 · '' · 0 · ${no}`,
      values: ['0', '', '0', no],
    },
    {
      k: 'random',
      labelKey: 'stdin.presets.random',
      meta: '6 · ~',
      values: [],
    },
  ];
}

function randomPreset(language: 'javascript' | 'typescript' | 'python', count = 6): string[] {
  const isPython = language === 'python';
  const trueLit = isPython ? 'True' : 'true';
  const falseLit = isPython ? 'False' : 'false';
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const r = Math.random();
    if (r < 0.5) out.push(String(Math.floor(Math.random() * 100)));
    else if (r < 0.75) out.push(Math.random() > 0.5 ? trueLit : falseLit);
    else out.push(Math.random().toString(36).slice(2, 8));
  }
  return out;
}

export function StdinInputPanel() {
  const { t } = useTranslation();
  const activeTab = useActiveTab();
  const setTabStdinBuffer = useEditorStore((state) => state.setTabStdinBuffer);
  const setTabInputArgs = useEditorStore((state) => state.setTabInputArgs);
  const stdinConsumed = useResultStore((state) => state.stdinConsumed);

  // Hooks must run unconditionally before the language/activeTab
  // guards below — see React's rules-of-hooks. The early returns sit
  // after these `useMemo` calls.
  const buffer = activeTab?.stdinBuffer ?? '';
  const lines = useMemo(() => splitLines(buffer), [buffer]);
  // Append a single trailing blank slot so the next prompt is always
  // visible/editable without forcing the user to press Enter first.
  // internal review — always allocate a fresh array so we never mutate
  // the `lines` memo by accident (the previous `tail = lines` branch
  // pushed empty strings into the cached `lines` reference and the
  // mutation leaked into `lines.filter(...)` downstream).
  const slots = useMemo(() => {
    const tail = [...lines];
    if (tail.length === 0 || tail[tail.length - 1] !== '') tail.push('');
    while (tail.length < 6) tail.push('');
    return tail;
  }, [lines]);

  // internal polish #3 — DnD sensors must be initialised before any
  // early return so the hooks list stays stable across re-renders
  // when the active tab toggles between supported / unsupported.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  if (!activeTab) {
    return (
      <div
        className="flex h-full items-center justify-center px-6 text-center"
        data-testid="stdin-panel-empty"
      >
        <span className="text-body-sm italic text-muted">
          {t('stdin.panel.empty')}
        </span>
      </div>
    );
  }

  if (!SUPPORTED.has(activeTab.language)) {
    return (
      <div
        className="flex h-full items-center justify-center px-6 text-center"
        data-testid="stdin-panel-unsupported"
      >
        <span className="text-body-sm italic text-muted">
          {t('stdin.panel.unsupportedLanguage')}
        </span>
      </div>
    );
  }

  const promptFn = activeTab.language === 'python' ? 'input()' : 'prompt()';
  const filledCount = lines.filter((l) => l !== '').length;
  const consumedCount = stdinConsumed?.count ?? 0;
  // Index of the first un-consumed empty slot — the line an upcoming
  // run will read from. Cheap O(n) over a 6-row slot list; no memo.
  let nextIndex = -1;
  for (let i = 0; i < slots.length; i += 1) {
    if (i >= consumedCount && slots[i] === '') {
      nextIndex = i;
      break;
    }
  }

  const writeLines = (next: string[]) => {
    setTabStdinBuffer(activeTab.id, next.length === 0 ? null : joinLines(next));
  };

  const handleLineChange = (idx: number, value: string) => {
    const next = [...lines];
    while (next.length <= idx) next.push('');
    next[idx] = value;
    // Drop trailing empties so the buffer stays compact.
    while (next.length > 0 && next[next.length - 1] === '') next.pop();
    writeLines(next);
  };

  const handleKeyDown = (idx: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = event.currentTarget;
      const value = target.value;
      const next = [...lines];
      while (next.length <= idx) next.push('');
      next[idx] = value;
      next.splice(idx + 1, 0, '');
      writeLines(next);
    }
  };

  const handleClear = () => writeLines([]);

  // internal polish #3 — drag-reorder with @dnd-kit/sortable. The user
  // can grab any row's left handle and drop it elsewhere; the buffer
  // is rewritten with the reordered values. Empty trailing slots are
  // not real lines (they're synthesised in `slots`), so reorders only
  // operate on indices that map back to the actual `lines` array.
  // (`sensors` is declared above the language guard so the hooks list
  // stays stable across re-renders.)
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIdx = Number(String(active.id).replace('stdin-row-', ''));
    const toIdx = Number(String(over.id).replace('stdin-row-', ''));
    if (Number.isNaN(fromIdx) || Number.isNaN(toIdx)) return;
    // Reorders are only meaningful between rows that already have
    // values (you can't reorder phantom blank slots). Cap the indices
    // to `lines.length - 1` so a drop onto a trailing blank slot
    // appends/keeps the dragged value at the end of the real list.
    const lastReal = Math.max(0, lines.length - 1);
    const safeFrom = Math.min(fromIdx, lastReal);
    const safeTo = Math.min(toIdx, lastReal);
    if (safeFrom === safeTo) return;
    const reordered = arrayMove([...lines], safeFrom, safeTo);
    writeLines(reordered);
  };

  // internal polish #11 — language-aware presets. The preset list is
  // recomputed lazily; with three modal options the cost is trivial.
  const language = activeTab.language as 'javascript' | 'typescript' | 'python';
  const presets = presetsForLanguage(language);
  const applyPreset = (preset: PresetDef) => {
    const values =
      preset.k === 'random' ? randomPreset(language) : [...preset.values];
    writeLines(values);
  };

  const sortableIds = slots.map((_, idx) => `stdin-row-${idx}`);

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 p-4"
      data-testid="stdin-panel"
      data-stdin-language={activeTab.language}
    >
      <header className="flex flex-shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquare size={11} aria-hidden className="text-fg-subtle" />
            <EyebrowMono>{t('stdin.panel.title')}</EyebrowMono>
            <MonoBadge tone="accent">
              {t('stdin.panel.lineCountBadge', { count: filledCount, promptFn })}
            </MonoBadge>
          </div>
          <p className="mt-1 max-w-[60ch] text-body-sm leading-5 text-fg-muted">
            {t('stdin.panel.descriptionShort', { promptFn })}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {stdinConsumed && stdinConsumed.total > 0 ? (
            <span
              data-testid="stdin-panel-consumed"
              className="inline-flex items-center gap-1.5 text-caption font-medium text-success"
            >
              <Check size={11} aria-hidden />
              {t('stdin.panel.consumed', {
                count: stdinConsumed.count,
                total: stdinConsumed.total,
              })}
            </span>
          ) : null}
          {filledCount > 0 ? (
            <button
              type="button"
              onClick={handleClear}
              data-testid="stdin-panel-clear"
              aria-label={t('stdin.panel.clear')}
              title={t('stdin.panel.clear')}
              className="icon-button h-7 w-7 icon-button-danger"
            >
              <Trash2 size={12} aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      <InputSetToolbar
        key={`${activeTab.id}:${activeTab.activeInputSetId ?? 'draft'}`}
        tabId={activeTab.id}
        inputSets={activeTab.inputSets ?? []}
        activeInputSetId={activeTab.activeInputSetId}
      />

      <label className="grid flex-shrink-0 gap-1.5" data-testid="stdin-input-args">
        <span className="text-caption font-semibold text-fg-muted">
          {t('stdin.inputSets.argsLabel')}
        </span>
        <textarea
          value={(activeTab.inputArgs ?? []).join('\n')}
          onChange={(event) => {
            const value = event.target.value;
            setTabInputArgs(activeTab.id, value === '' ? null : value.split('\n'));
          }}
          rows={2}
          spellCheck={false}
          placeholder={t('stdin.inputSets.argsPlaceholder')}
          aria-label={t('stdin.inputSets.argsAriaLabel')}
          className="field-shell min-h-12 resize-y px-3 py-2 font-mono text-body-sm"
        />
        <span className="text-caption text-fg-subtle">
          {t('stdin.inputSets.argsHint')}
        </span>
      </label>

      {/* Ordered queue */}
      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-border/60 bg-bg-panel-alt/70">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            {slots.map((value, idx) => {
              const consumed = idx < consumedCount && value !== '';
              const isNext = idx === nextIndex;
              const kind = inferTypeKind(value);
              const dragDisabled = consumed || value === '';
              return (
                <SortableStdinRow
                  key={`stdin-row-${idx}`}
                  id={`stdin-row-${idx}`}
                  idx={idx}
                  value={value}
                  consumed={consumed}
                  isNext={isNext}
                  kind={kind}
                  dragDisabled={dragDisabled}
                  onChange={(next) => handleLineChange(idx, next)}
                  onKeyDown={handleKeyDown(idx)}
                  consumedLabel={t('stdin.row.consumed')}
                  nextLabel={t('stdin.row.next')}
                  placeholderNext={t('stdin.row.placeholderNext')}
                  ariaLabel={t('stdin.row.ariaLabel', { line: idx + 1 })}
                  reorderAriaLabel={t('stdin.row.reorderAriaLabel', {
                    line: idx + 1,
                  })}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      </div>

      {/* Presets strip */}
      <footer className="flex flex-shrink-0 flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        <EyebrowMono className="text-fg-subtle">
          {t('stdin.presets.label')}
        </EyebrowMono>
        {presets.map((preset) => (
          <button
            key={preset.k}
            type="button"
            onClick={() => applyPreset(preset)}
            className="button-ghost h-7 gap-2 px-2.5 text-caption"
            data-testid={`stdin-preset-${preset.k}`}
          >
            <span className="font-semibold">{t(preset.labelKey)}</span>
            <span className="font-mono text-eyebrow text-fg-subtle">
              {preset.meta}
            </span>
          </button>
        ))}
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1.5 font-mono text-eyebrow text-fg-subtle">
          <Kbd>↵</Kbd>
          <span>{t('stdin.kbd.append')}</span>
          <Plus size={10} aria-hidden className="text-fg-subtle/50" />
          <ArrowRight size={10} aria-hidden className="text-fg-subtle/50" />
        </span>
      </footer>
    </div>
  );
}

interface InputSetToolbarProps {
  tabId: string;
  inputSets: readonly InputSet[];
  activeInputSetId?: string;
}

function InputSetToolbar({
  tabId,
  inputSets,
  activeInputSetId,
}: InputSetToolbarProps) {
  const { t } = useTranslation();
  const selectTabInputSet = useEditorStore((state) => state.selectTabInputSet);
  const saveTabInputSet = useEditorStore((state) => state.saveTabInputSet);
  const deleteTabInputSet = useEditorStore((state) => state.deleteTabInputSet);
  const activeInputSet = inputSets.find((inputSet) => inputSet.id === activeInputSetId);
  const [name, setName] = useState(activeInputSet?.name ?? '');
  const normalizedName = name.trim();
  const duplicateName = inputSets.some(
    (inputSet) =>
      inputSet.id !== activeInputSetId &&
      inputSet.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0
  );
  const atLimit = !activeInputSet && inputSets.length >= MAX_INPUT_SETS_PER_TAB;
  const canSave = normalizedName.length > 0 && !duplicateName && !atLimit;

  return (
    <div
      className="grid flex-shrink-0 gap-2 rounded-xl border border-border/60 bg-bg-panel-alt/45 p-3 md:grid-cols-[minmax(140px,0.8fr)_minmax(180px,1fr)_auto_auto] md:items-end"
      data-testid="stdin-input-set-toolbar"
    >
      <label className="grid gap-1.5">
        <span className="text-caption font-semibold text-fg-muted">
          {t('stdin.inputSets.label')}
        </span>
        <select
          value={activeInputSetId ?? ''}
          onChange={(event) =>
            selectTabInputSet(tabId, event.target.value || null)
          }
          aria-label={t('stdin.inputSets.selectAriaLabel')}
          className="field-shell h-9 px-2.5 text-body-sm"
        >
          <option value="">{t('stdin.inputSets.draft')}</option>
          {inputSets.map((inputSet) => (
            <option key={inputSet.id} value={inputSet.id}>
              {inputSet.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5">
        <span className="text-caption font-semibold text-fg-muted">
          {t('stdin.inputSets.nameLabel')}
        </span>
        <input
          type="text"
          value={name}
          maxLength={MAX_INPUT_SET_NAME_LENGTH}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('stdin.inputSets.namePlaceholder')}
          aria-label={t('stdin.inputSets.nameAriaLabel')}
          className="field-shell h-9 px-3 text-body-sm"
        />
      </label>
      <button
        type="button"
        disabled={!canSave}
        onClick={() => saveTabInputSet(tabId, normalizedName)}
        className="button-primary h-9 px-3 text-caption"
        data-testid="stdin-input-set-save"
        title={
          duplicateName
            ? t('stdin.inputSets.duplicateName')
            : atLimit
              ? t('stdin.inputSets.limitReached', { count: MAX_INPUT_SETS_PER_TAB })
              : undefined
        }
      >
        {t(activeInputSet ? 'stdin.inputSets.update' : 'stdin.inputSets.save')}
      </button>
      <button
        type="button"
        disabled={!activeInputSet}
        onClick={() => {
          if (activeInputSet) deleteTabInputSet(tabId, activeInputSet.id);
        }}
        className="button-ghost h-9 px-3 text-caption text-danger disabled:opacity-40"
        data-testid="stdin-input-set-delete"
      >
        {t('stdin.inputSets.delete')}
      </button>
      {duplicateName ? (
        <span className="text-caption text-danger md:col-span-4" role="alert">
          {t('stdin.inputSets.duplicateName')}
        </span>
      ) : null}
    </div>
  );
}

interface SortableStdinRowProps {
  id: string;
  idx: number;
  value: string;
  consumed: boolean;
  isNext: boolean;
  kind: TypePillKind | null;
  dragDisabled: boolean;
  onChange: (next: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  consumedLabel: string;
  nextLabel: string;
  placeholderNext: string;
  ariaLabel: string;
  /** Translated `aria-label` for the drag handle, e.g. "Reorder line 1". */
  reorderAriaLabel: string;
}

function SortableStdinRow({
  id,
  idx,
  value,
  consumed,
  isNext,
  kind,
  dragDisabled,
  onChange,
  onKeyDown,
  consumedLabel,
  nextLabel,
  placeholderNext,
  ariaLabel,
  reorderAriaLabel,
}: SortableStdinRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: dragDisabled });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative',
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`stdin-row-${idx}`}
      data-consumed={consumed ? 'true' : 'false'}
      data-next={isNext ? 'true' : 'false'}
      className={cn(
        'grid grid-cols-[18px_22px_28px_minmax(0,1fr)_auto_120px] items-center gap-2 px-3 py-1.5',
        isNext &&
          'bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] border-l-2 border-l-accent',
        !isNext && 'border-l-2 border-l-transparent',
      )}
    >
      <button
        type="button"
        aria-label={reorderAriaLabel}
        disabled={dragDisabled}
        {...attributes}
        {...listeners}
        className={cn(
          'inline-flex items-center justify-center bg-transparent border-0 p-0',
          dragDisabled
            ? 'text-fg-subtle/25 cursor-default'
            : 'text-fg-subtle/55 hover:text-fg-subtle cursor-grab active:cursor-grabbing',
        )}
      >
        <GripVertical size={11} aria-hidden />
      </button>
      <span
        aria-hidden
        className={cn(
          'inline-flex items-center justify-center rounded-full size-4',
          consumed
            ? 'bg-success/20 text-success'
            : isNext
              ? 'bg-accent text-white'
              : 'text-fg-subtle/40',
        )}
      >
        {consumed ? (
          <Check size={10} strokeWidth={2.5} />
        ) : isNext ? (
          <Play size={8} />
        ) : (
          <span className="text-eyebrow">·</span>
        )}
      </span>
      <span
        className={cn(
          'text-right font-mono text-caption font-semibold',
          consumed
            ? 'text-fg-subtle'
            : isNext
              ? 'text-accent-fg'
              : 'text-fg-subtle',
        )}
      >
        {idx + 1}.
      </span>
      <input
        type="text"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        placeholder={isNext ? placeholderNext : ''}
        aria-label={ariaLabel}
        className={cn(
          'min-w-0 bg-transparent font-mono text-body-sm text-fg-base outline-none placeholder:text-fg-subtle/60 placeholder:italic',
          consumed && 'line-through text-fg-muted/85',
        )}
      />
      <span className="inline-flex justify-end">
        {kind ? <TypePill kind={kind} /> : <span />}
      </span>
      <span
        className={cn(
          'text-right font-mono text-eyebrow',
          consumed ? 'text-fg-subtle' : isNext ? 'text-fg-muted' : '',
        )}
      >
        {consumed ? `→ ${consumedLabel}` : isNext ? `→ ${nextLabel}` : ''}
      </span>
    </div>
  );
}
