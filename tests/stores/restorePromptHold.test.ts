import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '@/stores/editorStore';
import { createDefaultTab } from '@/stores/editorTabUtils';
import {
  armPendingSessionRestoreSnapshot,
  clearPendingSessionRestoreSnapshot,
  holdRestorePrompt,
  releaseRestorePrompt,
  useSessionStore,
} from '@/stores/sessionStore';

describe('held restore prompt', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useSessionStore.setState({ savedTabs: [{ name: 'a.js', language: 'javascript', content: '1' }, { name: 'b.js', language: 'javascript', content: '2' }], savedActiveIndex: 0 });
    armPendingSessionRestoreSnapshot();
  });

  it('shows once a tab opens without a restore, and only once', () => {
    const show = vi.fn();
    holdRestorePrompt(show);
    expect(show).not.toHaveBeenCalled();
    useEditorStore.getState().addTab(createDefaultTab('javascript'));
    useEditorStore.getState().addTab(createDefaultTab('python'));
    releaseRestorePrompt();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('shows at once when a tab is already open', () => {
    const show = vi.fn();
    useEditorStore.getState().addTab(createDefaultTab('javascript'));
    holdRestorePrompt(show);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('keeps the tab that released the prompt when the prompt restores', async () => {
    holdRestorePrompt(vi.fn());
    useEditorStore.getState().addTab({ ...createDefaultTab('javascript'), name: 'kept.js' });
    await useSessionStore.getState().restoreSession();
    expect(useEditorStore.getState().tabs.map(tab => tab.name)).toEqual(['kept.js', 'a.js', 'b.js']);
  });

  it('stays quiet once the snapshot is gone or partly reopened', async () => {
    const show = vi.fn();
    holdRestorePrompt(show);
    clearPendingSessionRestoreSnapshot();
    releaseRestorePrompt();

    armPendingSessionRestoreSnapshot();
    holdRestorePrompt(show);
    await useSessionStore.getState().restoreSession({ only: 0 });
    expect(useEditorStore.getState().tabs.map(tab => tab.name)).toEqual(['a.js']);
    releaseRestorePrompt();
    expect(show).not.toHaveBeenCalled();
  });
});
