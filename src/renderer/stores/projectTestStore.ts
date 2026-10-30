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

/**
 * Renderer-only markers; never runner-reported outcomes or persisted state.
 * `reportedBy` is the scoped file whose run reported an off-scope diagnostic.
 */
export type ProjectTestDisplayCase = ProjectTestCase & { stale?: true; reportedBy?: string };

export const isProjectTestRunFailure = (entry: ProjectTestCase): boolean =>
  entry.status === 'failed' && entry.runnable === false && entry.path.length === 0;

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
  cases: ProjectTestDisplayCase[] | null;
  casesTruncated: boolean;
  runningScope: ProjectTestScope | null;
  filter: 'all' | 'failed';
  /** The failed test the editor shows a card for; its result is read from `cases`. */
  focusedFailure: Pick<ProjectTestCase, 'file' | 'path'> | null;
  detect: (binding: ProjectTestBinding) => Promise<void>;
  selectFramework: (framework: ProjectTestFramework) => void;
  run: (binding: ProjectTestBinding, scope?: ProjectTestScope) => Promise<void>;
  stop: (binding: ProjectTestBinding) => Promise<void>;
  setFilter: (filter: 'all' | 'failed') => void;
  focusFailure: (test: Pick<ProjectTestCase, 'file' | 'path'> | null) => void;
}

const sameTest = (a: Pick<ProjectTestCase, 'file' | 'path'>, b: Pick<ProjectTestCase, 'file' | 'path'>) =>
  a.file === b.file && a.path.length === b.path.length && a.path.every((part, index) => part === b.path[index]);

/**
 * A scoped run updates only its own part of the list: a file run replaces that
 * file's tests, a single-test run that one test (runners report the rest of
 * the file as skipped when a name filter applies).
 */
export function mergeProjectTestCases(
  previous: readonly ProjectTestDisplayCase[] | null,
  scope: ProjectTestScope,
  incoming: readonly ProjectTestCase[]
): ProjectTestDisplayCase[] {
  if (scope.kind === 'all') return [...incoming];
  const prior = previous ?? [];
  const inScope = (entry: ProjectTestCase) =>
    scope.kind === 'test' ? sameTest(entry, scope) : entry.file === scope.file;
  const failures = incoming.filter(isProjectTestRunFailure);
  const fresh = incoming.filter(entry => inScope(entry) || isProjectTestRunFailure(entry));
  // Each scoped run replaces the diagnostics its earlier runs reported, dependency ones included.
  const cleared = prior.filter(
    entry => !(isProjectTestRunFailure(entry) && (entry.file === scope.file || entry.reportedBy === scope.file))
  );
  if (failures.length > 0) {
    // Build/file diagnostics have no test name and may belong to a dependency,
    // so keep them even off-scope. Earlier results in scope become history;
    // results outside the scope were not touched by this run.
    return [
      ...cleared.filter(entry => !fresh.some(next => sameTest(entry, next)))
        .map(entry => (inScope(entry) ? { ...entry, stale: true as const } : entry)),
      ...fresh.map(entry => (entry.file === scope.file ? entry : { ...entry, reportedBy: scope.file })),
    ];
  }
  if (scope.kind === 'test') {
    const test = fresh.find(entry => sameTest(entry, scope));
    if (!test) return prior.map(entry => sameTest(entry, scope) ? { ...entry, stale: true } : entry);
    const at = cleared.findIndex(entry => sameTest(entry, scope));
    return at < 0 ? [...cleared, test] : cleared.map((entry, index) => (index === at ? test : entry));
  }
  const at = cleared.findIndex(entry => entry.file === scope.file);
  const rest = cleared.filter(entry => entry.file !== scope.file);
  if (at < 0) return [...rest, ...fresh];
  const before = cleared.slice(0, at).filter(entry => entry.file !== scope.file);
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
  focusedFailure: null,

  setFilter: filter => set({ filter }),
  focusFailure: test => set({ focusedFailure: test ? { file: test.file, path: [...test.path] } : null }),

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
      focusedFailure: null,
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
    set({ selectedFramework, result: null, error: null, cases: null, casesTruncated: false, focusedFailure: null }),

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
      const project = useProjectStore.getState().currentProject;
      if (project?.rootId === binding.rootId) useProjectStore.getState().setRecentTestRunner(project.id, framework);
      set(state => {
        if (!result.cases) return { status: 'ready', activeRunId: null, runningScope: null, result };
        const cases = mergeProjectTestCases(state.cases, scope, result.cases);
        const focused = state.focusedFailure;
        // The card closes once its test stops failing.
        const stillFailing = focused && cases.some(entry => sameTest(entry, focused) && entry.status === 'failed');
        return {
          status: 'ready',
          activeRunId: null,
          runningScope: null,
          result,
          cases,
          casesTruncated: scope.kind === 'all' ? result.casesTruncated === true : state.casesTruncated,
          focusedFailure: stillFailing ? focused : null,
        };
      });
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
