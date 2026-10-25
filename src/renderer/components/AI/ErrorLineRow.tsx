import { Bug, Copy, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type * as monacoTypes from 'monaco-editor';
import { useTranslation } from 'react-i18next';
import '../../i18n/explainCatalog';
import { useEntitlement } from '../../hooks/useEntitlement';
import { useDebuggerStore } from '../../stores/debuggerStore';
import { useExplainPanelStore } from '../../stores/explainPanelStore';
import { useResultStore } from '../../stores/resultStore';
import { languageSupportsDebugger } from '../../utils/languageMeta';

const ROW_HEIGHT = 32;
const ROW_ID = 'lingua.errorLineRow';
const ROW_BUTTON = 'focus-ring inline-flex h-5 shrink-0 items-center gap-1 rounded border border-error/50 px-1.5 text-micro font-medium text-error-fg hover:bg-error/10';

export interface ErrorLineRowProps {
  editor: monacoTypes.editor.IStandaloneCodeEditor | null;
  monaco: typeof monacoTypes | null;
  tabId: string | null;
  language: string | undefined;
}

const ERROR_NAME = /^\s*([A-Z][A-Za-z]*(?:Error|Exception))\b:?\s*/;

/** The error's name, from the message or the first stack line, and the rest of the message. */
export function describeError(error: { message: string; stack?: string }): { name: string | null; text: string; full: string } {
  const inMessage = ERROR_NAME.exec(error.message);
  if (inMessage) return { name: inMessage[1]!, text: error.message.slice(inMessage[0].length), full: error.message };
  const name = ERROR_NAME.exec(error.stack?.split('\n')[0] ?? '')?.[1] ?? null;
  return { name, text: error.message, full: name ? `${name}: ${error.message}` : error.message };
}

/** The red row under a failing line: the error, then Explain, Copy stack and Add breakpoint. */
export function ErrorLineRow({ editor, monaco, tabId, language }: ErrorLineRowProps) {
  const { t } = useTranslation();
  const error = useResultStore((state) => state.error);
  const explainable = useEntitlement('LOCAL_AI');
  const hasBreakpoint = useDebuggerStore((state) => (tabId && error?.line ? Boolean(state.breakpoints[`${tabId}:${error.line}`]) : false));
  const [node] = useState(() => document.createElement('div'));
  const [copied, setCopied] = useState(false);
  const line = error?.line && Number.isInteger(error.line) && error.line >= 1 ? error.line : null;

  useEffect(() => {
    if (!editor || !monaco || line === null) return;
    const model = editor.getModel();
    if (!model || line > model.getLineCount()) return;
    let zoneId = '';
    editor.changeViewZones((accessor) => {
      zoneId = accessor.addZone({ afterLineNumber: line, heightInPx: ROW_HEIGHT, domNode: document.createElement('div'), suppressMouseDown: true });
    });
    const tracker = editor.createDecorationsCollection([{ range: new monaco.Range(line, 1, line, 1), options: {} }]);
    const widget: monacoTypes.editor.IContentWidget = {
      getId: () => ROW_ID,
      getDomNode: () => node,
      getPosition: () => ({
        position: { lineNumber: tracker.getRange(0)?.startLineNumber ?? line, column: 1 },
        preference: [monaco.editor.ContentWidgetPositionPreference.BELOW],
      }),
    };
    editor.addContentWidget(widget);
    const edits = editor.onDidChangeModelContent(() => editor.layoutContentWidget(widget));
    return () => {
      edits.dispose();
      tracker.clear();
      editor.removeContentWidget(widget);
      editor.changeViewZones((accessor) => accessor.removeZone(zoneId));
    };
  }, [editor, monaco, line, node]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!error || line === null || !tabId) return null;
  const { name, text, full } = describeError(error);
  return createPortal(
    <div
      role="group"
      aria-label={t('errorRow.label', { line })}
      data-testid="error-line-row"
      className="mt-0.5 inline-flex h-[26px] max-w-[720px] items-center gap-2.5 whitespace-nowrap rounded-md border border-error/60 bg-error/10 px-2.5 text-caption text-error-fg"
    >
      <TriangleAlert size={12} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 truncate">
        {name ? <span className="font-semibold">{name}</span> : null}
        {name ? ' ' : ''}
        {text}
      </span>
      {error.column ? <span className="shrink-0 opacity-80">{t('errorRow.column', { column: error.column })}</span> : null}
      <span aria-hidden="true" className="h-[18px] w-px shrink-0 bg-error/50" />
      {explainable ? (
        <button
          type="button"
          data-testid="error-line-explain"
          onClick={() => useExplainPanelStore.getState().open({ tabId, errorMessage: full, line, column: error.column ?? null })}
          className={ROW_BUTTON}
        >
          <Sparkles size={11} aria-hidden="true" />
          {t('errorRow.explain')}
        </button>
      ) : null}
      <button
        type="button"
        data-testid="error-line-copy"
        onClick={() => void navigator.clipboard?.writeText(error.stack ?? error.message).then(() => setCopied(true), () => undefined)}
        className={ROW_BUTTON}
      >
        <Copy size={11} aria-hidden="true" />
        {t(copied ? 'errorRow.copied' : 'errorRow.copyStack')}
      </button>
      {languageSupportsDebugger(language) && !hasBreakpoint ? (
        <button
          type="button"
          data-testid="error-line-breakpoint"
          onClick={() => useDebuggerStore.getState().toggleBreakpoint(tabId, line)}
          className={ROW_BUTTON}
        >
          <Bug size={11} aria-hidden="true" />
          {t('errorRow.addBreakpoint')}
        </button>
      ) : null}
    </div>,
    node
  );
}
