import { create } from 'zustand';
import { isEntitled } from '../../shared/entitlements';
import { TIMELINE_FREE_STEPS, type ExecutionTimeline, type TimelineStep } from '../../shared/timeline';
import { currentEffectiveTier } from './licenseSelectors';
import { useEditorStore } from './editorStore';
import { findTimelineStep, type TimelineMove } from '../utils/timelineModel';

interface TimelineRecording {
  tabId: string;
  steps: TimelineStep[];
  /** Steps the run recorded, before the Free slice. */
  total: number;
  truncated: boolean;
  /** Free kept only the last steps. */
  limited: boolean;
}

interface TimelineState {
  recording: TimelineRecording | null;
  current: number;
  publish: (tabId: string, timeline: ExecutionTimeline) => void;
  select: (index: number) => void;
  step: (delta: number) => void;
  /** Moves by depth; a move with nowhere to go bumps `blocked` and keeps the step. */
  go: (move: TimelineMove, backward: boolean) => boolean;
  /** Counts moves that had nowhere to go, so the editor can flash the line. */
  blocked: number;
  clearTab: (tabId: string) => void;
}

/** The latest Record run, in memory only. It opens on the step where the run ended. */
let watchingTabs = false;

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
  publish: (tabId, timeline) => {
    let entitled: boolean;
    try {
      entitled = isEntitled(currentEffectiveTier(), 'EXECUTION_HISTORY');
    } catch {
      entitled = false;
    }
    dropRecordingWithItsTab();
    const total = timeline.steps.length;
    const steps = entitled ? timeline.steps : timeline.steps.slice(-TIMELINE_FREE_STEPS);
    set({
      recording: { tabId, steps, total, truncated: timeline.truncated, limited: steps.length < total },
      current: Math.max(0, steps.length - 1),
    });
  },
  select: index => {
    const count = get().recording?.steps.length ?? 0;
    if (count > 0) set({ current: Math.min(count - 1, Math.max(0, index)) });
  },
  step: delta => get().select(get().current + delta),
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
