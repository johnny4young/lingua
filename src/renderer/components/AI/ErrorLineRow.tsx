import { Bug, Copy, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type * as monacoTypes from 'monaco-editor';
import { useTranslation } from 'react-i18next';
import '../../i18n/explainCatalog';
import { useEntitlement } from '../../hooks/useEntitlement';
import { useDebuggerStore } from '../../stores/debuggerStore';
import { useExplainPanelStore } from '../../stores/explainPanelStore';
import { useResultStore } from '../../stores/resultStore';
import { languageSupportsDebugger } from '../../utils/languageMeta';
import { describeError } from '../../utils/describeError';
import { useLineWidget } from '../Editor/useLineWidget';
import { useErrorLineMarks } from '../../hooks/useErrorLineMarks';

const ROW_ID = 'lingua.errorLineRow';
const ROW_BUTTON = 'pointer-events-auto focus-ring inline-flex h-5 shrink-0 items-center gap-1 rounded border border-error/50 px-1.5 text-micro font-medium text-error-fg hover:bg-error/10';

export interface ErrorLineRowProps {
  editor: monacoTypes.editor.IStandaloneCodeEditor | null;
  monaco: typeof monacoTypes | null;
  tabId: string | null;
  language: string | undefined;
  /** The width the actions take after the line's text, so inline results can make room. */
  onWidthChange?: (reserve: { line: number; width: number } | null) => void;
}

/**
 * Explain, Copy stack and Add breakpoint at the end of the failing line. The
 * error text itself stays in the line's inline result, so nothing is shown
 * twice and no row is reserved that would shift the code.
 */
export function ErrorLineRow({ editor, monaco, tabId, language, onWidthChange }: ErrorLineRowProps) {
  const { t } = useTranslation();
  const error = useResultStore((state) => state.error);
  const explainable = useEntitlement('LOCAL_AI');
  const hasBreakpoint = useDebuggerStore((state) => (tabId && error?.line ? Boolean(state.breakpoints[`${tabId}:${error.line}`]) : false));
  const [node] = useState(() => {
    const element = document.createElement('div');
    element.style.pointerEvents = 'none';
    return element;
  });
  const [copied, setCopied] = useState(false);
  // Labels give way to icons when the actions would run past the editor's edge.
  const [compact, setCompact] = useState(false);
  const fullWidthRef = useRef(0);
  const line = error?.line && Number.isInteger(error.line) && error.line >= 1 ? error.line : null;

  useLineWidget(editor, monaco, line, node, { id: ROW_ID, placement: 'line-end' });
  // The tint and the gutter mark load with these actions, on the first failure on a known line.
  useErrorLineMarks(editor, monaco);

  useEffect(() => {
    if (!onWidthChange) return;
    if (line === null || typeof ResizeObserver === 'undefined') {
      onWidthChange(null);
      return;
    }
    const observer = new ResizeObserver(() => {
      const width = Math.ceil(node.getBoundingClientRect().width);
      if (!compact) fullWidthRef.current = width;
      onWidthChange({ line, width });
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      onWidthChange(null);
    };
  }, [line, node, onWidthChange, compact]);

  useEffect(() => {
    if (!editor || line === null) return;
    const measure = () => {
      const model = editor.getModel();
      if (!model || line > model.getLineCount() || fullWidthRef.current === 0) return;
      const layout = editor.getLayoutInfo();
      const lineEnd = layout.contentLeft + editor.getOffsetForColumn(line, model.getLineMaxColumn(line)) - editor.getScrollLeft();
      const room = layout.width - layout.verticalScrollbarWidth - (layout.minimap.minimapWidth ?? 0) - lineEnd;
      setCompact(fullWidthRef.current > room);
    };
    const frame = requestAnimationFrame(measure);
    const listeners = [editor.onDidLayoutChange(measure), editor.onDidChangeModelContent(measure), editor.onDidScrollChange(measure)];
    return () => {
      cancelAnimationFrame(frame);
      for (const listener of listeners) listener.dispose();
    };
  }, [editor, line]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!error || line === null || !tabId) return null;
  const { name, full } = describeError(error);
  return createPortal(
    <div
      role="group"
      aria-label={t('errorRow.label', { line })}
      data-testid="error-line-row"
      className="pointer-events-none ml-4 inline-flex h-[20px] items-center gap-1.5 whitespace-nowrap text-micro text-error-fg"
    >
      <TriangleAlert size={11} aria-hidden="true" className="shrink-0" />
      {name ? <span className="font-semibold">{name}</span> : null}
      {error.column && !compact ? <span className="opacity-80">{t('errorRow.column', { column: error.column })}</span> : null}
      {explainable ? (
        <button
          type="button"
          data-testid="error-line-explain"
          aria-label={t('errorRow.explain')}
          title={t('errorRow.explain')}
          onClick={() => useExplainPanelStore.getState().open({ tabId, errorMessage: full, line, column: error.column ?? null })}
          className={ROW_BUTTON}
        >
          <Sparkles size={11} aria-hidden="true" />
          {compact ? null : t('errorRow.explain')}
        </button>
      ) : null}
      <button
        type="button"
        data-testid="error-line-copy"
        aria-label={t(copied ? 'errorRow.copied' : 'errorRow.copyStack')}
        title={t(copied ? 'errorRow.copied' : 'errorRow.copyStack')}
        onClick={() => void navigator.clipboard?.writeText(error.stack ?? error.message).then(() => setCopied(true), () => undefined)}
        className={ROW_BUTTON}
      >
        <Copy size={11} aria-hidden="true" />
        {compact ? null : t(copied ? 'errorRow.copied' : 'errorRow.copyStack')}
      </button>
      {languageSupportsDebugger(language) && !hasBreakpoint ? (
        <button
          type="button"
          data-testid="error-line-breakpoint"
          aria-label={t('errorRow.addBreakpoint')}
          title={t('errorRow.addBreakpoint')}
          onClick={() => useDebuggerStore.getState().toggleBreakpoint(tabId, line)}
          className={ROW_BUTTON}
        >
          <Bug size={11} aria-hidden="true" />
          {compact ? null : t('errorRow.addBreakpoint')}
        </button>
      ) : null}
    </div>,
    node
  );
}
