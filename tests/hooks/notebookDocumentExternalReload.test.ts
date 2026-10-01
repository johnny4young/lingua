import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyNotebookReloadCandidate,
  readNotebookReloadCandidate,
} from '../../src/renderer/hooks/notebookDocumentExternalReload';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import {
  resetNotebookStoreForTests,
  useNotebookStore,
} from '../../src/renderer/stores/notebookStore';
import { notebookDocumentSnapshot } from '../../src/renderer/stores/notebookDocumentPersistence';
import { serializeNotebookDocument } from '../../src/shared/notebookDocument';
import { computeContentHash } from '../../src/shared/contentHash';
import type { FileTab } from '../../src/renderer/types/editor';
import type { NotebookV1 } from '../../src/shared/notebook';
import type { ReloadCandidate } from '../../src/renderer/hooks/projectWatchReload';

const { dispose } = vi.hoisted(() => ({ dispose: vi.fn() }));
vi.mock('../../src/renderer/runtime/notebookSession', () => ({ disposeNotebookSession: dispose }));

const diskNotebook: NotebookV1 = {
  version: 1,
  id: 'document',
  title: 'Notebook',
  cells: [
    {
      kind: 'code',
      id: 'cell',
      language: 'javascript',
      source: 'console.log(2)',
      outputs: [{ kind: 'text', text: '2', stream: 'stdout' }],
    },
  ],
};
const disk = serializeNotebookDocument(diskNotebook, { executionOrder: { cell: 2 } });
let tab: FileTab;
let candidate: ReloadCandidate;
let read: ReturnType<typeof vi.fn>;
const previousTabs = useEditorStore.getState().tabs;
const previousActive = useEditorStore.getState().activeTabId;
const originalBridge = Object.getOwnPropertyDescriptor(window, 'lingua');

beforeEach(() => {
  resetNotebookStoreForTests();
  dispose.mockClear();
  useNotebookStore.getState().installImportedNotebook('tab', {
    ...diskNotebook,
    cells: [
      { kind: 'code', id: 'cell', language: 'javascript', source: 'console.log(1)', outputs: [] },
    ],
  });
  const content = notebookDocumentSnapshot('tab')!;
  tab = {
    id: 'tab',
    name: 'notes.linguanb',
    language: 'javascript',
    kind: 'notebook',
    content,
    rootId: 'root',
    relativePath: 'notes.linguanb',
    isDirty: false,
  };
  useEditorStore.setState({ tabs: [tab], activeTabId: 'tab' });
  candidate = {
    tabId: 'tab',
    tabName: tab.name,
    diskSnapshot: disk,
    isDirty: false,
    notebookSnapshot: content,
    rootId: 'root',
    relativePath: 'notes.linguanb',
  };
  read = vi.fn().mockResolvedValue(disk);
  Object.defineProperty(window, 'lingua', { configurable: true, value: { fs: { read } } });
});
afterEach(() => {
  if (originalBridge) Object.defineProperty(window, 'lingua', originalBridge);
  else Reflect.deleteProperty(window, 'lingua');
  resetNotebookStoreForTests();
  useEditorStore.setState({ tabs: previousTabs, activeTabId: previousActive });
});

describe('notebook external reload evidence', () => {
  it('ignores the current saved disk hash even when formatting differs', async () => {
    tab.notebookDocumentHash = await computeContentHash(disk);
    expect(await readNotebookReloadCandidate(tab, tab, disk)).toBeNull();
  });
  it('records the current document snapshot without executing it', async () => {
    expect(await readNotebookReloadCandidate(tab, tab, disk)).toEqual(candidate);
    expect(dispose).not.toHaveBeenCalled();
  });
  it('requires fresh confirmation for edits made after a notice', async () => {
    useNotebookStore.getState().updateCellSource('tab', 'cell', 'local edit');
    const confirm = vi.fn(() => false);
    await applyNotebookReloadCandidate(tab, candidate, confirm);
    expect(confirm).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(notebookDocumentSnapshot('tab')).toContain('local edit');
    expect(dispose).not.toHaveBeenCalled();
  });
  it('refuses changed disk bytes after the notice', async () => {
    read.mockResolvedValue('changed again');
    await applyNotebookReloadCandidate(tab, candidate, () => true);
    expect(dispose).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs[0].content).toBe(tab.content);
  });
  it('preserves edits made while rereading disk', async () => {
    read.mockImplementation(async () => {
      useNotebookStore.getState().updateCellSource('tab', 'cell', 'in flight');
      return disk;
    });
    await applyNotebookReloadCandidate(tab, candidate, () => true);
    expect(dispose).not.toHaveBeenCalled();
    expect(notebookDocumentSnapshot('tab')).toContain('in flight');
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });
  it('rejects a root change while rereading disk', async () => {
    read.mockImplementation(async () => {
      useEditorStore.setState({ tabs: [{ ...tab, rootId: 'replacement' }] });
      return disk;
    });
    await applyNotebookReloadCandidate(tab, candidate, () => true);
    expect(dispose).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs[0].rootId).toBe('replacement');
  });
  it('reloads complete disk evidence only after tearing down the old heap', async () => {
    await applyNotebookReloadCandidate(tab, candidate, () => true);
    expect(dispose).toHaveBeenCalledExactlyOnceWith('tab');
    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      content: disk,
      isDirty: false,
      notebookDocumentHash: await computeContentHash(disk),
    });
    const slice = useNotebookStore.getState().notebooks.tab;
    expect(slice.notebook).toEqual(diskNotebook);
    expect(slice.cellExecutionOrder).toEqual({ cell: 2 });
  });
});
