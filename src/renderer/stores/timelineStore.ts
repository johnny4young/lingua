import { create } from 'zustand';
import { isEntitled } from '../../shared/entitlements';
import { TIMELINE_FREE_STEPS, TIMELINE_MAX_STEPS, type ExecutionTimeline, type TimelineStep, type TimelineStepMarks } from '../../shared/timeline';
import { currentEffectiveTier } from './licenseSelectors';
import { useEditorStore } from './editorStore';
import { findTimelineStep, type TimelineMove } from '../utils/timelineModel';

export interface TimelineRecording {
  tabId: string;
  steps: TimelineStep[];
  /** Steps the run recorded, before the Free slice. */
  total: number;
  truncated: boolean;
  /** Free kept only the last steps. */
  limited: boolean;
  /** Paid tiers see the whole run, its trace and its time per line. */
  entitled: boolean;
  /** Run time when recording ended; see `ExecutionTimeline.ms`. */
  ms?: number;
  /** The tab's code when the recording arrived, so line labels survive later edits. */
  code: string;
  /** The run is still going: steps arrive as it records them. */
  live?: true;
}

interface TimelineState {
  recording: TimelineRecording | null;
  current: number;
  publish: (tabId: string, timeline: ExecutionTimeline, code?: string) => void;
  /** Appends the steps a recording in flight posted, after `marks` for the step it posted last; the first call starts it. */
  grow: (tabId: string, steps: TimelineStep[], ms: number, code?: string, marks?: TimelineStepMarks) => void;
  /** A recording in flight whose run ended without its timeline: kept as cut short, or dropped. A run that threw marks its latest step when it is on `errorLine`. */
  endLive: (tabId: string, keep: boolean, errorLine?: number) => void;
  select: (index: number) => void;
  /** Moves by `delta` steps; at the first or last step it bumps `blocked` instead, as `go` does. */
  step: (delta: number) => boolean;
  /** Moves by depth; a move with nowhere to go bumps `blocked` and keeps the step. */
  go: (move: TimelineMove, backward: boolean) => boolean;
  /** Counts moves that had nowhere to go, so the editor can flash the line. */
  blocked: number;
  clearTab: (tabId: string) => void;
}

/** The latest Record run, in memory only. It opens on the step where the run ended. */
let watchingTabs = false;

function entitledNow(): boolean {
  try {
    return isEntitled(currentEffectiveTier(), 'EXECUTION_HISTORY');
  } catch {
    return false;
  }
}

/** `timeline` as the store keeps it: Free sees its last steps of `total`. */
function recordingOf(tabId: string, timeline: ExecutionTimeline, total: number, entitled: boolean, code: string): TimelineRecording {
  const steps = entitled ? timeline.steps : timeline.steps.slice(-TIMELINE_FREE_STEPS);
  return {
    tabId,
    steps,
    total,
    truncated: timeline.truncated,
    limited: steps.length < total,
    entitled,
    code,
    ...(timeline.ms !== undefined ? { ms: timeline.ms } : {}),
  };
}

/** Replaces the marks of `steps[index]` in place; `steps` must be a fresh array. */
function mark(steps: TimelineStep[], index: number, marks: TimelineStepMarks): TimelineStep[] {
  const step = steps[index];
  if (step) steps[index] = { ...step, ...marks };
  return steps;
}

/** A recording goes with its tab, so a closed tab does not keep its steps in memory. */
function dropRecordingWithItsTab(): void {
  if (watchingTabs) return;
  watchingTabs = true;
  useEditorStore.subscribe(state => {
    const tabId = useTimelineStore.getState().recording?.tabId;
    if (tabId !== undefined && !state.tabs.some(tab => tab.id === tabId)) useTimelineStore.getState().clearTab(tabId);
  });
}

export const useTimelineStore = create<TimelineState>()((set, get) => ({
  recording: null,
  current: 0,
  blocked: 0,
  publish: (tabId, timeline, code = '') => {
    dropRecordingWithItsTab();
    const recording = recordingOf(tabId, timeline, timeline.steps.length, entitledNow(), code);
    set({ recording, current: Math.max(0, recording.steps.length - 1) });
  },
  grow: (tabId, steps, ms, code = '', marks) => {
    const previous = get().recording;
    // One recording in flight at a time: another tab's steps wait for its own final timeline.
    if (previous?.live && previous.tabId !== tabId) return;
    const growing = previous?.live ? previous : null;
    if (!growing && steps.length === 0) return;
    dropRecordingWithItsTab();
    const joined = (growing ? growing.steps.concat(steps) : steps).slice(0, TIMELINE_MAX_STEPS);
    if (growing && marks) mark(joined, growing.steps.length - 1, marks);
    const total = Math.min(TIMELINE_MAX_STEPS, (growing?.total ?? 0) + steps.length);
    const entitled = growing ? growing.entitled : entitledNow();
    const recording = { ...recordingOf(tabId, { steps: joined, truncated: false, ms }, total, entitled, growing?.code ?? code), live: true as const };
    // The selection follows the run unless the user moved it back.
    const following = !growing || !entitled || get().current >= growing.steps.length - 1;
    set({ recording, current: following ? Math.max(0, recording.steps.length - 1) : get().current });
  },
  endLive: (tabId, keep, errorLine) => {
    const recording = get().recording;
    if (!recording?.live || recording.tabId !== tabId) return;
    if (!keep) {
      set({ recording: null, current: 0 });
      return;
    }
    const { live: _live, ...rest } = recording;
    // Steps since the last post never arrived, so only a latest step on the thrown line is known to be the one.
    const last = rest.steps.length - 1;
    const steps = errorLine !== undefined && rest.steps[last]?.line === errorLine ? mark([...rest.steps], last, { error: true }) : rest.steps;
    set({ recording: { ...rest, truncated: true, steps } });
  },
  select: index => {
    const count = get().recording?.steps.length ?? 0;
    if (count > 0) set({ current: Math.min(count - 1, Math.max(0, index)) });
  },
  step: delta => {
    const before = get().current;
    get().select(before + delta);
    if (delta === 0 || get().current !== before) return true;
    set(state => ({ blocked: state.blocked + 1 }));
    return false;
  },
  go: (move, backward) => {
    const steps = get().recording?.steps ?? [];
    const target = findTimelineStep(steps, get().current, move, backward);
    if (target === null) {
      set(state => ({ blocked: state.blocked + 1 }));
      return false;
    }
    set({ current: target });
    return true;
  },
  clearTab: tabId => {
    if (get().recording?.tabId === tabId) set({ recording: null, current: 0 });
  },
}));
