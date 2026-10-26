/** Transient renderer orchestration for the desktop project test runner. */

import {
  appendProjectTestOutput,
  type ProjectTestTranscript,
} from '../../shared/projectTestOutput';
import { create } from 'zustand';
import type {
  ProjectTestCandidate,
  ProjectTestCase,
  ProjectTestDetectionResult,
  ProjectTestFramework,
  ProjectTestRunResult,
  ProjectTestScope,
} from '../../shared/projectTests';
import type { RootId } from '../../shared/fs/brandedIds';
import { useSettingsStore } from './settingsStore';
import { useNativeExecutionGateStore } from './nativeExecutionGateStore';
import { useProjectStore } from './projectStore';

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
  liveOutput: { stdout: string; stderr: string; transcript?: ProjectTestTranscript };
  error: ProjectTestError;
  activeRunId: string | null;
  /** Every test the runner has reported so far; null until a run returns a readable report. */
  cases: ProjectTestCase[] | null;
  casesTruncated: boolean;
  runningScope: ProjectTestScope | null;
  filter: 'all' | 'failed';
  detect: (binding: ProjectTestBinding) => Promise<void>;
  selectFramework: (framework: ProjectTestFramework) => void;
  run: (binding: ProjectTestBinding, scope?: ProjectTestScope) => Promise<void>;
  stop: (binding: ProjectTestBinding) => Promise<void>;
  setFilter: (filter: 'all' | 'failed') => void;
}

const sameTest = (a: Pick<ProjectTestCase, 'file' | 'path'>, b: Pick<ProjectTestCase, 'file' | 'path'>) =>
  a.file === b.file && a.path.length === b.path.length && a.path.every((part, index) => part === b.path[index]);

/**
 * A scoped run updates only its own part of the list: a file run replaces that
 * file's tests, a single-test run that one test (runners report the rest of
 * the file as skipped when a name filter applies).
 */
export function mergeProjectTestCases(
  previous: readonly ProjectTestCase[] | null,
  scope: ProjectTestScope,
  incoming: readonly ProjectTestCase[]
): ProjectTestCase[] {
  if (scope.kind === 'all' || !previous) return [...incoming];
  if (scope.kind === 'test') {
    const fresh = incoming.find(entry => sameTest(entry, scope));
    if (!fresh) return [...previous];
    const at = previous.findIndex(entry => sameTest(entry, scope));
    return at < 0 ? [...previous, fresh] : previous.map((entry, index) => (index === at ? fresh : entry));
  }
  const fresh = incoming.filter(entry => entry.file === scope.file);
  const at = previous.findIndex(entry => entry.file === scope.file);
  const rest = previous.filter(entry => entry.file !== scope.file);
  if (at < 0) return [...rest, ...fresh];
  const before = previous.slice(0, at).filter(entry => entry.file !== scope.file);
  return [...before, ...fresh, ...rest.slice(before.length)];
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
  cases: null,
  casesTruncated: false,
  runningScope: null,
  filter: 'all',

  setFilter: filter => set({ filter }),

  detect: async binding => {
    const bridge = window.lingua?.projectTests;
    const previous = get();
    if (bridge && previous.rootId && previous.rootId !== binding.rootId && previous.activeRunId) {
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
      cases: null,
      casesTruncated: false,
      runningScope: null,
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
      const selectedFramework = defaultFramework(detection.candidates);
      set({ status: 'ready', detection, selectedFramework });
      const project = useProjectStore.getState().currentProject;
      if (selectedFramework && project?.rootId === binding.rootId) {
        useProjectStore.getState().setRecentTestRunner(project.id, selectedFramework);
      }
    } catch {
      if (get().rootId !== binding.rootId) return;
      set({ status: 'error', error: 'detect-failed' });
    }
  },

  selectFramework: selectedFramework =>
    set({ selectedFramework, result: null, error: null, cases: null, casesTruncated: false }),

  run: async (binding, scope = { kind: 'all' }) => {
    const bridge = window.lingua?.projectTests;
    const framework = get().selectedFramework;
    if (!bridge || !framework || get().status === 'running' || get().rootId !== binding.rootId) {
      return;
    }
    if (!useSettingsStore.getState().nativeExecutionAcknowledged) {
      useNativeExecutionGateStore.getState().request('project-tests', () => {
        if (get().rootId === binding.rootId) void get().run(binding, scope);
      });
      return;
    }
    const runId = createRunId();
    set({
      status: 'running',
      activeRunId: runId,
      runningScope: scope,
      result: null,
      liveOutput: { stdout: '', stderr: '' },
      error: null,
    });
    const unsubscribe = bridge.onOutput(event => {
      if (event.runId !== runId || get().activeRunId !== runId) return;
      set(state => ({
        liveOutput: {
          ...state.liveOutput,
          transcript: appendProjectTestOutput(state.liveOutput.transcript, event.chunk),
          [event.stream]: `${state.liveOutput[event.stream]}${event.chunk}`,
        },
      }));
    });
    try {
      const result = await bridge.run(binding.rootId, framework, runId, scope);
      if (get().activeRunId !== runId) return;
      set(state => ({
        status: 'ready',
        activeRunId: null,
        runningScope: null,
        result,
        ...(result.cases
          ? {
              cases: mergeProjectTestCases(state.cases, scope, result.cases),
              casesTruncated: scope.kind === 'all' ? result.casesTruncated === true : state.casesTruncated,
            }
          : {}),
      }));
    } catch {
      if (get().activeRunId !== runId) return;
      set({ status: 'error', activeRunId: null, runningScope: null, error: 'run-failed' });
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
