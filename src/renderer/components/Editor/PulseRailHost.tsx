import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type * as monacoTypes from 'monaco-editor';
import { useShallow } from 'zustand/react/shallow';
import { useDebuggerStore } from '../../stores/debuggerStore';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useLiveRunStore } from '../../stores/liveRunStore';
import { useResultStore } from '../../stores/resultStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { useUIStore } from '../../stores/uiStore';
import type { TimelineStep } from '../../../shared/timeline';
import { buildPulseRail, PULSE_RAIL_SLOTS, type PulseRailInput, type PulseRailLine } from '../../utils/pulseRail';
import { railDecoration } from './pulseRailDecoration';
import { statementEndLine } from './answerColumnGeometry';
import '../ui/identity.css';
import './pulseRail.css';

/** How long the travel classes stay on: every slot's delay plus one light, at the 120 ms --motion-pulse-line. */
const TRAVEL_MS = 120 * (1 + PULSE_RAIL_SLOTS / 3) + 80;

function railFrontier(
  pausedLine: number | null,
  step: TimelineStep | undefined,
  errorLine: number | null
): PulseRailInput['frontier'] {
  if (pausedLine !== null) return { line: pausedLine, kind: 'paused' };
  if (step && step.line > 0) return { line: step.line, kind: step.error ? 'raised' : 'running' };
  if (errorLine !== null) return { line: errorLine, kind: 'raised' };
  return null;
}

/**
 * The run rail between the line numbers and the code: a tick on each line the
 * run reached, dots where it did not, a beat on the line a run in flight is on
 * or on the selected timeline step, a
 * cross where it threw and a held mark where the debugger paused. Each
 * completed run sends the pulse down the rail once.
 */
export function PulseRailHost({
  editor,
  monaco,
  tabId,
  stale = false,
  held = false,
}: {
  editor: monacoTypes.editor.IStandaloneCodeEditor | null;
  monaco: typeof monacoTypes | null;
  tabId: string | null;
  /** The editor holds other code than the run: line numbers no longer match, so the marks stay where Monaco moved them. */
  stale?: boolean;
  /** A run in flight has not answered yet: the previous run's marks stay where they are. */
  held?: boolean;
}) {
  const results = useResultStore(
    useShallow(state => ({
      lineResults: state.lineResults,
      lineTimings: state.lineTimings,
      failed: state.error !== null,
      errorLine: state.error?.line ?? null,
      ranTab: state.ranCode?.tabId ?? null,
      span: state.ranCode?.span,
      running: state.isAutoRunning || state.isManualRunning,
      succeeded: state.runTermination?.kind === 'success',
    }))
  );
  const recording = useTimelineStore(state => (state.recording && state.recording.tabId === tabId ? state.recording : null));
  const current = useTimelineStore(state => state.current);
  const timelineOpen = useUIStore(state => state.consoleVisible && state.activeBottomPanel === 'timeline');
  const pausedLine = useDebuggerStore(state => (state.pausedFrame?.tabId === tabId ? state.pausedFrame.line : null));
  const pausedReached = useDebuggerStore(state => (state.pausedFrame?.tabId === tabId ? state.pausedFrame.reachedLines : undefined));
  const lastRun = useExecutionHistoryStore(
    useShallow(state => ({ id: state.entries.at(-1)?.id ?? null, tabId: state.entries.at(-1)?.tabId ?? null }))
  );
  const lastRunId = lastRun.id;
  const [travelRun, setTravelRun] = useState<string | null>(null);
  const [seenRun, setSeenRun] = useState(lastRunId);
  const decorations = useRef<monacoTypes.editor.IEditorDecorationsCollection | null>(null);

  // A new run of this tab after mount sends the pulse; the run already on screen does not.
  if (lastRunId !== seenRun) {
    setSeenRun(lastRunId);
    if (lastRunId && lastRun.tabId === tabId) setTravelRun(lastRunId);
  }
  useEffect(() => {
    if (!travelRun) return;
    const timer = setTimeout(() => setTravelRun(null), TRAVEL_MS);
    return () => clearTimeout(timer);
  }, [travelRun]);

  // Monaco drops the editor's decorations from a model it detaches, so a tab switch redraws on the new one.
  const subscribeModel = useCallback(
    (onChange: () => void) => {
      const subscription = editor?.onDidChangeModel(onChange);
      return () => subscription?.dispose();
    },
    [editor]
  );
  const model = useSyncExternalStore(subscribeModel, () => editor?.getModel() ?? null);

  const source = useMemo<Omit<PulseRailInput, 'lines'> | null>(() => {
    if (!tabId) return null;
    const ownsResults = results.ranTab === tabId;
    // A JS pause knows every line the session ran, so code it never reached stays dotted.
    if (pausedLine !== null && pausedReached) {
      return { executed: pausedReached, complete: true, frontier: { line: pausedLine, kind: 'paused' }, finished: false };
    }
    const stepLines = (recording ? (timelineOpen ? recording.steps.slice(0, current + 1) : recording.steps) : []).map(
      step => step.line
    );
    const complete = Boolean(recording && !recording.limited && !recording.truncated);
    const answered = ownsResults && !complete ? [...results.lineResults, ...results.lineTimings].map(entry => entry.line) : [];
    const step = recording && timelineOpen ? recording.steps[current] : undefined;
    return {
      executed: [...stepLines, ...answered],
      complete,
      frontier: railFrontier(pausedLine, step, ownsResults ? results.errorLine : null),
      finished: ownsResults && !results.running && results.succeeded && !results.failed,
      ...(ownsResults && results.span ? { span: results.span } : {}),
    };
  }, [tabId, results, recording, timelineOpen, current, pausedLine, pausedReached]);

  // Rebuilt when the run or its frontier changes, never on edits: Monaco carries the marks with the text.
  const rail = useMemo(() => {
    if (!model || !source || held) return [];
    const lines = model.getLinesContent();
    // Brace languages would read a block's body as part of its header, such as an if that never entered.
    const statementEnd =
      model.getLanguageId() === 'python'
        ? (line: number) => statementEndLine(at => lines[at - 1] ?? '', line, lines.length, 'python')
        : undefined;
    return buildPulseRail({ ...source, lines, ...(statementEnd ? { statementEnd } : {}) });
  }, [model, source, held]);
  useEffect(() => {
    if (!editor || !monaco || stale || held) return;
    // The trail fades with distance above the selected step, not from the top of the rail.
    const front = rail.find(line => line.state === 'running')?.line;
    const top = rail.find(line => line.slot !== null)?.line ?? 1;
    const trailSlot = ({ line, slot }: PulseRailLine) =>
      front !== undefined && slot !== null && line < front
        ? Math.round(((line - top) / Math.max(1, front - top)) * (PULSE_RAIL_SLOTS - 1))
        : null;
    const next = rail.map(line => railDecoration(monaco, line, travelRun !== null, trailSlot(line)));
    if (decorations.current) decorations.current.set(next);
    else decorations.current = editor.createDecorationsCollection(next);
  }, [editor, monaco, rail, travelRun, stale, held]);

  // The run in flight beats on the line it is on, over the marks the previous run left.
  const liveLine = useLiveRunStore(state => (tabId ? (state.byTab[tabId]?.live.line ?? null) : null));
  const beat = useRef<monacoTypes.editor.IEditorDecorationsCollection | null>(null);
  useEffect(() => {
    if (!editor || !monaco) return;
    const next =
      liveLine === null || pausedLine !== null || stale ? [] : [railDecoration(monaco, { line: liveLine, state: 'running', slot: null }, false, null)];
    if (beat.current) beat.current.set(next);
    else beat.current = editor.createDecorationsCollection(next);
  }, [editor, monaco, liveLine, pausedLine, stale, model]);

  // The held ring follows the pause even while the rail is stale, so it always marks the line the debugger holds.
  const hold = useRef<monacoTypes.editor.IEditorDecorationsCollection | null>(null);
  useEffect(() => {
    if (!editor || !monaco) return;
    const next =
      pausedLine === null
        ? []
        : [{ range: new monaco.Range(pausedLine, 1, pausedLine, 1), options: { linesDecorationsClassName: 'lingua-rail-hold' } }];
    if (hold.current) hold.current.set(next);
    else hold.current = editor.createDecorationsCollection(next);
  }, [editor, monaco, pausedLine, model]);

  useEffect(
    () => () => {
      decorations.current?.clear();
      hold.current?.clear();
      beat.current?.clear();
    },
    []
  );

  return null;
}
