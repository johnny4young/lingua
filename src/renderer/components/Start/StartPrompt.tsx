import { useCallback, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { isJavaScriptFamily } from '../../../shared/languageFamilies';
import { SEEDED_SCRATCHPAD_NAME, seededScratchpadTab } from '../../onboarding/seedScratchpad';
import { openHttpWorkspaceTab, openSqlWorkspaceTab } from '../../runtime/openWorkspaceTab';
import { useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { NEW_SCRATCH_LANGUAGE } from '../../stores/editorTabUtils';
import { requestSqlSample } from '../SqlWorkspace/pendingSqlSample';
import { Kbd } from '../ui/ModalShell';
import { AnswerPicture } from './AnswerPicture';
import { DottedLeader } from './StartParts';
import { StartPromptEditor } from './StartPromptEditor';
import { answerFallback } from './answerLabels';
import { runsOnPause, type PromptAnswer } from './startPromptModel';
import { useStartPromptRun, type PromptRun } from './useStartPromptRun';

const SAMPLE_REQUEST_URL = 'https://jsonplaceholder.typicode.com/todos/1';

function openSampleTable(): void {
  requestSqlSample();
  openSqlWorkspaceTab();
}

async function openSampleRequest(name: string): Promise<void> {
  const [{ useWorkspaceToolStore }, { createBlankHttpRequest }] = await Promise.all([
    import('../../stores/workspaceToolStore'),
    import('../../../shared/httpWorkspaceSchema'),
  ]);
  useWorkspaceToolStore.getState().createRequest({
    ...createBlankHttpRequest({ id: crypto.randomUUID(), name }),
    url: SAMPLE_REQUEST_URL,
  });
  openHttpWorkspaceTab();
}

function StarterChips() {
  const { t } = useTranslation();
  const starters = [
    { id: 'welcome', label: SEEDED_SCRATCHPAD_NAME, open: () => useEditorStore.getState().addTab(seededScratchpadTab()) },
    { id: 'sample-table', label: t('start.try.sampleTable'), open: openSampleTable },
    { id: 'sample-request', label: t('start.try.sampleRequest'), open: () => void openSampleRequest(t('start.try.sampleRequestName')) },
  ];
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>{t('start.try.label')}</span>
      {starters.map(starter => (
        <button
          key={starter.id}
          type="button"
          onClick={starter.open}
          data-testid={`start-try-${starter.id}`}
          className="start-chip focus-ring inline-flex items-center rounded-md bg-bg-panel-alt text-fg-muted transition-colors hover:text-fg-base"
        >
          {starter.label}
        </button>
      ))}
    </span>
  );
}

function valueTag({ answer, valueKind }: PromptAnswer, t: TFunction): string | undefined {
  if (!valueKind) return undefined;
  if (valueKind === 'array' && answer.total) return t('start.prompt.type.arrayCount', { count: answer.total });
  return t(`start.prompt.type.${valueKind}`);
}

function PromptAnswerView({ shown }: { shown: PromptAnswer }) {
  const { t } = useTranslation();
  const { answer, valueKind } = shown;
  const tag = valueTag(shown, t);
  return (
    <span
      className="start-prompt-answer"
      role="status"
      data-testid="start-prompt-answer"
      data-status={answer.status}
      data-kind={valueKind}
    >
      <DottedLeader />
      {tag ? <span className="start-prompt-tag">{tag}</span> : null}
      {answer.picture ? (
        <span className="start-prompt-picture">
          <AnswerPicture picture={answer.picture} barHeight={30} />
        </span>
      ) : null}
      <span className="start-prompt-value truncate font-mono">{answer.numeral || answerFallback(answer, t)}</span>
    </span>
  );
}

function hintKey(run: PromptRun, onPause: boolean, current: boolean): string | undefined {
  if (run.phase === 'busy') return 'start.prompt.busy';
  if (run.phase === 'running') return 'start.prompt.running';
  return onPause && current ? 'start.prompt.ranOnPause' : undefined;
}

/** One line that answers as you pause; Enter keeps it as a scratch file. */
export function StartPrompt() {
  const { t } = useTranslation();
  const language = NEW_SCRATCH_LANGUAGE;
  const [value, setValue] = useState('');
  const [textWidth, setTextWidth] = useState(0);
  const focusRef = useRef<(() => void) | null>(null);
  const { run, shown, edit, submit } = useStartPromptRun(language);
  const runPolicies = useSettingsStore(state => state.runPolicyByGroup);
  const onPause = runsOnPause(language, runPolicies);
  const current = run.phase === 'answered' && run.code === value;
  const hint = hintKey(run, onPause, current);

  const handleChange = useCallback(
    (next: string) => {
      setValue(next);
      edit(next);
    },
    [edit]
  );
  const handleSubmit = useCallback(() => submit(value), [submit, value]);
  const handleReady = useCallback((focus: () => void) => {
    focusRef.current = focus;
  }, []);
  // The whole card is the field's target, apart from its buttons.
  const focusField = (event: MouseEvent) => {
    if ((event.target as Element).closest('.monaco-editor, button')) return;
    event.preventDefault();
    focusRef.current?.();
  };

  return (
    <div className="start-prompt" data-testid="start-prompt" onMouseDown={focusField}>
      <div className="start-prompt-line">
        <span className="start-prompt-caret font-mono" aria-hidden>
          ›
        </span>
        <div
          className="start-prompt-field"
          data-testid="start-prompt-input"
          data-sized={shown ? '' : undefined}
          style={shown ? { width: textWidth + 12 } : undefined}
        >
          <StartPromptEditor
            language={language}
            value={value}
            ariaLabel={t('start.prompt.label')}
            placeholder={isJavaScriptFamily(language) ? t('start.prompt.placeholder') : ''}
            onChange={handleChange}
            onSubmit={handleSubmit}
            onTextWidth={setTextWidth}
            onReady={handleReady}
          />
        </div>
        {shown ? <PromptAnswerView shown={shown} /> : null}
      </div>
      <div className="start-prompt-hints start-small text-fg-muted">
        {hint ? <span data-testid="start-prompt-hint">{t(hint)}</span> : null}
        {value.trim() ? (
          <span className="inline-flex items-center gap-2" data-testid="start-prompt-enter">
            <Kbd className="bg-transparent">↵</Kbd>
            {t(onPause || current ? 'start.prompt.keep' : 'start.prompt.run')}
          </span>
        ) : null}
        <span className="flex-1" />
        <StarterChips />
      </div>
    </div>
  );
}
