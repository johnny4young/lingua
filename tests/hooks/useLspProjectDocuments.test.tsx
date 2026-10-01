import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLspDocumentSync, LSP_DOCUMENT_SYNC_DEBOUNCE_MS } from '@/hooks/useLspLifecycle';
import { useEditorStore } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';
import { createLspLanguageStore } from '@/stores/lspLanguageStoreFactory';
import { asRootId, asRelativePath } from '../../src/shared/fs/brandedIds';

const store = createLspLanguageStore();
const root = asRootId('project-buffer-test');
const openDocument = vi.fn();
const closeDocument = vi.fn();
const adapter = { openDocument, closeDocument };
const getAdapter = () => adapter;
const loadAdapter = async () => adapter;
const tab = (id: string, content: string) => ({
  id,
  name: `${id}.rs`,
  language: 'rust',
  content,
  rootId: root,
  relativePath: asRelativePath(`${id}.rs`),
  filePath: `/fixture/${id}.rs`,
  isDirty: true,
});
function Harness({ active }: { active: string }) {
  const current = useEditorStore.getState().tabs.find(tab => tab.id === active)!;
  useLspDocumentSync(
    { getModel: () => ({ uri: { toString: () => `file:///fixture/${active}.rs` } }) },
    current,
    { language: 'rust', store, getAdapter, loadAdapter }
  );
  return null;
}
const sync = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(LSP_DOCUMENT_SYNC_DEBOUNCE_MS);
  });

describe('project LSP buffer ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    store.getState().setStatus({ kind: 'available', version: 'fixture' });
    useProjectStore.setState({
      currentProject: {
        id: 'project',
        name: 'fixture',
        rootPath: '/fixture',
        openedAt: 0,
        rootId: root,
      },
    });
    useEditorStore.setState({
      tabs: [tab('main', 'mod helper;'), tab('helper', '// dirty\npub fn hello() {}')],
      activeTabId: 'helper',
    });
  });
  afterEach(() => {
    cleanup();
    useProjectStore.setState({ currentProject: null });
    useEditorStore.setState({ tabs: [], activeTabId: null });
    vi.useRealTimers();
  });

  it('keeps inactive dirty siblings synchronized without closing on focus changes', async () => {
    const view = render(<Harness active="helper" />);
    await sync();
    expect(openDocument).toHaveBeenCalledWith(
      'file:///fixture/helper.rs',
      '// dirty\npub fn hello() {}'
    );
    expect(openDocument).toHaveBeenCalledWith('file:///fixture/main.rs', 'mod helper;');
    act(() => useEditorStore.setState({ activeTabId: 'main' }));
    view.rerender(<Harness active="main" />);
    await sync();
    expect(closeDocument).not.toHaveBeenCalled();
    act(() =>
      useEditorStore.setState({
        tabs: [tab('main', 'mod helper;'), tab('helper', '// newer unsaved')],
      })
    );
    await sync();
    expect(openDocument).toHaveBeenLastCalledWith('file:///fixture/helper.rs', '// newer unsaved');
    view.unmount();
    expect(closeDocument.mock.calls.map(([uri]) => uri).sort()).toEqual([
      'file:///fixture/helper.rs',
      'file:///fixture/main.rs',
    ]);
  });
  it('closes removed tabs and drops all documents after root revocation', async () => {
    render(<Harness active="main" />);
    await sync();
    act(() => useEditorStore.setState({ tabs: [tab('main', 'mod helper;')] }));
    await sync();
    expect(closeDocument).toHaveBeenCalledWith('file:///fixture/helper.rs');
    act(() => useProjectStore.setState({ currentProject: null }));
    await sync();
    expect(closeDocument).toHaveBeenCalledWith('file:///fixture/main.rs');
  });
  it('does not reopen buffers when an async adapter resolves after unmount', async () => {
    let resolve!: (adapter: typeof adapter) => void;
    function Delayed() {
      useLspDocumentSync(null, null, {
        language: 'rust',
        store,
        getAdapter,
        loadAdapter: () =>
          new Promise(done => {
            resolve = done;
          }),
      });
      return null;
    }
    const view = render(<Delayed />);
    await sync();
    view.unmount();
    await act(async () => {
      resolve(adapter);
      await Promise.resolve();
    });
    expect(openDocument).not.toHaveBeenCalled();
  });
});
