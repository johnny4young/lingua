import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type * as monacoTypes from 'monaco-editor';
import { useNow } from '../../hooks/useNow';
import { useLiveRun } from '../../stores/liveRunStore';
import { LoopAnswerObject, RunningAnswerObject } from '../Answer/AnswerObject';
import { readAnswer } from '../Answer/answerObjectModel';
import { useAnswerContext } from '../Answer/useAnswerContext';
import { DotLeader } from '../ui/answer';
import { LEADER_MARGIN, MIN_LEADER, answerColumnBand, lineEnd } from './answerColumnGeometry';
import { createInlineResultNode } from './inlineResultWidgetDom';
import { liveLineAnswers, liveLineMs } from './liveLineModel';

const LIVE_WIDGET_PREFIX = 'lingua.liveAnswer';
const perfNow = () => performance.now();

interface LiveWidget {
  readonly widget: monacoTypes.editor.IOverlayWidget;
  readonly domNode: HTMLElement;
}

/**
 * The run in flight in the answer column: RUNNING on the line that holds it and
 * each open loop's pass and variable on its header. Lines go beside their code
 * only; a narrow editor, a line whose text reaches the column, or a line edited
 * since the run started shows none. `onShown` reports the lines these answers
 * cover, so the answers under them hide.
 */
export function LiveLineAnswers({
  editor,
  tabId,
  language,
  lineEndReserve = null,
  onShown,
}: {
  readonly editor: monacoTypes.editor.IStandaloneCodeEditor;
  readonly tabId: string | null;
  readonly language?: string;
  /** Room kept at the end of one line, such as the failing line's actions. */
  readonly lineEndReserve?: { readonly line: number; readonly width: number } | null;
  readonly onShown: (lines: ReadonlySet<number>) => void;
}) {
  const run = useLiveRun(tabId);
  const now = useNow(run !== null, perfNow);
  const answers = useMemo(
    () => (run ? liveLineAnswers(run.live, liveLineMs(run.live, run.at, Math.max(now, run.at))) : []),
    [run, now]
  );
  const code = run?.code;
  const ranLines = useMemo(() => (code === undefined ? null : code.split('\n')), [code]);
  const widgetsRef = useRef(new Map<number, LiveWidget>());
  const [widgets, setWidgets] = useState<ReadonlyMap<number, LiveWidget>>(() => new Map());
  const lineKey = answers.map(answer => answer.line).join(',');

  // One overlay per answered line; a line keeps its node while it stays live.
  useLayoutEffect(() => {
    const wanted = new Set(lineKey ? lineKey.split(',').map(Number) : []);
    const current = widgetsRef.current;
    let changed = false;
    for (const [line, { widget }] of current) {
      if (wanted.has(line)) continue;
      editor.removeOverlayWidget(widget);
      current.delete(line);
      changed = true;
    }
    for (const line of wanted) {
      if (current.has(line)) continue;
      const domNode = createInlineResultNode(line);
      domNode.setAttribute('data-testid', 'lingua-live-answer');
      domNode.style.position = 'absolute';
      domNode.style.pointerEvents = 'none';
      domNode.style.visibility = 'hidden';
      const id = `${LIVE_WIDGET_PREFIX}.${line}`;
      const widget = { getId: () => id, getDomNode: () => domNode, getPosition: () => null };
      editor.addOverlayWidget(widget);
      current.set(line, { widget, domNode });
      changed = true;
    }
    if (changed) setWidgets(new Map(current));
  }, [editor, lineKey]);

  useEffect(
    () => () => {
      for (const { widget } of widgetsRef.current.values()) editor.removeOverlayWidget(widget);
      widgetsRef.current.clear();
    },
    [editor]
  );

  // Placed beside the line like the other answers; measured after Monaco renders.
  const shownRef = useRef('');
  const reserveLine = lineEndReserve?.line ?? null;
  const reserveWidth = lineEndReserve?.width ?? 0;
  useEffect(() => {
    let frame: number | null = null;
    const report = (lines: Set<number>) => {
      const key = [...lines].join(',');
      if (key === shownRef.current) return;
      shownRef.current = key;
      onShown(lines);
    };
    const place = () => {
      frame = null;
      const model = editor.getModel();
      if (!model) return;
      const layout = editor.getLayoutInfo();
      const band = answerColumnBand(layout);
      const scrollTop = editor.getScrollTop();
      const scrollLeft = editor.getScrollLeft();
      const ranges = editor.getVisibleRanges();
      const shown = new Set<number>();
      for (const [line, { domNode }] of widgets) {
        const visible =
          line <= model.getLineCount() &&
          (ranLines === null || ranLines[line - 1] === model.getLineContent(line)) &&
          ranges.some(range => line >= range.startLineNumber && line <= range.endLineNumber);
        const end = visible && !band.narrow ? lineEnd(editor, line) : null;
        const reserved = reserveLine === line ? reserveWidth : 0;
        const room = end === null ? null : band.start - end + scrollLeft - reserved - LEADER_MARGIN * 2;
        if (room === null || room < MIN_LEADER) {
          domNode.style.visibility = 'hidden';
          continue;
        }
        shown.add(line);
        domNode.style.visibility = '';
        domNode.style.top = `${editor.getTopForLineNumber(line) - scrollTop}px`;
        domNode.style.left = `${layout.contentLeft + band.start}px`;
        domNode.style.setProperty('--answer-column-width', `${band.width}px`);
        domNode.style.setProperty('--answer-leader', `${room}px`);
        domNode.style.setProperty('--inline-line-height', `${editor.getLineHeightForPosition({ lineNumber: line, column: 1 })}px`);
      }
      report(shown);
    };
    if (widgets.size === 0) {
      report(new Set());
      return;
    }
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(place);
    };
    schedule();
    const disposables = [
      editor.onDidScrollChange(schedule),
      editor.onDidLayoutChange(schedule),
      editor.onDidContentSizeChange(schedule),
      editor.onDidChangeModelContent(schedule),
    ];
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      for (const disposable of disposables) disposable.dispose();
    };
  }, [editor, widgets, ranLines, onShown, reserveLine, reserveWidth]);

  return (
    <>
      {answers.map(answer => {
        const live = widgets.get(answer.line);
        if (!live) return null;
        const content =
          answer.kind === 'running' ? (
            <LiveLine kind="running" lineMs={answer.lineMs} />
          ) : (
            <LiveLine
              kind="loop"
              pass={answer.pass}
              total={answer.total}
              bindingName={answer.binding?.name}
              bindingText={answer.binding?.value}
              language={language}
            />
          );
        return createPortal(content, live.domNode, live.widget.getId());
      })}
    </>
  );
}

type LoopLineProps = {
  readonly kind: 'loop';
  readonly pass: number;
  readonly total?: number;
  readonly bindingName?: string;
  readonly bindingText?: string;
  readonly language?: string;
};

type LiveLineProps = { readonly kind: 'running'; readonly lineMs: number } | LoopLineProps;

/** Flat props, so the 100 ms tick re-renders only the RUNNING line. */
const LiveLine = memo(function LiveLine(props: LiveLineProps) {
  return (
    <>
      <DotLeader className="lingua-inline-result-leader" />
      <span className="lingua-inline-result-body" data-live-kind={props.kind}>
        {props.kind === 'running' ? <RunningAnswerObject elapsedMs={props.lineMs} /> : <LiveLoop {...props} />}
      </span>
    </>
  );
});

function LiveLoop({ pass, total, bindingName, bindingText, language }: LoopLineProps) {
  const { now, locale } = useAnswerContext();
  const binding = useMemo(
    () =>
      bindingName !== undefined && bindingText !== undefined
        ? { name: bindingName, value: readAnswer({ text: bindingText, role: 'value', language }, { now, locale }) }
        : undefined,
    [bindingName, bindingText, language, now, locale]
  );
  return <LoopAnswerObject iteration={pass} total={total} binding={binding} />;
}
