import { Check, Copy, Pin, Play, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import '../../i18n/explainCatalog';
import { answerLanguageFor, buildExplainErrorRequest, previewOf } from '../../../shared/ai/explainError';
import { runtimeNoteFor } from '../../../shared/ai/runtimeNotes';
import type { runChatCompletion } from '../../runtime/aiClient';
import { useAiConfigStore, isAiConfigured } from '../../stores/aiConfigStore';
import { useDebuggerStore } from '../../stores/debuggerStore';
import { useEditorStore } from '../../stores/editorStore';
import { useExplainPanelStore, type ExplainTarget } from '../../stores/explainPanelStore';
import { useResultStore } from '../../stores/resultStore';
import { useEntitlement } from '../../hooks/useEntitlement';
import { useRunner } from '../../hooks/useRunner';
import { useShortcutLabel } from '../../hooks/useShortcutLabel';
import { diffLines } from '../../utils/diff';
import { recordExplainRating, type ExplainVote } from '../../utils/explainRatings';
import { scopeValueToString } from '../Console/richConsoleFormat';
import { ApplyDiff, ExplainExchanges } from './ExplainConversationParts';
import { ExplainModeSwitch } from './ExplainModeSwitch';
import { useExplainConversation } from './useExplainConversation';

const FOLLOW_UP_CHIPS = ['why', 'safer', 'test'] as const;
const BUTTON = 'focus-ring inline-flex h-[30px] items-center gap-1.5 rounded-md border border-border-subtle px-2.5 text-caption font-medium text-fg-base hover:bg-bg-inset';
const PRIMARY = 'focus-ring inline-flex h-[30px] items-center gap-1.5 rounded-md bg-accent px-2.5 text-caption font-semibold text-accent-foreground';
const ICON_BUTTON = 'focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-inset hover:text-fg-base aria-pressed:bg-accent-tint aria-pressed:text-accent-fg';

/**
 * "Explain this error" beside the editor: anchored to the failing line, no
 * scrim, so the code stays editable. It sends nothing until Send, keeps one
 * thread per tab in memory, and can include the last known runtime values.
 */
export function ExplainErrorPanel(props: { target: ExplainTarget; runChatCompletionImpl?: typeof runChatCompletion }) {
  // A new endpoint remounts the conversation, which then starts from the consent preview again.
  const endpoint = useAiConfigStore((s) => s.endpoint);
  return <ExplainConversationPanel key={endpoint} {...props} />;
}

function ExplainConversationPanel({
  target,
  runChatCompletionImpl,
}: {
  target: ExplainTarget;
  runChatCompletionImpl?: typeof runChatCompletion;
}) {
  const { t, i18n } = useTranslation();
  const entitled = useEntitlement('LOCAL_AI');
  const endpoint = useAiConfigStore((s) => s.endpoint);
  const apiKey = useAiConfigStore((s) => s.apiKey);
  const model = useAiConfigStore((s) => s.model);
  const mode = useAiConfigStore((s) => s.mode);
  const tab = useEditorStore((s) => s.tabs.find((candidate) => candidate.id === target.tabId) ?? null);
  const pinned = useExplainPanelStore((s) => s.pinned);
  const { run } = useRunner();
  const jumpCombo = useShortcutLabel('ai-jump-to-error');
  const values = useRuntimeValues(target.tabId, tab?.language ?? '');
  const [includeValues, setIncludeValues] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const [vote, setVote] = useState<ExplainVote | null>(null);
  const [copied, setCopied] = useState(false);
  const answerLanguage = answerLanguageFor(i18n.resolvedLanguage);
  const code = tab?.content ?? '';
  const language = tab?.language ?? 'plaintext';
  const filename = tab?.name;
  const runtimeMode = tab?.runtimeMode;

  const request = useMemo(
    () =>
      buildExplainErrorRequest({
        errorMessage: target.errorMessage,
        code,
        language,
        ...(filename ? { filename } : {}),
        runtimeNote: runtimeNoteFor({
          language,
          platform: typeof window !== 'undefined' && window.lingua?.platform === 'web' ? 'web' : 'desktop',
          ...(runtimeMode ? { runtimeMode } : {}),
        }),
        ...(answerLanguage ? { answerLanguage } : {}),
        ...(model ? { model } : {}),
        ...(includeValues && values ? { runtimeValues: values } : {}),
      }),
    [target.errorMessage, code, language, filename, runtimeMode, answerLanguage, model, includeValues, values]
  );
  const conversation = useExplainConversation({
    request,
    initialTranscript: useExplainPanelStore.getState().threadFor(target.tabId, target.errorMessage, endpoint),
    onTranscriptChange: (transcript) => useExplainPanelStore.getState().saveThread(target.tabId, target.errorMessage, endpoint, transcript),
    ...(runChatCompletionImpl ? { runChatCompletionImpl } : {}),
  });
  const { phase, setPhase, exchanges, suggestedCode, lastAnswer, transcript } = conversation;
  // Once sent, the box shows the payload that went out, which later turns re-send.
  const sentPreview = transcript.length > 0 ? previewOf(transcript.slice(0, request.messages.length)) : null;
  const configured = isAiConfigured({ endpoint, apiKey, model });
  const applyDiff = useMemo(() => (phase.kind === 'confirm-apply' ? diffLines(code, phase.suggested) : []), [phase, code]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const close = () => {
    conversation.abort('dialog-closed');
    useExplainPanelStore.getState().close();
  };
  const apply = (suggested: string, rerun: boolean) => {
    if (!tab) return;
    useEditorStore.getState().updateContent(tab.id, suggested);
    setPhase({ kind: 'done' });
    if (rerun) void run();
  };
  const rate = (next: ExplainVote) => {
    setVote(next);
    recordExplainRating(next, target.errorMessage);
  };
  const ask = (question: string) => {
    conversation.ask(question);
    setFollowUp('');
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  };

  return (
    <aside
      aria-label={t('ai.explain.title')}
      data-testid="ai-explain-panel"
      onKeyDown={handleKeyDown}
      className="flex h-full w-[480px] shrink-0 flex-col border-l border-border-subtle bg-bg-panel text-body-sm"
    >
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border-subtle px-4">
        <Sparkles size={15} className="text-accent" aria-hidden="true" />
        <span className="font-semibold text-fg-base">{t('ai.explain.title')}</span>
        <span className="truncate font-mono text-caption text-fg-subtle" title={jumpCombo ? t('ai.panel.jumpHint', { combo: jumpCombo }) : undefined}>
          {tab?.name ?? ''}
          {target.line ? `:${target.line}` : ''}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label={t(pinned ? 'ai.panel.unpin' : 'ai.panel.pin')}
          aria-pressed={pinned}
          data-testid="ai-explain-panel-pin"
          onClick={() => useExplainPanelStore.getState().setPinned(!pinned)}
          className={ICON_BUTTON}
        >
          <Pin size={14} aria-hidden="true" />
        </button>
        <button type="button" aria-label={t('ai.explain.close')} data-testid="ai-explain-close" onClick={close} className={ICON_BUTTON}>
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-3">
        {entitled ? <ExplainModeSwitch /> : null}
        {!entitled ? (
          <p data-testid="ai-explain-upsell" className="text-fg-muted">
            {t('ai.explain.upsell')}
          </p>
        ) : !configured ? (
          <p data-testid="ai-explain-unconfigured" className="text-fg-muted">
            {t(`ai.panel.mode.${mode}Unset`)}
          </p>
        ) : (
          <>
            <details open={phase.kind === 'preview'} className="rounded-lg border border-border-subtle bg-bg-panel px-3 py-2">
              <summary className="flex cursor-pointer items-center gap-2 text-caption font-semibold text-fg-base">
                <ShieldCheck size={13} aria-hidden="true" />
                {t('ai.panel.whatGetsSent')}
                {request.redactedCount > 0 ? (
                  <span data-testid="ai-explain-redacted" className="font-normal text-fg-subtle">
                    {t('ai.panel.redacted', { count: request.redactedCount })}
                  </span>
                ) : null}
              </summary>
              <p className="mt-2 text-caption text-fg-subtle">{t('ai.explain.consentIntro')}</p>
              <pre data-testid="ai-explain-preview" className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded border border-border-subtle bg-bg-inset p-2 text-micro text-fg-base">
                {sentPreview ?? request.preview}
              </pre>
              {values && !sentPreview ? (
                <label className="mt-2 flex items-start gap-2 text-caption text-fg-subtle">
                  <input
                    type="checkbox"
                    checked={includeValues}
                    disabled={phase.kind !== 'preview'}
                    onChange={(event) => setIncludeValues(event.target.checked)}
                    data-testid="ai-explain-include-values"
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-fg-base">{t('ai.panel.includeValues')}</span> {t('ai.panel.includeValuesHint')}
                  </span>
                </label>
              ) : null}
            </details>

            {phase.kind === 'preview' ? (
              <div className="flex justify-end">
                <button type="button" onClick={conversation.start} data-testid="ai-explain-send" className={PRIMARY}>
                  {t('ai.explain.send')}
                </button>
              </div>
            ) : phase.kind === 'confirm-apply' ? (
              <div className="space-y-2">
                <p className="text-fg-muted">{t(phase.rerun ? 'ai.explain.applyIntro' : 'ai.panel.applyOnlyIntro')}</p>
                <ApplyDiff segments={applyDiff} />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setPhase({ kind: 'done' })} data-testid="ai-explain-apply-back" className={BUTTON}>
                    {t('ai.explain.applyBack')}
                  </button>
                  <button type="button" onClick={() => apply(phase.suggested, phase.rerun)} data-testid="ai-explain-apply-confirm" className={PRIMARY}>
                    {phase.rerun ? <Play size={12} aria-hidden="true" /> : null}
                    {t(phase.rerun ? 'ai.panel.applyRerun' : 'ai.panel.applyOnly')}
                  </button>
                </div>
              </div>
            ) : (
              <ExplainExchanges exchanges={exchanges} phase={phase} />
            )}

            {phase.kind === 'error' ? (
              <div className="flex justify-end">
                <button type="button" onClick={conversation.retry} data-testid="ai-explain-retry" className={BUTTON}>
                  {t('ai.explain.retry')}
                </button>
              </div>
            ) : null}

            {phase.kind === 'done' && lastAnswer ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {suggestedCode && tab && suggestedCode.trim() !== code.trim() ? (
                    <>
                      <button
                        type="button"
                        data-testid="ai-explain-apply"
                        onClick={() => setPhase({ kind: 'confirm-apply', suggested: suggestedCode, rerun: true })}
                        className={PRIMARY}
                      >
                        <Play size={12} aria-hidden="true" />
                        {t('ai.panel.applyRerun')}
                      </button>
                      <button
                        type="button"
                        data-testid="ai-explain-apply-only"
                        onClick={() => setPhase({ kind: 'confirm-apply', suggested: suggestedCode, rerun: false })}
                        className={BUTTON}
                      >
                        {t('ai.panel.applyOnly')}
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    data-testid="ai-explain-copy"
                    onClick={() => {
                      void navigator.clipboard?.writeText(suggestedCode ?? lastAnswer).then(() => setCopied(true), () => undefined);
                    }}
                    className={BUTTON}
                  >
                    <Copy size={12} aria-hidden="true" />
                    {t(copied ? 'ai.panel.copied' : 'ai.panel.copy')}
                  </button>
                  <span className="flex-1" />
                  <button type="button" aria-label={t('ai.panel.helpful')} aria-pressed={vote === 'helpful'} data-testid="ai-explain-helpful" onClick={() => rate('helpful')} className={ICON_BUTTON}>
                    <Check size={14} aria-hidden="true" />
                  </button>
                  <button type="button" aria-label={t('ai.panel.notHelpful')} aria-pressed={vote === 'not-helpful'} data-testid="ai-explain-not-helpful" onClick={() => rate('not-helpful')} className={ICON_BUTTON}>
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FOLLOW_UP_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      data-testid="ai-explain-chip"
                      onClick={() => ask(t(`ai.panel.chip.${chip}`))}
                      className="focus-ring h-6 rounded-full border border-border-strong px-2.5 text-caption text-fg-muted hover:text-fg-base"
                    >
                      {t(`ai.panel.chip.${chip}`)}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {phase.kind === 'done' || phase.kind === 'error' ? (
              <>
                <label className="flex h-[34px] items-center gap-2 rounded-md border border-border-strong bg-bg-inset px-2">
                  <Sparkles size={13} className="shrink-0 text-fg-subtle" aria-hidden="true" />
                  <input
                    type="text"
                    value={followUp}
                    onChange={(event) => setFollowUp(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') ask(followUp);
                    }}
                    placeholder={t('ai.panel.askPlaceholder')}
                    aria-label={t('ai.panel.askPlaceholder')}
                    data-testid="ai-explain-followup-input"
                    className="min-w-0 flex-1 bg-transparent text-body-sm text-fg-base outline-none placeholder:text-fg-subtle"
                  />
                  <button type="button" onClick={() => ask(followUp)} data-testid="ai-explain-followup-send" className="focus-ring h-6 rounded bg-accent px-2 text-caption font-semibold text-accent-foreground">
                    {t('ai.panel.ask')}
                  </button>
                </label>
                <p className="text-micro text-fg-subtle">{t('ai.panel.footer')}</p>
              </>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}

/** The values the program last held in this tab: the paused frame, else the last run's variables. */
function useRuntimeValues(tabId: string, language: string): Record<string, string> | null {
  const paused = useDebuggerStore((s) => (s.pausedFrame?.tabId === tabId ? s.pausedFrame.locals : null));
  const snapshot = useResultStore((s) => s.scopeSnapshot);
  return useMemo(() => {
    if (paused && Object.keys(paused).length > 0) return paused;
    if (!snapshot || snapshot.language !== language || snapshot.variables.length === 0) return null;
    return Object.fromEntries(snapshot.variables.map((variable) => [variable.name, scopeValueToString(variable.value)]));
  }, [paused, snapshot, language]);
}
