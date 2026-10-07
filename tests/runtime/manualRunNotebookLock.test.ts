import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beginManualRun } from '../../src/renderer/runtime/manualRunSession';
import {
  claimNotebookRunner,
  resetNotebookRunnerLocksForTests,
} from '../../src/renderer/stores/notebookRunnerLockStore';
import { useResultStore } from '../../src/renderer/stores/resultStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import type { FileTab } from '../../src/renderer/types/editor';

const initialResultState = useResultStore.getState();

function tab(language: FileTab['language'], overrides: Partial<FileTab> = {}): FileTab {
  return { id: `tab-${language}`, name: 'main', language, content: '', isDirty: false, ...overrides };
}

beforeEach(() => {
  resetNotebookRunnerLocksForTests();
  useResultStore.setState(initialResultState, true);
  useUIStore.setState({ statusNotice: null });
});
afterEach(() => {
  useResultStore.getState().manualRunSession?.cancel();
  useResultStore.setState(initialResultState, true);
  resetNotebookRunnerLocksForTests();
});

describe('manual runs on a runner a notebook cell holds', () => {
  it('refuses the run with an info notice instead of terminating the cell', () => {
    claimNotebookRunner('python', 'notebook-tab');
    expect(beginManualRun(tab('python'))).toBeNull();
    expect(useResultStore.getState().isManualRunning).toBe(false);
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'info',
      messageKey: 'notebook.notice.runtimeHeldByNotebook',
    });
  });

  it('starts runs on other runners', () => {
    claimNotebookRunner('python', 'notebook-tab');
    expect(beginManualRun(tab('javascript'))).not.toBeNull();
  });

  it('starts a JavaScript run in an explicit runtime mode', () => {
    claimNotebookRunner('javascript', 'notebook-tab');
    expect(beginManualRun(tab('javascript', { runtimeMode: 'browser-preview' }))).not.toBeNull();
  });

  it('starts a Python Debug run, which uses the native debugger', () => {
    claimNotebookRunner('python', 'notebook-tab');
    expect(beginManualRun(tab('python'), true)).not.toBeNull();
  });

  it('starts again once the cell releases the runner', () => {
    const release = claimNotebookRunner('javascript', 'notebook-tab')!;
    expect(beginManualRun(tab('javascript'))).toBeNull();
    release();
    expect(beginManualRun(tab('javascript'))).not.toBeNull();
  });
});
