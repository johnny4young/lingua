import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notebookDocumentNotice } from '../../src/renderer/stores/notebookDocumentPersistence';
import { notebookConflictActions } from '../../src/renderer/stores/notebookConflictActions';
import { reloadTabFromDisk } from '../../src/renderer/hooks/projectWatchReload';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { subscribeCommand } from '../../src/renderer/stores/commandBus';
import type { FileTab } from '../../src/renderer/types/editor';

const originalBridge = Object.getOwnPropertyDescriptor(window, 'lingua');
const previousTabs = useEditorStore.getState().tabs;
let read: ReturnType<typeof vi.fn>;

function seedTab(overrides: Partial<FileTab> = {}): FileTab {
  const tab: FileTab = {
    id: 'tab',
    name: 'main.ts',
    language: 'typescript',
    content: 'local',
    rootId: 'root',
    relativePath: 'main.ts',
    isDirty: false,
    ...overrides,
  };
  useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
  return tab;
}

beforeEach(() => {
  read = vi.fn().mockResolvedValue('disk');
  Object.defineProperty(window, 'lingua', { configurable: true, value: { fs: { read } } });
  useUIStore.setState({ statusNotice: null });
});

afterEach(() => {
  if (originalBridge) Object.defineProperty(window, 'lingua', originalBridge);
  else Reflect.deleteProperty(window, 'lingua');
  useEditorStore.setState({ tabs: previousTabs });
  vi.restoreAllMocks();
});

describe('notebook conflict notice', () => {
  it('pushes a sticky conflict with Reload and Save As actions', () => {
    notebookDocumentNotice('conflict', notebookConflictActions('tab', true));
    const notice = useUIStore.getState().statusNotice;
    expect(notice?.tone).toBe('error');
    expect(notice?.messageKey).toBe('notebook.document.conflict');
    expect(notice?.actions?.map(action => action.labelKey)).toEqual([
      'git.externalReload.dirty.action',
      'commandPalette.action.saveAs.label',
    ]);
  });

  it('routes Reload through the editor.reloadFromDisk command', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommand('editor.reloadFromDisk', listener);
    try {
      notebookConflictActions('tab', true)[0]!.onClick();
      expect(listener).toHaveBeenCalledWith({ tabId: 'tab' }, expect.anything());
    } finally {
      unsubscribe();
    }
  });

  it('offers only Save As when the conflicting file is not the tab file', () => {
    expect(notebookConflictActions('tab', false).map(action => action.labelKey)).toEqual([
      'commandPalette.action.saveAs.label',
    ]);
  });

  it('routes Save As through saveTabById for the conflicting tab', async () => {
    const saveTabById = vi.fn().mockResolvedValue(true);
    useEditorStore.setState({ saveTabById });
    notebookConflictActions('tab', false)[0]!.onClick();
    await vi.waitFor(() => expect(saveTabById).toHaveBeenCalledWith('tab', true));
  });
});

describe('reloadTabFromDisk', () => {
  it('replaces a clean tab with the disk copy', async () => {
    seedTab();
    await expect(reloadTabFromDisk('tab')).resolves.toBe(true);
    expect(read).toHaveBeenCalledWith('root', 'main.ts');
    expect(useEditorStore.getState().tabs[0]?.content).toBe('disk');
  });

  it('keeps dirty edits when the user declines the discard confirmation', async () => {
    seedTab({ isDirty: true });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await expect(reloadTabFromDisk('tab')).resolves.toBe(false);
    expect(useEditorStore.getState().tabs[0]?.content).toBe('local');
  });

  it('is a no-op for tabs without a disk location', async () => {
    seedTab({ rootId: undefined, relativePath: undefined });
    await expect(reloadTabFromDisk('tab')).resolves.toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
});
