/**
 * Library ownership for the Utility Pipelines workspace.
 *
 * Keeps persisted pipeline CRUD, JSON import/export, destructive confirmation,
 * and import focus restoration together while the parent panel owns execution
 * and editor orchestration.
 */

import { Copy as CopyIcon, Download, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useUtilityPipelineStore } from '../../stores/utilityPipelineStore';
import { cn } from '../../utils/cn';
import { createBlankPipeline } from '../../../shared/utilityPipeline';
import { ConfirmDialog } from '../ui/ConfirmDialog';

export function UtilityPipelineLibrarySidebar() {
  const { t } = useTranslation();
  const pipelines = useUtilityPipelineStore(state => state.pipelines);
  const activePipelineId = useUtilityPipelineStore(state => state.activePipelineId);
  const clipboardConsent = useSettingsStore(state => state.utilitiesClipboardOnFocusConsent);
  const activePipeline = pipelines.find(pipeline => pipeline.id === activePipelineId);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const importTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const importTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [importTextareaValue, setImportTextareaValue] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importWarning, setImportWarning] = useState<string | null>(null);

  const handleCreate = useCallback(() => {
    useUtilityPipelineStore.getState().createPipeline(
      createBlankPipeline({
        id: crypto.randomUUID(),
        name: '',
      })
    );
  }, []);

  const handleSelect = useCallback((id: string) => {
    useUtilityPipelineStore.getState().setActivePipeline(id);
  }, []);

  const handleShowTemplates = useCallback(() => {
    useUtilityPipelineStore.getState().setActivePipeline(null);
  }, []);

  const handleRename = useCallback((id: string, name: string) => {
    useUtilityPipelineStore.getState().updatePipeline(id, { name });
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (pendingDeleteId === null) return;
    useUtilityPipelineStore.getState().deletePipeline(pendingDeleteId);
    setPendingDeleteId(null);
  }, [pendingDeleteId]);

  const handleDuplicate = useCallback(
    (id: string) => {
      useUtilityPipelineStore
        .getState()
        .duplicatePipeline(id, crypto.randomUUID(), t('utilityPipeline.list.copySuffix'));
    },
    [t]
  );

  const closeImportPanel = useCallback(() => {
    setImportOpen(false);
    setImportWarning(null);
    importTriggerRef.current?.focus();
  }, []);

  const handleImportKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeImportPanel();
    },
    [closeImportPanel]
  );

  const handleImportOpen = useCallback(async () => {
    setImportOpen(true);
    setImportWarning(null);
    if (clipboardConsent === 'granted' && navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text.trim().startsWith('{') && text.includes('"version"')) {
          setImportTextareaValue(text);
        }
      } catch {
        /* fall through — user can paste manually */
      }
    }
    setTimeout(() => importTextareaRef.current?.focus(), 0);
  }, [clipboardConsent]);

  const handleImportConfirm = useCallback(() => {
    if (!importTextareaValue.trim()) return;
    const outcome = useUtilityPipelineStore.getState().importPipelineJson(importTextareaValue);
    if (outcome.ok) {
      setImportOpen(false);
      setImportTextareaValue('');
      setImportWarning(null);
      importTriggerRef.current?.focus();
    } else {
      const detail = outcome.detail ? ` — ${outcome.detail}` : '';
      setImportWarning(`${t(`utilityPipeline.import.reject.${camel(outcome.reason)}`)}${detail}`);
    }
  }, [importTextareaValue, t]);

  const handleExport = useCallback(async () => {
    if (!activePipeline) return;
    const json = useUtilityPipelineStore.getState().exportPipelineJson(activePipeline.id);
    if (!json) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(json);
        useUIStore.getState().pushStatusNotice({
          tone: 'success',
          messageKey: 'utilityPipeline.list.exported',
        });
        return;
      } catch {
        /* clipboard rejected — fall through to the warning notice */
      }
    }
    useUIStore.getState().pushStatusNotice({
      tone: 'warning',
      messageKey: 'utilityPipeline.list.clipboardUnavailable',
    });
  }, [activePipeline]);

  return (
    <>
      <aside className="flex min-h-0 flex-col border-r border-border/60 pr-2">
        <header className="flex items-center justify-between gap-2 pb-2">
          <span className="text-caption font-bold uppercase tracking-[0.12em] text-muted">
            {t('utilityPipeline.list.label')}
          </span>
          <div className="flex items-center gap-1">
            <button
              ref={importTriggerRef}
              type="button"
              onClick={handleImportOpen}
              aria-label={t('utilityPipeline.list.import')}
              title={t('utilityPipeline.list.import')}
              data-testid="utility-pipeline-list-import"
              className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-surface/40 text-muted hover:border-border-strong hover:bg-background hover:text-foreground"
            >
              <Upload size={11} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!activePipeline}
              aria-label={t('utilityPipeline.list.export')}
              title={t('utilityPipeline.list.export')}
              data-testid="utility-pipeline-list-export"
              className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-surface/40 text-muted hover:border-border-strong hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={11} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleShowTemplates}
              aria-label={t('utilityPipeline.template.galleryTitle')}
              title={t('utilityPipeline.template.galleryTitle')}
              data-testid="utility-pipeline-list-templates"
              className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-surface/40 text-muted hover:border-border-strong hover:bg-background hover:text-foreground"
            >
              <Sparkles size={11} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleCreate}
              aria-label={t('utilityPipeline.list.create')}
              title={t('utilityPipeline.list.create')}
              data-testid="utility-pipeline-list-create"
              className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-surface/40 text-muted hover:border-border-strong hover:bg-background hover:text-foreground"
            >
              <Plus size={12} aria-hidden="true" />
            </button>
          </div>
        </header>
        {pipelines.length === 0 ? (
          <p className="px-2 py-3 text-body-sm text-muted">{t('utilityPipeline.list.empty')}</p>
        ) : null}
        <ul role="list" className="flex-1 overflow-y-auto">
          {pipelines.map(pipeline => {
            const isActive = pipeline.id === activePipelineId;
            return (
              <li
                key={pipeline.id}
                data-testid="utility-pipeline-list-row"
                data-pipeline-id={pipeline.id}
                data-active={isActive}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'group flex items-center gap-1 rounded px-2 py-1.5 text-body-sm',
                  isActive
                    ? 'bg-background-elevated text-foreground'
                    : 'text-muted hover:bg-surface-strong/60 hover:text-foreground'
                )}
              >
                <input
                  type="text"
                  value={pipeline.name}
                  data-testid="utility-pipeline-list-name"
                  aria-label={t('utilityPipeline.list.nameAria')}
                  onChange={event => handleRename(pipeline.id, event.target.value)}
                  onFocus={() => handleSelect(pipeline.id)}
                  placeholder={t('utilityPipeline.list.renamePlaceholder')}
                  className="focus-ring min-w-0 flex-1 truncate cursor-pointer rounded bg-transparent px-1 text-body-sm"
                />
                <button
                  type="button"
                  onClick={() => handleDuplicate(pipeline.id)}
                  aria-label={t('utilityPipeline.list.duplicateAria', { name: pipeline.name })}
                  data-testid="utility-pipeline-list-duplicate"
                  className="focus-ring inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                >
                  <CopyIcon size={10} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDeleteId(pipeline.id)}
                  aria-label={t('utilityPipeline.list.deleteAria', { name: pipeline.name })}
                  data-testid="utility-pipeline-list-delete"
                  className="focus-ring inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-rose-500 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2 size={10} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
        {importOpen ? (
          <div
            data-testid="utility-pipeline-import-panel"
            onKeyDown={handleImportKeyDown}
            className="mt-2 grid gap-2 rounded border border-border/60 bg-surface/40 p-2"
          >
            <textarea
              ref={importTextareaRef}
              value={importTextareaValue}
              onChange={event => setImportTextareaValue(event.target.value)}
              data-testid="utility-pipeline-import-textarea"
              placeholder={t('utilityPipeline.import.placeholder')}
              rows={4}
              className="rounded border border-border/60 bg-background px-2 py-1 font-mono text-eyebrow"
            />
            {importWarning ? (
              <p data-testid="utility-pipeline-import-error" className="text-eyebrow text-rose-300">
                {importWarning}
              </p>
            ) : null}
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={closeImportPanel}
                data-testid="utility-pipeline-import-cancel"
                className="focus-ring inline-flex h-6 items-center rounded border border-border/60 bg-surface/40 px-2 text-eyebrow text-muted hover:text-foreground"
              >
                {t('utilityPipeline.import.cancel')}
              </button>
              <button
                type="button"
                onClick={handleImportConfirm}
                disabled={!importTextareaValue.trim()}
                data-testid="utility-pipeline-import-confirm"
                className="focus-ring inline-flex h-6 items-center rounded border border-accent/40 bg-accent/10 px-2 text-eyebrow text-accent-fg hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('utilityPipeline.import.confirm')}
              </button>
            </div>
          </div>
        ) : null}
      </aside>

      {pendingDeleteId !== null ? (
        <ConfirmDialog
          testId="utility-pipeline-delete-confirm"
          title={t('utilityPipeline.list.deleteConfirm.title')}
          body={t('utilityPipeline.list.deleteConfirm.body', {
            name: pipelines.find(pipeline => pipeline.id === pendingDeleteId)?.name ?? '',
          })}
          confirmLabel={t('utilityPipeline.list.deleteConfirm.confirm')}
          cancelLabel={t('utilityPipeline.list.deleteConfirm.cancel')}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDeleteId(null)}
        />
      ) : null}
    </>
  );
}

function camel(value: string): string {
  return value.replace(/-([a-z])/g, (_, character) => (character as string).toUpperCase());
}
