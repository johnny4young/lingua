import { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type * as monacoTypes from 'monaco-editor';
import { useConsoleStore } from '../../stores/consoleStore';
import { useResultStore } from '../../stores/resultStore';
import { answerColumnBand } from './answerColumnGeometry';
import '../../i18n/answersCatalog';
import '../ui/identity.css';

/** Code start, column start and narrowness as one string, so an unchanged layout keeps its snapshot. */
function readLayout(editor: monacoTypes.editor.IStandaloneCodeEditor): string {
  const layout = editor.getLayoutInfo();
  const band = answerColumnBand(layout);
  return band.narrow ? 'narrow' : `${layout.contentLeft}:${layout.contentLeft + band.start}`;
}

/**
 * Labels the two columns over the editor: the code on the left, the answer
 * column with the run it shows on the right. Narrow editors have no column, so
 * the header keeps only the changes switch, and only when there is a run to compare.
 */
export function AnswerColumnHeader({
  editor,
  tabId,
  since,
}: {
  readonly editor: monacoTypes.editor.IStandaloneCodeEditor;
  readonly tabId: string | null;
  /** The run the answers on screen compare with, or null when there is none. */
  readonly since: number | null;
}) {
  const { t } = useTranslation();
  const subscribe = useCallback(
    (notify: () => void) => {
      const listener = editor.onDidLayoutChange(notify);
      return () => listener.dispose();
    },
    [editor]
  );
  const layout = useSyncExternalStore(subscribe, () => readLayout(editor));
  const run = useConsoleStore(state => (state.currentRun && state.currentRun.tabId === tabId ? state.currentRun.number : null));
  const live = useResultStore(state => state.executionSource === 'auto');
  const showChanges = useResultStore(state => state.showRunChanges);
  const setShowChanges = useResultStore(state => state.setShowRunChanges);

  const narrow = layout === 'narrow';
  if (narrow && since === null) return null;
  const [code, column] = layout.split(':').map(Number);
  return (
    <div className="answer-column-header" data-testid="answer-column-header">
      {narrow ? null : (
        <>
          <span className="type-tag answer-column-header-code" style={{ left: code }}>
            {t('answers.header.code')}
          </span>
          <span className="answer-column-header-answers" style={{ left: column }}>
            <span className="type-tag answer-column-header-title">{t('answers.header.answers')}</span>
            {run === null ? null : (
              <span className="type-tag" data-testid="answer-column-header-run">
                {`· ${t(live ? 'answers.header.runLive' : 'answers.header.run', { number: run })}`}
              </span>
            )}
          </span>
        </>
      )}
      {since === null ? null : (
        <button
          type="button"
          role="switch"
          aria-checked={showChanges}
          className="type-tag answer-column-header-changes focus-ring"
          onClick={() => setShowChanges(!showChanges)}
          data-testid="answer-column-header-changes"
        >
          <span className="switch-track" aria-hidden />
          {t('answers.header.changes', { number: since })}
        </button>
      )}
    </div>
  );
}
