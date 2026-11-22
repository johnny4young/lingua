import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type * as monacoTypes from 'monaco-editor';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import '../../i18n/testsCatalog';
import '../ui/identity.css';
import './projectTests.css';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { sameTest, useProjectTestStore, type ProjectTestDisplayCase } from '../../stores/projectTestStore';
import { parentDirOf } from '../../utils/filePath';
import { formatWholeDuration } from '../../utils/latencyScale';
import { projectTestFailureHeadline } from '../../utils/projectTestFailure';
import { inferKind } from '../Editor/inlineResultWidgetDom';
import { useAnswerColumnWidgets } from './answerColumn';
import { openProjectFileAt, openTestFailure } from './openTestFailure';
import { TestFailureCard } from './TestFailureCard';
import { suiteTally, testLineAnswers, type TestLineAnswer } from './testLineAnswersModel';
import { useCodeUnderTestChange } from './useCodeUnderTestChange';
import type { CodeChange } from './codeUnderTestChange';

const MAX_SUITE_MARKS = 12;
const JS_FAMILY = new Set(['vitest', 'jest']);

export interface TestLineAnswersProps {
  editor: monacoTypes.editor.IStandaloneCodeEditor | null;
  monaco: typeof monacoTypes | null;
}

const baseName = (file: string) => parentDirOf(file).basename;

/** Each test's result on its line of the open test file, and the focused failure's card. */
export function TestLineAnswers({ editor, monaco }: TestLineAnswersProps) {
  // The content is read when needed rather than subscribed to, so typing does not re-render the answers.
  const tab = useEditorStore(
    useShallow(state => {
      const active = getActiveTab(state);
      return { id: active?.id, rootId: active?.rootId, file: active?.relativePath };
    })
  );
  const rootId = useProjectTestStore(state => state.rootId);
  const cases = useProjectTestStore(state => state.cases);
  const framework = useProjectTestStore(state => state.selectedFramework);
  const focused = useProjectTestStore(state => state.focusedFailure);
  const file = tab.rootId === rootId ? tab.file : undefined;
  // Suite lines are found in the text; only the JS runners write suites as `describe` calls.
  const suites = framework !== null && JS_FAMILY.has(framework);
  const answers = useMemo(
    () => (file ? testLineAnswers(cases, file, getActiveTab(useEditorStore.getState())?.content ?? '', { suites }) : []),
    [cases, file, suites]
  );
  const focusedAnswer = focused ? answers.find(answer => answer.kind === 'assertion' && sameTest(answer.test, focused)) : undefined;
  const entry = focusedAnswer?.kind === 'assertion' ? focusedAnswer.test : undefined;
  const lookup = useCodeUnderTestChange(entry);
  const change = lookup.status === 'done' ? lookup.change : null;
  const nodes = useAnswerColumnWidgets(editor, monaco, answers);
  const answeredLines = useMemo(() => answers.map(answer => answer.line), [answers]);

  useEffect(() => {
    if (!editor || !monaco) return;
    const tint = editor.createDecorationsCollection(
      answers
        .filter(answer => answer.kind === 'assertion')
        .map(answer => ({ range: new monaco.Range(answer.line, 1, answer.line, 1), options: { isWholeLine: true, className: 'lingua-error-line' } }))
    );
    return () => tint.clear();
  }, [editor, monaco, answers]);

  if (!file) return null;
  return (
    <>
      {answers.map(answer => {
        const node = nodes.get(answer.key);
        return node ? createPortal(<LineAnswer answer={answer} file={file} change={answer === focusedAnswer ? change : null} />, node, answer.key) : null;
      })}
      {entry && lookup.status === 'done' && tab.id ? (
        <TestFailureCard editor={editor} monaco={monaco} entry={entry} change={change} tabId={tab.id} answeredLines={answeredLines} />
      ) : null}
    </>
  );
}

function LineAnswer({ answer, file, change }: { answer: TestLineAnswer; file: string; change: CodeChange | null }) {
  const { t } = useTranslation();
  // Opening also reveals the assertion line, which can be off screen in a long test.
  const focus = (test: ProjectTestDisplayCase) => void openTestFailure(test);
  let tag: string;
  let tone: 'muted' | 'error' = 'muted';
  let body: React.ReactNode;

  if (answer.kind === 'suite') {
    const { passed, total } = suiteTally(answer.statuses);
    tag = t('projectTests.line.suite');
    body = (
      <>
        {answer.statuses.length <= MAX_SUITE_MARKS ? (
          <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
            {answer.statuses.map((status, index) => (
              <span key={index} className="test-answer-mark" data-status={status} />
            ))}
          </span>
        ) : null}
        <span className="truncate text-fg-muted">
          {total === 0 ? t('projectTests.skipped', { count: answer.statuses.length }) : t('projectTests.line.passedOf', { passed, total })}
        </span>
      </>
    );
  } else if (answer.kind === 'test') {
    const { test } = answer;
    const duration = test.durationMs !== undefined ? formatWholeDuration(test.durationMs) : null;
    if (test.status === 'passed') {
      tag = t('projectTests.line.passed');
      body = (
        <>
          <span className="test-answer-pill" data-tone="ok">
            {t('projectTests.line.ok')}
          </span>
          {duration ? <span className="text-fg-subtle">{duration}</span> : null}
        </>
      );
    } else if (test.status === 'skipped') {
      tag = t('projectTests.line.skipped');
      body = null;
    } else {
      tag = t('projectTests.line.failed');
      tone = 'error';
      const where = test.failureLine
        ? test.failureFile && test.failureFile !== file
          ? t('projectTests.line.atFileLine', { file: baseName(test.failureFile), line: test.failureLine })
          : t('projectTests.line.atLine', { line: test.failureLine })
        : null;
      const text = [duration, where].filter(Boolean).join(' · ');
      body =
        where && test.failureFile ? (
          <button type="button" className="test-answer-link" onClick={() => focus(test)} data-testid="test-line-open-failure">
            {text}
          </button>
        ) : (
          <span className="truncate text-fg-subtle">{text}</span>
        );
    }
  } else {
    const { test } = answer;
    tone = 'error';
    const compared = test.expected !== undefined && test.received !== undefined;
    tag = compared ? t('projectTests.line.received') : t('projectTests.line.failed');
    body = (
      <>
        <button
          type="button"
          className="test-answer-link flex min-w-0 items-center gap-2.5"
          onClick={() => focus(test)}
          aria-label={t('projectTests.card.label', { name: test.path.join(' › ') })}
          data-testid="test-line-show-failure"
        >
          {compared ? (
            <>
              <span className="test-answer-pill" data-tone="error">
                {test.received}
              </span>
              <span className="shrink-0 text-fg-subtle">{t('projectTests.line.expected')}</span>
              <span className="test-answer-pill" data-tone={inferKind(test.expected)}>
                {test.expected}
              </span>
            </>
          ) : (
            <span className="truncate text-value-error">{projectTestFailureHeadline(test.failureMessage) ?? t('projectTests.line.failed')}</span>
          )}
        </button>
        {change ? (
          <button
            type="button"
            className="test-answer-chip"
            onClick={() => void openProjectFileAt(change.file, change.line)}
            data-testid="test-line-open-change"
          >
            {t('projectTests.change.open', { file: baseName(change.file), line: change.line })}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <div className="test-answer" data-testid="test-line-answer" data-kind={answer.kind} data-line={answer.line}>
      <span className="dot-leader test-answer-leader" data-tone={tone} aria-hidden="true" />
      <span className="test-answer-body">
        <span className="test-answer-tag" data-tone={tone}>
          {tag}
        </span>
        {body}
      </span>
    </div>
  );
}
