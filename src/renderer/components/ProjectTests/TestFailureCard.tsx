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
import { useLineWidget } from '../Editor/useLineWidget';
import { LanguageSquare } from '../Start/StartParts';
import { answerColumn, lineEnd } from './answerColumn';
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
    const listeners = [editor.onDidLayoutChange(schedule), editor.onDidChangeModelContent(schedule)];
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
        <div className="flex h-[30px] min-w-0 items-center gap-2 whitespace-nowrap border-b border-border-subtle px-3">
          {change ? (
            <>
              <LanguageSquare language={languageFromPath(change.file) ?? PLAINTEXT_LANGUAGE} />
              <span
                className="min-w-0 truncate font-mono font-semibold"
                data-testid="test-failure-change-file"
              >
                {fileName}
              </span>
              <span className="shrink-0 font-mono text-fg-muted">
                {t('projectTests.change.line', { line: change.line })}
              </span>
              <span
                className="ml-1 shrink-0 font-mono font-semibold text-value-number"
                aria-hidden="true"
              >
                M
              </span>
              <span className="min-w-0 truncate text-fg-muted">
                {t('projectTests.change.uncommitted')}
              </span>
            </>
          ) : (
            <>
              <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-error/15 text-error-fg ring-1 ring-inset ring-error/50">
                <X size={10} strokeWidth={2.4} aria-hidden="true" />
              </span>
              <span className="min-w-0 truncate font-semibold">{entry.path.join(' › ')}</span>
            </>
          )}
          <span className="flex-1" />
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
            {change.removed.map((text, index) => (
              <div key={`r${index}`} className="test-change-row" data-kind="remove">
                <span className="test-change-sign">−</span>
                <span className="sr-only">{t('projectTests.change.removed')}</span>
                {text}
              </div>
            ))}
            {change.added.map((text, index) => (
              <div key={`a${index}`} className="test-change-row" data-kind="add">
                <span className="test-change-sign">+</span>
                <span className="sr-only">{t('projectTests.change.added')}</span>
                {text}
              </div>
            ))}
            {change.more > 0 ? (
              <div className="px-3 font-sans text-[11.5px] text-fg-subtle">
                {t('projectTests.change.more', { count: change.more })}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex h-[34px] min-w-0 items-center gap-2 whitespace-nowrap border-t border-border-subtle px-3">
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
          <span className="flex-1" />
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
        </div>
      </div>
    </div>,
    node
  );
}
