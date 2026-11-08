import { Loader2, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type * as monacoTypes from 'monaco-editor';
import { useTranslation } from 'react-i18next';
import '../../i18n/testsCatalog';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useProjectTestStore } from '../../stores/projectTestStore';
import { summarizeProjectTestFailure } from '../../utils/projectTestFailure';
import { useLineWidget } from '../Editor/useLineWidget';
import { opensInEditor } from './openTestFailure';

const CARD_ID = 'lingua.projectTests.failureCard';
const CARD_WIDTH = 640;

export interface TestFailureCardProps {
  editor: monacoTypes.editor.IStandaloneCodeEditor | null;
  monaco: typeof monacoTypes | null;
}

/** The focused failed test under its assertion line, in a reserved row so no code is covered. */
export function TestFailureCard({ editor, monaco }: TestFailureCardProps) {
  const { t } = useTranslation();
  const entry = useProjectTestStore(state => {
    const focused = state.focusedFailure;
    return focused
      ? state.cases?.find(
          test => test.file === focused.file && test.path.length === focused.path.length && test.path.every((part, index) => part === focused.path[index])
        )
      : undefined;
  });
  const rootId = useProjectTestStore(state => state.rootId);
  const projectName = useProjectTestStore(state => state.projectName);
  const running = useProjectTestStore(state => state.status === 'running');
  const onFailureFile = useEditorStore(state => {
    const tab = getActiveTab(state);
    return entry?.failureFile !== undefined && tab?.rootId === rootId && tab?.relativePath === entry.failureFile;
  });
  const [node] = useState(() => document.createElement('div'));
  const [height, setHeight] = useState(84);
  const [width, setWidth] = useState(CARD_WIDTH);
  const line = entry && onFailureFile && opensInEditor(entry) ? entry.failureLine! : null;

  useEffect(() => {
    if (line === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setHeight(Math.ceil(node.getBoundingClientRect().height)));
    observer.observe(node);
    return () => observer.disconnect();
  }, [line, node]);

  useEffect(() => {
    if (!editor || !monaco || line === null) return;
    let zoneId = '';
    editor.changeViewZones(accessor => {
      zoneId = accessor.addZone({ afterLineNumber: line, heightInPx: height, domNode: document.createElement('div'), suppressMouseDown: true });
    });
    const tint = editor.createDecorationsCollection([
      { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'lingua-error-line' } },
    ]);
    return () => {
      tint.clear();
      editor.changeViewZones(accessor => accessor.removeZone(zoneId));
    };
  }, [editor, monaco, line, height]);

  useEffect(() => {
    if (!editor || line === null) return;
    const fit = () => setWidth(Math.min(CARD_WIDTH, editor.getLayoutInfo().contentWidth - 32));
    fit();
    const layout = editor.onDidLayoutChange(fit);
    const keys = editor.onKeyDown(event => {
      // Esc first closes whatever editor widget is open (suggestions, find, hints).
      const widgetOpen = editor.getDomNode()?.querySelector('.suggest-widget.visible, .find-widget.visible, .parameter-hints-widget.visible');
      if (event.browserEvent.key === 'Escape' && !widgetOpen) useProjectTestStore.getState().focusFailure(null);
    });
    return () => {
      layout.dispose();
      keys.dispose();
    };
  }, [editor, line]);

  useLineWidget(editor, monaco, line, node, { id: CARD_ID, placement: 'below' });

  if (line === null || !entry || !rootId || !projectName) return null;
  const summary = summarizeProjectTestFailure(entry.failureMessage);
  const runAgain = () =>
    void useProjectTestStore.getState().run({ rootId, projectName }, { kind: 'test', file: entry.file, path: entry.path });
  return createPortal(
    <div
      role="group"
      aria-label={t('projectTests.card.label', { name: entry.path.join(' › ') })}
      data-testid="test-failure-card"
      style={{ width }}
      className="my-1.5 box-border rounded-lg border border-error/50 bg-error/10 px-3 py-2.5 font-sans text-body text-fg-base"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-error/15 text-error-fg ring-1 ring-inset ring-error/50">
          <X size={10} strokeWidth={2.4} aria-hidden="true" />
        </span>
        <span className="shrink-0 font-semibold">{t('projectTests.card.title')}</span>
        {summary ? (
          <span className="min-w-0 truncate font-mono text-caption text-fg-muted" data-testid="test-failure-summary">
            {summary.expected !== undefined ? (
              <>
                {t('projectTests.card.expected')} <span className="text-success-fg">{summary.expected}</span> {t('projectTests.card.received')}{' '}
                <span className="text-error-fg">{summary.received}</span>
              </>
            ) : (
              summary.headline
            )}
          </span>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          aria-label={t('projectTests.card.close')}
          title={t('projectTests.card.close')}
          onClick={() => useProjectTestStore.getState().focusFailure(null)}
          data-testid="test-failure-close"
          className="icon-button h-6 w-6 shrink-0 rounded-md"
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      {entry.runnable !== false && entry.path.length > 0 ? (
        <div className="mt-2 pl-[26px]">
          <button
            type="button"
            disabled={running}
            onClick={runAgain}
            data-testid="test-failure-run-again"
            className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-success/35 bg-success/10 px-2.5 text-caption font-semibold text-success-fg hover:bg-success/15 disabled:opacity-50"
          >
            {running ? <Loader2 size={11} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={11} aria-hidden="true" />}
            {t('projectTests.card.runAgain')}
          </button>
        </div>
      ) : null}
    </div>,
    node
  );
}
