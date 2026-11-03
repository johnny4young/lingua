import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEphemeralStorageNotice } from '@/hooks/useEphemeralStorageNotice';
import { useEditorStore } from '@/stores/editorStore';
import { useUIStore } from '@/stores/uiStore';

function setDirty(isDirty: boolean): void {
  useEditorStore.setState({
    tabs: [{ id: 'tab', name: 'main.js', language: 'javascript', content: '', isDirty }],
    activeTabId: 'tab',
  });
}

function reloadIsGuarded(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('useEphemeralStorageNotice', () => {
  beforeEach(() => {
    useUIStore.getState().dismissStatusNotice();
    setDirty(false);
  });

  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.storage;
  });

  it('warns once on boot when storage is blocked', () => {
    document.documentElement.dataset.storage = 'memory';
    renderHook(() => useEphemeralStorageNotice());
    const notice = useUIStore.getState().statusNotice;
    expect(notice?.messageKey).toBe('storage.ephemeral.message');
    expect(notice?.tone).toBe('warning');
  });

  it('guards a reload only while a tab has edits, until unmount', () => {
    document.documentElement.dataset.storage = 'memory';
    const { unmount } = renderHook(() => useEphemeralStorageNotice());
    expect(reloadIsGuarded()).toBe(false);
    setDirty(true);
    expect(reloadIsGuarded()).toBe(true);
    unmount();
    expect(reloadIsGuarded()).toBe(false);
  });

  it('stays out of the way when storage works', () => {
    renderHook(() => useEphemeralStorageNotice());
    setDirty(true);
    expect(useUIStore.getState().statusNotice).toBeNull();
    expect(reloadIsGuarded()).toBe(false);
  });
});
