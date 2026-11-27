import { GitCompare, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type * as monacoTypes from 'monaco-editor';
import { useTranslation } from 'react-i18next';
import { useEntitlement } from '../../hooks/useEntitlement';
import { useExplainPanelStore } from '../../stores/explainPanelStore';
import { useProjectTestStore, type ProjectTestDisplayCase } from '../../stores/projectTestStore';
import { useUIStore } from '../../stores/uiStore';
import { parentDirOf } from '../../utils/filePath';
import { PLAINTEXT_LANGUAGE, languageFromPath } from '../../utils/language';
import { monacoLanguageFor } from '../../utils/languageMeta';
import { useLineWidget } from '../Editor/useLineWidget';
import { LanguageSquare } from '../Start/StartParts';
import { lineEnd } from '../Editor/answerColumnGeometry';
import { answerColumn } from './answerColumn';
import { useColorizedLines, type ColorToken } from './colorizedLines';
import { explainTestFailureText, type CodeChange } from './codeUnderTestChange';
import { openProjectFileAt } from './openTestFailure';

const CARD_ID = 'lingua.projectTests.failureCard';
const CARD_MAX = 530;
const CARD_MIN = 320;

export interface TestFailureCardProps {
  editor: monacoTypes.editor.IStandaloneCodeEditor | null;
  monaco: typeof monacoTypes | null;
  entry: ProjectTestDisplayCase;
  change: CodeChange | null;
  tabId: string;
  /** Lines with their own answer, which the card must not cover. */
  answeredLines: readonly number[];
}

/**
 * The focused failure under its assertion line, in the answer column: the
 * uncommitted change in the code under test and what to do next. It reserves
 * rows only when the code or answers beside it would run under it.
 */
export function TestFailureCard({ editor, monaco, entry, change, tabId, answeredLines }: TestFailureCardProps) {
  const { t } = useTranslation();
  const rootId = useProjectTestStore(state => state.rootId);
  const projectName = useProjectTestStore(state => state.projectName);
  const running = useProjectTestStore(state => state.status === 'running');
  const explainable = useEntitlement('LOCAL_AI');
  const [node] = useState(() => {
    const element = document.createElement('div');
    element.style.pointerEvents = 'none';
    return element;
  });
  const [height, setHeight] = useState(84);
  const [box, setBox] = useState({ left: 0, width: CARD_MAX, reserve: true });
  const line = entry.failureLine!;
  const changeLanguage = change ? (languageFromPath(change.file) ?? PLAINTEXT_LANGUAGE) : PLAINTEXT_LANGUAGE;
  const colored = useColorizedLines(
    monaco,
    monacoLanguageFor(changeLanguage),
    change ? [change.removed, change.added] : [],
    editor?.getModel()?.getOptions().tabSize ?? 4
  );
  const hunk = change
    ? [...change.removed.map(text => ({ kind: 'remove' as const, text })), ...change.added.map(text => ({ kind: 'add' as const, text }))]
    : [];

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const card = node.firstElementChild ?? node;
    const observer = new ResizeObserver(() =>
      setHeight(Math.ceil(card.getBoundingClientRect().height))
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, [node, change]);

  useEffect(() => {
    if (!editor || !monaco) return;
    const fit = () => {
      const column = answerColumn(editor);
      const room = editor.getLayoutInfo().contentWidth - 32;
      const width = Math.max(Math.min(CARD_MIN, room), Math.min(CARD_MAX, column.width - 70, room));
      const left = Math.max(0, column.right - width);
      const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
      const charWidth = editor.getOption(monaco.editor.EditorOption.fontInfo).typicalHalfwidthCharacterWidth;
      const model = editor.getModel();
      const last = model ? Math.min(model.getLineCount(), line + Math.ceil(height / lineHeight)) : line;
      let reserve = false;
      for (let next = line + 1; model && next <= last && !reserve; next += 1) {
        const end = lineEnd(editor, next) ?? model.getLineMaxColumn(next) * charWidth;
        reserve = end + 16 > left || answeredLines.includes(next);
      }
      setBox(current =>
        current.left === left && current.width === width && current.reserve === reserve ? current : { left, width, reserve }
      );
    };
    fit();
    let frame = 0;
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(() => {
        frame = 0;
        fit();
      });
    };
    const listeners = [
      editor.onDidLayoutChange(schedule),
      editor.onDidChangeModelContent(schedule),
      editor.onDidScrollChange(event => {
        if (event.scrollLeftChanged) schedule();
      }),
    ];
    return () => {
      cancelAnimationFrame(frame);
      for (const listener of listeners) listener.dispose();
    };
  }, [editor, monaco, line, height, answeredLines]);

  useEffect(() => {
    if (!editor) return;
    const keys = editor.onKeyDown(event => {
      if (event.browserEvent.key !== 'Escape') return;
      // Esc first closes whatever editor widget is open (suggestions, find, hints).
      const widgetOpen = editor.getDomNode()?.querySelector('.suggest-widget.visible, .find-widget.visible, .parameter-hints-widget.visible');
      if (!widgetOpen) useProjectTestStore.getState().focusFailure(null);
    });
    return () => keys.dispose();
  }, [editor]);

  useEffect(() => {
    if (!editor || !box.reserve) return;
    let zoneId = '';
    editor.changeViewZones(accessor => {
      zoneId = accessor.addZone({
        afterLineNumber: line,
        heightInPx: height,
        domNode: document.createElement('div'),
        suppressMouseDown: true,
      });
    });
    return () => editor.changeViewZones(accessor => accessor.removeZone(zoneId));
  }, [editor, line, height, box.reserve]);

  useLineWidget(editor, monaco, line, node, { id: CARD_ID, placement: 'below' });

  if (!rootId || !projectName) return null;
  const runAgain = () =>
    void useProjectTestStore
      .getState()
      .run({ rootId, projectName }, { kind: 'test', file: entry.file, path: entry.path });
  const showDiff = (target: CodeChange) =>
    void openProjectFileAt(target.file, target.line).then(opened => {
      if (opened) useUIStore.getState().openBottomPanel('git-diff');
    });
  const explain = () =>
    useExplainPanelStore
      .getState()
      .open({ tabId, errorMessage: explainTestFailureText(entry, change), line, column: null });
  const fileName = change ? parentDirOf(change.file).basename : '';

  return createPortal(
    // Padded to the answer column so the card lines up with the answers above it.
    <div
      className="box-border py-1.5"
      style={{ paddingLeft: box.left, width: box.left + box.width }}
    >
      <div
        role="group"
        aria-label={t('projectTests.card.label', { name: entry.path.join(' › ') })}
        data-testid="test-failure-card"
        style={{ pointerEvents: 'auto' }}
        className="overflow-hidden rounded-[10px] border border-border-strong bg-bg-panel font-sans text-[12px] text-fg-base"
      >
        <div className="flex min-h-[30px] min-w-0 items-center gap-2 border-b border-border-subtle px-3 py-1">
          {change ? (
            // The state moves to a second row before the file name is ever cut.
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <LanguageSquare language={changeLanguage} />
                <span className="min-w-0 font-mono font-semibold [overflow-wrap:anywhere]" data-testid="test-failure-change-file">
                  {fileName}
                </span>
              </span>
              <span className="flex items-center gap-2 whitespace-nowrap text-fg-muted" data-testid="test-failure-change-state">
                <span className="font-mono font-semibold text-value-number" aria-hidden="true">
                  M
                </span>
                {t('projectTests.change.uncommitted')}
              </span>
            </span>
          ) : (
            <>
              <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-error/15 text-error-fg ring-1 ring-inset ring-error/50">
                <X size={10} strokeWidth={2.4} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 truncate whitespace-nowrap font-semibold">{entry.path.join(' › ')}</span>
            </>
          )}
          <button
            type="button"
            aria-label={t('projectTests.card.close')}
            title={t('projectTests.card.close')}
            onClick={() => useProjectTestStore.getState().focusFailure(null)}
            data-testid="test-failure-close"
            className="icon-button -mr-1.5 h-6 w-6 shrink-0 rounded-md"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
        {change ? (
          <div
            className="whitespace-pre py-2 font-mono text-[12.5px] leading-[22px]"
            data-testid="test-failure-change"
          >
            {hunk.map((row, index) => (
              <div key={index} className="test-change-row" data-kind={row.kind}>
                <span className="test-change-sign">{row.kind === 'remove' ? '−' : '+'}</span>
                <span className="sr-only">{t(row.kind === 'remove' ? 'projectTests.change.removed' : 'projectTests.change.added')}</span>
                <HunkText text={row.text} tokens={colored?.[index]} />
              </div>
            ))}
            {change.more > 0 ? (
              <div className="px-3 font-sans text-[11.5px] text-fg-subtle">
                {t('projectTests.change.more', { count: change.more })}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex min-h-[34px] min-w-0 flex-wrap items-center gap-2 border-t border-border-subtle px-3 py-[7px]">
          {entry.runnable !== false ? (
            <button
              type="button"
              disabled={running}
              onClick={runAgain}
              data-testid="test-failure-run-again"
              className="test-answer-chip"
            >
              {running ? (
                <Loader2 size={11} className="animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw size={11} aria-hidden="true" />
              )}
              {t('projectTests.card.runAgain')}
            </button>
          ) : null}
          <span className="ml-auto flex flex-wrap justify-end gap-2">
            {change ? (
              <button
                type="button"
                onClick={() => showDiff(change)}
                data-testid="test-failure-git-diff"
                className="test-answer-chip"
              >
                <GitCompare size={11} aria-hidden="true" />
                {t('projectTests.change.gitDiff')}
              </button>
            ) : null}
            {explainable ? (
              <button
                type="button"
                onClick={explain}
                data-testid="test-failure-explain"
                className="test-answer-chip"
              >
                <Sparkles size={11} aria-hidden="true" />
                {t('projectTests.change.explain')}
              </button>
            ) : null}
          </span>
        </div>
      </div>
    </div>,
    node
  );
}

/** A hunk line in the editor's token colors once they are ready, plain text until then. */
function HunkText({ text, tokens }: { text: string; tokens: ColorToken[] | undefined }) {
  if (!tokens) return <>{text}</>;
  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} className={token.className}>
          {token.text}
        </span>
      ))}
    </>
  );
}
