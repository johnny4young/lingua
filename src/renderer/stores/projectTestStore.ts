/** Transient renderer orchestration for the desktop project test runner. */

import { create } from 'zustand';
import type {
  ProjectTestCandidate,
  ProjectTestDetectionResult,
  ProjectTestFramework,
  ProjectTestRunResult,
} from '../../shared/projectTests';
import type { RootId } from '../../shared/fs/brandedIds';
import { useSettingsStore } from './settingsStore';
import { useNativeExecutionGateStore } from './nativeExecutionGateStore';

export interface ProjectTestBinding {
  rootId: RootId;
  projectName: string;
}

type ProjectTestStatus = 'idle' | 'detecting' | 'ready' | 'running' | 'error';
type ProjectTestError = 'detect-failed' | 'run-failed' | null;

interface ProjectTestState {
  rootId: RootId | null;
  projectName: string | null;
  status: ProjectTestStatus;
  detection: ProjectTestDetectionResult | null;
  selectedFramework: ProjectTestFramework | null;
  result: ProjectTestRunResult | null;
  liveOutput: { stdout: string; stderr: string };
  error: ProjectTestError;
  activeRunId: string | null;
  detect: (binding: ProjectTestBinding) => Promise<void>;
  selectFramework: (framework: ProjectTestFramework) => void;
  run: (binding: ProjectTestBinding) => Promise<void>;
  stop: (binding: ProjectTestBinding) => Promise<void>;
}

function defaultFramework(
  candidates: readonly ProjectTestCandidate[]
): ProjectTestFramework | null {
  return (
    candidates.find(candidate => candidate.available)?.framework ?? candidates[0]?.framework ?? null
  );
}

function createRunId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  const id =
    typeof randomUUID === 'function'
      ? randomUUID.call(globalThis.crypto)
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `project-tests-${id}`;
}

export const useProjectTestStore = create<ProjectTestState>((set, get) => ({
  rootId: null,
  projectName: null,
  status: 'idle',
  detection: null,
  selectedFramework: null,
  result: null,
  liveOutput: { stdout: '', stderr: '' },
  error: null,
  activeRunId: null,

  detect: async binding => {
    const bridge = window.lingua?.projectTests;
    const previous = get();
    if (
      bridge &&
      previous.rootId &&
      previous.rootId !== binding.rootId &&
      previous.activeRunId
    ) {
      await bridge.stop(previous.rootId, previous.activeRunId).catch(() => ({ stopped: false }));
    }
    set({
      rootId: binding.rootId,
      projectName: binding.projectName,
      status: 'detecting',
      detection: null,
      selectedFramework: null,
      result: null,
      liveOutput: { stdout: '', stderr: '' },
      error: null,
      activeRunId: null,
    });
    if (!bridge) {
      set({ status: 'ready', detection: { kind: 'none', candidates: [] } });
      return;
    }

    try {
      const detection = await bridge.detect(binding.rootId);
      // A project switch while detection was in flight must not install stale
      // candidates into the new project's surface.
      if (get().rootId !== binding.rootId) return;
      set({
        status: 'ready',
        detection,
        selectedFramework: defaultFramework(detection.candidates),
      });
    } catch {
      if (get().rootId !== binding.rootId) return;
      set({ status: 'error', error: 'detect-failed' });
    }
  },

  selectFramework: selectedFramework => set({ selectedFramework, result: null, error: null }),

  run: async binding => {
    const bridge = window.lingua?.projectTests;
    const framework = get().selectedFramework;
    if (!bridge || !framework || get().status === 'running' || get().rootId !== binding.rootId) {
      return;
    }
    if (!useSettingsStore.getState().nativeExecutionAcknowledged) {
      useNativeExecutionGateStore.getState().request('project-tests', () => {
        if (get().rootId === binding.rootId) void get().run(binding);
      });
      return;
    }
    const runId = createRunId();
    set({
      status: 'running',
      activeRunId: runId,
      result: null,
      liveOutput: { stdout: '', stderr: '' },
      error: null,
    });
    const unsubscribe = bridge.onOutput(event => {
      if (event.runId !== runId || get().activeRunId !== runId) return;
      set(state => ({
        liveOutput: {
          ...state.liveOutput,
          [event.stream]: `${state.liveOutput[event.stream]}${event.chunk}`,
        },
      }));
    });
    try {
      const result = await bridge.run(binding.rootId, framework, runId);
      if (get().activeRunId !== runId) return;
      set({ status: 'ready', activeRunId: null, result });
    } catch {
      if (get().activeRunId !== runId) return;
      set({ status: 'error', activeRunId: null, error: 'run-failed' });
    } finally {
      unsubscribe();
    }
  },

  stop: async binding => {
    const bridge = window.lingua?.projectTests;
    const runId = get().activeRunId;
    if (!bridge || !runId) return;
    await bridge.stop(binding.rootId, runId).catch(() => ({ stopped: false }));
  },
}));
