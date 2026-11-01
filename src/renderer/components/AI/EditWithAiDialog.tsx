import { DiffEditor } from '@monaco-editor/react';
import type * as monacoTypes from 'monaco-editor';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import '../../i18n/explainCatalog';
import { answerLanguageFor } from '../../../shared/ai/explainError';
import { applyEdit, buildEditSelectionRequest, MAX_EDIT_INSTRUCTION_CHARS, readEditAnswer, REDACTED_MARK } from '../../../shared/ai/editSelection';
import { currentShortcutDisplayPlatform, formatShortcutCombo } from '../../data/keyboardShortcuts';
import { useEntitlement } from '../../hooks/useEntitlement';
import { getActiveEditor, getActiveMonaco } from '../../runtime/editorAccess';
import { comparePreview, runEditPreview, type EditPreview } from '../../runtime/aiEditPreview';
import { runChatCompletion, type AiChatResult } from '../../runtime/aiClient';
import { aiFailureMessage } from '../../runtime/aiFailureMessage';
import { isAiConfigured, useAiConfigStore } from '../../stores/aiConfigStore';
import type { EditSelectionRequest } from '../../stores/aiEditSelectionStore';
import { useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { isLocalAiEndpoint } from '../../utils/loopbackHost';
import { formatRunDuration } from '../../utils/timeLabels';
import { cn } from '../../utils/cn';

const NOTICE_KEY = 'lingua-ai-edit-preview-notice';
const ACCEPT_KEYS = formatShortcutCombo({ tokens: ['Mod', 'Enter'] }, currentShortcutDisplayPlatform());

export interface EditWithAiDialogProps {
  request: EditSelectionRequest;
  onClose: () => void;
  /** Test seams. */
  runChatCompletionImpl?: typeof runChatCompletion;
  runPreviewImpl?: typeof runEditPreview;
}

type Phase =
  | { kind: 'compose' }
  | { kind: 'asking'; partial: string }
  | { kind: 'running'; proposal: string }
  | { kind: 'ready'; proposal: string; preview: EditPreview }
  | { kind: 'error'; message: string };

function noticeSeen(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1';
  } catch {
    return true;
  }
}

function RunLine({ error, stdout }: { error: string | null; stdout: string }) {
  const { t } = useTranslation();
  if (error) return <p className="truncate font-mono text-caption text-error-fg" title={error} data-testid="ai-edit-run-line">{error}</p>;
  const first = stdout.split('\n')[0] ?? '';
  return <p className="truncate font-mono text-caption text-fg-muted" title={stdout} data-testid="ai-edit-run-line">{first || t('ai.edit.noOutput')}</p>;
}

/** Detaches and disposes the models itself: the wrapper disposes them while still attached on unmount, which Monaco throws on. */
function WholeFileDiff({ original, modified, language, dark }: { original: string; modified: string; language: string; dark: boolean }) {
  const editor = useRef<monacoTypes.editor.IStandaloneDiffEditor | null>(null);
  useEffect(
    () => () => {
      const models = editor.current?.getModel();
      editor.current?.setModel(null);
      models?.original.dispose();
      models?.modified.dispose();
    },
    []
  );
  return (
    <DiffEditor
      height="100%"
      original={original}
      modified={modified}
      language={language}
      theme={dark ? 'vs-dark' : 'vs'}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={mounted => {
        editor.current = mounted;
      }}
      options={{ readOnly: true, originalEditable: false, renderSideBySide: true, minimap: { enabled: false }, renderOverviewRuler: false, scrollBeyondLastLine: false, wordWrap: 'on' }}
    />
  );
}

/** Ask the AI to rewrite the selection, see the change run in a throwaway worker, then accept or discard it. */
export function EditWithAiDialog({ request, onClose, runChatCompletionImpl, runPreviewImpl }: EditWithAiDialogProps) {
  const { t, i18n } = useTranslation();
  const entitled = useEntitlement('LOCAL_AI');
  const endpoint = useAiConfigStore(s => s.endpoint);
  const apiKey = useAiConfigStore(s => s.apiKey);
  const model = useAiConfigStore(s => s.model);
  const theme = useSettingsStore(s => s.editorTheme);
  const [instruction, setInstruction] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'compose' });
  const [showDiff, setShowDiff] = useState(false);
  const [notice, setNotice] = useState(() => !noticeSeen());
  const [stale, setStale] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const configured = isAiConfigured({ endpoint, apiKey, model });
  const send = runChatCompletionImpl ?? runChatCompletion;
  const preview = runPreviewImpl ?? runEditPreview;
  const answerLanguage = answerLanguageFor(i18n.resolvedLanguage);
  const built = useMemo(
    () =>
      buildEditSelectionRequest({
        code: request.code,
        start: request.start,
        end: request.end,
        instruction,
        language: request.language,
        ...(request.filename ? { filename: request.filename } : {}),
        ...(answerLanguage ? { answerLanguage } : {}),
        ...(model ? { model } : {}),
      }),
    [request, instruction, answerLanguage, model]
  );
  const { span } = built;
  const selected = request.code.slice(span.start, span.end);

  useEffect(() => () => controller.current?.abort('dialog-closed'), []);

  const close = () => {
    controller.current?.abort('dialog-closed');
    onClose();
  };

  const ask = async () => {
    if (!instruction.trim()) return;
    controller.current?.abort('superseded');
    const own = new AbortController();
    controller.current = own;
    setShowDiff(false);
    setPhase({ kind: 'asking', partial: '' });
    const result: AiChatResult = await send(
      { messages: built.messages, model },
      { endpoint, apiKey, model },
      { signal: own.signal, onChunk: partial => !own.signal.aborted && setPhase({ kind: 'asking', partial }) }
    );
    if (own.signal.aborted) return;
    if (!result.ok) {
      setPhase({ kind: 'error', message: aiFailureMessage(result, t) });
      return;
    }
    const proposal = readEditAnswer(result.content, selected);
    setPhase({ kind: 'running', proposal });
    // The preview runs the redacted file, so the AI's code never sees a secret it was not sent.
    const ran = await preview(request.language, `${span.before}${span.selected}${span.after}`, `${span.before}${proposal}${span.after}`);
    if (!own.signal.aborted) setPhase({ kind: 'ready', proposal, preview: ran });
  };

  const accept = () => {
    if (phase.kind !== 'ready' || phase.proposal.includes(REDACTED_MARK)) return;
    const editor = getActiveEditor();
    const monaco = getActiveMonaco();
    const model = editor?.getModel();
    // Tabs can share one Monaco model, so the tab is checked as well as the model and its version.
    const sameTab = request.tabId === undefined || useEditorStore.getState().activeTabId === request.tabId;
    if (!editor || !monaco || !model || !sameTab || model.uri.toString() !== request.modelUri || model.getVersionId() !== request.versionId) {
      setStale(true);
      return;
    }
    const from = model.getPositionAt(span.start);
    const to = model.getPositionAt(span.end);
    editor.pushUndoStop();
    editor.executeEdits('lingua.ai.edit', [{ range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column), text: phase.proposal, forceMoveMarkers: true }]);
    editor.pushUndoStop();
    editor.focus();
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      // Never reaches the global run shortcut behind the dialog.
      event.preventDefault();
      event.stopPropagation();
      if (phase.kind === 'ready') accept();
      else if (phase.kind === 'compose' || phase.kind === 'error') void ask();
    }
  };

  const dismissNotice = () => {
    setNotice(false);
    try {
      localStorage.setItem(NOTICE_KEY, '1');
    } catch {
      /* the notice shows again next time */
    }
  };

  const ready = phase.kind === 'ready' ? phase : null;
  const verdict = ready?.preview.kind === 'ran' ? comparePreview(ready.preview.before, ready.preview.after) : null;
  const masked = ready?.proposal.includes(REDACTED_MARK) === true;
  const provider = t(isLocalAiEndpoint(endpoint) ? 'ai.edit.provider.local' : 'ai.edit.provider.remote', { model: model || '—' });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onKeyDown={onKeyDown}>
      <div role="dialog" aria-modal="true" aria-label={t('ai.edit.title')} data-testid="ai-edit-dialog" className="flex max-h-[85vh] w-full max-w-[920px] flex-col overflow-hidden rounded-lg border border-border bg-bg-panel shadow-e3">
        <form
          className="flex h-[42px] shrink-0 items-center gap-2 border-b border-border px-3"
          onSubmit={event => {
            event.preventDefault();
            void ask();
          }}
        >
          <span className="shrink-0 font-mono text-micro font-semibold uppercase tracking-[0.18em] text-fg-muted">{t('ai.edit.title')}</span>
          <input
            autoFocus
            value={instruction}
            maxLength={MAX_EDIT_INSTRUCTION_CHARS}
            onChange={event => setInstruction(event.target.value)}
            aria-label={t('ai.edit.instruction')}
            placeholder={t('ai.edit.instruction')}
            disabled={!entitled || !configured}
            data-testid="ai-edit-instruction"
            className="field-shell h-[26px] min-w-0 flex-1 rounded-md px-2 py-0 text-caption"
          />
          <span className="shrink-0 rounded border border-border-subtle px-1.5 font-mono text-micro text-fg-muted" data-testid="ai-edit-provider">
            {provider}
          </span>
          <button type="submit" disabled={!entitled || !configured || !instruction.trim() || phase.kind === 'asking' || phase.kind === 'running'} data-testid="ai-edit-send" className="button-primary h-[26px] shrink-0 px-2.5 text-caption">
            {t('ai.edit.send')}
          </button>
          <button type="button" onClick={close} aria-label={t('ai.explain.close')} className="icon-button h-6 w-6 shrink-0 rounded-md">
            ×
          </button>
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!entitled ? (
            <p className="px-4 py-5 text-sm text-fg-muted">{t('ai.explainCode.upsell')}</p>
          ) : !configured ? (
            <p className="px-4 py-5 text-sm text-fg-muted">{t('ai.explainCode.unconfigured')}</p>
          ) : phase.kind === 'compose' ? (
            <details className="px-4 py-3 text-caption text-fg-muted" data-testid="ai-edit-consent">
              <summary className="cursor-pointer">{t('ai.edit.consent')}</summary>
              {built.redactedCount > 0 ? <p className="mt-2">{t('ai.explain.redactedNotice', { count: built.redactedCount })}</p> : null}
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border-subtle bg-bg-inset p-2 font-mono text-caption">{built.preview}</pre>
            </details>
          ) : phase.kind === 'asking' ? (
            <div className="px-4 py-3" role="status" aria-live="polite">
              <p className="text-caption text-fg-muted">{t('ai.edit.asking')}</p>
              {phase.partial ? <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-caption text-fg-subtle">{phase.partial}</pre> : null}
            </div>
          ) : phase.kind === 'running' ? (
            <p className="px-4 py-3 text-caption text-fg-muted" role="status">{t('ai.edit.running')}</p>
          ) : phase.kind === 'error' ? (
            <p className="px-4 py-3 text-caption text-error-fg" role="alert">{phase.message}</p>
          ) : (
            <>
              {notice && ready?.preview.kind === 'ran' ? (
                <div className="flex items-center gap-3 border-b border-border-subtle bg-accent/10 px-4 py-2 text-caption text-fg-base" data-testid="ai-edit-notice">
                  <span className="min-w-0 flex-1">{t('ai.edit.notice')}</span>
                  <button type="button" onClick={dismissNotice} className="button-secondary h-6 shrink-0 px-2 text-caption">{t('ai.edit.noticeOk')}</button>
                </div>
              ) : null}
              {showDiff ? (
                <div className="h-[340px]" data-testid="ai-edit-diff">
                  <WholeFileDiff
                    original={request.code}
                    modified={applyEdit(request.code, span.start, span.end, ready!.proposal)}
                    language={request.language}
                    dark={theme !== 'lingua-light'}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2">
                  <section className="min-w-0 border-r border-border-subtle py-2.5" data-testid="ai-edit-now">
                    <p className="px-4 font-mono text-micro uppercase tracking-[0.18em] text-fg-subtle">{t('ai.edit.now')}</p>
                    <pre className="mt-1.5 max-h-72 overflow-auto px-4 font-mono text-caption text-fg-base">{selected}</pre>
                    {ready?.preview.kind === 'ran' ? <div className="px-4 pt-1.5"><RunLine {...ready.preview.before} /></div> : null}
                  </section>
                  <section className="min-w-0 bg-accent/5 py-2.5" data-testid="ai-edit-preview">
                    <p className="px-4 font-mono text-micro uppercase tracking-[0.18em] text-accent-fg">
                      {ready?.preview.kind === 'ran'
                        ? t('ai.edit.previewRan', { duration: formatRunDuration(ready.preview.after.executionTime) })
                        : t('ai.edit.previewOnly')}
                    </p>
                    <pre className="mt-1.5 max-h-72 overflow-auto px-4 font-mono text-caption text-fg-base">{ready?.proposal}</pre>
                    {ready?.preview.kind === 'ran' ? <div className="px-4 pt-1.5"><RunLine {...ready.preview.after} /></div> : null}
                  </section>
                </div>
              )}
            </>
          )}
        </div>

        {ready ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-2.5" data-testid="ai-edit-actions">
            {verdict ? (
              <>
                {verdict.fixed > 0 ? <span className="rounded border border-success-border bg-success-bg px-1.5 font-mono text-micro text-success-fg">{t('ai.edit.fixed', { count: verdict.fixed })}</span> : null}
                <span className={cn('rounded border px-1.5 font-mono text-micro', verdict.introduced > 0 ? 'border-error/50 bg-error/10 text-error-fg' : 'border-border-subtle text-fg-muted')}>
                  {t('ai.edit.newErrors', { count: verdict.introduced })}
                </span>
                <span className="rounded border border-border-subtle px-1.5 font-mono text-micro text-fg-muted">{verdict.stdoutChanged ? t('ai.edit.stdoutChanged') : t('ai.edit.stdoutSame')}</span>
              </>
            ) : (
              <span className="min-w-0 text-caption text-fg-muted" data-testid="ai-edit-skipped">
                {t('ai.edit.skippedLanguage')}
              </span>
            )}
            {masked ? <span className="text-caption text-warning-fg" data-testid="ai-edit-masked">{t('ai.edit.redactedAnswer')}</span> : null}
            {stale ? <span className="text-caption text-warning-fg" role="alert" data-testid="ai-edit-stale">{t('ai.edit.stale')}</span> : null}
            <span className="flex-1" />
            <button type="button" onClick={() => setShowDiff(value => !value)} data-testid="ai-edit-show-diff" className="button-secondary h-7 px-2.5 text-caption">
              {showDiff ? t('ai.edit.hideDiff') : t('ai.edit.showDiff')}
            </button>
            <button type="button" onClick={accept} disabled={masked || stale} data-testid="ai-edit-accept" className="button-primary h-7 px-2.5 text-caption">
              {t('ai.edit.accept')} <kbd className="ml-1 font-mono text-micro opacity-80">{ACCEPT_KEYS}</kbd>
            </button>
            <button type="button" onClick={close} data-testid="ai-edit-discard" className="button-secondary h-7 px-2.5 text-caption">
              {t('ai.edit.discard')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
